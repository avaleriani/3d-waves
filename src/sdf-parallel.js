/**
 * Multi-Worker Parallel SDF Generation
 * Splits work across CPU cores for 3-6x speedup
 */

/**
 * Generate SDF using multiple workers in parallel
 */
export async function generateSDFParallel(triangles, bbox, resolution, onProgress, workerCount = null) {
    // Default to available cores (max 8)
    const numWorkers = workerCount || Math.min(navigator.hardwareConcurrency || 4, 8);
    
    const startTime = performance.now();
    console.log(`Starting parallel SDF generation with ${numWorkers} workers...`);
    
    if (onProgress) onProgress(5);
    
    const size = {
        x: bbox.max.x - bbox.min.x,
        y: bbox.max.y - bbox.min.y,
        z: bbox.max.z - bbox.min.z
    };
    
    const stepX = size.x / resolution;
    const stepY = size.y / resolution;
    const stepZ = size.z / resolution;
    
    // Divide Z slices among workers
    const slicesPerWorker = Math.ceil(resolution / numWorkers);
    const workers = [];
    const promises = [];
    const results = new Array(numWorkers);
    let completedSlices = 0;
    const totalSlices = resolution;
    
    for (let i = 0; i < numWorkers; i++) {
        const zStart = i * slicesPerWorker;
        const zEnd = Math.min(zStart + slicesPerWorker, resolution);
        
        if (zStart >= resolution) break;
        
        const worker = new Worker(new URL('./sdf-worker-slice.js', import.meta.url));
        workers.push(worker);
        
        const promise = new Promise((resolve, reject) => {
            worker.onmessage = (e) => {
                if (e.data.type === 'progress') {
                    completedSlices++;
                    const progress = Math.floor(10 + (completedSlices / totalSlices) * 85);
                    if (onProgress) onProgress(progress);
                } else if (e.data.type === 'complete') {
                    results[i] = {
                        data: e.data.data,
                        zStart: e.data.zStart,
                        zEnd: e.data.zEnd
                    };
                    worker.terminate();
                    resolve();
                }
            };
            
            worker.onerror = (err) => {
                console.error('SDF worker error:', err);
                worker.terminate();
                reject(err);
            };
        });
        
        // Send work to worker
        worker.postMessage({
            triangles,
            bbox: { 
                min: { x: bbox.min.x, y: bbox.min.y, z: bbox.min.z },
                max: { x: bbox.max.x, y: bbox.max.y, z: bbox.max.z }
            },
            resolution,
            zStart,
            zEnd,
            stepX,
            stepY,
            stepZ
        });
        
        promises.push(promise);
    }
    
    // Wait for all workers to complete
    await Promise.all(promises);
    
    if (onProgress) onProgress(95);
    
    // Merge results into single SDF array
    const totalVoxels = resolution * resolution * resolution;
    const finalData = new Float32Array(totalVoxels);
    
    for (const result of results) {
        if (!result) continue;
        const { data, zStart, zEnd } = result;
        const sliceSize = resolution * resolution;
        
        for (let z = zStart; z < zEnd; z++) {
            const srcOffset = (z - zStart) * sliceSize;
            const dstOffset = z * sliceSize;
            finalData.set(data.subarray(srcOffset, srcOffset + sliceSize), dstOffset);
        }
    }
    
    if (onProgress) onProgress(100);
    
    const duration = performance.now() - startTime;
    console.log(`Parallel SDF generation: ${duration.toFixed(0)}ms (${numWorkers} workers)`);
    
    return {
        data: finalData,
        bbox,
        size,
        resolution,
        stepX,
        stepY,
        stepZ
    };
}
