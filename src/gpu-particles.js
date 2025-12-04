/**
 * Optimized Particle System with SDF Collision
 * Uses Structure-of-Arrays (SoA) for cache-friendly physics
 * SDF provides O(1) collision detection
 */

// States
const FALLING = 0;
const STUCK = 1;
const SLIDING = 2;
const DRIPPING = 3;
const INACTIVE = 4;
const BOUNCING = 5;  // New state for splash rebound!

// Generate 3D Signed Distance Field from geometry
export function generateSDF(geometry, resolution = 64) {
    console.time('SDF Generation');
    
    const bbox = geometry.boundingBox.clone();
    bbox.expandByScalar(0.8);
    
    const size = {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z
    };
    
    const data = new Float32Array(resolution * resolution * resolution);
    const positions = geometry.attributes.position.array;
    const indices = geometry.index ? geometry.index.array : null;
    
    // Build proper triangle data for accurate distance
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
    
    const stepX = size.x / resolution;
    const stepY = size.y / resolution;
    const stepZ = size.z / resolution;
    
    // Fill SDF with accurate distances to triangles
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
    console.log('SDF bounds:', bbox.min, bbox.max);
    
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
    
    // Sample SDF at position - O(1) collision!
    sampleSDF(x, y, z) {
        if (!this.sdf) return 100;
        
        const { data, bbox, resolution, stepX, stepY, stepZ } = this.sdf;
        
        // Convert world pos to grid coords
        const gx = Math.floor((x - bbox.min.x) / stepX);
        const gy = Math.floor((y - bbox.min.y) / stepY);
        const gz = Math.floor((z - bbox.min.z) / stepZ);
        
        // Bounds check
        if (gx < 0 || gx >= resolution || 
            gy < 0 || gy >= resolution || 
            gz < 0 || gz >= resolution) {
            return 100; // Far from surface
        }
        
        return data[gx + gy * resolution + gz * resolution * resolution];
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
        const gravity = -9.8;  // Natural gravity
        const normal = { x: 0, y: 0, z: 0 };
        
        let activeCount = 0;
        
        for (let i = 0; i < this.count; i++) {
            const s = this.state[i];
            if (s === INACTIVE) continue;
            
            activeCount++;
            
            if (s === FALLING) {
                // Apply gravity
                this.velY[i] += gravity * dt;
                
                // Move
                this.posX[i] += this.velX[i] * dt;
                this.posY[i] += this.velY[i] * dt;
                this.posZ[i] += this.velZ[i] * dt;
                
                // Check collision with SDF
                const dist = this.sampleSDF(this.posX[i], this.posY[i], this.posZ[i]);
                
                if (dist < 0.35) {
                    // HIT! Calculate impact speed
                    const speed = Math.sqrt(this.velX[i]**2 + this.velY[i]**2 + this.velZ[i]**2);
                    this.sdfGradient(this.posX[i], this.posY[i], this.posZ[i], normal);
                    
                    // Push out of surface
                    const push = 0.15 - dist;
                    this.posX[i] += normal.x * push;
                    this.posY[i] += normal.y * push;
                    this.posZ[i] += normal.z * push;
                    
                    // SPLASH DECISION: bounce or stick based on impact speed & randomness
                    const bounceChance = Math.min(0.7, speed / 40);  // Faster = more likely to bounce
                    
                    if (Math.random() < bounceChance) {
                        // BOUNCE! Reflect velocity off surface
                        const dotVN = this.velX[i]*normal.x + this.velY[i]*normal.y + this.velZ[i]*normal.z;
                        
                        // Reflect with energy loss
                        const restitution = 0.3 + Math.random() * 0.4;  // 30-70% energy kept
                        this.velX[i] = (this.velX[i] - 2*dotVN*normal.x) * restitution;
                        this.velY[i] = (this.velY[i] - 2*dotVN*normal.y) * restitution;
                        this.velZ[i] = (this.velZ[i] - 2*dotVN*normal.z) * restitution;
                        
                        // Add random splash scatter
                        this.velX[i] += (Math.random() - 0.5) * 8;
                        this.velY[i] += (Math.random() - 0.5) * 8 + 3;  // Upward bias
                        this.velZ[i] += (Math.random() - 0.5) * 5;
                        
                        this.state[i] = BOUNCING;
                        this.stickTime[i] = 0;  // Track bounces
                        
                        // Some drops split smaller on impact
                        this.size[i] *= (0.6 + Math.random() * 0.4);
                    } else {
                        // STICK to surface
                        this.velX[i] = 0;
                        this.velY[i] = 0;
                        this.velZ[i] = 0;
                        this.state[i] = STUCK;
                        this.stickTime[i] = 0;
                    }
                }
                
                // Remove if fallen too far
                if (this.posY[i] < -20 || this.posZ[i] < -10) {
                    this.state[i] = INACTIVE;
                    this.size[i] = 0;
                }
            }
            else if (s === BOUNCING) {
                // Bouncing droplet - apply gravity and check for re-collision
                this.velY[i] += gravity * dt;
                
                this.posX[i] += this.velX[i] * dt;
                this.posY[i] += this.velY[i] * dt;
                this.posZ[i] += this.velZ[i] * dt;
                
                this.stickTime[i] += dt;
                
                // Check if it hits surface again
                const dist = this.sampleSDF(this.posX[i], this.posY[i], this.posZ[i]);
                
                if (dist < 0.3) {
                    this.sdfGradient(this.posX[i], this.posY[i], this.posZ[i], normal);
                    const push = 0.15 - dist;
                    this.posX[i] += normal.x * push;
                    this.posY[i] += normal.y * push;
                    this.posZ[i] += normal.z * push;
                    
                    // After bouncing, more likely to stick
                    if (Math.random() < 0.6 || this.stickTime[i] > 0.5) {
                        this.velX[i] = 0;
                        this.velY[i] = 0;
                        this.velZ[i] = 0;
                        this.state[i] = STUCK;
                        this.stickTime[i] = 0;
                    } else {
                        // Bounce again but weaker
                        const dotVN = this.velX[i]*normal.x + this.velY[i]*normal.y + this.velZ[i]*normal.z;
                        this.velX[i] = (this.velX[i] - 2*dotVN*normal.x) * 0.3;
                        this.velY[i] = (this.velY[i] - 2*dotVN*normal.y) * 0.3 + 2;
                        this.velZ[i] = (this.velZ[i] - 2*dotVN*normal.z) * 0.3;
                    }
                }
                
                // Bounced off into space - becomes dripping
                if (this.posY[i] < -5 || this.stickTime[i] > 1.5) {
                    this.state[i] = DRIPPING;
                }
                
                // Remove if way off screen
                if (this.posY[i] < -20 || Math.abs(this.posX[i]) > 30) {
                    this.state[i] = INACTIVE;
                    this.size[i] = 0;
                }
            }
            else if (s === STUCK) {
                this.stickTime[i] += dt;
                
                // Very small jitter for realism
                this.posX[i] += Math.sin(time * 6 + this.posY[i] * 3) * 0.0002;
                
                // Quick stick then start sliding (0.3-0.8s)
                if (this.stickTime[i] > 0.3 + this.slideSpeed[i] * 0.5) {
                    this.state[i] = SLIDING;
                }
            }
            else if (s === SLIDING) {
                // Get surface normal
                this.sdfGradient(this.posX[i], this.posY[i], this.posZ[i], normal);
                
                // Gravity tangent to surface - slide down
                const dot = gravity * normal.y;
                const tanX = -normal.x * dot;
                const tanY = gravity - normal.y * dot;
                const tanZ = -normal.z * dot;
                
                // Fast slide speed
                const speed = 0.8 + this.slideSpeed[i] * 0.4;
                this.velX[i] = tanX * speed;
                this.velY[i] = tanY * speed;
                this.velZ[i] = tanZ * speed;
                
                // Move
                this.posX[i] += this.velX[i] * dt;
                this.posY[i] += this.velY[i] * dt;
                this.posZ[i] += this.velZ[i] * dt;
                
                // Check if still on surface
                const dist = this.sampleSDF(this.posX[i], this.posY[i], this.posZ[i]);
                
                // Left surface OR reached bottom of letter - start dripping!
                if (dist > 0.4 || this.posY[i] < this.sdf.bbox.min.y + 0.3) {
                    this.state[i] = DRIPPING;
                    this.velX[i] *= 0.3;
                    this.velY[i] = -2;  // Start falling
                    this.velZ[i] *= 0.3;
                } else if (dist < 0.08) {
                    // Push back to surface
                    this.posX[i] += normal.x * (0.12 - dist);
                    this.posY[i] += normal.y * (0.12 - dist);
                    this.posZ[i] += normal.z * (0.12 - dist);
                }
                
                this.stickTime[i] += dt;
                // Max slide time 2-3 seconds then drip
                if (this.stickTime[i] > 2.0 + this.slideSpeed[i] * 1.0) {
                    this.state[i] = DRIPPING;
                    this.velY[i] = -1.5;
                }
            }
            else if (s === DRIPPING) {
                // Fall straight down with gravity - all the way to bottom!
                this.velY[i] += gravity * dt;
                this.velX[i] *= 0.99;
                this.velZ[i] *= 0.99;
                
                this.posX[i] += this.velX[i] * dt;
                this.posY[i] += this.velY[i] * dt;
                this.posZ[i] += this.velZ[i] * dt;
                
                // Slight shrink as it falls
                this.size[i] *= (1 - dt * 0.08);
                
                // Remove only when way off bottom of screen
                if (this.posY[i] < -20 || this.size[i] < 0.015) {
                    this.state[i] = INACTIVE;
                    this.size[i] = 0;
                }
            }
        }
        
        return activeCount;
    }
    
    // Copy to Three.js buffer attributes
    copyToBuffers(positionAttr, stateAttr) {
        const pos = positionAttr.array;
        const st = stateAttr.array;
        
        for (let i = 0; i < this.count; i++) {
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
    }
    
    // Reset for next wave
    reset() {
        this.count = 0;
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
