/**
 * WebGPU Compute Shader for SDF Generation
 * Massively parallel - 10-50x faster than CPU
 */

const SDF_COMPUTE_SHADER = /* wgsl */`
    struct Triangle {
        ax: f32, ay: f32, az: f32, _pad0: f32,
        bx: f32, by: f32, bz: f32, _pad1: f32,
        cx: f32, cy: f32, cz: f32, _pad2: f32,
    }
    
    struct Config {
        minX: f32, minY: f32, minZ: f32, resolution: f32,
        stepX: f32, stepY: f32, stepZ: f32, triangleCount: f32,
    }
    
    @group(0) @binding(0) var<storage, read_write> sdfData: array<f32>;
    @group(0) @binding(1) var<storage, read> triangles: array<Triangle>;
    @group(0) @binding(2) var<uniform> config: Config;
    
    fn pointToTriangleDist(px: f32, py: f32, pz: f32, tri: Triangle) -> f32 {
        let abx = tri.bx - tri.ax; let aby = tri.by - tri.ay; let abz = tri.bz - tri.az;
        let acx = tri.cx - tri.ax; let acy = tri.cy - tri.ay; let acz = tri.cz - tri.az;
        let apx = px - tri.ax; let apy = py - tri.ay; let apz = pz - tri.az;
        
        let d1 = abx*apx + aby*apy + abz*apz;
        let d2 = acx*apx + acy*apy + acz*apz;
        
        if (d1 <= 0.0 && d2 <= 0.0) {
            return sqrt(apx*apx + apy*apy + apz*apz);
        }
        
        let bpx = px - tri.bx; let bpy = py - tri.by; let bpz = pz - tri.bz;
        let d3 = abx*bpx + aby*bpy + abz*bpz;
        let d4 = acx*bpx + acy*bpy + acz*bpz;
        
        if (d3 >= 0.0 && d4 <= d3) {
            return sqrt(bpx*bpx + bpy*bpy + bpz*bpz);
        }
        
        let vc = d1*d4 - d3*d2;
        if (vc <= 0.0 && d1 >= 0.0 && d3 <= 0.0) {
            let v = d1 / (d1 - d3);
            let closestX = tri.ax + abx * v;
            let closestY = tri.ay + aby * v;
            let closestZ = tri.az + abz * v;
            let dx = px - closestX; let dy = py - closestY; let dz = pz - closestZ;
            return sqrt(dx*dx + dy*dy + dz*dz);
        }
        
        let cpx = px - tri.cx; let cpy = py - tri.cy; let cpz = pz - tri.cz;
        let d5 = abx*cpx + aby*cpy + abz*cpz;
        let d6 = acx*cpx + acy*cpy + acz*cpz;
        
        if (d6 >= 0.0 && d5 <= d6) {
            return sqrt(cpx*cpx + cpy*cpy + cpz*cpz);
        }
        
        let vb = d5*d2 - d1*d6;
        if (vb <= 0.0 && d2 >= 0.0 && d6 <= 0.0) {
            let w = d2 / (d2 - d6);
            let closestX = tri.ax + acx * w;
            let closestY = tri.ay + acy * w;
            let closestZ = tri.az + acz * w;
            let dx = px - closestX; let dy = py - closestY; let dz = pz - closestZ;
            return sqrt(dx*dx + dy*dy + dz*dz);
        }
        
        let va = d3*d6 - d5*d4;
        if (va <= 0.0 && (d4 - d3) >= 0.0 && (d5 - d6) >= 0.0) {
            let w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
            let closestX = tri.bx + (tri.cx - tri.bx) * w;
            let closestY = tri.by + (tri.cy - tri.by) * w;
            let closestZ = tri.bz + (tri.cz - tri.bz) * w;
            let dx = px - closestX; let dy = py - closestY; let dz = pz - closestZ;
            return sqrt(dx*dx + dy*dy + dz*dz);
        }
        
        let denom = 1.0 / (va + vb + vc);
        let v = vb * denom;
        let w = vc * denom;
        let closestX = tri.ax + abx * v + acx * w;
        let closestY = tri.ay + aby * v + acy * w;
        let closestZ = tri.az + abz * v + acz * w;
        let dx = px - closestX; let dy = py - closestY; let dz = pz - closestZ;
        return sqrt(dx*dx + dy*dy + dz*dz);
    }
    
    @compute @workgroup_size(8, 8, 8)
    fn main(@builtin(global_invocation_id) id: vec3u) {
        let res = u32(config.resolution);
        if (id.x >= res || id.y >= res || id.z >= res) { return; }
        
        let px = config.minX + (f32(id.x) + 0.5) * config.stepX;
        let py = config.minY + (f32(id.y) + 0.5) * config.stepY;
        let pz = config.minZ + (f32(id.z) + 0.5) * config.stepZ;
        
        var minDist: f32 = 1000000.0;
        let triCount = u32(config.triangleCount);
        
        for (var t: u32 = 0u; t < triCount; t = t + 1u) {
            let dist = pointToTriangleDist(px, py, pz, triangles[t]);
            minDist = min(minDist, dist);
        }
        
        let idx = id.x + id.y * res + id.z * res * res;
        sdfData[idx] = minDist;
    }
`;

let gpuDevice = null;
let gpuPipeline = null;

/**
 * Initialize WebGPU for SDF generation
 */
async function initWebGPU() {
    if (gpuDevice) return true;
    
    if (!navigator.gpu) {
        console.log('WebGPU not available for SDF generation');
        return false;
    }
    
    try {
        const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
        if (!adapter) return false;
        
        gpuDevice = await adapter.requestDevice({
            requiredLimits: {
                maxStorageBufferBindingSize: 512 * 1024 * 1024,
                maxBufferSize: 512 * 1024 * 1024
            }
        });
        
        const shaderModule = gpuDevice.createShaderModule({ code: SDF_COMPUTE_SHADER });
        
        gpuPipeline = gpuDevice.createComputePipeline({
            layout: 'auto',
            compute: { module: shaderModule, entryPoint: 'main' }
        });
        
        console.log('WebGPU SDF generator initialized');
        return true;
    } catch (err) {
        console.warn('WebGPU SDF init failed:', err);
        return false;
    }
}

/**
 * Generate SDF using WebGPU compute shader
 */
export async function generateSDFWebGPU(triangles, bbox, resolution, onProgress) {
    if (!await initWebGPU()) return null;
    
    const startTime = performance.now();
    if (onProgress) onProgress(5);
    
    const size = {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z
    };
    
    const stepX = size.x / resolution;
    const stepY = size.y / resolution;
    const stepZ = size.z / resolution;
    
    // Prepare triangle data (padded to 16 floats per triangle for alignment)
    const triData = new Float32Array(triangles.length * 12);
    for (let i = 0; i < triangles.length; i++) {
        const t = triangles[i];
        const base = i * 12;
        triData[base + 0] = t.ax; triData[base + 1] = t.ay; triData[base + 2] = t.az; triData[base + 3] = 0;
        triData[base + 4] = t.bx; triData[base + 5] = t.by; triData[base + 6] = t.bz; triData[base + 7] = 0;
        triData[base + 8] = t.cx; triData[base + 9] = t.cy; triData[base + 10] = t.cz; triData[base + 11] = 0;
    }
    
    if (onProgress) onProgress(10);
    
    // Create buffers
    const sdfSize = resolution * resolution * resolution * 4;
    const sdfBuffer = gpuDevice.createBuffer({
        size: sdfSize,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC
    });
    
    const triangleBuffer = gpuDevice.createBuffer({
        size: triData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
    });
    gpuDevice.queue.writeBuffer(triangleBuffer, 0, triData);
    
    const configData = new Float32Array([
        bbox.min.x, bbox.min.y, bbox.min.z, resolution,
        stepX, stepY, stepZ, triangles.length
    ]);
    const configBuffer = gpuDevice.createBuffer({
        size: 32,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
    });
    gpuDevice.queue.writeBuffer(configBuffer, 0, configData);
    
    const stagingBuffer = gpuDevice.createBuffer({
        size: sdfSize,
        usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST
    });
    
    if (onProgress) onProgress(20);
    
    // Create bind group
    const bindGroup = gpuDevice.createBindGroup({
        layout: gpuPipeline.getBindGroupLayout(0),
        entries: [
            { binding: 0, resource: { buffer: sdfBuffer } },
            { binding: 1, resource: { buffer: triangleBuffer } },
            { binding: 2, resource: { buffer: configBuffer } }
        ]
    });
    
    // Dispatch compute shader
    const commandEncoder = gpuDevice.createCommandEncoder();
    const passEncoder = commandEncoder.beginComputePass();
    passEncoder.setPipeline(gpuPipeline);
    passEncoder.setBindGroup(0, bindGroup);
    
    // Workgroup size is 8x8x8, so dispatch ceiling(resolution/8) in each dimension
    const workgroupsX = Math.ceil(resolution / 8);
    const workgroupsY = Math.ceil(resolution / 8);
    const workgroupsZ = Math.ceil(resolution / 8);
    passEncoder.dispatchWorkgroups(workgroupsX, workgroupsY, workgroupsZ);
    passEncoder.end();
    
    // Copy result to staging buffer
    commandEncoder.copyBufferToBuffer(sdfBuffer, 0, stagingBuffer, 0, sdfSize);
    gpuDevice.queue.submit([commandEncoder.finish()]);
    
    if (onProgress) onProgress(70);
    
    // Read back result
    await stagingBuffer.mapAsync(GPUMapMode.READ);
    const resultData = new Float32Array(stagingBuffer.getMappedRange().slice(0));
    stagingBuffer.unmap();
    
    // Cleanup
    sdfBuffer.destroy();
    triangleBuffer.destroy();
    configBuffer.destroy();
    stagingBuffer.destroy();
    
    if (onProgress) onProgress(100);
    
    const duration = performance.now() - startTime;
    console.log(`WebGPU SDF generation: ${duration.toFixed(0)}ms`);
    
    return {
        data: resultData,
        bbox,
        size,
        resolution,
        stepX,
        stepY,
        stepZ
    };
}

/**
 * Check if WebGPU SDF is available
 */
export async function isWebGPUSDFAvailable() {
    return await initWebGPU();
}
