/**
 * Web Worker for SDF Generation
 * Runs heavy computation off the main thread
 */

// Accurate point-to-triangle distance
function pointToTriangleDist(px, py, pz, tri) {
    const abx = tri.bx - tri.ax, aby = tri.by - tri.ay, abz = tri.bz - tri.az;
    const acx = tri.cx - tri.ax, acy = tri.cy - tri.ay, acz = tri.cz - tri.az;
    const apx = px - tri.ax, apy = py - tri.ay, apz = pz - tri.az;
    
    const d1 = abx*apx + aby*apy + abz*apz;
    const d2 = acx*apx + acy*apy + acz*apz;
    
    if (d1 <= 0 && d2 <= 0) {
        return Math.sqrt(apx*apx + apy*apy + apz*apz);
    }
    
    const bpx = px - tri.bx, bpy = py - tri.by, bpz = pz - tri.bz;
    const d3 = abx*bpx + aby*bpy + abz*bpz;
    const d4 = acx*bpx + acy*bpy + acz*bpz;
    
    if (d3 >= 0 && d4 <= d3) {
        return Math.sqrt(bpx*bpx + bpy*bpy + bpz*bpz);
    }
    
    const vc = d1*d4 - d3*d2;
    if (vc <= 0 && d1 >= 0 && d3 <= 0) {
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
        return Math.sqrt(cpx*cpx + cpy*cpy + cpz*cpz);
    }
    
    const vb = d5*d2 - d1*d6;
    if (vb <= 0 && d2 >= 0 && d6 <= 0) {
        const w = d2 / (d2 - d6);
        const closestX = tri.ax + acx * w;
        const closestY = tri.ay + acy * w;
        const closestZ = tri.az + acz * w;
        const dx = px - closestX, dy = py - closestY, dz = pz - closestZ;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    const va = d3*d6 - d5*d4;
    if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
        const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
        const closestX = tri.bx + (tri.cx - tri.bx) * w;
        const closestY = tri.by + (tri.cy - tri.by) * w;
        const closestZ = tri.bz + (tri.cz - tri.bz) * w;
        const dx = px - closestX, dy = py - closestY, dz = pz - closestZ;
        return Math.sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    const denom = 1 / (va + vb + vc);
    const v = vb * denom;
    const w = vc * denom;
    const closestX = tri.ax + abx * v + acx * w;
    const closestY = tri.ay + aby * v + acy * w;
    const closestZ = tri.az + abz * v + acz * w;
    const dx = px - closestX, dy = py - closestY, dz = pz - closestZ;
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function generateSDF(triangles, bbox, resolution) {
    const size = {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z
    };
    
    const data = new Float32Array(resolution * resolution * resolution);
    const stepX = size.x / resolution;
    const stepY = size.y / resolution;
    const stepZ = size.z / resolution;
    
    const totalVoxels = resolution * resolution * resolution;
    let processed = 0;
    let lastProgress = 0;
    
    for (let z = 0; z < resolution; z++) {
        const pz = bbox.min.z + (z + 0.5) * stepZ;
        for (let y = 0; y < resolution; y++) {
            const py = bbox.min.y + (y + 0.5) * stepY;
            for (let x = 0; x < resolution; x++) {
                const px = bbox.min.x + (x + 0.5) * stepX;
                
                let minDist = Infinity;
                for (let t = 0; t < triangles.length; t++) {
                    const tri = triangles[t];
                    const dist = pointToTriangleDist(px, py, pz, tri);
                    if (dist < minDist) minDist = dist;
                }
                
                data[x + y * resolution + z * resolution * resolution] = minDist;
                processed++;
            }
        }
        
        // Report progress every 10%
        const progress = Math.floor((processed / totalVoxels) * 100);
        if (progress >= lastProgress + 10) {
            lastProgress = progress;
            self.postMessage({ type: 'progress', progress });
        }
    }
    
    return { data, size, stepX, stepY, stepZ };
}

// Handle messages from main thread
self.onmessage = function(e) {
    const { triangles, bbox, resolution } = e.data;
    
    const startTime = performance.now();
    const result = generateSDF(triangles, bbox, resolution);
    const duration = performance.now() - startTime;
    
    self.postMessage({
        type: 'complete',
        data: result.data,
        size: result.size,
        stepX: result.stepX,
        stepY: result.stepY,
        stepZ: result.stepZ,
        duration
    }, [result.data.buffer]); // Transfer buffer for zero-copy
};
