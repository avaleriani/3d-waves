/**
 * Physics Worker for parallel particle processing
 * Uses SharedArrayBuffer for zero-copy data sharing
 */

// Particle states
const FALLING = 0;
const STUCK = 1;
const SLIDING = 2;
const DRIPPING = 3;
const INACTIVE = 4;
const BOUNCING = 5;

let config = null;
let sdfData = null;
let sdfBbox = null;
let sdfResolution = 0;
let sdfStepX = 0, sdfStepY = 0, sdfStepZ = 0;

// Shared buffers
let posX, posY, posZ;
let velX, velY, velZ;
let state, size, stickTime, slideSpeed;

// Trilinear SDF sampling
function sampleSDF(x, y, z) {
    if (!sdfData) return 100;
    
    const fx = (x - sdfBbox.minX) / sdfStepX - 0.5;
    const fy = (y - sdfBbox.minY) / sdfStepY - 0.5;
    const fz = (z - sdfBbox.minZ) / sdfStepZ - 0.5;
    
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const z0 = Math.floor(fz);
    
    if (x0 < 0 || x0 >= sdfResolution - 1 || 
        y0 < 0 || y0 >= sdfResolution - 1 || 
        z0 < 0 || z0 >= sdfResolution - 1) {
        return 100;
    }
    
    const tx = fx - x0;
    const ty = fy - y0;
    const tz = fz - z0;
    
    const r = sdfResolution;
    const r2 = r * r;
    const i000 = x0 + y0 * r + z0 * r2;
    
    const c00 = sdfData[i000] * (1 - tx) + sdfData[i000 + 1] * tx;
    const c10 = sdfData[i000 + r] * (1 - tx) + sdfData[i000 + r + 1] * tx;
    const c01 = sdfData[i000 + r2] * (1 - tx) + sdfData[i000 + r2 + 1] * tx;
    const c11 = sdfData[i000 + r2 + r] * (1 - tx) + sdfData[i000 + r2 + r + 1] * tx;
    
    const c0 = c00 * (1 - ty) + c10 * ty;
    const c1 = c01 * (1 - ty) + c11 * ty;
    
    return c0 * (1 - tz) + c1 * tz;
}

function sdfGradient(x, y, z) {
    const eps = 0.1;
    const dx = sampleSDF(x + eps, y, z) - sampleSDF(x - eps, y, z);
    const dy = sampleSDF(x, y + eps, z) - sampleSDF(x, y - eps, z);
    const dz = sampleSDF(x, y, z + eps) - sampleSDF(x, y, z - eps);
    
    const len = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    return { x: dx/len, y: dy/len, z: dz/len };
}

function processParticles(startIdx, endIdx, dt, time) {
    const gravity = config.DRIP_GRAVITY;
    let activeCount = 0;
    
    for (let i = startIdx; i < endIdx; i++) {
        const s = state[i];
        if (s === INACTIVE) continue;
        activeCount++;
        
        // FALLING
        if (s === FALLING) {
            velY[i] += gravity * dt;
            posX[i] += velX[i] * dt;
            posY[i] += velY[i] * dt;
            posZ[i] += velZ[i] * dt;
            
            const dist = sampleSDF(posX[i], posY[i], posZ[i]);
            
            if (dist < 0.2) {
                const normal = sdfGradient(posX[i], posY[i], posZ[i]);
                
                // Only collide if:
                // 1. Hitting FRONT face of text (normal pointing toward camera)
                // 2. Particle Z is near the FRONT of the text (not deep in gaps between letters)
                const frontThreshold = sdfBbox.maxZ - 1.5;
                const isFrontFacing = normal.z > 0.5;
                const isNearFront = posZ[i] > frontThreshold;
                
                if (isFrontFacing && isNearFront) {
                    const push = 0.1 - dist;
                    posX[i] += normal.x * push;
                    posY[i] += normal.y * push;
                    posZ[i] += normal.z * push;
                    
                    if (Math.random() < config.BOUNCE_CHANCE) {
                        // BOUNCE - natural water spray physics
                        const vx = velX[i], vy = velY[i], vz = velZ[i];
                        const impactSpeed = Math.sqrt(vx*vx + vy*vy + vz*vz);
                        const dotVN = vx*normal.x + vy*normal.y + vz*normal.z;
                        
                        // Restitution varies with impact angle and speed
                        const angleInfluence = Math.abs(dotVN) / (impactSpeed + 0.01);
                        const baseRestitution = config.BOUNCE_RESTITUTION_MIN + 
                            Math.random() * (config.BOUNCE_RESTITUTION_MAX - config.BOUNCE_RESTITUTION_MIN);
                        const restitution = baseRestitution * (0.7 + 0.3 * (1 - angleInfluence));
                        
                        // Reflect with energy loss
                        let reflX = (vx - 2*dotVN*normal.x) * restitution;
                        let reflY = (vy - 2*dotVN*normal.y) * restitution;
                        let reflZ = (vz - 2*dotVN*normal.z) * restitution;
                        
                        // Radial spray pattern
                        const sprayAngle = Math.random() * Math.PI * 2;
                        const sprayFactor = config.IMPACT_SPRAY_FACTOR || 0.12;
                        const sprayStrength = impactSpeed * sprayFactor;
                        
                        // Create tangent vectors for radial spray
                        let tangentX = 1, tangentY = 0, tangentZ = 0;
                        if (Math.abs(normal.x) > 0.9) { tangentX = 0; tangentY = 1; }
                        const t1x = normal.y*tangentZ - normal.z*tangentY;
                        const t1y = normal.z*tangentX - normal.x*tangentZ;
                        const t1z = normal.x*tangentY - normal.y*tangentX;
                        const t1len = Math.sqrt(t1x*t1x + t1y*t1y + t1z*t1z) || 1;
                        const nt1x = t1x/t1len, nt1y = t1y/t1len, nt1z = t1z/t1len;
                        const t2x = normal.y*nt1z - normal.z*nt1y;
                        const t2y = normal.z*nt1x - normal.x*nt1z;
                        const t2z = normal.x*nt1y - normal.y*nt1x;
                        
                        // Apply radial spray
                        const sprayMult = sprayStrength * (0.5 + Math.random() * 0.5);
                        reflX += (nt1x * Math.cos(sprayAngle) + t2x * Math.sin(sprayAngle)) * sprayMult;
                        reflY += (nt1y * Math.cos(sprayAngle) + t2y * Math.sin(sprayAngle)) * sprayMult;
                        reflZ += (nt1z * Math.cos(sprayAngle) + t2z * Math.sin(sprayAngle)) * sprayMult;
                        
                        // Add scatter with more vertical emphasis
                        const hScatter = config.BOUNCE_SCATTER * (0.3 + Math.random() * 0.7);
                        const vScatter = (config.BOUNCE_SCATTER_VERTICAL || 6) * (0.4 + Math.random() * 0.6);
                        
                        velX[i] = reflX + (Math.random() - 0.5) * hScatter * 2;
                        velY[i] = reflY + Math.random() * vScatter + config.SPLASH_UPWARD_BIAS;
                        velZ[i] = reflZ + (Math.random() - 0.5) * hScatter;
                        
                        state[i] = BOUNCING;
                        
                        // Size reduction with mist variation
                        const speedFactor = Math.min(impactSpeed / 40, 1);
                        const mistFactor = config.MIST_SIZE_FACTOR || 0.3;
                        const sizeReduction = Math.max(config.BOUNCE_SIZE_REDUCTION - speedFactor * mistFactor, 0.2);
                        size[i] *= sizeReduction * (0.6 + Math.random() * 0.6);
                    } else {
                        velX[i] = velY[i] = velZ[i] = 0;
                        state[i] = STUCK;
                        stickTime[i] = 0;
                    }
                }
            }
            
            if (posY[i] < config.DRIP_REMOVE_Y || posZ[i] < -10) {
                state[i] = INACTIVE;
                size[i] = 0;
            }
        }
        
        // BOUNCING
        else if (s === BOUNCING) {
            velY[i] += gravity * dt;
            velX[i] *= config.BOUNCE_DRAG;
            velZ[i] *= config.BOUNCE_DRAG;
            
            posX[i] += velX[i] * dt;
            posY[i] += velY[i] * dt;
            posZ[i] += velZ[i] * dt;
            
            size[i] *= (1 - dt * config.DRIP_SHRINK_RATE);
            
            if (posY[i] < config.DRIP_REMOVE_Y || size[i] < config.DRIP_MIN_SIZE) {
                state[i] = INACTIVE;
                size[i] = 0;
            }
        }
        
        // STUCK
        else if (s === STUCK) {
            stickTime[i] += dt;
            posX[i] += Math.sin(time * config.STICK_JITTER_SPEED + posY[i] * 3) * config.STICK_JITTER_AMOUNT;
            
            const stickDuration = config.STICK_DURATION_MIN + 
                slideSpeed[i] * (config.STICK_DURATION_MAX - config.STICK_DURATION_MIN);
            
            if (stickTime[i] > stickDuration) {
                state[i] = DRIPPING;
                velY[i] = config.DRIP_INITIAL_VELOCITY;
            }
        }
        
        // DRIPPING
        else if (s === DRIPPING) {
            velY[i] += gravity * dt;
            velX[i] *= 0.99;
            velZ[i] *= 0.99;
            
            posX[i] += velX[i] * dt;
            posY[i] += velY[i] * dt;
            posZ[i] += velZ[i] * dt;
            
            size[i] *= (1 - dt * config.DRIP_SHRINK_RATE);
            
            if (posY[i] < config.DRIP_REMOVE_Y || size[i] < config.DRIP_MIN_SIZE) {
                state[i] = INACTIVE;
                size[i] = 0;
            }
        }
    }
    
    return activeCount;
}

self.onmessage = function(e) {
    const { type } = e.data;
    
    if (type === 'init') {
        // Initialize with SharedArrayBuffers
        const { buffers, cfg, sdf } = e.data;
        
        posX = new Float32Array(buffers.posX);
        posY = new Float32Array(buffers.posY);
        posZ = new Float32Array(buffers.posZ);
        velX = new Float32Array(buffers.velX);
        velY = new Float32Array(buffers.velY);
        velZ = new Float32Array(buffers.velZ);
        state = new Uint8Array(buffers.state);
        size = new Float32Array(buffers.size);
        stickTime = new Float32Array(buffers.stickTime);
        slideSpeed = new Float32Array(buffers.slideSpeed);
        
        config = cfg;
        sdfData = new Float32Array(sdf.data);
        sdfBbox = sdf.bbox;
        sdfResolution = sdf.resolution;
        sdfStepX = sdf.stepX;
        sdfStepY = sdf.stepY;
        sdfStepZ = sdf.stepZ;
        
        self.postMessage({ type: 'ready' });
    }
    
    else if (type === 'update') {
        const { startIdx, endIdx, dt, time } = e.data;
        const activeCount = processParticles(startIdx, endIdx, dt, time);
        self.postMessage({ type: 'done', activeCount });
    }
    
    else if (type === 'updateConfig') {
        config = e.data.config;
    }
};
