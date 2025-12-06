/**
 * Worker for parallel SDF generation - processes a slice of Z layers
 * Uses BVH for fast triangle lookups
 */

// ============================================
// BVH (Bounding Volume Hierarchy)
// ============================================
class BVHNode {
    constructor() {
        this.minX = Infinity; this.minY = Infinity; this.minZ = Infinity;
        this.maxX = -Infinity; this.maxY = -Infinity; this.maxZ = -Infinity;
        this.left = null;
        this.right = null;
        this.triangles = null;
    }
}

function buildBVH(triangles, depth = 0, maxDepth = 12, minTris = 4) {
    const node = new BVHNode();
    
    for (const tri of triangles) {
        node.minX = Math.min(node.minX, tri.ax, tri.bx, tri.cx);
        node.minY = Math.min(node.minY, tri.ay, tri.by, tri.cy);
        node.minZ = Math.min(node.minZ, tri.az, tri.bz, tri.cz);
        node.maxX = Math.max(node.maxX, tri.ax, tri.bx, tri.cx);
        node.maxY = Math.max(node.maxY, tri.ay, tri.by, tri.cy);
        node.maxZ = Math.max(node.maxZ, tri.az, tri.bz, tri.cz);
    }
    
    if (triangles.length <= minTris || depth >= maxDepth) {
        node.triangles = triangles;
        return node;
    }
    
    const sizeX = node.maxX - node.minX;
    const sizeY = node.maxY - node.minY;
    const sizeZ = node.maxZ - node.minZ;
    
    let getCoord;
    if (sizeX >= sizeY && sizeX >= sizeZ) {
        getCoord = t => (t.ax + t.bx + t.cx) / 3;
    } else if (sizeY >= sizeZ) {
        getCoord = t => (t.ay + t.by + t.cy) / 3;
    } else {
        getCoord = t => (t.az + t.bz + t.cz) / 3;
    }
    
    triangles.sort((a, b) => getCoord(a) - getCoord(b));
    const mid = Math.floor(triangles.length / 2);
    
    const leftTris = triangles.slice(0, mid);
    const rightTris = triangles.slice(mid);
    
    if (leftTris.length > 0 && rightTris.length > 0) {
        node.left = buildBVH(leftTris, depth + 1, maxDepth, minTris);
        node.right = buildBVH(rightTris, depth + 1, maxDepth, minTris);
    } else {
        node.triangles = triangles;
    }
    
    return node;
}

function pointToAABBDist(px, py, pz, node) {
    let dx = 0, dy = 0, dz = 0;
    
    if (px < node.minX) dx = node.minX - px;
    else if (px > node.maxX) dx = px - node.maxX;
    
    if (py < node.minY) dy = node.minY - py;
    else if (py > node.maxY) dy = py - node.maxY;
    
    if (pz < node.minZ) dz = node.minZ - pz;
    else if (pz > node.maxZ) dz = pz - node.maxZ;
    
    return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function queryBVH(node, px, py, pz, bestDist) {
    if (!node) return bestDist;
    
    const aabbDist = pointToAABBDist(px, py, pz, node);
    if (aabbDist >= bestDist) return bestDist;
    
    if (node.triangles) {
        for (const tri of node.triangles) {
            const d = pointToTriangleDist(px, py, pz, tri);
            if (d < bestDist) bestDist = d;
        }
        return bestDist;
    }
    
    const leftDist = node.left ? pointToAABBDist(px, py, pz, node.left) : Infinity;
    const rightDist = node.right ? pointToAABBDist(px, py, pz, node.right) : Infinity;
    
    if (leftDist < rightDist) {
        bestDist = queryBVH(node.left, px, py, pz, bestDist);
        bestDist = queryBVH(node.right, px, py, pz, bestDist);
    } else {
        bestDist = queryBVH(node.right, px, py, pz, bestDist);
        bestDist = queryBVH(node.left, px, py, pz, bestDist);
    }
    
    return bestDist;
}

// ============================================
// Point-to-triangle distance
// ============================================
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

// ============================================
// Worker message handler
// ============================================
self.onmessage = function(e) {
    const { triangles, bbox, resolution, zStart, zEnd, stepX, stepY, stepZ } = e.data;
    
    // Build BVH for this worker
    const bvh = buildBVH([...triangles]);
    
    const sliceCount = zEnd - zStart;
    const sliceSize = resolution * resolution;
    const data = new Float32Array(sliceCount * sliceSize);
    
    for (let z = zStart; z < zEnd; z++) {
        const pz = bbox.min.z + (z + 0.5) * stepZ;
        const zOffset = (z - zStart) * sliceSize;
        
        for (let y = 0; y < resolution; y++) {
            const py = bbox.min.y + (y + 0.5) * stepY;
            const yOffset = y * resolution;
            
            for (let x = 0; x < resolution; x++) {
                const px = bbox.min.x + (x + 0.5) * stepX;
                const minDist = queryBVH(bvh, px, py, pz, Infinity);
                data[zOffset + yOffset + x] = minDist;
            }
        }
        
        // Report progress for each Z slice
        self.postMessage({ type: 'progress', z });
    }
    
    // Send result back
    self.postMessage({
        type: 'complete',
        data,
        zStart,
        zEnd
    }, [data.buffer]);
};
