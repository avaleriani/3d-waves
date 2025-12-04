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
            
            if (dist < 0.35) {
                const normal = sdfGradient(posX[i], posY[i], posZ[i]);
                const push = 0.15 - dist;
                posX[i] += normal.x * push;
                posY[i] += normal.y * push;
                posZ[i] += normal.z * push;
                
                if (Math.random() < config.BOUNCE_CHANCE) {
                    const dotVN = velX[i]*normal.x + velY[i]*normal.y + velZ[i]*normal.z;
                    const restitution = config.BOUNCE_RESTITUTION_MIN + 
                        Math.random() * (config.BOUNCE_RESTITUTION_MAX - config.BOUNCE_RESTITUTION_MIN);
                    
                    velX[i] = (velX[i] - 2*dotVN*normal.x) * restitution;
                    velY[i] = (velY[i] - 2*dotVN*normal.y) * restitution;
                    velZ[i] = (velZ[i] - 2*dotVN*normal.z) * restitution;
                    
                    velX[i] += (Math.random() - 0.5) * config.BOUNCE_SCATTER * 2;
                    velY[i] += (Math.random() - 0.5) * config.BOUNCE_SCATTER + config.SPLASH_UPWARD_BIAS;
                    velZ[i] += (Math.random() - 0.5) * config.BOUNCE_SCATTER;
                    
                    state[i] = BOUNCING;
                    size[i] *= config.BOUNCE_SIZE_REDUCTION + Math.random() * 0.3;
                } else {
                    velX[i] = velY[i] = velZ[i] = 0;
                    state[i] = STUCK;
                    stickTime[i] = 0;
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
