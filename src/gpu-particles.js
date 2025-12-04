/**
 * Optimized Particle System with SDF Collision
 * Uses Structure-of-Arrays (SoA) for cache-friendly physics
 * SDF provides O(1) collision detection
 */

import * as CONFIG from './config.js';

// Particle States
const FALLING = 0;   // Invisible, flying toward text
const STUCK = 1;     // Stuck on letter surface
const SLIDING = 2;   // Sliding down letter
const DRIPPING = 3;  // Falling off letter
const INACTIVE = 4;  // Dead/unused
const BOUNCING = 5;  // Bounced off on impact

// Extract triangle data from geometry (runs on main thread)
export function extractTriangles(geometry) {
    const positions = geometry.attributes.position.array;
    const indices = geometry.index ? geometry.index.array : null;
    const triCount = indices ? indices.length / 3 : positions.length / 9;
    const triangles = [];
    
    for (let i = 0; i < triCount; i++) {
        const i0 = indices ? indices[i * 3] : i * 3;
        const i1 = indices ? indices[i * 3 + 1] : i * 3 + 1;
        const i2 = indices ? indices[i * 3 + 2] : i * 3 + 2;
        
        triangles.push({
            ax: positions[i0 * 3], ay: positions[i0 * 3 + 1], az: positions[i0 * 3 + 2],
            bx: positions[i1 * 3], by: positions[i1 * 3 + 1], bz: positions[i1 * 3 + 2],
            cx: positions[i2 * 3], cy: positions[i2 * 3 + 1], cz: positions[i2 * 3 + 2]
        });
    }
    
    return triangles;
}

// Generate SDF using Web Worker (non-blocking)
export function generateSDFAsync(geometry, resolution = 64, onProgress) {
    return new Promise((resolve, reject) => {
        const bbox = geometry.boundingBox.clone();
        bbox.expandByScalar(0.8);
        
        const triangles = extractTriangles(geometry);
        
        // Create worker (classic worker, not module)
        const worker = new Worker(new URL('./sdf-worker.js', import.meta.url));
        
        worker.onmessage = (e) => {
            if (e.data.type === 'progress') {
                if (onProgress) onProgress(e.data.progress);
            } else if (e.data.type === 'complete') {
                console.log(`SDF Generation: ${e.data.duration.toFixed(0)}ms (worker)`);
                
                resolve({
                    data: e.data.data,
                    bbox,
                    size: e.data.size,
                    resolution,
                    stepX: e.data.stepX,
                    stepY: e.data.stepY,
                    stepZ: e.data.stepZ
                });
                
                worker.terminate();
            }
        };
        
        worker.onerror = (err) => {
            console.error('SDF Worker error:', err);
            reject(err);
            worker.terminate();
        };
        
        // Send data to worker
        worker.postMessage({
            triangles,
            bbox: { min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
                    max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z } },
            resolution
        });
    });
}

// Synchronous fallback (for when workers aren't available)
export function generateSDF(geometry, resolution = 64) {
    console.time('SDF Generation');
    
    const bbox = geometry.boundingBox.clone();
    bbox.expandByScalar(0.8);
    
    const size = {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z
    };
    
    const triangles = extractTriangles(geometry);
    const data = new Float32Array(resolution * resolution * resolution);
    
    const stepX = size.x / resolution;
    const stepY = size.y / resolution;
    const stepZ = size.z / resolution;
    
    for (let z = 0; z < resolution; z++) {
        const pz = bbox.min.z + (z + 0.5) * stepZ;
        for (let y = 0; y < resolution; y++) {
            const py = bbox.min.y + (y + 0.5) * stepY;
            for (let x = 0; x < resolution; x++) {
                const px = bbox.min.x + (x + 0.5) * stepX;
                
                let minDist = Infinity;
                for (const tri of triangles) {
                    const dist = pointToTriangleDist(px, py, pz, tri);
                    if (dist < minDist) minDist = dist;
                }
                
                data[x + y * resolution + z * resolution * resolution] = minDist;
            }
        }
    }
    
    console.timeEnd('SDF Generation');
    
    return { data, bbox, size, resolution, stepX, stepY, stepZ };
}

// Accurate point-to-triangle distance
function pointToTriangleDist(px, py, pz, tri) {
    // Vectors from A
    const abx = tri.bx - tri.ax, aby = tri.by - tri.ay, abz = tri.bz - tri.az;
    const acx = tri.cx - tri.ax, acy = tri.cy - tri.ay, acz = tri.cz - tri.az;
    const apx = px - tri.ax, apy = py - tri.ay, apz = pz - tri.az;
    
    const d1 = abx*apx + aby*apy + abz*apz;
    const d2 = acx*apx + acy*apy + acz*apz;
    
    if (d1 <= 0 && d2 <= 0) {
        // Closest to vertex A
        return Math.sqrt(apx*apx + apy*apy + apz*apz);
    }
    
    const bpx = px - tri.bx, bpy = py - tri.by, bpz = pz - tri.bz;
    const d3 = abx*bpx + aby*bpy + abz*bpz;
    const d4 = acx*bpx + acy*bpy + acz*bpz;
    
    if (d3 >= 0 && d4 <= d3) {
        // Closest to vertex B
        return Math.sqrt(bpx*bpx + bpy*bpy + bpz*bpz);
    }
    
    const vc = d1*d4 - d3*d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
        // Closest to edge AB
        const v = d1 / (d1 - d3);
        const closestX = tri.ax + abx * v;
        const closestY = tri.ay + aby * v;
        const closestZ = tri.az + abz * v;
        const dx = px - closestX, dy = py - closestY, dz = pz - closestZ;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    const cpx = px - tri.cx, cpy = py - tri.cy, cpz = pz - tri.cz;
    const d5 = abx*cpx + aby*cpy + abz*cpz;
    const d6 = acx*cpx + acy*cpy + acz*cpz;
    
    if (d6 >= 0 && d5 <= d6) {
        // Closest to vertex C
        return Math.sqrt(cpx*cpx + cpy*cpy + cpz*cpz);
    }
    
    const vb = d5*d2 - d1*d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        // Closest to edge AC
        const w = d2 / (d2 - d6);
        const closestX = tri.ax + acx * w;
        const closestY = tri.ay + acy * w;
        const closestZ = tri.az + acz * w;
        const dx = px - closestX, dy = py - closestY, dz = pz - closestZ;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    const va = d3*d6 - d5*d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        // Closest to edge BC
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        const closestX = tri.bx + (tri.cx - tri.bx) * w;
        const closestY = tri.by + (tri.cy - tri.by) * w;
        const closestZ = tri.bz + (tri.cz - tri.bz) * w;
        const dx = px - closestX, dy = py - closestY, dz = pz - closestZ;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    // Inside triangle - project to plane
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    const closestX = tri.ax + abx * v + acx * w;
    const closestY = tri.ay + aby * v + acy * w;
    const closestZ = tri.az + abz * v + acz * w;
    const dx = px - closestX, dy = py - closestY, dz = pz - closestZ;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

/**
 * High-performance particle system using SoA layout
 */
export class ParticleSystem {
    constructor(maxParticles = 100000) {
        this.max = maxParticles;
        this.count = 0;
        
        // Structure of Arrays - cache friendly!
        this.posX = new Float32Array(maxParticles);
        this.posY = new Float32Array(maxParticles);
        this.posZ = new Float32Array(maxParticles);
        this.velX = new Float32Array(maxParticles);
        this.velY = new Float32Array(maxParticles);
        this.velZ = new Float32Array(maxParticles);
        this.state = new Uint8Array(maxParticles);
        this.size = new Float32Array(maxParticles);
        this.stickTime = new Float32Array(maxParticles);
        this.slideSpeed = new Float32Array(maxParticles);
        
        // SDF data
        this.sdf = null;
        
        // Initialize as inactive
        this.state.fill(INACTIVE);
    }
    
    setSDF(sdfData) {
        this.sdf = sdfData;
    }
    
    // Sample SDF at position with trilinear interpolation - smooth O(1) collision!
    sampleSDF(x, y, z) {
        if (!this.sdf) return 100;
        
        const { data, bbox, resolution, stepX, stepY, stepZ } = this.sdf;
        
        // Convert world pos to continuous grid coords
        const fx = (x - bbox.min.x) / stepX - 0.5;
        const fy = (y - bbox.min.y) / stepY - 0.5;
        const fz = (z - bbox.min.z) / stepZ - 0.5;
        
        // Integer grid coords
        const x0 = Math.floor(fx);
        const y0 = Math.floor(fy);
        const z0 = Math.floor(fz);
        
        // Bounds check (with 1 cell margin for interpolation)
        if (x0 < 0 || x0 >= resolution - 1 || 
            y0 < 0 || y0 >= resolution - 1 || 
            z0 < 0 || z0 >= resolution - 1) {
            return 100; // Far from surface
        }
        
        // Fractional parts for interpolation
        const tx = fx - x0;
        const ty = fy - y0;
        const tz = fz - z0;
        
        // Sample 8 corners of the cell
        const r = resolution;
        const r2 = r * r;
        const i000 = x0 + y0 * r + z0 * r2;
        const i100 = i000 + 1;
        const i010 = i000 + r;
        const i110 = i000 + r + 1;
        const i001 = i000 + r2;
        const i101 = i000 + r2 + 1;
        const i011 = i000 + r2 + r;
        const i111 = i000 + r2 + r + 1;
        
        // Trilinear interpolation
        const c00 = data[i000] * (1 - tx) + data[i100] * tx;
        const c10 = data[i010] * (1 - tx) + data[i110] * tx;
        const c01 = data[i001] * (1 - tx) + data[i101] * tx;
        const c11 = data[i011] * (1 - tx) + data[i111] * tx;
        
        const c0 = c00 * (1 - ty) + c10 * ty;
        const c1 = c01 * (1 - ty) + c11 * ty;
        
        return c0 * (1 - tz) + c1 * tz;
    }
    
    // Compute SDF gradient (surface normal direction)
    sdfGradient(x, y, z, out) {
        const eps = 0.1;
        const dx = this.sampleSDF(x + eps, y, z) - this.sampleSDF(x - eps, y, z);
        const dy = this.sampleSDF(x, y + eps, z) - this.sampleSDF(x, y - eps, z);
        const dz = this.sampleSDF(x, y, z + eps) - this.sampleSDF(x, y, z - eps);
        
        const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
        out.x = dx / len;
        out.y = dy / len;
        out.z = dz / len;
    }
    
    // Spawn particles
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
            this.state[idx] = FALLING;
            this.size[idx] = sizes[i];
            this.stickTime[idx] = 0;
            this.slideSpeed[idx] = slideSpeeds[i];
        }
    }
    
    // Update all particles - tight loop, cache friendly
    update(dt, time) {
        const gravity = CONFIG.DRIP_GRAVITY;
        const normal = { x: 0, y: 0, z: 0 };
        
        let activeCount = 0;
        let highestActive = 0;
        
        // Process particles, tracking highest active index for draw range optimization
        for (let i = 0; i < this.count; i++) {
            const s = this.state[i];
            if (s === INACTIVE) continue;
            
            activeCount++;
            highestActive = i;
            
            // ========== FALLING STATE ==========
            // Invisible drops flying toward text
            if (s === FALLING) {
                this.velY[i] += gravity * dt;
                
                this.posX[i] += this.velX[i] * dt;
                this.posY[i] += this.velY[i] * dt;
                this.posZ[i] += this.velZ[i] * dt;
                
                // Check collision with text surface
                const dist = this.sampleSDF(this.posX[i], this.posY[i], this.posZ[i]);
                
                if (dist < 0.35) {
                    // IMPACT! Get surface normal
                    this.sdfGradient(this.posX[i], this.posY[i], this.posZ[i], normal);
                    
                    // Push out of surface
                    const push = 0.15 - dist;
                    this.posX[i] += normal.x * push;
                    this.posY[i] += normal.y * push;
                    this.posZ[i] += normal.z * push;
                    
                    // Decide: BOUNCE or STICK?
                    if (Math.random() < CONFIG.BOUNCE_CHANCE) {
                        // BOUNCE - reflect off surface with energy loss
                        const dotVN = this.velX[i]*normal.x + this.velY[i]*normal.y + this.velZ[i]*normal.z;
                        const restitution = CONFIG.BOUNCE_RESTITUTION_MIN + 
                            Math.random() * (CONFIG.BOUNCE_RESTITUTION_MAX - CONFIG.BOUNCE_RESTITUTION_MIN);
                        
                        this.velX[i] = (this.velX[i] - 2*dotVN*normal.x) * restitution;
                        this.velY[i] = (this.velY[i] - 2*dotVN*normal.y) * restitution;
                        this.velZ[i] = (this.velZ[i] - 2*dotVN*normal.z) * restitution;
                        
                        // Add chaotic splash scatter
                        this.velX[i] += (Math.random() - 0.5) * CONFIG.BOUNCE_SCATTER * 2;
                        this.velY[i] += (Math.random() - 0.5) * CONFIG.BOUNCE_SCATTER + CONFIG.SPLASH_UPWARD_BIAS;
                        this.velZ[i] += (Math.random() - 0.5) * CONFIG.BOUNCE_SCATTER;
                        
                        this.state[i] = BOUNCING;
                        this.size[i] *= CONFIG.BOUNCE_SIZE_REDUCTION + Math.random() * 0.3;
                    } else {
                        // STICK to surface
                        this.velX[i] = 0;
                        this.velY[i] = 0;
                        this.velZ[i] = 0;
                        this.state[i] = STUCK;
                        this.stickTime[i] = 0;
                    }
                }
                
                // Remove if missed text entirely
                if (this.posY[i] < CONFIG.DRIP_REMOVE_Y || this.posZ[i] < -10) {
                    this.state[i] = INACTIVE;
                    this.size[i] = 0;
                }
            }
            
            // ========== BOUNCING STATE ==========
            // Drops that bounced off - fall with air drag on horizontal movement
            else if (s === BOUNCING) {
                this.velY[i] += gravity * dt;  // Normal gravity
                this.velX[i] *= CONFIG.BOUNCE_DRAG;  // Air drag on horizontal only
                this.velZ[i] *= CONFIG.BOUNCE_DRAG;
                
                this.posX[i] += this.velX[i] * dt;
                this.posY[i] += this.velY[i] * dt;
                this.posZ[i] += this.velZ[i] * dt;
                
                this.size[i] *= (1 - dt * CONFIG.DRIP_SHRINK_RATE);
                
                if (this.posY[i] < CONFIG.DRIP_REMOVE_Y || this.size[i] < CONFIG.DRIP_MIN_SIZE) {
                    this.state[i] = INACTIVE;
                    this.size[i] = 0;
                }
            }
            
            // ========== STUCK STATE ==========
            // Drops stuck on letters briefly, then drip straight down
            else if (s === STUCK) {
                this.stickTime[i] += dt;
                
                // Subtle jitter for realism
                this.posX[i] += Math.sin(time * CONFIG.STICK_JITTER_SPEED + this.posY[i] * 3) * CONFIG.STICK_JITTER_AMOUNT;
                
                // Wait, then start dripping (staggered by slideSpeed random value)
                const stickDuration = CONFIG.STICK_DURATION_MIN + 
                    this.slideSpeed[i] * (CONFIG.STICK_DURATION_MAX - CONFIG.STICK_DURATION_MIN);
                
                if (this.stickTime[i] > stickDuration) {
                    // Skip SLIDING - go straight to DRIPPING
                    this.state[i] = DRIPPING;
                    this.velY[i] = CONFIG.DRIP_INITIAL_VELOCITY;
                }
            }
            
            // ========== SLIDING STATE ==========
            // Drops slowly sliding down the letter surface
            else if (s === SLIDING) {
                this.sdfGradient(this.posX[i], this.posY[i], this.posZ[i], normal);
                
                // Calculate gravity tangent to surface
                const dot = gravity * normal.y;
                const tanX = -normal.x * dot;
                const tanY = gravity - normal.y * dot;
                const tanZ = -normal.z * dot;
                
                // Slide speed (slower = more realistic drip)
                const speed = CONFIG.SLIDE_SPEED_MIN + 
                    this.slideSpeed[i] * (CONFIG.SLIDE_SPEED_MAX - CONFIG.SLIDE_SPEED_MIN);
                
                this.velX[i] = tanX * speed;
                this.velY[i] = tanY * speed;
                this.velZ[i] = tanZ * speed;
                
                this.posX[i] += this.velX[i] * dt;
                this.posY[i] += this.velY[i] * dt;
                this.posZ[i] += this.velZ[i] * dt;
                
                // Check if still on surface
                const dist = this.sampleSDF(this.posX[i], this.posY[i], this.posZ[i]);
                
                // Left surface OR reached letter bottom - start dripping
                if (dist > 0.4 || this.posY[i] < this.sdf.bbox.min.y + 0.3) {
                    this.state[i] = DRIPPING;
                    this.velX[i] *= 0.3;
                    this.velY[i] = CONFIG.DRIP_INITIAL_VELOCITY;
                    this.velZ[i] *= 0.3;
                } else if (dist < 0.08) {
                    // Push back to surface
                    this.posX[i] += normal.x * (0.12 - dist);
                    this.posY[i] += normal.y * (0.12 - dist);
                    this.posZ[i] += normal.z * (0.12 - dist);
                }
                
                this.stickTime[i] += dt;
                
                // Max slide time then force drip (staggered)
                const maxSlide = CONFIG.SLIDE_DURATION_MIN + 
                    this.slideSpeed[i] * (CONFIG.SLIDE_DURATION_MAX - CONFIG.SLIDE_DURATION_MIN);
                
                if (this.stickTime[i] > maxSlide) {
                    this.state[i] = DRIPPING;
                    this.velY[i] = CONFIG.DRIP_INITIAL_VELOCITY;
                }
            }
            
            // ========== DRIPPING STATE ==========
            // Final fall to bottom of screen
            else if (s === DRIPPING) {
                this.velY[i] += gravity * dt;
                this.velX[i] *= 0.99;
                this.velZ[i] *= 0.99;
                
                this.posX[i] += this.velX[i] * dt;
                this.posY[i] += this.velY[i] * dt;
                this.posZ[i] += this.velZ[i] * dt;
                
                this.size[i] *= (1 - dt * CONFIG.DRIP_SHRINK_RATE);
                
                if (this.posY[i] < CONFIG.DRIP_REMOVE_Y || this.size[i] < CONFIG.DRIP_MIN_SIZE) {
                    this.state[i] = INACTIVE;
                    this.size[i] = 0;
                }
            }
        }
        
        // Store highest active index for optimized rendering
        this.highestActiveIndex = highestActive;
        return activeCount;
    }
    
    // Copy to Three.js buffer attributes - optimized to only copy active range
    copyToBuffers(positionAttr, stateAttr) {
        const pos = positionAttr.array;
        const st = stateAttr.array;
        
        // Only copy up to highest active particle (not all allocated)
        const limit = Math.min(this.highestActiveIndex + 1, this.count);
        
        for (let i = 0; i < limit; i++) {
            const i3 = i * 3;
            const i4 = i * 4;
            
            pos[i3] = this.posX[i];
            pos[i3 + 1] = this.posY[i];
            pos[i3 + 2] = this.posZ[i];
            
            st[i4] = this.state[i];
            st[i4 + 1] = this.stickTime[i];
            st[i4 + 2] = this.size[i];
            st[i4 + 3] = this.slideSpeed[i];
        }
        
        positionAttr.needsUpdate = true;
        stateAttr.needsUpdate = true;
        
        return limit; // Return count for draw range
    }
    
    // Reset for next wave
    reset() {
        this.count = 0;
        this.highestActiveIndex = 0;
        this.state.fill(INACTIVE);
    }
    
    // Count particles on text (stuck or sliding)
    countOnText() {
        let count = 0;
        for (let i = 0; i < this.count; i++) {
            if (this.state[i] === STUCK || this.state[i] === SLIDING) {
                count++;
            }
        }
        return count;
    }
}
