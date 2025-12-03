import * as THREE from 'three';
import { FontLoader } from 'three/examples/jsm/loaders/FontLoader.js';
import { TextGeometry } from 'three/examples/jsm/geometries/TextGeometry.js';

// Scene setup
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000005);

const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ 
    canvas: document.getElementById('canvas'),
    antialias: true,
    powerPreference: "high-performance"
});

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// Environment for reflections
const cubeRenderTarget = new THREE.WebGLCubeRenderTarget(256);
const cubeCamera = new THREE.CubeCamera(0.1, 100, cubeRenderTarget);
scene.add(cubeCamera);

// Lighting - dramatic for water droplets
const ambientLight = new THREE.AmbientLight(0x0a1020, 0.3);
scene.add(ambientLight);

// Key light from top-right
const keyLight = new THREE.DirectionalLight(0xffffff, 2.5);
keyLight.position.set(10, 20, 15);
scene.add(keyLight);

// Blue fill from left
const fillLight = new THREE.DirectionalLight(0x4488cc, 1.0);
fillLight.position.set(-15, 5, 10);
scene.add(fillLight);

// Rim light from behind for droplet highlights
const rimLight = new THREE.DirectionalLight(0x88ccff, 1.5);
rimLight.position.set(0, 10, -15);
scene.add(rimLight);

// Camera position
camera.position.set(0, 1, 20);
camera.lookAt(0, 0, 0);

// INVISIBLE text mesh - only for collision detection
let textMesh;
let textBBox;
const raycaster = new THREE.Raycaster();

// Create INVISIBLE 3D text (collision surface only)
function createText() {
    const loader = new FontLoader();
    
    loader.load('https://threejs.org/examples/fonts/helvetiker_bold.typeface.json', function(font) {
        const textGeometry = new TextGeometry('WEEKEND', {
            font: font,
            size: 2.8,
            height: 0.5,
            curveSegments: 8,
            bevelEnabled: true,
            bevelThickness: 0.04,
            bevelSize: 0.02,
            bevelSegments: 3
        });
        
        textGeometry.center();
        textGeometry.computeBoundingBox();
        textBBox = textGeometry.boundingBox;
        
        // INVISIBLE material - text is never visible, only droplets are
        const invisibleMaterial = new THREE.MeshBasicMaterial({
            visible: false
        });
        
        textMesh = new THREE.Mesh(textGeometry, invisibleMaterial);
        textMesh.position.set(0, 0, 0);
        scene.add(textMesh);
        
        console.log('Invisible text collision mesh ready');
        
        // Initialize droplet system after text is ready
        initDropletSystem();
    });
}

// ============================================
// WATER DROPLET PARTICLE SYSTEM
// Droplets stick to invisible text surface
// ============================================

// CONTROL: Adjust droplet multiplier (higher = more droplets)
const DROPLET_MULTIPLIER = 1.0;  // Change this: 1.0 = 15K, 2.0 = 30K, etc.
const BASE_DROPLETS = 15000;
const MAX_DROPLETS = Math.min(Math.floor(BASE_DROPLETS * DROPLET_MULTIPLIER), 50000); // Cap at 50K for performance
let dropletSystem = null;

// Droplet states
const FALLING = 0;   // Falling from wave
const STUCK = 1;     // Stuck on letter surface
const SLIDING = 2;   // Sliding down letter surface
const DRIPPING = 3;  // Falling off letter

function initDropletSystem() {
    // High quality water droplet material
    const dropletMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0 },
            envMap: { value: cubeRenderTarget.texture }
        },
        vertexShader: `
            attribute float size;
            attribute float state;
            varying vec3 vViewPosition;
            varying vec3 vNormal;
            varying float vState;
            
            void main() {
                vState = state;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                vViewPosition = -mvPosition.xyz;
                vNormal = normalize(normalMatrix * vec3(0.0, 0.0, 1.0));
                gl_Position = projectionMatrix * mvPosition;
                
                // Size attenuation
                float dist = length(mvPosition.xyz);
                gl_PointSize = size * (300.0 / dist);
                gl_PointSize = clamp(gl_PointSize, 2.0, 40.0);
            }
        `,
        fragmentShader: `
            uniform float time;
            uniform samplerCube envMap;
            varying vec3 vViewPosition;
            varying vec3 vNormal;
            varying float vState;
            
            void main() {
                // Circular droplet shape
                vec2 center = gl_PointCoord - 0.5;
                float dist = length(center);
                if (dist > 0.5) discard;
                
                // Smooth edge
                float alpha = 1.0 - smoothstep(0.35, 0.5, dist);
                
                // Fake spherical normal for lighting
                vec3 normal;
                normal.xy = center * 2.0;
                normal.z = sqrt(max(0.0, 1.0 - dot(normal.xy, normal.xy)));
                
                // View direction
                vec3 viewDir = normalize(vViewPosition);
                
                // Base water color
                vec3 waterColor = vec3(0.7, 0.85, 1.0);
                
                // Fresnel effect - edges are brighter
                float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 3.0);
                
                // Specular highlight
                vec3 lightDir = normalize(vec3(0.5, 1.0, 0.5));
                vec3 halfVec = normalize(viewDir + lightDir);
                float spec = pow(max(0.0, dot(normal, halfVec)), 64.0);
                
                // Environment reflection
                vec3 reflectDir = reflect(-viewDir, normal);
                vec3 envColor = textureCube(envMap, reflectDir).rgb;
                
                // Combine
                vec3 color = waterColor * 0.3;
                color += envColor * fresnel * 0.5;
                color += vec3(1.0) * spec * 1.5;
                color += vec3(0.8, 0.9, 1.0) * fresnel * 0.4;
                
                // Inner glow / refraction hint
                float innerGlow = 1.0 - dist * 1.5;
                color += vec3(0.9, 0.95, 1.0) * innerGlow * 0.2;
                
                // Transparency
                alpha *= 0.85;
                
                gl_FragColor = vec4(color, alpha);
            }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending
    });
    
    // Geometry with attributes
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(MAX_DROPLETS * 3);
    const sizes = new Float32Array(MAX_DROPLETS);
    const states = new Float32Array(MAX_DROPLETS);
    
    // Initialize off-screen
    for (let i = 0; i < MAX_DROPLETS; i++) {
        positions[i * 3] = 0;
        positions[i * 3 + 1] = -1000;
        positions[i * 3 + 2] = 0;
        sizes[i] = 0;
        states[i] = FALLING;
    }
    
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute('state', new THREE.BufferAttribute(states, 1));
    
    const points = new THREE.Points(geometry, dropletMaterial);
    points.frustumCulled = false;
    scene.add(points);
    
    // Droplet data
    const droplets = [];
    for (let i = 0; i < MAX_DROPLETS; i++) {
        droplets.push({
            active: false,
            state: FALLING,
            pos: new THREE.Vector3(),
            vel: new THREE.Vector3(),
            normal: new THREE.Vector3(),
            size: 0,
            stickTime: 0,
            slideSpeed: 0
        });
    }
    
    dropletSystem = {
        geometry,
        material: dropletMaterial,
        points,
        droplets,
        positions: geometry.attributes.position.array,
        sizes: geometry.attributes.size.array,
        states: geometry.attributes.state.array
    };
    
    console.log('Droplet system initialized with', MAX_DROPLETS, 'particles');
}

// Spawn droplets falling from wave position
function spawnWaveDroplets(waveZ, count) {
    if (!dropletSystem || !textBBox) return;
    
    const { droplets, positions, sizes, states } = dropletSystem;
    let spawned = 0;
    
    for (let i = 0; i < MAX_DROPLETS && spawned < count; i++) {
        if (!droplets[i].active) {
            const d = droplets[i];
            d.active = true;
            d.state = FALLING;
            
            // Spawn in area covering the text bounds
            d.pos.set(
                (Math.random() - 0.5) * textBBox.max.x * 2.5,  // X spread
                (Math.random() - 0.5) * textBBox.max.y * 2,   // Y spread
                waveZ + (Math.random() - 0.5) * 1  // Z near wave
            );
            
            // Strong velocity toward text (negative Z) with slight spread
            d.vel.set(
                (Math.random() - 0.5) * 0.3,
                (Math.random() - 0.5) * 1,
                -12 - Math.random() * 6  // Faster toward text
            );
            
            d.size = 0.12 + Math.random() * 0.15;
            d.stickTime = 0;
            d.slideSpeed = 0.4 + Math.random() * 0.5;
            
            // Update buffers
            positions[i * 3] = d.pos.x;
            positions[i * 3 + 1] = d.pos.y;
            positions[i * 3 + 2] = d.pos.z;
            sizes[i] = d.size;
            states[i] = FALLING;
            
            spawned++;
        }
    }
    
    dropletSystem.geometry.attributes.position.needsUpdate = true;
    dropletSystem.geometry.attributes.size.needsUpdate = true;
}

// Check if droplet hits text mesh
function checkCollision(droplet) {
    if (!textMesh) return null;
    
    // Check if droplet is near text bounds first
    if (Math.abs(droplet.pos.x) > textBBox.max.x * 1.5 || 
        Math.abs(droplet.pos.y) > textBBox.max.y * 1.5 ||
        Math.abs(droplet.pos.z) > 2) {
        return null;
    }
    
    // Ray from droplet position in its velocity direction
    const dir = droplet.vel.clone().normalize();
    raycaster.set(droplet.pos, dir);
    raycaster.far = droplet.vel.length() * 0.2; // Longer ray
    
    const intersects = raycaster.intersectObject(textMesh);
    if (intersects.length > 0) {
        return intersects[0];
    }
    
    // Check forward direction (droplet moving toward text)
    const forwardDir = new THREE.Vector3(0, 0, -1);
    raycaster.set(droplet.pos, forwardDir);
    raycaster.far = 3.0;
    const forwardIntersects = raycaster.intersectObject(textMesh);
    if (forwardIntersects.length > 0 && forwardIntersects[0].distance < 2.0) {
        return forwardIntersects[0];
    }
    
    // Check if droplet is already inside text bounds (overshoot)
    if (Math.abs(droplet.pos.x) < textBBox.max.x && 
        Math.abs(droplet.pos.y) < textBBox.max.y &&
        Math.abs(droplet.pos.z) < 1) {
        
        // Find nearest surface point
        const testPoints = [
            new THREE.Vector3(droplet.pos.x, droplet.pos.y, droplet.pos.z + 0.5),
            new THREE.Vector3(droplet.pos.x, droplet.pos.y, droplet.pos.z - 0.5),
            new THREE.Vector3(droplet.pos.x + 0.5, droplet.pos.y, droplet.pos.z),
            new THREE.Vector3(droplet.pos.x - 0.5, droplet.pos.y, droplet.pos.z),
            new THREE.Vector3(droplet.pos.x, droplet.pos.y + 0.5, droplet.pos.z),
            new THREE.Vector3(droplet.pos.x, droplet.pos.y - 0.5, droplet.pos.z)
        ];
        
        for (let testPoint of testPoints) {
            raycaster.set(testPoint, droplet.pos.clone().sub(testPoint).normalize());
            raycaster.far = 1.0;
            const nearIntersects = raycaster.intersectObject(textMesh);
            if (nearIntersects.length > 0) {
                return nearIntersects[0];
            }
        }
    }
    
    return null;
}

// Update all droplets
function updateDroplets(dt) {
    if (!dropletSystem) return;
    
    const { droplets, positions, sizes, states, geometry } = dropletSystem;
    const gravity = new THREE.Vector3(0, -9.8, 0);
    
    for (let i = 0; i < MAX_DROPLETS; i++) {
        const d = droplets[i];
        if (!d.active) continue;
        
        const idx = i * 3;
        
        switch (d.state) {
            case FALLING:
                // Apply gravity
                d.vel.addScaledVector(gravity, dt);
                d.pos.addScaledVector(d.vel, dt);
                
                // Check collision with text
                const hit = checkCollision(d);
                if (hit) {
                    // STICK to the surface!
                    d.state = STUCK;
                    d.pos.copy(hit.point);
                    d.pos.addScaledVector(hit.face.normal, 0.02); // Slight offset
                    d.normal.copy(hit.face.normal);
                    d.vel.set(0, 0, 0);
                    d.stickTime = 0;
                    states[i] = STUCK;
                }
                
                // Miss - fell past text
                if (d.pos.z < -5 || d.pos.y < -10) {
                    d.active = false;
                    sizes[i] = 0;
                }
                break;
                
            case STUCK:
                // Droplet sticks for a moment, then starts sliding
                d.stickTime += dt;
                
                // Start sliding after random delay
                if (d.stickTime > 0.5 + Math.random() * 2.0) {
                    d.state = SLIDING;
                    states[i] = SLIDING;
                }
                break;
                
            case SLIDING:
                // Slide DOWN the surface
                // Project gravity onto surface tangent
                const tangent = new THREE.Vector3(0, -1, 0);
                const normalComponent = d.normal.clone().multiplyScalar(
                    tangent.dot(d.normal)
                );
                const slideDir = tangent.sub(normalComponent).normalize();
                
                // Move along surface
                d.pos.addScaledVector(slideDir, d.slideSpeed * dt);
                d.stickTime += dt;
                
                // Shrink slowly as it slides (water spreading)
                d.size *= (1 - dt * 0.1);
                sizes[i] = d.size;
                
                // Check if still on surface or fell off edge
                raycaster.set(d.pos, d.normal.clone().negate());
                raycaster.far = 0.5;
                const stillOnSurface = raycaster.intersectObject(textMesh);
                
                if (stillOnSurface.length === 0 || d.stickTime > 6 || d.size < 0.02) {
                    // Fell off edge - start dripping
                    d.state = DRIPPING;
                    d.vel.set(0, -0.5, 0);
                    states[i] = DRIPPING;
                }
                break;
                
            case DRIPPING:
                // Fall with gravity
                d.vel.addScaledVector(gravity, dt);
                d.pos.addScaledVector(d.vel, dt);
                d.size *= (1 - dt * 0.3);
                sizes[i] = d.size;
                
                // Remove when off screen
                if (d.pos.y < -10 || d.size < 0.01) {
                    d.active = false;
                    sizes[i] = 0;
                }
                break;
        }
        
        // Update position buffer
        positions[idx] = d.pos.x;
        positions[idx + 1] = d.pos.y;
        positions[idx + 2] = d.pos.z;
    }
    
    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.size.needsUpdate = true;
    geometry.attributes.state.needsUpdate = true;
}

// ============================================
// 3D OCEAN WAVE - Realistic breaking wave
// ============================================

function createWaveGeometry() {
    // Create a parametric breaking wave shape
    const widthSegments = 100;
    const heightSegments = 60;
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
            
            // X position - spread across width
            const x = (u - 0.5) * waveWidth;
            
            // Wave profile - creates the curl shape
            // v=0 is bottom, v=1 is top/curl
            const angle = v * Math.PI * 1.3; // Curve from bottom to curl over
            
            // Base wave height
            const baseY = Math.sin(angle) * waveHeight * 0.5;
            
            // Z depth - creates the 3D tube/curl shape
            const curlRadius = 2.5 * (0.3 + v * 0.7); // Curl gets thicker toward top
            const baseZ = -Math.cos(angle) * curlRadius;
            
            // Add variation along width
            const widthVar = Math.sin(u * Math.PI * 4) * 0.3;
            
            // Final position
            const y = baseY + widthVar;
            const z = baseZ;
            
            vertices.push(x, y, z);
            
            // Calculate normal (approximate)
            const nx = widthVar * 0.2;
            const ny = Math.cos(angle);
            const nz = Math.sin(angle);
            const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
            normals.push(nx/len, ny/len, nz/len);
            
            uvs.push(u, v);
        }
    }
    
    // Create indices for triangles
    for (let j = 0; j < heightSegments; j++) {
        for (let i = 0; i < widthSegments; i++) {
            const a = j * (widthSegments + 1) + i;
            const b = a + 1;
            const c = a + widthSegments + 1;
            const d = c + 1;
            
            indices.push(a, c, b);
            indices.push(b, c, d);
        }
    }
    
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    
    return geometry;
}

const waveGeometry = createWaveGeometry();

const waveMaterial = new THREE.ShaderMaterial({
    uniforms: {
        time: { value: 0 },
        envMap: { value: cubeRenderTarget.texture }
    },
    vertexShader: `
        uniform float time;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vFoam;
        varying float vCurl;
        
        void main() {
            vUv = uv;
            vec3 pos = position;
            
            // Animate wave motion
            float waveMotion = sin(position.x * 0.3 + time * 2.0) * 0.4;
            waveMotion += sin(position.x * 0.7 + time * 3.5) * 0.2;
            pos.y += waveMotion;
            
            // Turbulence on surface
            float turb = sin(pos.x * 1.5 + pos.y * 2.0 + time * 4.0) * 0.15;
            turb += cos(pos.x * 2.0 - time * 3.0) * 0.1;
            pos.z += turb;
            
            // More movement at the curl (top)
            float curlFactor = uv.y;
            pos.y += sin(time * 5.0 + pos.x * 0.5) * curlFactor * 0.3;
            pos.z += cos(time * 4.0 + pos.x * 0.8) * curlFactor * 0.2;
            
            vCurl = curlFactor;
            vFoam = smoothstep(0.6, 0.95, curlFactor);
            
            vNormal = normalize(normalMatrix * normal);
            vec4 worldPos = modelMatrix * vec4(pos, 1.0);
            vWorldPos = worldPos.xyz;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float time;
        uniform samplerCube envMap;
        
        varying vec2 vUv;
        varying vec3 vNormal;
        varying vec3 vWorldPos;
        varying float vFoam;
        varying float vCurl;
        
        // Simple noise
        float hash(vec2 p) {
            return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
        }
        
        float noise(vec2 p) {
            vec2 i = floor(p);
            vec2 f = fract(p);
            f = f * f * (3.0 - 2.0 * f);
            return mix(
                mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
                f.y
            );
        }
        
        void main() {
            vec3 normal = normalize(vNormal);
            vec3 viewDir = normalize(cameraPosition - vWorldPos);
            
            // Water colors
            vec3 deepColor = vec3(0.0, 0.05, 0.15);
            vec3 midColor = vec3(0.02, 0.2, 0.4);
            vec3 surfaceColor = vec3(0.1, 0.45, 0.65);
            vec3 foamColor = vec3(0.9, 0.95, 1.0);
            
            // Depth gradient based on curl position
            vec3 baseColor = mix(deepColor, midColor, vCurl * 0.5);
            baseColor = mix(baseColor, surfaceColor, vCurl);
            
            // Fresnel - edges are more reflective
            float fresnel = pow(1.0 - max(0.0, dot(normal, viewDir)), 4.0);
            
            // Environment reflection
            vec3 reflectDir = reflect(-viewDir, normal);
            vec3 envColor = textureCube(envMap, reflectDir).rgb;
            baseColor = mix(baseColor, envColor, fresnel * 0.6);
            
            // Specular highlights
            vec3 lightDir = normalize(vec3(0.3, 1.0, 0.5));
            vec3 halfVec = normalize(viewDir + lightDir);
            float spec = pow(max(0.0, dot(normal, halfVec)), 128.0);
            baseColor += vec3(1.0) * spec * 0.9;
            
            // Secondary light
            vec3 lightDir2 = normalize(vec3(-0.5, 0.8, -0.3));
            float spec2 = pow(max(0.0, dot(normal, normalize(viewDir + lightDir2))), 64.0);
            baseColor += vec3(0.6, 0.8, 1.0) * spec2 * 0.4;
            
            // Foam on curl/crest
            float foamNoise = noise(vWorldPos.xy * 8.0 + time * 2.0);
            foamNoise += noise(vWorldPos.xy * 15.0 - time * 3.0) * 0.5;
            float foam = vFoam * (0.5 + foamNoise * 0.5);
            foam += smoothstep(0.85, 1.0, vCurl) * foamNoise;
            baseColor = mix(baseColor, foamColor, foam * 0.85);
            
            // Subsurface scattering hint
            float sss = pow(max(0.0, dot(viewDir, -lightDir)), 4.0);
            baseColor += surfaceColor * sss * 0.3 * (1.0 - vCurl);
            
            // Caustic shimmer in deeper parts
            float caustic = pow(abs(sin(time * 4.0 + vWorldPos.x * 8.0) * cos(time * 3.0 + vWorldPos.y * 6.0)), 4.0);
            baseColor += vec3(0.2, 0.4, 0.5) * caustic * 0.15 * (1.0 - vCurl);
            
            // Transparency - more opaque at foam, more transparent at base
            float alpha = 0.85 + foam * 0.15;
            alpha = mix(0.7, alpha, vCurl * 0.5 + 0.5);
            
            gl_FragColor = vec4(baseColor, alpha);
        }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
});

const waveMesh = new THREE.Mesh(waveGeometry, waveMaterial);
scene.add(waveMesh);

// ============================================
// ANIMATION LOOP
// ============================================

const waveState = {
    z: 22,
    speed: 8,
    spawning: false,
    waiting: false,
    waitTimer: 0,
    waitDuration: 6.0  // Seconds to wait after wave passes (for droplets to drip off)
};

let lastTime = performance.now();

// Count active droplets stuck/sliding on text
function countActiveDroplets() {
    if (!dropletSystem) return 0;
    let count = 0;
    for (const d of dropletSystem.droplets) {
        if (d.active && (d.state === STUCK || d.state === SLIDING)) {
            count++;
        }
    }
    return count;
}

function animate() {
    requestAnimationFrame(animate);
    
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const time = now * 0.001;
    
    // Wave state machine
    if (waveState.waiting) {
        // Waiting for droplets to drain off
        waveState.waitTimer += dt;
        
        // Check if enough droplets have drained OR max wait time reached
        const activeOnText = countActiveDroplets();
        const drainedEnough = activeOnText < MAX_DROPLETS * 0.05; // 95% gone
        const timeExpired = waveState.waitTimer > waveState.waitDuration;
        
        if (drainedEnough || timeExpired) {
            // Reset wave for next cycle
            waveState.z = 22;
            waveState.waiting = false;
            waveState.waitTimer = 0;
            waveState.spawning = false;
        }
    } else {
        // Move wave from camera toward text
        waveState.z -= waveState.speed * dt;
        
        // Spawn droplets when wave is near text
        if (waveState.z < 6 && waveState.z > -4) {
            waveState.spawning = true;
            // Spawn based on multiplier
            const baseSpawn = Math.floor(200 + Math.random() * 100);
            const spawnCount = Math.floor(baseSpawn * DROPLET_MULTIPLIER);
            spawnWaveDroplets(waveState.z + 2, spawnCount);
        }
        
        // Wave passed - start waiting
        if (waveState.z < -10) {
            waveState.waiting = true;
            waveState.waitTimer = 0;
            waveMesh.visible = false;
        }
    }
    
    // Position 3D wave mesh
    if (!waveState.waiting) {
        waveMesh.position.set(0, -1, waveState.z);
        waveMesh.rotation.y = Math.PI;
        waveMaterial.uniforms.time.value = time;
        waveMesh.visible = waveState.z > -8;
    }
    
    // Update droplets
    updateDroplets(dt);
    
    // Update droplet shader
    if (dropletSystem) {
        dropletSystem.material.uniforms.time.value = time;
    }
    
    // Update environment map occasionally (not every frame - causes feedback loop)
    // Hide droplets during env map capture to avoid feedback
    if (Math.floor(time) % 2 === 0 && Math.floor(time * 10) % 10 === 0) {
        if (dropletSystem) dropletSystem.points.visible = false;
        cubeCamera.update(renderer, scene);
        if (dropletSystem) dropletSystem.points.visible = true;
    }
    
    renderer.render(scene, camera);
}

// Handle resize
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// Start
createText();
animate();

console.log(`3D Wave Effect: ${MAX_DROPLETS} droplets (multiplier: ${DROPLET_MULTIPLIER}x). Droplets stick to invisible text, slide down, drip off.`);
