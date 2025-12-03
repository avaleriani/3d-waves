import * as THREE from 'three';

// Create 3D water wave using actual geometry
export function createWaterWave(scene, cubeRenderTarget) {
    // Create cylindrical water surface for more realistic wave
    const waveGeometry = new THREE.CylinderGeometry(15, 15, 8, 64, 32, true, 0, Math.PI * 2);
    
    // Simple but effective water material
    const waterMaterial = new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(0.006, 0.31, 0.65),
        metalness: 0.0,
        roughness: 0.15,
        transmission: 0.9,
        thickness: 1.0,
        transparent: true,
        opacity: 0.6,
        envMap: cubeRenderTarget.texture,
        envMapIntensity: 2.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.0,
        side: THREE.DoubleSide
    });

    // Wave displacement shader
    const waveShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            time: { value: 0.0 },
            waveHeight: { value: 1.5 },
            waveSpeed: { value: 2.0 },
            baseColor: { value: new THREE.Color(0.006, 0.31, 0.65) },
            foamColor: { value: new THREE.Color(1.0, 1.0, 1.0) },
            envMap: { value: cubeRenderTarget.texture }
        },
        vertexShader: `
            uniform float time;
            uniform float waveHeight;
            uniform float waveSpeed;
            
            varying vec3 vWorldPosition;
            varying vec3 vNormal;
            varying vec3 vReflect;
            varying float vElevation;
            
            void main() {
                vec3 pos = position;
                
                // Create circular wave pattern
                float radius = length(pos.xz);
                float angle = atan(pos.z, pos.x);
                
                // Multiple wave layers for organic look
                float wave1 = sin(radius * 0.4 - time * waveSpeed) * waveHeight * 0.6;
                float wave2 = sin(radius * 0.8 + angle * 2.0 - time * waveSpeed * 1.5) * waveHeight * 0.4;
                float wave3 = cos(angle * 3.0 + radius * 0.3 - time * waveSpeed * 0.8) * waveHeight * 0.3;
                
                // Add turbulence
                float turbulence = sin(pos.x * 2.0 + pos.y * 1.5 + time * 3.0) * 0.2;
                turbulence += cos(pos.z * 1.8 - time * 2.5) * 0.15;
                
                float elevation = wave1 + wave2 + wave3 + turbulence;
                pos.x += sin(angle + time * 0.5) * elevation * 0.3;
                pos.z += cos(angle + time * 0.5) * elevation * 0.3;
                pos.y += elevation;
                
                // Calculate normals
                float delta = 0.1;
                float dx = (sin((radius + delta) * 0.4 - time * waveSpeed) * waveHeight * 0.6) - 
                          (sin((radius - delta) * 0.4 - time * waveSpeed) * waveHeight * 0.6);
                float dy = (sin(pos.y + delta) * 0.5) - (sin(pos.y - delta) * 0.5);
                
                vNormal = normalize(vec3(dx, dy, 1.0));
                vWorldPosition = (modelMatrix * vec4(pos, 1.0)).xyz;
                vReflect = reflect(normalize(vWorldPosition - cameraPosition), vNormal);
                vElevation = elevation;
                
                gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
            }
        `,
        fragmentShader: `
            uniform vec3 baseColor;
            uniform vec3 foamColor;
            uniform samplerCube envMap;
            uniform float time;
            
            varying vec3 vWorldPosition;
            varying vec3 vNormal;
            varying vec3 vReflect;
            varying float vElevation;
            
            void main() {
                vec3 normal = normalize(vNormal);
                
                // Dynamic water color
                vec3 waterColor = baseColor;
                waterColor *= 0.7 + 0.3 * sin(vWorldPosition.x * 0.3 + time);
                
                // Environment reflection
                vec3 envColor = textureCube(envMap, vReflect).rgb;
                waterColor = mix(waterColor, envColor, 0.4);
                
                // Fresnel effect
                vec3 viewDir = normalize(vWorldPosition - cameraPosition);
                float fresnel = pow(1.0 - dot(normal, viewDir), 2.0);
                waterColor += vec3(0.2, 0.4, 0.8) * fresnel * 0.5;
                
                // Foam on wave peaks
                float foamFactor = smoothstep(0.8, 1.5, vElevation);
                foamFactor += pow(max(0.0, normal.y), 3.0) * 0.4;
                waterColor = mix(waterColor, foamColor, foamFactor * 0.5);
                
                // Shimmer effect
                float shimmer = sin(time * 5.0 + length(vWorldPosition.xz) * 4.0) * 0.08;
                waterColor += vec3(0.3, 0.6, 1.0) * shimmer * (1.0 - foamFactor);
                
                // Transparency
                float alpha = 0.7 + fresnel * 0.2 + foamFactor * 0.1;
                
                gl_FragColor = vec4(waterColor, alpha);
            }
        `,
        transparent: true,
        side: THREE.DoubleSide
    });

    const waveMesh = new THREE.Mesh(waveGeometry, waveShaderMaterial);
    waveMesh.position.set(0, 0, 0);
    waveMesh.rotation.z = Math.PI; // Face the camera
    scene.add(waveMesh);

    return waveMesh;
}
