import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';
import { ParticleSystem, generateSDF } from './gpu-particles.js';

// ============================================
// CONFIGURATION
// ============================================
const MAX_PARTICLES = 100000;  // 100K particles with SoA layout
const SPAWN_RATE = 400;        // Particles per frame during wave
const SDF_RESOLUTION = 64;     // Higher resolution = better letter shapes

// ============================================
// SCENE SETUP
// ============================================
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000008);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 1, 22);
camera.lookAt(0, 0, 0);

const renderer = new THREE.WebGLRenderer({ 
    canvas: document.getElementById('canvas'),
    antialias: true,
    powerPreference: "high-performance"
});
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

function initParticleSystem(textGeometry) {
    console.log('Generating SDF...');
    const sdfData = generateSDF(textGeometry, SDF_RESOLUTION);
    
    textBBox = sdfData.bbox;
    
    // Create optimized particle system
    particles = new ParticleSystem(MAX_PARTICLES);
    particles.setSDF(sdfData);
    
    // Create Three.js mesh for rendering
    createParticleRenderer();
    
    console.log('Particle System ready:', MAX_PARTICLES.toLocaleString(), 'max particles');
}

function createParticleRenderer() {
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
                
                // Hide inactive particles
                if (vState > 3.5 || vSize < 0.01) {
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
                if (vState > 3.5 || vSize < 0.01) discard;
                
                // Circular shape
                vec2 center = gl_PointCoord - 0.5;
                float dist = length(center);
                if (dist > 0.5) discard;
                
                // Smooth edge
                float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
                
                // Fake sphere normal
                vec3 normal;
                normal.xy = center * 2.0;
                normal.z = sqrt(max(0.0, 1.0 - dot(normal.xy, normal.xy)));
                
                vec3 viewDir = normalize(vViewPos);
                
                // Water color
                vec3 baseColor = vec3(0.6, 0.85, 1.0);
                
                // Fresnel
                float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);
                
                // Specular
                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
                vec3 halfVec = normalize(viewDir + lightDir);
                float spec = pow(max(0.0, dot(normal, halfVec)), 80.0);
                
                // Second light
                vec3 lightDir2 = normalize(vec3(-0.3, 0.8, -0.2));
                float spec2 = pow(max(0.0, dot(normal, normalize(viewDir + lightDir2))), 40.0);
                
                vec3 color = baseColor * 0.4;
                color += vec3(1.0) * spec * 1.2;
                color += vec3(0.7, 0.85, 1.0) * spec2 * 0.5;
                color += vec3(0.9, 0.95, 1.0) * fresnel * 0.6;
                
                // Inner highlight
                float inner = 1.0 - dist * 1.8;
                color += vec3(0.95, 0.98, 1.0) * inner * 0.15;
                
                // State-based color tweak
                if (vState > 1.5 && vState < 2.5) {
                    // Sliding - slightly more blue
                    color *= vec3(0.95, 0.98, 1.05);
                }
                
                alpha *= 0.9;
                
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
    const positions = new Float32Array(MAX_PARTICLES * 3);
    const states = new Float32Array(MAX_PARTICLES * 4);
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('state', new THREE.BufferAttribute(states, 4));
    
    particlesMesh = new THREE.Points(geometry, particleMaterial);
    particlesMesh.frustumCulled = false;
    scene.add(particlesMesh);
}

// Update Three.js buffers from particle system
function syncParticleBuffers() {
    if (!particles || !particlesMesh) return;
    
    const posAttr = particlesMesh.geometry.attributes.position;
    const stateAttr = particlesMesh.geometry.attributes.state;
    
    particles.copyToBuffers(posAttr, stateAttr);
    particlesMesh.geometry.setDrawRange(0, particles.count);
}

// ============================================
// WAVE SPAWNING
// ============================================
function spawnFromWave(waveZ) {
    if (!particles || !textBBox) return;
    
    const count = SPAWN_RATE;
    const positions = new Float32Array(count * 3);
    const velocities = new Float32Array(count * 3);
    const sizes = new Float32Array(count);
    const slideSpeeds = new Float32Array(count);
    
    // Text dimensions - spawn tightly around the text bounds
    const width = textBBox.max.x - textBBox.min.x;
    const height = textBBox.max.y - textBBox.min.y;
    const centerX = (textBBox.max.x + textBBox.min.x) / 2;
    const centerY = (textBBox.max.y + textBBox.min.y) / 2;
    
    for (let i = 0; i < count; i++) {
        // Spawn position - tightly over text bounds
        positions[i * 3] = centerX + (Math.random() - 0.5) * width;
        positions[i * 3 + 1] = centerY + (Math.random() - 0.5) * height;
        positions[i * 3 + 2] = waveZ + Math.random() * 1;
        
        // Velocity: straight toward text with slight spread
        velocities[i * 3] = (Math.random() - 0.5) * 0.8;
        velocities[i * 3 + 1] = (Math.random() - 0.5) * 1.2;
        velocities[i * 3 + 2] = -20 - Math.random() * 8;  // Fast toward text (neg Z)
        
        sizes[i] = 0.08 + Math.random() * 0.1;
        slideSpeeds[i] = 0.5 + Math.random() * 1.0;
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
// TEXT CREATION
// ============================================
function createText() {
    const loader = new FontLoader();
    loader.load('https://threejs.org/examples/fonts/helvetiker_bold.typeface.json', (font) => {
        const geometry = new TextGeometry('WEEKEND', {
            font: font,
            size: 2.8,
            height: 0.6,
            curveSegments: 12,
            bevelEnabled: true,
            bevelThickness: 0.05,
            bevelSize: 0.03,
            bevelSegments: 4
        });
        
        geometry.center();
        geometry.computeBoundingBox();
        geometry.computeVertexNormals();
        
        console.log('Text geometry ready');
        initParticleSystem(geometry);
    });
}

// ============================================
// ANIMATION
// ============================================
const waveState = {
    z: 24,
    speed: 9,
    waiting: false,
    waitTimer: 0
};

let lastTime = performance.now();
let frameCount = 0;

function animate() {
    requestAnimationFrame(animate);
    
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const time = now * 0.001;
    
    frameCount++;
    
    // Wave state machine
    if (waveState.waiting) {
        waveState.waitTimer += dt;
        
        // Wait until most particles drained
        if (frameCount % 30 === 0 && particles) {
            const onText = particles.countOnText();
            const drained = onText < MAX_PARTICLES * 0.02; // 98% gone
            
            if (drained || waveState.waitTimer > 6.0) {
                waveState.z = 24;
                waveState.waiting = false;
                waveState.waitTimer = 0;
                particles.reset();
            }
        }
    } else {
        waveState.z -= waveState.speed * dt;
        
        // Spawn particles when wave approaches and passes through text
        // Text is at Z=0, spawn from Z=10 down to Z=-3
        if (waveState.z < 12 && waveState.z > -3) {
            spawnFromWave(waveState.z + 2);
        }
        
        if (waveState.z < -12) {
            waveState.waiting = true;
            waveState.waitTimer = 0;
            waveMesh.visible = false;
        }
    }
    
    // Update wave mesh
    if (!waveState.waiting) {
        waveMesh.position.set(0, -1, waveState.z);
        waveMesh.rotation.y = Math.PI;
        waveMaterial.uniforms.time.value = time;
        waveMesh.visible = waveState.z > -8;
    }
    
    // Particle physics (SoA + SDF collision)
    if (particles) {
        particles.update(dt, time);
        syncParticleBuffers();
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

createText();
animate();

console.log(`Particle System: ${MAX_PARTICLES.toLocaleString()} particles, SoA layout, SDF collision`);
