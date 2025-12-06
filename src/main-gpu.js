import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { ParticleSystem, generateSDFAsync, generateSDF, getLastSDFBackend } from './gpu-particles.js';
import { HybridParticleSystem, BACKEND } from './particle-system.js';
import { generateCacheKey, getCachedSDF, cacheSDF, pruneCache } from './sdf-cache.js';
import * as CONFIG from './config.js';

// Current text settings reference for caching
let currentCacheKey = null;

// ============================================
// SCENE SETUP
// ============================================
const scene = new THREE.Scene();
scene.background = null;  // Transparent - video shows through

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1, 22);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ 
    canvas: document.getElementById('canvas'),
    antialias: true,
    alpha: true,  // Transparent background
    powerPreference: "high-performance"
});
renderer.setClearColor(0x000000, 0);  // Fully transparent
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.3;

// ============================================
// LIGHTING
// ============================================
scene.add(new THREE.AmbientLight(0x0a1525, 0.4));

const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(10, 20, 15);
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0x4488cc, 1.2);
fillLight.position.set(-15, 5, 10);
scene.add(fillLight);

const rimLight = new THREE.DirectionalLight(0x88ccff, 1.8);
rimLight.position.set(0, 10, -15);
scene.add(rimLight);

// ============================================
// PARTICLE SYSTEM (SoA + SDF)
// ============================================
let particles = null;
let particlesMesh = null;
let textBBox = null;

async function initParticleSystem(textGeometry, isUpdate = false, cacheKey = null) {
    console.log('Initializing particle system...');
    
    const loaderText = document.querySelector('.loader-text');
    const backendTypeEl = document.getElementById('backend-type');
    const recalcStatus = document.getElementById('recalc-status');
    
    try {
        let sdfData = null;
        
        // Try to load from cache first
        if (cacheKey) {
            const loadingText = 'Checking cache...';
            if (loaderText) loaderText.textContent = loadingText;
            if (isUpdate && recalcStatus) recalcStatus.textContent = loadingText;
            
            sdfData = await getCachedSDF(cacheKey);
            
            if (sdfData) {
                // Validate cached data
                const data = sdfData.data;
                let isValid = data && data.length > 0;
                
                if (isValid) {
                    // Quick validation: check for reasonable distance values
                    let minVal = Infinity, maxVal = -Infinity;
                    const step = Math.max(1, Math.floor(data.length / 100));
                    for (let i = 0; i < data.length; i += step) {
                        if (data[i] < minVal) minVal = data[i];
                        if (data[i] > maxVal) maxVal = data[i];
                    }
                    isValid = (maxVal - minVal) > 0.01 && minVal < 1.0;
                    console.log(`Cache validation: min=${minVal.toFixed(3)}, max=${maxVal.toFixed(3)}, valid=${isValid}`);
                }
                
                if (isValid) {
                    // Reconstruct THREE.js Box3 from cached data
                    sdfData.bbox = new THREE.Box3(
                        new THREE.Vector3(sdfData.bbox.min.x, sdfData.bbox.min.y, sdfData.bbox.min.z),
                        new THREE.Vector3(sdfData.bbox.max.x, sdfData.bbox.max.y, sdfData.bbox.max.z)
                    );
                    console.log('✓ SDF loaded from cache (instant!)');
                } else {
                    console.warn('Cached SDF invalid, regenerating...');
                    sdfData = null; // Force regeneration
                }
            }
        }
        
        // Generate SDF if not cached
        if (!sdfData) {
            if (loaderText) loaderText.textContent = 'Generating collision map...';
            
            sdfData = await generateSDFAsync(
                textGeometry, 
                CONFIG.SDF_RESOLUTION,
                (progress) => {
                    const statusText = `Generating collision map... ${progress}%`;
                    if (loaderText) loaderText.textContent = statusText;
                    if (isUpdate && recalcStatus) recalcStatus.textContent = statusText;
                }
            );
            
            // Cache the result for next time
            if (cacheKey) {
                cacheSDF(cacheKey, sdfData).catch(err => console.warn('Cache save failed:', err));
                pruneCache(10); // Keep last 10 cached SDFs
            }
        }
        
        textBBox = sdfData.bbox;
        
        // Initialize hybrid particle system (auto-selects best backend)
        const initText = 'Initializing particle system...';
        if (loaderText) loaderText.textContent = initText;
        if (isUpdate && recalcStatus) recalcStatus.textContent = initText;
        
        particles = new HybridParticleSystem(CONFIG.MAX_PARTICLES);
        await particles.init(sdfData);
        
        // Update backend display
        const backendNames = {
            [BACKEND.WEBGPU]: '🚀 WebGPU Compute',
            [BACKEND.WORKERS]: '⚡ Multi-threaded Workers',
            [BACKEND.SINGLE_THREAD]: '💻 Single-threaded CPU'
        };
        if (backendTypeEl) {
            backendTypeEl.textContent = backendNames[particles.getBackendType()] || 'Unknown';
            backendTypeEl.style.color = particles.getBackendType() === BACKEND.WEBGPU ? '#00ff88' : 
                                         particles.getBackendType() === BACKEND.WORKERS ? '#88ccff' : '#ffcc88';
        }
        
        // Create Three.js mesh for rendering
        createParticleRenderer();
        
        console.log('Particle System ready:', CONFIG.MAX_PARTICLES.toLocaleString(), 'max particles');
        console.log('Particle Backend:', particles.getBackendType());
        console.log('SDF Backend:', getLastSDFBackend());
        
    } catch (err) {
        console.warn('Async SDF failed, falling back to sync:', err);
        const sdfData = generateSDF(textGeometry, CONFIG.SDF_RESOLUTION);
        textBBox = sdfData.bbox;
        particles = new ParticleSystem(CONFIG.MAX_PARTICLES);
        particles.setSDF(sdfData);
        createParticleRenderer();
        
        if (backendTypeEl) {
            backendTypeEl.textContent = '💻 Single-threaded CPU (fallback)';
            backendTypeEl.style.color = '#ffcc88';
        }
    }
}

function createParticleRenderer() {
    // Remove old particle mesh if it exists
    if (particlesMesh) {
        scene.remove(particlesMesh);
        particlesMesh.geometry.dispose();
        particlesMesh.material.dispose();
        particlesMesh = null;
    }
    
    // Custom shader for rendering particles
    const particleMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 }
        },
        vertexShader: `
            attribute vec4 state; // state, stickTime, size, slideSpeed
            
            varying float vSize;
            varying float vState;
            varying vec3 vViewPos;
            
            void main() {
                vState = state.x;
                vSize = state.z;
                
                // Hide FALLING (0) and INACTIVE (4) particles
                // Show STUCK (1), SLIDING (2), DRIPPING (3), BOUNCING (5)
                if (vState < 0.5 || (vState > 3.5 && vState < 4.5) || vSize < 0.01) {
                    gl_Position = vec4(0.0, 0.0, -1000.0, 1.0);
                    gl_PointSize = 0.0;
                    return;
                }
                
                vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
                vViewPos = -mvPos.xyz;
                gl_Position = projectionMatrix * mvPos;
                
                // Size attenuation
                float dist = length(mvPos.xyz);
                gl_PointSize = vSize * (350.0 / dist);
                gl_PointSize = clamp(gl_PointSize, 1.0, 50.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            
            varying float vSize;
            varying float vState;
            varying vec3 vViewPos;
            
            void main() {
                // Only render STUCK, SLIDING, DRIPPING, BOUNCING
                if (vState < 0.5 || (vState > 3.5 && vState < 4.5) || vSize < 0.01) discard;
                
                // Circular shape
                vec2 center = gl_PointCoord - 0.5;
                float dist = length(center);
                if (dist > 0.5) discard;
                
                // Smooth edge
                float alpha = 1.0 - smoothstep(0.35, 0.5, dist);
                
                // Fake sphere normal
                vec3 normal;
                normal.xy = center * 2.0;
                normal.z = sqrt(max(0.0, 1.0 - dot(normal.xy, normal.xy)));
                
                vec3 viewDir = normalize(vViewPos);
                
                // Water color
                vec3 baseColor = vec3(0.6, 0.85, 1.0);
                
                // Border/rim effect - darker edge for definition
                float rimDist = smoothstep(0.25, 0.45, dist);
                vec3 rimColor = vec3(0.2, 0.4, 0.6); // Darker blue for border
                
                // Fresnel - enhanced for rim lighting
                float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 2.5);
                
                // Specular
                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
                vec3 halfVec = normalize(viewDir + lightDir);
                float spec = pow(max(0.0, dot(normal, halfVec)), 80.0);
                
                // Second light
                vec3 lightDir2 = normalize(vec3(-0.3, 0.8, -0.2));
                float spec2 = pow(max(0.0, dot(normal, normalize(viewDir + lightDir2))), 40.0);
                
                // Base shading
                vec3 color = baseColor * 0.5;
                color += vec3(1.0) * spec * 1.2;
                color += vec3(0.7, 0.85, 1.0) * spec2 * 0.5;
                color += vec3(0.9, 0.95, 1.0) * fresnel * 0.7;
                
                // Inner highlight (brighter center)
                float inner = 1.0 - dist * 1.6;
                color += vec3(0.95, 0.98, 1.0) * inner * 0.25;
                
                // Apply rim/border darkening
                color = mix(color, rimColor, rimDist * 0.6);
                
                // Bright rim highlight on edge
                float rimHighlight = smoothstep(0.35, 0.45, dist) * (1.0 - smoothstep(0.45, 0.5, dist));
                color += vec3(0.8, 0.9, 1.0) * rimHighlight * 0.8;
                
                // State-based color tweak
                if (vState > 1.5 && vState < 2.5) {
                    // Sliding - slightly more blue
                    color *= vec3(0.95, 0.98, 1.05);
                }
                
                // Boost alpha at edges for more defined border
                alpha = alpha * 0.95 + rimDist * 0.15;
                
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    });
    
    // Create geometry that will be updated with GPU buffers
    const geometry = new THREE.BufferGeometry();
    
    // Dummy attributes - will be replaced with GPU buffers
    const positions = new Float32Array(CONFIG.MAX_PARTICLES * 3);
    const states = new Float32Array(CONFIG.MAX_PARTICLES * 4);
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('state', new THREE.BufferAttribute(states, 4));
    
    particlesMesh = new THREE.Points(geometry, particleMaterial);
    particlesMesh.frustumCulled = false;
    scene.add(particlesMesh);
}

// Update Three.js buffers from particle system - optimized draw range
function syncParticleBuffers() {
    if (!particles || !particlesMesh) return;
    
    const posAttr = particlesMesh.geometry.attributes.position;
    const stateAttr = particlesMesh.geometry.attributes.state;
    
    // copyToBuffers now returns actual count of particles copied (only active range)
    const activeCount = particles.copyToBuffers(posAttr, stateAttr);
    
    // Only tell GPU to draw particles that exist - significant optimization
    particlesMesh.geometry.setDrawRange(0, activeCount);
}

// ============================================
// WAVE SPAWNING
// ============================================
function spawnFromWave(waveZ) {
    if (!particles || !textBBox) return;
    
    const count = CONFIG.SPAWN_RATE;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const slideSpeeds = new Float32Array(count);
    
    // Text dimensions
    const width = textBBox.max.x - textBBox.min.x;
    const height = textBBox.max.y - textBBox.min.y;
    const centerX = (textBBox.max.x + textBBox.min.x) / 2;
    const centerY = (textBBox.max.y + textBBox.min.y) / 2;
    
    for (let i = 0; i < count; i++) {
        // Spawn position - spread across text area
        positions[i * 3] = centerX + (Math.random() - 0.5) * width * 1.5;
        positions[i * 3 + 1] = centerY + (Math.random() - 0.5) * height * 1.5;
        positions[i * 3 + 2] = 6 + Math.random() * 5;
        
        // Velocity: chaotic splash with configurable spread
        const angle = Math.random() * Math.PI * 2;
        const spread = Math.random() * CONFIG.SPLASH_SPREAD_XY;
        velocities[i * 3] = Math.cos(angle) * spread + (Math.random() - 0.5) * 3;
        velocities[i * 3 + 1] = Math.sin(angle) * spread + (Math.random() - 0.5) * 5;
        velocities[i * 3 + 2] = CONFIG.SPLASH_VELOCITY_Z - Math.random() * CONFIG.SPLASH_VELOCITY_SPREAD;
        
        // Random drop sizes
        sizes[i] = CONFIG.DROP_SIZE_MIN + Math.random() * (CONFIG.DROP_SIZE_MAX - CONFIG.DROP_SIZE_MIN);
        
        // Random slide speed (0-1 range, used to stagger drip timing)
        slideSpeeds[i] = Math.random();
    }
    
    particles.spawn(positions, velocities, sizes, slideSpeeds);
}

// ============================================
// 3D WAVE MESH
// ============================================
function createWaveGeometry() {
    const widthSegments = 80;
    const heightSegments = 50;
    const waveWidth = 35;
    const waveHeight = 8;
    
    const geometry = new THREE.BufferGeometry();
    const vertices = [];
    const normals = [];
    const uvs = [];
    const indices = [];
    
    for (let j = 0; j <= heightSegments; j++) {
        const v = j / heightSegments;
        for (let i = 0; i <= widthSegments; i++) {
            const u = i / widthSegments;
            const x = (u - 0.5) * waveWidth;
            const angle = v * Math.PI * 1.3;
            const baseY = Math.sin(angle) * waveHeight * 0.5;
            const curlRadius = 2.5 * (0.3 + v * 0.7);
            const baseZ = -Math.cos(angle) * curlRadius;
            const widthVar = Math.sin(u * Math.PI * 4) * 0.3;
            
            vertices.push(x, baseY + widthVar, baseZ);
            
            const nx = widthVar * 0.2;
            const ny = Math.cos(angle);
            const nz = Math.sin(angle);
            const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
            normals.push(nx/len, ny/len, nz/len);
            uvs.push(u, v);
        }
    }
    
    for (let j = 0; j < heightSegments; j++) {
        for (let i = 0; i < widthSegments; i++) {
            const a = j * (widthSegments + 1) + i;
            const b = a + 1;
            const c = a + widthSegments + 1;
            const d = c + 1;
            indices.push(a, c, b, b, c, d);
        }
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    return geometry;
}

const waveMaterial = new THREE.ShaderMaterial({
    uniforms: { time: { value: 0 } },
    vertexShader: `
        uniform float time;
        varying vec2 vUv;
        varying float vCurl;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        void main() {
            vUv = uv;
            vCurl = uv.y;
            vec3 pos = position;
            
            pos.y += sin(pos.x * 0.3 + time * 2.0) * 0.5;
            pos.y += sin(pos.x * 0.7 + time * 3.5) * 0.25;
            pos.z += sin(pos.x * 1.5 + time * 4.0) * 0.15;
            pos.y += sin(time * 5.0 + pos.x * 0.5) * uv.y * 0.3;
            
            vNormal = normalize(normalMatrix * normal);
            vWorldPos = (modelMatrix * vec4(pos, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float time;
        varying vec2 vUv;
        varying float vCurl;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
            vec2 i = floor(p), f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                       mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        
        void main() {
            vec3 n = normalize(vNormal);
            vec3 v = normalize(cameraPosition - vWorldPos);
            
            vec3 deep = vec3(0.0, 0.05, 0.15);
            vec3 mid = vec3(0.02, 0.2, 0.4);
            vec3 surf = vec3(0.1, 0.45, 0.65);
            vec3 foam = vec3(0.92, 0.96, 1.0);
            
            vec3 col = mix(deep, mid, vCurl * 0.5);
            col = mix(col, surf, vCurl);
            
            float fresnel = pow(1.0 - max(0.0, dot(n, v)), 4.0);
            col += surf * fresnel * 0.4;
            
            vec3 l = normalize(vec3(0.3, 1.0, 0.5));
            float spec = pow(max(0.0, dot(n, normalize(v + l))), 128.0);
            col += vec3(1.0) * spec * 0.8;
            
            float foamNoise = noise(vWorldPos.xy * 8.0 + time * 2.0);
            float foamAmt = smoothstep(0.6, 0.95, vCurl) * (0.5 + foamNoise * 0.5);
            col = mix(col, foam, foamAmt * 0.85);
            
            float alpha = 0.85 + foamAmt * 0.1;
            gl_FragColor = vec4(col, alpha);
        }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
});

const waveMesh = new THREE.Mesh(createWaveGeometry(), waveMaterial);
scene.add(waveMesh);

// ============================================
// TEXT SETTINGS
// ============================================
let textSettings = {
    text: 'WEEKEND',
    fontName: 'helvetiker',
    fontWeight: 'bold',
    size: 2.8,
    height: 0.6,
    letterSpacing: 0.5,
    bevelEnabled: true,
    bevelSize: 0.04,
    underline: false
};

let loadedFonts = {};
let underlineMesh = null;

// Font URLs from Three.js examples
const FONT_URLS = {
    helvetiker_bold: 'https://threejs.org/examples/fonts/helvetiker_bold.typeface.json',
    helvetiker_regular: 'https://threejs.org/examples/fonts/helvetiker_regular.typeface.json',
    optimer_bold: 'https://threejs.org/examples/fonts/optimer_bold.typeface.json',
    optimer_regular: 'https://threejs.org/examples/fonts/optimer_regular.typeface.json',
    gentilis_bold: 'https://threejs.org/examples/fonts/gentilis_bold.typeface.json',
    gentilis_regular: 'https://threejs.org/examples/fonts/gentilis_regular.typeface.json',
    droid_sans_bold: 'https://threejs.org/examples/fonts/droid/droid_sans_bold.typeface.json',
    droid_sans_regular: 'https://threejs.org/examples/fonts/droid/droid_sans_regular.typeface.json',
    droid_serif_bold: 'https://threejs.org/examples/fonts/droid/droid_serif_bold.typeface.json',
    droid_serif_regular: 'https://threejs.org/examples/fonts/droid/droid_serif_regular.typeface.json'
};

// ============================================
// TEXT CREATION
// ============================================
function getFontKey(fontName, weight) {
    return `${fontName}_${weight}`;
}

function loadFont(fontKey) {
    return new Promise((resolve, reject) => {
        if (loadedFonts[fontKey]) {
            resolve(loadedFonts[fontKey]);
            return;
        }
        
        const url = FONT_URLS[fontKey];
        if (!url) {
            reject(new Error(`Font not found: ${fontKey}`));
            return;
        }
        
        const loader = new FontLoader();
        loader.load(url, (font) => {
            loadedFonts[fontKey] = font;
            resolve(font);
        }, undefined, reject);
    });
}

function createTextWithLetterSpacing(font, text, settings) {
    if (settings.letterSpacing === 0) {
        // No letter spacing - use standard TextGeometry
        return new TextGeometry(text, {
            font: font,
            size: settings.size,
            height: settings.height,
            curveSegments: 24,
            bevelEnabled: settings.bevelEnabled,
            bevelThickness: 0.06,
            bevelSize: settings.bevelSize,
            bevelSegments: 6
        });
    }
    
    // Letter spacing: create each character separately and merge
    const geometries = [];
    let offsetX = 0;
    
    for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === ' ') {
            offsetX += settings.size * 0.5 + settings.letterSpacing;
            continue;
        }
        
        const charGeom = new TextGeometry(char, {
            font: font,
            size: settings.size,
            height: settings.height,
            curveSegments: 24,
            bevelEnabled: settings.bevelEnabled,
            bevelThickness: 0.06,
            bevelSize: settings.bevelSize,
            bevelSegments: 6
        });
        
        charGeom.computeBoundingBox();
        const charWidth = charGeom.boundingBox.max.x - charGeom.boundingBox.min.x;
        
        // Translate character to position
        charGeom.translate(offsetX - charGeom.boundingBox.min.x, 0, 0);
        geometries.push(charGeom);
        
        offsetX += charWidth + settings.letterSpacing;
    }
    
    // Merge all character geometries
    if (geometries.length === 0) return null;
    if (geometries.length === 1) return geometries[0];
    
    // Use BufferGeometryUtils to merge
    const mergedGeometry = mergeBufferGeometries(geometries);
    return mergedGeometry;
}

// Simple geometry merge function
function mergeBufferGeometries(geometries) {
    let totalPositions = 0;
    let totalNormals = 0;
    let totalIndices = 0;
    
    geometries.forEach(g => {
        g.computeVertexNormals();
        totalPositions += g.attributes.position.count;
        if (g.index) totalIndices += g.index.count;
    });
    
    const positions = new Float32Array(totalPositions * 3);
    const normals = new Float32Array(totalPositions * 3);
    const indices = [];
    
    let posOffset = 0;
    let idxOffset = 0;
    
    geometries.forEach(g => {
        const pos = g.attributes.position.array;
        const norm = g.attributes.normal.array;
        
        positions.set(pos, posOffset * 3);
        normals.set(norm, posOffset * 3);
        
        if (g.index) {
            const idx = g.index.array;
            for (let i = 0; i < idx.length; i++) {
                indices.push(idx[i] + posOffset);
            }
        }
        
        posOffset += g.attributes.position.count;
    });
    
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    if (indices.length > 0) {
        merged.setIndex(indices);
    }
    
    return merged;
}

function createUnderline(bbox, settings) {
    const width = bbox.max.x - bbox.min.x;
    const underlineGeom = new THREE.BoxGeometry(
        width + 0.5,
        settings.size * 0.08,
        settings.height
    );
    
    const underlineMat = new THREE.MeshStandardMaterial({
        color: 0x88ccff,
        metalness: 0.3,
        roughness: 0.5,
        transparent: true,
        opacity: 0.8
    });
    
    const mesh = new THREE.Mesh(underlineGeom, underlineMat);
    mesh.position.set(
        (bbox.max.x + bbox.min.x) / 2,
        bbox.min.y - settings.size * 0.15,
        (bbox.max.z + bbox.min.z) / 2
    );
    
    return mesh;
}

async function createText(isUpdate = false) {
    const fontKey = getFontKey(textSettings.fontName, textSettings.fontWeight);
    
    // Show recalculating overlay for updates
    const recalcEl = document.getElementById('recalculating');
    const recalcStatus = document.getElementById('recalc-status');
    if (isUpdate && recalcEl) {
        recalcEl.classList.add('visible');
        if (recalcStatus) recalcStatus.textContent = 'Loading font...';
    }
    
    try {
        const font = await loadFont(fontKey);
        
        let geometry = createTextWithLetterSpacing(font, textSettings.text, textSettings);
        if (!geometry) {
            console.error('Failed to create text geometry');
            // Hide recalculating overlay on failure
            if (recalcEl) recalcEl.classList.remove('visible');
            return;
        }
        
        geometry.center();
        geometry.computeBoundingBox();
        geometry.computeVertexNormals();
        
        console.log('Text geometry ready:', textSettings.text);
        
        // Remove old underline if exists
        if (underlineMesh) {
            scene.remove(underlineMesh);
            underlineMesh.geometry.dispose();
            underlineMesh.material.dispose();
            underlineMesh = null;
        }
        
        // Add underline if enabled
        if (textSettings.underline) {
            underlineMesh = createUnderline(geometry.boundingBox, textSettings);
            scene.add(underlineMesh);
        }
        
        // Reset particles if updating
        if (isUpdate && particles) {
            particles.reset();
        }
        
        // Generate cache key for this text configuration
        currentCacheKey = generateCacheKey(textSettings.text, textSettings);
        
        // Update recalc status
        if (recalcStatus) recalcStatus.textContent = 'Checking cache...';
        
        // Await async SDF generation (or load from cache)
        await initParticleSystem(geometry, isUpdate, currentCacheKey);
        
        // Hide loader after everything is ready
        const loaderEl = document.getElementById('loader');
        if (loaderEl) {
            loaderEl.classList.add('hidden');
            setTimeout(() => loaderEl.remove(), 500);
        }
        
        // Hide recalculating overlay
        if (recalcEl) {
            recalcEl.classList.remove('visible');
        }
        
        // Start video playback now that animation is ready
        const videoEl = document.getElementById('video-bg');
        if (videoEl && videoEl.paused) {
            videoEl.currentTime = 0;
            videoEl.play().catch(err => console.log('Video autoplay blocked:', err));
        }
    } catch (error) {
        console.error('Failed to load font:', error);
        // Hide loader even on error
        const loaderEl = document.getElementById('loader');
        if (loaderEl) {
            loaderEl.classList.add('hidden');
            setTimeout(() => loaderEl.remove(), 500);
        }
        // Hide recalculating overlay on error too
        if (recalcEl) {
            recalcEl.classList.remove('visible');
        }
    }
}

// ============================================
// CONTROL PANEL SETUP
// ============================================
function setupControls() {
    // Text input
    const textInput = document.getElementById('text-input');
    
    // Font buttons
    const fontBtns = document.querySelectorAll('.font-btn:not(.weight-btn)');
    fontBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            fontBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            textSettings.fontName = btn.dataset.font;
        });
    });
    
    // Weight buttons
    const weightBtns = document.querySelectorAll('.weight-btn');
    weightBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            weightBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            textSettings.fontWeight = btn.dataset.weight;
        });
    });
    
    // Sliders
    const sliders = [
        { id: 'size-slider', valueId: 'size-value', prop: 'size' },
        { id: 'spacing-slider', valueId: 'spacing-value', prop: 'letterSpacing' },
        { id: 'depth-slider', valueId: 'depth-value', prop: 'height' },
        { id: 'bevel-slider', valueId: 'bevel-value', prop: 'bevelSize' }
    ];
    
    sliders.forEach(({ id, valueId, prop }) => {
        const slider = document.getElementById(id);
        const valueDisplay = document.getElementById(valueId);
        
        slider.addEventListener('input', () => {
            const val = parseFloat(slider.value);
            valueDisplay.textContent = val.toFixed(prop === 'letterSpacing' ? 2 : 1);
            textSettings[prop] = val;
        });
    });
    
    // Checkboxes
    document.getElementById('bevel-enabled').addEventListener('change', (e) => {
        textSettings.bevelEnabled = e.target.checked;
    });
    
    document.getElementById('underline-enabled').addEventListener('change', (e) => {
        textSettings.underline = e.target.checked;
    });
    
    // Apply button
    document.getElementById('apply-btn').addEventListener('click', () => {
        textSettings.text = textInput.value.toUpperCase() || 'TEXT';
        createText(true);
    });
    
    // Reset button - restore defaults
    document.getElementById('reset-btn').addEventListener('click', () => {
        // Reset to defaults
        textSettings.text = 'WEEKEND';
        textSettings.fontName = 'helvetiker';
        textSettings.fontWeight = 'bold';
        textSettings.size = 2.8;
        textSettings.height = 0.6;
        textSettings.letterSpacing = 0.5;
        textSettings.bevelEnabled = true;
        textSettings.bevelSize = 0.04;
        textSettings.underline = false;
        
        // Update UI
        textInput.value = 'WEEKEND';
        
        // Reset font buttons
        fontBtns.forEach(b => b.classList.remove('active'));
        document.querySelector('[data-font="helvetiker"]').classList.add('active');
        
        weightBtns.forEach(b => b.classList.remove('active'));
        document.querySelector('[data-weight="bold"]').classList.add('active');
        
        // Reset sliders
        document.getElementById('size-slider').value = 2.8;
        document.getElementById('size-value').textContent = '2.8';
        document.getElementById('spacing-slider').value = 0.5;
        document.getElementById('spacing-value').textContent = '0.50';
        document.getElementById('depth-slider').value = 0.6;
        document.getElementById('depth-value').textContent = '0.6';
        document.getElementById('bevel-slider').value = 0.04;
        document.getElementById('bevel-value').textContent = '0.04';
        
        // Reset checkboxes
        document.getElementById('bevel-enabled').checked = true;
        document.getElementById('underline-enabled').checked = false;
        
        // Regenerate text
        createText(true);
    });
    
    // Toggle controls visibility
    const controls = document.getElementById('controls');
    const toggleBtn = document.getElementById('toggle-controls');
    const closeBtn = document.getElementById('close-controls');
    
    toggleBtn.addEventListener('click', () => {
        controls.classList.remove('hidden');
    });
    
    closeBtn.addEventListener('click', () => {
        controls.classList.add('hidden');
    });
    
    // Close controls with Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            controls.classList.add('hidden');
        }
    });
}

// ============================================
// ANIMATION - VIDEO SYNCED (with fallback)
// ============================================
const video = document.getElementById('video-bg');
let lastTime = performance.now();
let wasSpawning = false;
let fallbackTime = 0;  // Used when no video
let updateInProgress = false;  // For async WebGPU updates
let lastVideoTime = 0;  // Track video time for loop detection

// Check if video is available
const hasVideo = video && video.src && video.readyState > 0;

async function animate() {
    requestAnimationFrame(animate);
    
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const time = now * 0.001;
    
    // Get video time, or use fallback timer if no video
    let videoTime;
    if (video && video.readyState >= 2) {
        videoTime = video.currentTime;
    } else {
        // Fallback: simulate video timing
        fallbackTime += dt;
        if (fallbackTime > CONFIG.VIDEO_LOOP_DURATION) {
            fallbackTime = 0;
            if (particles && particles.isReady()) particles.reset();
        }
        videoTime = fallbackTime;
    }
    
    // Check if we're in the wave hit window
    const isWaveHitting = videoTime >= CONFIG.VIDEO_WAVE_HIT_TIME && videoTime <= CONFIG.VIDEO_WAVE_END_TIME;
    
    // Spawn particles when video wave is hitting
    if (isWaveHitting && particles && particles.isReady()) {
        // Calculate spawn Z based on progress through wave
        const progress = (videoTime - CONFIG.VIDEO_WAVE_HIT_TIME) / (CONFIG.VIDEO_WAVE_END_TIME - CONFIG.VIDEO_WAVE_HIT_TIME);
        const spawnZ = 15 - progress * 15;  // From Z=15 to Z=0
        spawnFromWave(spawnZ);
    }
    
    // Reset particles when video loops (detect time jumping backwards)
    if (videoTime < lastVideoTime - 0.5 && particles && particles.isReady()) {
        // Video looped - reset particles for fresh splash
        particles.reset();
    }
    lastVideoTime = videoTime;
    wasSpawning = isWaveHitting;
    
    // Hide wave mesh - we're using video now
    waveMesh.visible = false;
    
    // Particle physics (handles async WebGPU or sync CPU)
    if (particles && particles.isReady() && !updateInProgress) {
        updateInProgress = true;
        try {
            // Update returns a promise for WebGPU, resolves immediately for CPU
            await particles.update(dt, time);
            syncParticleBuffers();
        } catch (err) {
            console.error('Particle update error:', err);
        }
        updateInProgress = false;
    }
    
    // Update particle shader
    if (particlesMesh) {
        particlesMesh.material.uniforms.time.value = time;
    }
    
    renderer.render(scene, camera);
}

// ============================================
// START
// ============================================
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Preload default font immediately (non-blocking)
const defaultFontKey = getFontKey(textSettings.fontName, textSettings.fontWeight);
loadFont(defaultFontKey).catch(() => {}); // Start loading, ignore errors here

setupControls();
createText();
animate();

console.log(`Particle System: ${CONFIG.MAX_PARTICLES.toLocaleString()} particles, video-synced`);
console.log(`Video sync: wave hits at ${CONFIG.VIDEO_WAVE_HIT_TIME}s, ends at ${CONFIG.VIDEO_WAVE_END_TIME}s`);
