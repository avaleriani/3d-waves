/**
 * Hybrid Particle System
 * Automatically selects the best available backend:
 * 1. WebGPU Compute (fastest - GPU parallel)
 * 2. SharedArrayBuffer + Workers (fast - CPU multi-core)
 * 3. Single-threaded JS (baseline)
 */

import { GPUComputeParticles, isWebGPUAvailable } from './gpu-compute.js';
import { ParticleSystem as CPUParticleSystem } from './gpu-particles.js';
import * as CONFIG from './config.js';

// Backend types
export const BACKEND = {
    WEBGPU: 'webgpu',
    WORKERS: 'workers',
    SINGLE_THREAD: 'single-thread'
};

/**
 * Worker Pool for parallel CPU physics
 */
class WorkerParticleSystem {
    constructor(maxParticles, workerCount = navigator.hardwareConcurrency || 4) {
        this.max = maxParticles;
        this.count = 0;
        this.workerCount = Math.min(workerCount, 8);
        this.workers = [];
        this.ready = false;
        this.pendingUpdates = 0;
        this.highestActiveIndex = 0;
        
        // Check SharedArrayBuffer support
        this.supported = typeof SharedArrayBuffer !== 'undefined';
        
        if (this.supported) {
            // Create SharedArrayBuffers
            this.posXBuffer = new SharedArrayBuffer(maxParticles * 4);
            this.posYBuffer = new SharedArrayBuffer(maxParticles * 4);
            this.posZBuffer = new SharedArrayBuffer(maxParticles * 4);
            this.velXBuffer = new SharedArrayBuffer(maxParticles * 4);
            this.velYBuffer = new SharedArrayBuffer(maxParticles * 4);
            this.velZBuffer = new SharedArrayBuffer(maxParticles * 4);
            this.stateBuffer = new SharedArrayBuffer(maxParticles);
            this.sizeBuffer = new SharedArrayBuffer(maxParticles * 4);
            this.stickTimeBuffer = new SharedArrayBuffer(maxParticles * 4);
            this.slideSpeedBuffer = new SharedArrayBuffer(maxParticles * 4);
            
            // Create typed array views
            this.posX = new Float32Array(this.posXBuffer);
            this.posY = new Float32Array(this.posYBuffer);
            this.posZ = new Float32Array(this.posZBuffer);
            this.velX = new Float32Array(this.velXBuffer);
            this.velY = new Float32Array(this.velYBuffer);
            this.velZ = new Float32Array(this.velZBuffer);
            this.state = new Uint8Array(this.stateBuffer);
            this.size = new Float32Array(this.sizeBuffer);
            this.stickTime = new Float32Array(this.stickTimeBuffer);
            this.slideSpeed = new Float32Array(this.slideSpeedBuffer);
            
            this.state.fill(4); // INACTIVE
        }
        
        this.sdf = null;
    }
    
    async init(sdfData) {
        if (!this.supported) return false;
        
        this.sdf = sdfData;
        
        const configData = {
            DRIP_GRAVITY: CONFIG.DRIP_GRAVITY,
            BOUNCE_CHANCE: CONFIG.BOUNCE_CHANCE,
            BOUNCE_RESTITUTION_MIN: CONFIG.BOUNCE_RESTITUTION_MIN,
            BOUNCE_RESTITUTION_MAX: CONFIG.BOUNCE_RESTITUTION_MAX,
            BOUNCE_SCATTER: CONFIG.BOUNCE_SCATTER,
            BOUNCE_SCATTER_VERTICAL: CONFIG.BOUNCE_SCATTER_VERTICAL,
            BOUNCE_DRAG: CONFIG.BOUNCE_DRAG,
            BOUNCE_SIZE_REDUCTION: CONFIG.BOUNCE_SIZE_REDUCTION,
            SPLASH_UPWARD_BIAS: CONFIG.SPLASH_UPWARD_BIAS,
            IMPACT_SPRAY_FACTOR: CONFIG.IMPACT_SPRAY_FACTOR,
            MIST_SIZE_FACTOR: CONFIG.MIST_SIZE_FACTOR,
            STICK_DURATION_MIN: CONFIG.STICK_DURATION_MIN,
            STICK_DURATION_MAX: CONFIG.STICK_DURATION_MAX,
            STICK_JITTER_AMOUNT: CONFIG.STICK_JITTER_AMOUNT,
            STICK_JITTER_SPEED: CONFIG.STICK_JITTER_SPEED,
            DRIP_INITIAL_VELOCITY: CONFIG.DRIP_INITIAL_VELOCITY,
            DRIP_SHRINK_RATE: CONFIG.DRIP_SHRINK_RATE,
            DRIP_REMOVE_Y: CONFIG.DRIP_REMOVE_Y,
            DRIP_MIN_SIZE: CONFIG.DRIP_MIN_SIZE
        };
        
        const sdfTransfer = {
            data: sdfData.data.buffer,
            bbox: {
                minX: sdfData.bbox.min.x,
                minY: sdfData.bbox.min.y,
                minZ: sdfData.bbox.min.z,
                maxX: sdfData.bbox.max.x,
                maxY: sdfData.bbox.max.y,
                maxZ: sdfData.bbox.max.z
            },
            resolution: sdfData.resolution,
            stepX: sdfData.stepX,
            stepY: sdfData.stepY,
            stepZ: sdfData.stepZ
        };
        
        // Create workers
        const workerPromises = [];
        for (let i = 0; i < this.workerCount; i++) {
            const worker = new Worker(new URL('./physics-worker.js', import.meta.url));
            
            const promise = new Promise((resolve) => {
                worker.onmessage = (e) => {
                    if (e.data.type === 'ready') resolve();
                    else if (e.data.type === 'done') {
                        this.pendingUpdates--;
                    }
                };
            });
            
            worker.postMessage({
                type: 'init',
                buffers: {
                    posX: this.posXBuffer,
                    posY: this.posYBuffer,
                    posZ: this.posZBuffer,
                    velX: this.velXBuffer,
                    velY: this.velYBuffer,
                    velZ: this.velZBuffer,
                    state: this.stateBuffer,
                    size: this.sizeBuffer,
                    stickTime: this.stickTimeBuffer,
                    slideSpeed: this.slideSpeedBuffer
                },
                cfg: configData,
                sdf: sdfTransfer
            });
            
            this.workers.push(worker);
            workerPromises.push(promise);
        }
        
        await Promise.all(workerPromises);
        this.ready = true;
        console.log(`Worker pool ready: ${this.workerCount} workers`);
        return true;
    }
    
    spawn(positions, velocities, sizes, slideSpeeds) {
        const count = positions.length / 3;
        
        for (let i = 0; i < count && this.count < this.max; i++) {
            const idx = this.count++;
            
            this.posX[idx] = positions[i * 3];
            this.posY[idx] = positions[i * 3 + 1];
            this.posZ[idx] = positions[i * 3 + 2];
            this.velX[idx] = velocities[i * 3];
            this.velY[idx] = velocities[i * 3 + 1];
            this.velZ[idx] = velocities[i * 3 + 2];
            this.state[idx] = 0; // FALLING
            this.size[idx] = sizes[i];
            this.stickTime[idx] = 0;
            this.slideSpeed[idx] = slideSpeeds[i];
        }
    }
    
    // Spawn particles directly on surface (STUCK state)
    spawnOnSurface(count, sizes, stickTimes) {
        if (!this.sdf) return 0;
        
        const { bbox, data, resolution, stepX, stepY, stepZ } = this.sdf;
        let spawned = 0;
        let attempts = 0;
        const maxAttempts = count * 10;
        
        while (spawned < count && this.count < this.max && attempts < maxAttempts) {
            attempts++;
            
            const x = bbox.min.x + Math.random() * (bbox.max.x - bbox.min.x);
            const y = bbox.min.y + Math.random() * (bbox.max.y - bbox.min.y);
            const z = bbox.max.z - Math.random() * 0.5;
            
            const dist = this.sampleSDF(x, y, z);
            
            // Sólo puntos muy cercanos a la superficie frontal del texto
            if (dist > -0.05 && dist < 0.18) {
                const grad = this.sdfGradient(x, y, z);
                if (grad.z > 0.2) {
                    const idx = this.count++;
                    
                    this.posX[idx] = x + grad.x * (0.05 - dist);
                    this.posY[idx] = y + grad.y * (0.05 - dist);
                    this.posZ[idx] = z + grad.z * (0.05 - dist);
                    this.velX[idx] = 0;
                    this.velY[idx] = 0;
                    this.velZ[idx] = 0;
                    this.state[idx] = 1; // STUCK
                    this.size[idx] = sizes[spawned % sizes.length];
                    this.stickTime[idx] = stickTimes[spawned % stickTimes.length];
                    this.slideSpeed[idx] = CONFIG.SLIDE_SPEED_MIN + Math.random() * (CONFIG.SLIDE_SPEED_MAX - CONFIG.SLIDE_SPEED_MIN);
                    
                    spawned++;
                }
            }
        }
        
        return spawned;
    }
    
    // Sample SDF (simplified version for worker system)
    sampleSDF(x, y, z) {
        if (!this.sdf) return 100;
        
        const { bbox, data, resolution, stepX, stepY, stepZ } = this.sdf;
        
        const fx = (x - bbox.min.x) / stepX - 0.5;
        const fy = (y - bbox.min.y) / stepY - 0.5;
        const fz = (z - bbox.min.z) / stepZ - 0.5;
        
        const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
        
        if (x0 < 0 || x0 >= resolution - 1 || y0 < 0 || y0 >= resolution - 1 || z0 < 0 || z0 >= resolution - 1) return 100;
        
        const tx = fx - x0, ty = fy - y0, tz = fz - z0;
        const r = resolution, r2 = r * r;
        const i000 = x0 + y0 * r + z0 * r2;
        
        const c00 = data[i000] * (1 - tx) + data[i000 + 1] * tx;
        const c10 = data[i000 + r] * (1 - tx) + data[i000 + r + 1] * tx;
        const c01 = data[i000 + r2] * (1 - tx) + data[i000 + r2 + 1] * tx;
        const c11 = data[i000 + r2 + r] * (1 - tx) + data[i000 + r2 + r + 1] * tx;
        
        const c0 = c00 * (1 - ty) + c10 * ty;
        const c1 = c01 * (1 - ty) + c11 * ty;
        
        return c0 * (1 - tz) + c1 * tz;
    }
    
    // Get SDF gradient (surface normal)
    sdfGradient(x, y, z) {
        const eps = 0.1;
        const dx = this.sampleSDF(x + eps, y, z) - this.sampleSDF(x - eps, y, z);
        const dy = this.sampleSDF(x, y + eps, z) - this.sampleSDF(x, y - eps, z);
        const dz = this.sampleSDF(x, y, z + eps) - this.sampleSDF(x, y, z - eps);
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
        return { x: dx/len, y: dy/len, z: dz/len };
    }
    
    // Spawn spray particles (BOUNCING state)
    spawnSpray(positions, velocities, sizes) {
        const count = positions.length / 3;
        
        for (let i = 0; i < count && this.count < this.max; i++) {
            const idx = this.count++;
            
            this.posX[idx] = positions[i * 3];
            this.posY[idx] = positions[i * 3 + 1];
            this.posZ[idx] = positions[i * 3 + 2];
            this.velX[idx] = velocities[i * 3];
            this.velY[idx] = velocities[i * 3 + 1];
            this.velZ[idx] = velocities[i * 3 + 2];
            this.state[idx] = 5; // BOUNCING
            this.size[idx] = sizes[i];
            this.stickTime[idx] = 0;
            this.slideSpeed[idx] = 0;
        }
    }
    
    update(dt, time) {
        if (!this.ready || this.count === 0) return 0;
        
        // Distribute work across workers
        const chunkSize = Math.ceil(this.count / this.workerCount);
        this.pendingUpdates = this.workerCount;
        
        for (let i = 0; i < this.workerCount; i++) {
            const startIdx = i * chunkSize;
            const endIdx = Math.min(startIdx + chunkSize, this.count);
            
            if (startIdx < this.count) {
                this.workers[i].postMessage({
                    type: 'update',
                    startIdx,
                    endIdx,
                    dt,
                    time
                });
            } else {
                this.pendingUpdates--;
            }
        }
        
        // Find highest active (scan shared buffer)
        let highest = 0;
        let active = 0;
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] !== 4) {
                active++;
                highest = i;
            }
        }
        this.highestActiveIndex = highest;
        
        return active;
    }
    
    copyToBuffers(positionAttr, stateAttr) {
        const pos = positionAttr.array;
        const st = stateAttr.array;
        const limit = Math.min(this.highestActiveIndex + 1, this.count);
        
        for (let i = 0; i < limit; i++) {
            pos[i * 3] = this.posX[i];
            pos[i * 3 + 1] = this.posY[i];
            pos[i * 3 + 2] = this.posZ[i];
            
            st[i * 4] = this.state[i];
            st[i * 4 + 1] = this.stickTime[i];
            st[i * 4 + 2] = this.size[i];
            st[i * 4 + 3] = this.slideSpeed[i];
        }
        
        positionAttr.needsUpdate = true;
        stateAttr.needsUpdate = true;
        
        return limit;
    }
    
    reset() {
        this.count = 0;
        this.highestActiveIndex = 0;
        this.state.fill(4);
    }
    
    countOnText() {
        let count = 0;
        for (let i = 0; i < this.count; i++) {
            const s = this.state[i];
            if (s === 1 || s === 2) count++;
        }
        return count;
    }
    
    destroy() {
        this.workers.forEach(w => w.terminate());
        this.workers = [];
    }
}

/**
 * Hybrid Particle System - automatically selects best backend
 */
export class HybridParticleSystem {
    constructor(maxParticles) {
        this.maxParticles = maxParticles;
        this.backend = null;
        this.backendType = null;
        this.count = 0;
        this.sdfData = null;
        
        // GPU compute instance
        this.gpuCompute = null;
        this.gpuParticleData = null;
    }
    
    async init(sdfData) {
        this.sdfData = sdfData;
        
        // Try WebGPU first
        if (await isWebGPUAvailable()) {
            console.log('Trying WebGPU backend...');
            this.gpuCompute = new GPUComputeParticles(this.maxParticles);
            
            if (await this.gpuCompute.init()) {
                this.gpuCompute.setSDF(sdfData);
                this.backendType = BACKEND.WEBGPU;
                console.log('✓ Using WebGPU Compute backend');
                return;
            }
        }
        
        // Try SharedArrayBuffer + Workers
        if (typeof SharedArrayBuffer !== 'undefined') {
            console.log('Trying Worker pool backend...');
            const workerSystem = new WorkerParticleSystem(this.maxParticles);
            
            try {
                if (await workerSystem.init(sdfData)) {
                    this.backend = workerSystem;
                    this.backendType = BACKEND.WORKERS;
                    console.log('✓ Using SharedArrayBuffer + Workers backend');
                    return;
                }
            } catch (err) {
                console.warn('Worker backend failed:', err);
                workerSystem.destroy();
            }
        }
        
        // Fall back to single-threaded CPU
        console.log('Using single-threaded CPU backend');
        this.backend = new CPUParticleSystem(this.maxParticles);
        this.backend.setSDF(sdfData);
        this.backendType = BACKEND.SINGLE_THREAD;
        console.log('✓ Using single-threaded CPU backend');
    }
    
    isReady() {
        return this.backendType !== null;
    }
    
    spawn(positions, velocities, sizes, slideSpeeds) {
        if (!this.backendType) return; // Not initialized yet
        
        const spawnCount = positions.length / 3;
        
        if (this.backendType === BACKEND.WEBGPU) {
            this.gpuCompute.spawn(positions, velocities, sizes, slideSpeeds, this.count, spawnCount);
            this.count = Math.min(this.count + spawnCount, this.maxParticles);
        } else if (this.backend) {
            this.backend.spawn(positions, velocities, sizes, slideSpeeds);
            this.count = this.backend.count;
        }
    }
    
    // Spawn particles directly on surface in STUCK state
    spawnOnSurface(count, sizes, stickTimes) {
        if (!this.backendType) return 0;
        
        // Only CPU backends support surface spawning currently
        if (this.backend && this.backend.spawnOnSurface) {
            const spawned = this.backend.spawnOnSurface(count, sizes, stickTimes);
            this.count = this.backend.count;
            return spawned;
        }
        return 0;
    }
    
    // Spawn spray particles (start in BOUNCING state, visible immediately)
    spawnSpray(positions, velocities, sizes) {
        if (!this.backendType) return;
        
        if (this.backend && this.backend.spawnSpray) {
            this.backend.spawnSpray(positions, velocities, sizes);
            this.count = this.backend.count;
        }
    }
    
    async update(dt, time) {
        if (!this.backendType) return 0; // Not initialized yet
        
        if (this.backendType === BACKEND.WEBGPU) {
            if (!this.gpuCompute) return 0;
            this.gpuCompute.update(dt, time, this.count);
            // Read back for rendering (async)
            this.gpuParticleData = await this.gpuCompute.readBack(this.count);
            return this.count;
        } else if (this.backend) {
            return this.backend.update(dt, time);
        }
        return 0;
    }
    
    copyToBuffers(positionAttr, stateAttr) {
        if (!this.backendType) return 0; // Not initialized yet
        
        if (this.backendType === BACKEND.WEBGPU) {
            if (!this.gpuCompute) return 0;
            return this.gpuCompute.copyToRenderBuffers(
                this.gpuParticleData, 
                this.count, 
                positionAttr, 
                stateAttr
            );
        } else if (this.backend) {
            return this.backend.copyToBuffers(positionAttr, stateAttr);
        }
        return 0;
    }
    
    reset() {
        this.count = 0;
        if (this.backendType === BACKEND.WEBGPU && this.gpuCompute) {
            this.gpuCompute.reset();
        } else if (this.backend) {
            this.backend.reset();
        }
    }
    
    countOnText() {
        if (!this.backendType) return 0;
        
        if (this.backendType === BACKEND.WEBGPU) {
            // Count from GPU data if available
            if (!this.gpuParticleData) return 0;
            let count = 0;
            for (let i = 0; i < this.count; i++) {
                const state = this.gpuParticleData[i * 10 + 6];
                if (state === 1 || state === 2) count++;
            }
            return count;
        } else if (this.backend !== null) {
            return this.backend.countOnText();
        }
        return 0;
    }
    
    getBackendType() {
        return this.backendType;
    }
    
    destroy() {
        if (this.gpuCompute) this.gpuCompute.destroy();
        if (this.backend && this.backend.destroy) this.backend.destroy();
    }
}
