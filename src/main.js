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

const MAX_DROPLETS = 8000;
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
// SEA WAVE - Visual only (spawns droplets)
// ============================================

const waveGeometry = new THREE.PlaneGeometry(40, 12, 80, 40);
const waveMaterial = new THREE.ShaderMaterial({
    uniforms: {
        time: { value: 0 },
        opacity: { value: 0.9 }
    },
    vertexShader: `
        uniform float time;
        varying vec2 vUv;
        varying float vHeight;
        varying float vFoam;
        
        void main() {
            vUv = uv;
            vec3 pos = position;
            
            // Primary wave - large rolling motion
            float mainWave = sin(pos.x * 0.3 + time * 2.5) * 1.8;
            
            // Secondary wave - faster ripples
            float secondaryWave = sin(pos.x * 0.8 + pos.y * 0.2 + time * 4.0) * 0.6;
            
            // Cross waves for realism
            float crossWave = cos(pos.y * 0.5 + time * 3.0) * 0.4;
            
            // Turbulence
            float turb = sin(pos.x * 1.2 + pos.y * 0.8 + time * 5.5) * 0.2;
            
            // Wave crest (breaking wave effect)
            float crestFactor = sin(pos.x * 0.3 + time * 2.5);
            float crest = smoothstep(0.7, 1.0, crestFactor) * 0.8;
            
            pos.z = mainWave + secondaryWave + crossWave + turb + crest;
            vHeight = pos.z;
            vFoam = smoothstep(1.0, 2.0, pos.z) + crest * 0.5;
            
            gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
        }
    `,
    fragmentShader: `
        uniform float time;
        uniform float opacity;
        varying vec2 vUv;
        varying float vHeight;
        varying float vFoam;
        
        void main() {
            vec3 deepBlue = vec3(0.01, 0.08, 0.2);
            vec3 surfaceBlue = vec3(0.08, 0.35, 0.55);
            vec3 foam = vec3(0.95, 0.98, 1.0);
            
            // Base color with depth
            vec3 color = mix(deepBlue, surfaceBlue, smoothstep(-1.0, 1.5, vHeight));
            
            // Foam on wave crests
            float foamAmount = vFoam + sin(time * 8.0 + vUv.x * 30.0) * 0.1;
            foamAmount = smoothstep(0.3, 0.8, foamAmount);
            color = mix(color, foam, foamAmount * 0.8);
            
            // Dynamic shimmer
            float shimmer = sin(time * 6.0 + vUv.x * 25.0 + vUv.y * 15.0) * 0.15;
            shimmer *= cos(time * 4.0 + vUv.y * 20.0) * 0.5 + 0.5;
            color += vec3(0.15, 0.3, 0.45) * shimmer;
            
            // Fresnel edge highlight
            float fresnel = pow(1.0 - vUv.y, 2.0) * 0.2;
            color += surfaceBlue * fresnel;
            
            gl_FragColor = vec4(color, opacity);
        }
    `,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false
});

const waveMesh = new THREE.Mesh(waveGeometry, waveMaterial);
waveMesh.rotation.x = -Math.PI / 2;
scene.add(waveMesh);

// ============================================
// ANIMATION LOOP
// ============================================

const waveState = {
    z: 18,
    speed: 8,
    spawning: false
};

let lastTime = performance.now();

function animate() {
    requestAnimationFrame(animate);
    
    const now = performance.now();
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    const time = now * 0.001;
    
    // Move wave from camera toward text
    waveState.z -= waveState.speed * dt;
    
    // Spawn droplets when wave is near text - wider range
    if (waveState.z < 5 && waveState.z > -3) {
        waveState.spawning = true;
        // Spawn LOTS of droplets per frame
        const spawnCount = Math.floor(120 + Math.random() * 60);
        spawnWaveDroplets(waveState.z, spawnCount);
    }
    
    // Reset wave
    if (waveState.z < -10) {
        waveState.z = 18;
        waveState.spawning = false;
    }
    
    // Position wave mesh
    waveMesh.position.set(0, -3, waveState.z);
    waveMaterial.uniforms.time.value = time;
    waveMaterial.uniforms.opacity.value = waveState.z > -5 ? 0.9 : 0.9 * (1 + waveState.z / 5);
    
    // Update droplets
    updateDroplets(dt);
    
    // Update droplet shader
    if (dropletSystem) {
        dropletSystem.material.uniforms.time.value = time;
    }
    
    // Update environment map
    cubeCamera.update(renderer, scene);
    
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

console.log('Particle Water Effect: Droplets fall from wave, stick to invisible text, slide down, drip off');
