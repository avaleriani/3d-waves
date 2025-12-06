/**
 * IndexedDB Cache for SDF data
 * Avoids regenerating SDF for text that was already computed
 */

const DB_NAME = 'sdf-cache';
const DB_VERSION = 2; // Increment to invalidate old caches
const STORE_NAME = 'sdf-data';
const CACHE_FORMAT_VERSION = 2; // Bump when SDF format changes

let db = null;

async function openDB() {
    if (db) return db;
    
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, DB_VERSION);
        
        request.onerror = () => reject(request.error);
        
        request.onsuccess = () => {
            db = request.result;
            resolve(db);
        };
        
        request.onupgradeneeded = (event) => {
            const database = event.target.result;
            if (!database.objectStoreNames.contains(STORE_NAME)) {
                database.createObjectStore(STORE_NAME, { keyPath: 'key' });
            }
        };
    });
}

/**
 * Generate a cache key from text settings
 */
export function generateCacheKey(text, settings) {
    const keyData = {
        version: CACHE_FORMAT_VERSION, // Invalidate on format change
        text: text.toUpperCase(),
        font: settings.fontName,
        weight: settings.fontWeight,
        size: Math.round(settings.size * 100),
        height: Math.round(settings.height * 100),
        spacing: Math.round(settings.letterSpacing * 100),
        bevel: settings.bevelEnabled,
        bevelSize: Math.round(settings.bevelSize * 1000)
    };
    return JSON.stringify(keyData);
}

/**
 * Clear all cached SDF data
 */
export async function clearCache() {
    try {
        const database = await openDB();
        
        return new Promise((resolve) => {
            const transaction = database.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            store.clear();
            transaction.oncomplete = () => {
                console.log('SDF cache cleared');
                resolve();
            };
            transaction.onerror = () => resolve();
        });
    } catch (err) {
        console.warn('Cache clear error:', err);
    }
}

/**
 * Get cached SDF data
 */
export async function getCachedSDF(cacheKey) {
    try {
        const database = await openDB();
        
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, 'readonly');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.get(cacheKey);
            
            request.onsuccess = () => {
                const result = request.result;
                if (result) {
                    // Reconstruct Float32Array from stored array
                    const sdfData = {
                        data: new Float32Array(result.data),
                        bbox: result.bbox,
                        size: result.size,
                        resolution: result.resolution,
                        stepX: result.stepX,
                        stepY: result.stepY,
                        stepZ: result.stepZ
                    };
                    console.log('SDF loaded from cache');
                    resolve(sdfData);
                } else {
                    resolve(null);
                }
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.warn('Cache read error:', err);
        return null;
    }
}

/**
 * Store SDF data in cache
 */
export async function cacheSDF(cacheKey, sdfData) {
    try {
        const database = await openDB();
        
        return new Promise((resolve, reject) => {
            const transaction = database.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            
            // Store as regular array (IndexedDB can't store Float32Array directly in some browsers)
            const dataToStore = {
                key: cacheKey,
                data: Array.from(sdfData.data),
                bbox: {
                    min: { x: sdfData.bbox.min.x, y: sdfData.bbox.min.y, z: sdfData.bbox.min.z },
                    max: { x: sdfData.bbox.max.x, y: sdfData.bbox.max.y, z: sdfData.bbox.max.z }
                },
                size: sdfData.size,
                resolution: sdfData.resolution,
                stepX: sdfData.stepX,
                stepY: sdfData.stepY,
                stepZ: sdfData.stepZ,
                timestamp: Date.now()
            };
            
            const request = store.put(dataToStore);
            
            request.onsuccess = () => {
                console.log('SDF cached successfully');
                resolve();
            };
            
            request.onerror = () => reject(request.error);
        });
    } catch (err) {
        console.warn('Cache write error:', err);
    }
}

/**
 * Clear old cache entries (keep last 10)
 */
export async function pruneCache(maxEntries = 10) {
    try {
        const database = await openDB();
        
        return new Promise((resolve) => {
            const transaction = database.transaction(STORE_NAME, 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const request = store.getAll();
            
            request.onsuccess = () => {
                const entries = request.result || [];
                if (entries.length > maxEntries) {
                    // Sort by timestamp, oldest first
                    entries.sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
                    
                    // Delete oldest entries
                    const toDelete = entries.slice(0, entries.length - maxEntries);
                    toDelete.forEach(entry => {
                        store.delete(entry.key);
                    });
                }
                resolve();
            };
            
            request.onerror = () => resolve();
        });
    } catch (err) {
        console.warn('Cache prune error:', err);
    }
}
