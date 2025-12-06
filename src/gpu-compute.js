/**
 * WebGPU Compute Shader for Particle Physics
 * Provides 100x+ speedup by running physics on GPU
 * Falls back to CPU if WebGPU unavailable
 */

import * as CONFIG from './config.js';

// Particle states (must match cpu-particles)
const FALLING = 0;
const STUCK = 1;
const SLIDING = 2;
const DRIPPING = 3;
const INACTIVE = 4;
const BOUNCING = 5;

// WGSL Compute Shader for particle physics
// Uses raw f32 array to avoid struct alignment issues
const PARTICLE_SHADER = /* wgsl */`
    // Particle data: 10 floats per particle (no padding issues)
    // [0-2] = pos.xyz, [3-5] = vel.xyz, [6] = state, [7] = size, [8] = stickTime, [9] = slideSpeed
    
    struct Config {
        dt: f32,
        time: f32,
        gravity: f32,
        particleCount: f32,  // Passed as float, cast to u32 when needed
        
        // SDF bounds
        sdfMinX: f32, sdfMinY: f32, sdfMinZ: f32, _pad0: f32,
        sdfMaxX: f32, sdfMaxY: f32, sdfMaxZ: f32, _pad1: f32,
        sdfResolution: f32,
        sdfStepX: f32, sdfStepY: f32, sdfStepZ: f32,
        
        // Physics config
        bounceChance: f32,
        bounceRestitutionMin: f32,
        bounceRestitutionMax: f32,
        bounceScatter: f32,
        bounceDrag: f32,
        bounceSizeReduction: f32,
        splashUpwardBias: f32,
        bounceScatterVertical: f32,
        
        impactSprayFactor: f32,
        mistSizeFactor: f32,
        _pad2a: f32,
        _pad2b: f32,
        
        stickDurationMin: f32,
        stickDurationMax: f32,
        stickJitterAmount: f32,
        stickJitterSpeed: f32,
        
        dripInitialVelocity: f32,
        dripShrinkRate: f32,
        dripRemoveY: f32,
        dripMinSize: f32,
    }
    
    @group(0) @binding(0) var<storage, read_write> particles: array<f32>;
    @group(0) @binding(1) var<uniform> config: Config;
    @group(0) @binding(2) var<storage, read> sdfData: array<f32>;
    
    const FLOATS_PER_PARTICLE: u32 = 10u;
    
    // Random function based on particle index and time
    fn rand(seed: u32) -> f32 {
        var s = seed;
        s = s ^ (s >> 13u);
        s = s * 0x5bd1e995u;
        s = s ^ (s >> 15u);
        return f32(s & 0x7FFFFFFFu) / f32(0x7FFFFFFF);
    }
    
    // Sample SDF with trilinear interpolation
    fn sampleSDF(pos: vec3f) -> f32 {
        let fx = (pos.x - config.sdfMinX) / config.sdfStepX - 0.5;
        let fy = (pos.y - config.sdfMinY) / config.sdfStepY - 0.5;
        let fz = (pos.z - config.sdfMinZ) / config.sdfStepZ - 0.5;
        
        let x0 = i32(floor(fx));
        let y0 = i32(floor(fy));
        let z0 = i32(floor(fz));
        
        let res = i32(config.sdfResolution);
        
        if (x0 < 0 || x0 >= res - 1 || y0 < 0 || y0 >= res - 1 || z0 < 0 || z0 >= res - 1) {
            return 100.0;
        }
        
        let tx = fx - f32(x0);
        let ty = fy - f32(y0);
        let tz = fz - f32(z0);
        
        let r = res;
        let r2 = r * r;
        let i000 = x0 + y0 * r + z0 * r2;
        
        let c000 = sdfData[i000];
        let c100 = sdfData[i000 + 1];
        let c010 = sdfData[i000 + r];
        let c110 = sdfData[i000 + r + 1];
        let c001 = sdfData[i000 + r2];
        let c101 = sdfData[i000 + r2 + 1];
        let c011 = sdfData[i000 + r2 + r];
        let c111 = sdfData[i000 + r2 + r + 1];
        
        let c00 = c000 * (1.0 - tx) + c100 * tx;
        let c10 = c010 * (1.0 - tx) + c110 * tx;
        let c01 = c001 * (1.0 - tx) + c101 * tx;
        let c11 = c011 * (1.0 - tx) + c111 * tx;
        
        let c0 = c00 * (1.0 - ty) + c10 * ty;
        let c1 = c01 * (1.0 - ty) + c11 * ty;
        
        return c0 * (1.0 - tz) + c1 * tz;
    }
    
    // Compute SDF gradient (surface normal)
    fn sdfGradient(pos: vec3f) -> vec3f {
        let eps = 0.1;
        let dx = sampleSDF(pos + vec3f(eps, 0.0, 0.0)) - sampleSDF(pos - vec3f(eps, 0.0, 0.0));
        let dy = sampleSDF(pos + vec3f(0.0, eps, 0.0)) - sampleSDF(pos - vec3f(0.0, eps, 0.0));
        let dz = sampleSDF(pos + vec3f(0.0, 0.0, eps)) - sampleSDF(pos - vec3f(0.0, 0.0, eps));
        
        let len = length(vec3f(dx, dy, dz));
        if (len < 0.001) {
            return vec3f(0.0, 1.0, 0.0);
        }
        return vec3f(dx, dy, dz) / len;
    }
    
    @compute @workgroup_size(256)
    fn main(@builtin(global_invocation_id) id: vec3u) {
        let particleIdx = id.x;
        if (particleIdx >= u32(config.particleCount)) { return; }
        
        // Base index into the f32 array
        let base = particleIdx * FLOATS_PER_PARTICLE;
        
        // Read particle data: [posX, posY, posZ, velX, velY, velZ, state, size, stickTime, slideSpeed]
        var posX = particles[base + 0u];
        var posY = particles[base + 1u];
        var posZ = particles[base + 2u];
        var velX = particles[base + 3u];
        var velY = particles[base + 4u];
        var velZ = particles[base + 5u];
        var state = particles[base + 6u];
        var size = particles[base + 7u];
        var stickTime = particles[base + 8u];
        let slideSpeed = particles[base + 9u];
        
        let stateInt = u32(state);
        
        // Skip inactive particles
        if (stateInt == 4u) { return; }
        
        let dt = config.dt;
        let gravity = config.gravity;
        let seed = particleIdx * 1000u + u32(config.time * 1000.0);
        
        // ========== FALLING STATE ==========
        if (stateInt == 0u) {
            velY = velY + gravity * dt;
            posX = posX + velX * dt;
            posY = posY + velY * dt;
            posZ = posZ + velZ * dt;
            
            let pos = vec3f(posX, posY, posZ);
            let dist = sampleSDF(pos);
            
            if (dist < 0.2) {
                let normal = sdfGradient(pos);
                
                // Only collide if:
                // 1. Hitting FRONT face of text (normal pointing toward camera)
                // 2. Particle Z is near the FRONT of the text (not deep in gaps between letters)
                // The front of the text is at sdfMaxZ, particles in gaps have lower Z
                let frontThreshold = config.sdfMaxZ - 1.5; // Allow collision in front portion of text
                let isFrontFacing = normal.z > 0.5;
                let isNearFront = posZ > frontThreshold;
                
                if (isFrontFacing && isNearFront) {
                    let push = 0.1 - dist;
                    posX = posX + normal.x * push;
                    posY = posY + normal.y * push;
                    posZ = posZ + normal.z * push;
                    
                    // Decide bounce or stick
                    if (rand(seed) < config.bounceChance) {
                        // BOUNCE - natural water spray physics
                        let vel = vec3f(velX, velY, velZ);
                        let impactSpeed = length(vel);
                        let dotVN = dot(vel, normal);
                        
                        // Restitution varies with impact angle and speed
                        let angleInfluence = abs(dotVN) / (impactSpeed + 0.01);
                        let baseRestitution = config.bounceRestitutionMin + 
                            rand(seed + 1u) * (config.bounceRestitutionMax - config.bounceRestitutionMin);
                        let restitution = baseRestitution * (0.7 + 0.3 * (1.0 - angleInfluence));
                        
                        // Reflect with energy loss
                        var reflected = (vel - 2.0 * dotVN * normal) * restitution;
                        
                        // Radial spray pattern - scatter perpendicular to impact direction
                        let sprayAngle = rand(seed + 10u) * 6.283185; // 2*PI
                        let sprayStrength = impactSpeed * config.impactSprayFactor;
                        
                        // Create tangent vectors for radial spray
                        var tangentX = vec3f(1.0, 0.0, 0.0);
                        if (abs(normal.x) > 0.9) { tangentX = vec3f(0.0, 1.0, 0.0); }
                        let tangent1 = normalize(cross(normal, tangentX));
                        let tangent2 = cross(normal, tangent1);
                        
                        // Apply radial spray
                        let sprayDir = tangent1 * cos(sprayAngle) + tangent2 * sin(sprayAngle);
                        reflected = reflected + sprayDir * sprayStrength * (0.5 + rand(seed + 11u) * 0.5);
                        
                        // Add scatter with more vertical emphasis (water sprays up)
                        let hScatter = config.bounceScatter * (0.3 + rand(seed + 2u) * 0.7);
                        let vScatter = config.bounceScatterVertical * (0.4 + rand(seed + 6u) * 0.6);
                        
                        velX = reflected.x + (rand(seed + 3u) - 0.5) * hScatter * 2.0;
                        velY = reflected.y + rand(seed + 4u) * vScatter + config.splashUpwardBias;
                        velZ = reflected.z + (rand(seed + 5u) - 0.5) * hScatter;
                        
                        state = 5.0; // BOUNCING
                        
                        // Size reduction with mist variation (faster = smaller drops)
                        let speedFactor = clamp(impactSpeed / 40.0, 0.0, 1.0);
                        let sizeReduction = config.bounceSizeReduction - speedFactor * config.mistSizeFactor;
                        size = size * max(sizeReduction, 0.2) * (0.6 + rand(seed + 7u) * 0.6);
                    } else {
                        // STICK
                        velX = 0.0; velY = 0.0; velZ = 0.0;
                        state = 1.0; // STUCK
                        stickTime = 0.0;
                    }
                }
            }
            
            if (posY < config.dripRemoveY || posZ < -10.0) {
                state = 4.0; // INACTIVE
                size = 0.0;
            }
        }
        
        // ========== BOUNCING STATE ==========
        else if (stateInt == 5u) {
            velY = velY + gravity * dt;
            velX = velX * config.bounceDrag;
            velZ = velZ * config.bounceDrag;
            
            posX = posX + velX * dt;
            posY = posY + velY * dt;
            posZ = posZ + velZ * dt;
            size = size * (1.0 - dt * config.dripShrinkRate);
            
            if (posY < config.dripRemoveY || size < config.dripMinSize) {
                state = 4.0;
                size = 0.0;
            }
        }
        
        // ========== STUCK STATE ==========
        else if (stateInt == 1u) {
            stickTime = stickTime + dt;
            
            // Subtle jitter
            posX = posX + sin(config.time * config.stickJitterSpeed + posY * 3.0) * config.stickJitterAmount;
            
            let stickDuration = config.stickDurationMin + 
                slideSpeed * (config.stickDurationMax - config.stickDurationMin);
            
            if (stickTime > stickDuration) {
                state = 3.0; // DRIPPING
                velY = config.dripInitialVelocity;
            }
        }
        
        // ========== DRIPPING STATE ==========
        else if (stateInt == 3u) {
            velY = velY + gravity * dt;
            velX = velX * 0.99;
            velZ = velZ * 0.99;
            
            posX = posX + velX * dt;
            posY = posY + velY * dt;
            posZ = posZ + velZ * dt;
            size = size * (1.0 - dt * config.dripShrinkRate);
            
            if (posY < config.dripRemoveY || size < config.dripMinSize) {
                state = 4.0;
                size = 0.0;
            }
        }
        
        // Write back particle data
        particles[base + 0u] = posX;
        particles[base + 1u] = posY;
        particles[base + 2u] = posZ;
        particles[base + 3u] = velX;
        particles[base + 4u] = velY;
        particles[base + 5u] = velZ;
        particles[base + 6u] = state;
        particles[base + 7u] = size;
        particles[base + 8u] = stickTime;
        // slideSpeed is read-only, no need to write back
    }
`;

/**
 * WebGPU Particle System
 */
export class GPUComputeParticles {
    constructor(maxParticles) {
        this.maxParticles = maxParticles;
        this.device = null;
        this.pipeline = null;
        this.particleBuffer = null;
        this.configBuffer = null;
        this.sdfBuffer = null;
        this.bindGroup = null;
        this.ready = false;
        this.sdfData = null;
        
        // CPU-side particle data for reading back
        this.particleData = null;
        this.stagingBuffer = null;
    }
    
    async init() {
        // Check WebGPU support
        if (!navigator.gpu) {
            console.warn('WebGPU not supported');
            return false;
        }
        
        try {
            const adapter = await navigator.gpu.requestAdapter({
                powerPreference: 'high-performance'
            });
            
            if (!adapter) {
                console.warn('No WebGPU adapter found');
                return false;
            }
            
            this.device = await adapter.requestDevice({
                requiredFeatures: [],
                requiredLimits: {
                    maxStorageBufferBindingSize: 256 * 1024 * 1024, // 256MB
                    maxBufferSize: 256 * 1024 * 1024
                }
            });
            
            // Create compute pipeline
            const shaderModule = this.device.createShaderModule({
                code: PARTICLE_SHADER
            });
            
            this.pipeline = this.device.createComputePipeline({
                layout: 'auto',
                compute: {
                    module: shaderModule,
                    entryPoint: 'main'
                }
            });
            
            // Create particle buffer (40 bytes per particle: 3+3+1+1+1+1 floats = 10 floats)
            const particleByteSize = 10 * 4; // 10 floats * 4 bytes
            this.particleBuffer = this.device.createBuffer({
                size: this.maxParticles * particleByteSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC
            });
            
            // Staging buffer for reading back
            this.stagingBuffer = this.device.createBuffer({
                size: this.maxParticles * particleByteSize,
                usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
            });
            
            // Config uniform buffer
            this.configBuffer = this.device.createBuffer({
                size: 256, // Padded for alignment
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
            });
            
            // Particle data array
            this.particleData = new Float32Array(this.maxParticles * 10);
            
            console.log('WebGPU Compute initialized successfully');
            this.ready = true;
            return true;
            
        } catch (err) {
            console.warn('WebGPU initialization failed:', err);
            return false;
        }
    }
    
    setSDF(sdfData) {
        if (!this.ready || !this.device) return;
        
        this.sdfData = sdfData;
        
        // Create SDF buffer
        this.sdfBuffer = this.device.createBuffer({
            size: sdfData.data.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        
        // Upload SDF data
        this.device.queue.writeBuffer(this.sdfBuffer, 0, sdfData.data);
        
        // Create bind group
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.particleBuffer } },
                { binding: 1, resource: { buffer: this.configBuffer } },
                { binding: 2, resource: { buffer: this.sdfBuffer } }
            ]
        });
    }
    
    // Spawn particles (uploads to GPU)
    spawn(positions, velocities, sizes, slideSpeeds, startIndex, count) {
        if (!this.ready) return;
        
        // Clamp to not exceed max particles
        const availableSlots = this.maxParticles - startIndex;
        if (availableSlots <= 0) return;
        const actualCount = Math.min(count, availableSlots);
        
        // Pack particle data into a temporary buffer for this batch
        const batchData = new Float32Array(actualCount * 10);
        
        for (let i = 0; i < actualCount; i++) {
            const idx = i * 10;
            const srcIdx = i;
            
            // Position
            batchData[idx + 0] = positions[srcIdx * 3];
            batchData[idx + 1] = positions[srcIdx * 3 + 1];
            batchData[idx + 2] = positions[srcIdx * 3 + 2];
            // Velocity
            batchData[idx + 3] = velocities[srcIdx * 3];
            batchData[idx + 4] = velocities[srcIdx * 3 + 1];
            batchData[idx + 5] = velocities[srcIdx * 3 + 2];
            // State (FALLING = 0)
            batchData[idx + 6] = FALLING;
            // Size
            batchData[idx + 7] = sizes[srcIdx];
            // StickTime
            batchData[idx + 8] = 0;
            // SlideSpeed
            batchData[idx + 9] = slideSpeeds[srcIdx];
        }
        
        // Upload to GPU at the correct offset
        const byteOffset = startIndex * 10 * 4;
        this.device.queue.writeBuffer(
            this.particleBuffer, 
            byteOffset, 
            batchData
        );
    }
    
    // Update particles on GPU
    update(dt, time, particleCount) {
        if (!this.ready || !this.bindGroup || particleCount === 0) return;
        
        // Update config - must match WGSL struct layout exactly (32 floats with padding)
        const configData = new Float32Array([
            // Row 1: dt, time, gravity, particleCount
            dt,
            time,
            CONFIG.DRIP_GRAVITY,
            particleCount,  // Will be reinterpreted as u32 in shader
            
            // Row 2: SDF min bounds + padding
            this.sdfData.bbox.min.x,
            this.sdfData.bbox.min.y,
            this.sdfData.bbox.min.z,
            0, // _pad0
            
            // Row 3: SDF max bounds + padding
            this.sdfData.bbox.max.x,
            this.sdfData.bbox.max.y,
            this.sdfData.bbox.max.z,
            0, // _pad1
            
            // Row 4: SDF resolution and steps
            this.sdfData.resolution,
            this.sdfData.stepX,
            this.sdfData.stepY,
            this.sdfData.stepZ,
            
            // Row 5: Bounce config
            CONFIG.BOUNCE_CHANCE,
            CONFIG.BOUNCE_RESTITUTION_MIN,
            CONFIG.BOUNCE_RESTITUTION_MAX,
            CONFIG.BOUNCE_SCATTER,
            
            // Row 6: More bounce config
            CONFIG.BOUNCE_DRAG,
            CONFIG.BOUNCE_SIZE_REDUCTION,
            CONFIG.SPLASH_UPWARD_BIAS,
            CONFIG.BOUNCE_SCATTER_VERTICAL,
            
            // Row 7: Impact/mist config
            CONFIG.IMPACT_SPRAY_FACTOR,
            CONFIG.MIST_SIZE_FACTOR,
            0, // _pad2a
            0, // _pad2b
            
            // Row 8: Stick config
            CONFIG.STICK_DURATION_MIN,
            CONFIG.STICK_DURATION_MAX,
            CONFIG.STICK_JITTER_AMOUNT,
            CONFIG.STICK_JITTER_SPEED,
            
            // Row 9: Drip config
            CONFIG.DRIP_INITIAL_VELOCITY,
            CONFIG.DRIP_SHRINK_RATE,
            CONFIG.DRIP_REMOVE_Y,
            CONFIG.DRIP_MIN_SIZE,
        ]);
        
        this.device.queue.writeBuffer(this.configBuffer, 0, configData);
        
        // Dispatch compute shader
        const commandEncoder = this.device.createCommandEncoder();
        const passEncoder = commandEncoder.beginComputePass();
        
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        
        // Dispatch workgroups (256 threads per workgroup)
        const workgroupCount = Math.ceil(particleCount / 256);
        passEncoder.dispatchWorkgroups(workgroupCount);
        
        passEncoder.end();
        this.device.queue.submit([commandEncoder.finish()]);
    }
    
    // Read back particle data for rendering
    async readBack(count) {
        if (!this.ready || count === 0) return null;
        
        const byteSize = count * 10 * 4;
        
        const commandEncoder = this.device.createCommandEncoder();
        commandEncoder.copyBufferToBuffer(
            this.particleBuffer, 0,
            this.stagingBuffer, 0,
            byteSize
        );
        this.device.queue.submit([commandEncoder.finish()]);
        
        await this.stagingBuffer.mapAsync(GPUMapMode.READ, 0, byteSize);
        const data = new Float32Array(this.stagingBuffer.getMappedRange(0, byteSize).slice(0));
        this.stagingBuffer.unmap();
        
        return data;
    }
    
    // Copy to Three.js buffers
    copyToRenderBuffers(particleData, count, positionAttr, stateAttr) {
        if (!particleData) return 0;
        
        const pos = positionAttr.array;
        const st = stateAttr.array;
        
        let activeCount = 0;
        
        for (let i = 0; i < count; i++) {
            const srcIdx = i * 10;
            const state = particleData[srcIdx + 6];
            
            if (state === INACTIVE) continue;
            activeCount = i + 1;
            
            // Position
            pos[i * 3] = particleData[srcIdx + 0];
            pos[i * 3 + 1] = particleData[srcIdx + 1];
            pos[i * 3 + 2] = particleData[srcIdx + 2];
            
            // State data for shader
            st[i * 4] = particleData[srcIdx + 6]; // state
            st[i * 4 + 1] = particleData[srcIdx + 8]; // stickTime
            st[i * 4 + 2] = particleData[srcIdx + 7]; // size
            st[i * 4 + 3] = particleData[srcIdx + 9]; // slideSpeed
        }
        
        positionAttr.needsUpdate = true;
        stateAttr.needsUpdate = true;
        
        return activeCount;
    }
    
    reset() {
        if (!this.ready) return;
        // Clear particle buffer by writing zeros
        const zeros = new Float32Array(this.maxParticles * 10);
        // Set all to INACTIVE state
        for (let i = 0; i < this.maxParticles; i++) {
            zeros[i * 10 + 6] = INACTIVE;
        }
        this.device.queue.writeBuffer(this.particleBuffer, 0, zeros);
    }
    
    destroy() {
        if (this.particleBuffer) this.particleBuffer.destroy();
        if (this.configBuffer) this.configBuffer.destroy();
        if (this.sdfBuffer) this.sdfBuffer.destroy();
        if (this.stagingBuffer) this.stagingBuffer.destroy();
    }
}

/**
 * Check if WebGPU is available
 */
export async function isWebGPUAvailable() {
    if (!navigator.gpu) return false;
    
    try {
        const adapter = await navigator.gpu.requestAdapter();
        return adapter !== null;
    } catch {
        return false;
    }
}
