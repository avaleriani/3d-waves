import { defineConfig } from 'vite';

export default defineConfig({
    server: {
        port: 8080,
        // Required headers for SharedArrayBuffer (multi-threaded workers)
        headers: {
            'Cross-Origin-Opener-Policy': 'same-origin',
            'Cross-Origin-Embedder-Policy': 'require-corp',
        },
    },
    // Build settings
    build: {
        target: 'esnext', // Required for WebGPU
    },
    // Worker settings
    worker: {
        format: 'es',
    },
});