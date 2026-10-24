// Agujeros de gusano del Mundo 3D: el portal (una lente que curva la luz y deja ver otra
// escena en su núcleo), la escena de destino y el render que los junta.
//
// Cómo se dibuja: la escena actual se renderiza SIN los agujeros a un render target (color y
// profundidad) y la escena del otro lado a otro. Luego se copia la primera a la pantalla (con su
// profundidad, para que una persona o un pilar delante tape el agujero) y encima se dibujan los
// agujeros, cuyo shader lee esas dos texturas para doblar el fondo y mostrar el destino.
import * as THREE from 'three';

export const HOLE_R = 1.7;          // radio del disco del agujero, en metros
export const HOLE_Y = 1.6;          // altura del centro
const NEAR_DIST = 40;               // más lejos que esto no vale la pena el render extra

const NOISE = `
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f*f*(3.0-2.0*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), u.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y); }
    float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
`;

export function createWormholes(renderer) {
    const rtOpts = { type: THREE.HalfFloatType, samples: 4 };
    const rtWorld = new THREE.WebGLRenderTarget(1, 1, { ...rtOpts, depthTexture: new THREE.DepthTexture(1, 1) });
    const rtOther = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
    const shared = { tWorld: { value: rtWorld.texture }, tOther: { value: rtOther.texture }, uTime: { value: 0 } };

    // Copia del mundo a la pantalla, con su profundidad y su alfa (el hueco del video queda transparente).
    const copyScene = new THREE.Scene();
    const copyCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const copyQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
        uniforms: { tColor: { value: rtWorld.texture }, tDepth: { value: rtWorld.depthTexture } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
        fragmentShader: `uniform sampler2D tColor; uniform sampler2D tDepth; varying vec2 vUv;
            void main(){
                gl_FragColor = texture2D(tColor, vUv);
                gl_FragDepth = texture2D(tDepth, vUv).x;
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
        blending: THREE.NoBlending, depthTest: true, depthWrite: true, depthFunc: THREE.AlwaysDepth,
    }));
    copyQuad.frustumCulled = false;
    copyScene.add(copyQuad);

    const holes = [];   // los que existen (en cualquier escena); cada uno sabe a qué escena pertenece
    const v = new THREE.Vector3();
    const frustum = new THREE.Frustum();
    const projScreen = new THREE.Matrix4();

    function makeHole({ scene, x, z }) {
        const group = new THREE.Group();
        group.position.set(x, HOLE_Y, z);
        const center = new THREE.Vector2(), radius = new THREE.Vector2();
        const disc = new THREE.Mesh(new THREE.PlaneGeometry(HOLE_R * 2, HOLE_R * 2), new THREE.ShaderMaterial({
            transparent: true, depthWrite: false,
            uniforms: { ...shared, uCenter: { value: center }, uRadius: { value: radius } },
            vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
            fragmentShader: `
                uniform sampler2D tWorld, tOther; uniform float uTime; uniform vec2 uCenter, uRadius;
                varying vec2 vUv;
                ${NOISE}
                void main(){
                    vec2 p = vUv * 2.0 - 1.0;
                    float r = length(p);
                    if (r > 1.0) discard;
                    float t = uTime;
                    // Lente gravitacional: el fondo gira y se curva hacia el centro (y se ve al revés cerca del núcleo).
                    float fade = 1.0 - smoothstep(0.55, 1.0, r);
                    float ang = 0.9 / (r + 0.25) * fade + t * 0.15 * fade;
                    float cs = cos(ang), sn = sin(ang);
                    vec2 q = mat2(cs, -sn, sn, cs) * p;
                    vec2 src = q - 0.11 * normalize(q + 1e-4) / max(r, 0.12) * fade;
                    vec4 w = texture2D(tWorld, uCenter + src * uRadius);
                    // Núcleo: la otra escena.
                    float horizon = 0.3;
                    vec3 o = texture2D(tOther, uCenter + q * uRadius * 0.9).rgb;
                    float inHole = smoothstep(horizon + 0.02, horizon - 0.02, r);
                    vec3 col = mix(w.rgb, o, inHole);
                    col += vec3(1.6, 0.8, 0.35) * min(0.006 / abs(r - horizon - 0.015), 4.0);
                    // Remolino de luz alrededor del núcleo.
                    float a = atan(p.y, p.x);
                    float swirl = fbm(vec2(a * 3.0 - 6.0 / (r + 0.1) + t * 1.4, r * 6.0 - t));
                    float band = smoothstep(0.3, 0.42, r) * smoothstep(0.85, 0.45, r);
                    col += mix(vec3(1.4, 0.4, 0.6), vec3(1.6, 0.9, 0.3), swirl) * pow(swirl, 3.0) * band * 1.4;
                    // Donde el fondo era el hueco del video (alfa 0) el disco igual se ve opaco.
                    gl_FragColor = vec4(col, smoothstep(1.0, 0.85, r));
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        }));
        group.add(disc);

        // Polvo en órbita, inclinado como un disco de acreción.
        const N = 360;
        const pos = new Float32Array(N * 3);
        const seeds = Array.from({ length: N }, () => ({ r: 0.55 + Math.random() * 1.2, a: Math.random() * Math.PI * 2, y: (Math.random() - 0.5) * 0.12, s: 0.6 + Math.random() }));
        const pGeo = new THREE.BufferGeometry();
        pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        const dust = new THREE.Points(pGeo, new THREE.PointsMaterial({
            color: 0xffb070, size: 0.035, transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
        }));
        dust.frustumCulled = false;
        const tilt = new THREE.Group();
        tilt.rotation.set(1.25, 0, 0.25);
        tilt.add(dust);
        group.add(tilt);

        const hole = {
            scene, group, x, z,
            update(camera, dt, t) {
                disc.quaternion.copy(camera.quaternion);
                group.position.y = HOLE_Y + Math.sin(t * 0.8 + x) * 0.06;
                group.getWorldPosition(v).project(camera);
                center.set(v.x * 0.5 + 0.5, v.y * 0.5 + 0.5);
                const dist = camera.position.distanceTo(group.position);
                const h = HOLE_R / (2 * dist * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
                radius.set(h / camera.aspect, h);
                for (let i = 0; i < N; i++) {
                    const s = seeds[i];
                    s.a += dt * s.s * 1.2 / s.r;
                    pos[i * 3] = Math.cos(s.a) * s.r;
                    pos[i * 3 + 1] = s.y;
                    pos[i * 3 + 2] = Math.sin(s.a) * s.r;
                }
                pGeo.attributes.position.needsUpdate = true;
            },
            dispose() {
                disc.geometry.dispose(); disc.material.dispose();
                pGeo.dispose(); dust.material.dispose();
                holes.splice(holes.indexOf(hole), 1);
            },
        };
        holes.push(hole);
        return hole;
    }

    function setSize(w, h) {
        rtWorld.setSize(w, h);
        rtOther.setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
    }

    // Dibuja `scene`. Si hay agujeros cerca y a la vista, hace el render en capas;
    // `other(hole)` devuelve la escena del otro lado del agujero más cercano.
    function render(scene, camera, dt, t, other) {
        shared.uTime.value = t;
        camera.updateMatrixWorld();
        projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projScreen);
        const sphere = new THREE.Sphere(new THREE.Vector3(), HOLE_R * 1.2);
        let nearest = null, nearestD = Infinity;
        const shown = [];
        for (const hole of holes) {
            if (hole.scene !== scene) continue;
            sphere.center.copy(hole.group.position);
            const d = camera.position.distanceTo(sphere.center);
            if (d > NEAR_DIST || !frustum.intersectsSphere(sphere)) continue;
            shown.push(hole);
            if (d < nearestD) { nearestD = d; nearest = hole; }
        }
        if (!shown.length) {
            renderer.render(scene, camera);
            return;
        }
        for (const hole of shown) hole.update(camera, dt, t);

        // 1. El otro lado (a media resolución: solo se ve dentro del núcleo, y deformado).
        const otherScene = other(nearest);
        const shadowAuto = renderer.shadowMap.autoUpdate;
        if (otherScene) {
            renderer.shadowMap.autoUpdate = false;
            renderer.setRenderTarget(rtOther);
            renderer.render(otherScene, camera);
            renderer.shadowMap.autoUpdate = shadowAuto;
        }
        // 2. Este lado sin los agujeros.
        renderer.setRenderTarget(rtWorld);
        renderer.render(scene, camera);
        renderer.setRenderTarget(null);
        // 3. Copia a la pantalla y los agujeros encima.
        renderer.render(copyScene, copyCam);
        const autoClear = renderer.autoClear;
        renderer.autoClear = false;
        for (const hole of shown) renderer.render(hole.group, camera);
        renderer.autoClear = autoClear;
    }

    return { makeHole, setSize, render, holes };
}

// ---------- Escena de destino: islas flotantes al atardecer ----------
// Por ahora todos los agujeros llevan a esta misma plantilla; el color del cielo cambia según
// el agujero (hue) para que cada una se sienta distinta. Más adelante cada dueño la configura.
export const DEST_RADIUS = 17;
export function buildDestination() {
    const scene = new THREE.Scene();
    const fogColor = new THREE.Color(0x5a2450);
    scene.background = fogColor.clone();
    scene.fog = new THREE.Fog(fogColor, 30, 110);
    const obstacles = [];

    const sky = new THREE.ShaderMaterial({
        side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: { uHue: { value: 0 } },
        vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: `uniform float uHue; varying vec3 vP;
            vec3 hueShift(vec3 c, float h){ const vec3 k = vec3(0.57735); float ca = cos(h); return c * ca + cross(k, c) * sin(h) + k * dot(k, c) * (1.0 - ca); }
            void main(){
                float h = vP.y;
                vec3 top = vec3(0.10, 0.03, 0.28), mid = vec3(0.95, 0.30, 0.45), low = vec3(1.4, 0.75, 0.25);
                vec3 col = mix(low, mid, smoothstep(-0.05, 0.18, h));
                col = mix(col, top, smoothstep(0.15, 0.6, h));
                float s = max(dot(vP, normalize(vec3(0.0, 0.08, -1.0))), 0.0);
                col += vec3(2.2, 1.2, 0.5) * pow(s, 220.0) * 3.0 + vec3(1.0, 0.45, 0.25) * pow(s, 8.0) * 0.6;
                gl_FragColor = vec4(max(hueShift(col, uHue), 0.0), 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    });
    const skyMesh = new THREE.Mesh(new THREE.SphereGeometry(95, 32, 16), sky);
    skyMesh.frustumCulled = false;
    scene.add(skyMesh);
    scene.add(new THREE.HemisphereLight(0xffb38a, 0x2a0a40, 1.3));
    const sun = new THREE.DirectionalLight(0xffc28a, 1.6);
    sun.position.set(0, 6, -20);
    scene.add(sun);

    const sea = new THREE.Mesh(new THREE.CircleGeometry(100, 48), new THREE.MeshStandardMaterial({ color: 0x3a1450, roughness: 0.15, metalness: 0.8 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = -6;
    scene.add(sea);

    // La isla donde se camina.
    const rock = new THREE.MeshStandardMaterial({ color: 0x5b2a6e, roughness: 0.85, flatShading: true });
    const grass = new THREE.MeshStandardMaterial({ color: 0x2fe0a0, roughness: 0.8, flatShading: true, emissive: 0x0a5040, emissiveIntensity: 0.35 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(DEST_RADIUS + 1.5, DEST_RADIUS + 0.5, 0.6, 40), grass);
    top.position.y = -0.3;
    top.receiveShadow = true;
    const under = new THREE.Mesh(new THREE.ConeGeometry(DEST_RADIUS + 0.5, 9, 40), rock);
    under.rotation.x = Math.PI;
    under.position.y = -5.1;
    const edge = new THREE.Mesh(new THREE.TorusGeometry(DEST_RADIUS + 1.5, 0.05, 8, 96), new THREE.MeshBasicMaterial({ color: 0xffb070, toneMapped: false }));
    edge.rotation.x = Math.PI / 2;
    edge.position.y = 0.01;
    scene.add(top, under, edge);

    // Cristales para orientarse (también son obstáculos).
    const crystalMat = new THREE.MeshStandardMaterial({ color: 0xffd0f0, emissive: 0xff5fb0, emissiveIntensity: 0.9, roughness: 0.2, flatShading: true });
    for (let i = 0; i < 7; i++) {
        const a = (i / 7) * Math.PI * 2 + 0.4;
        const d = 7 + (i % 3) * 3;
        const h = 1.2 + (i % 4) * 0.6;
        const c = new THREE.Mesh(new THREE.OctahedronGeometry(0.5, 0), crystalMat);
        c.scale.set(1, h, 1);
        c.position.set(Math.cos(a) * d, h * 0.5, Math.sin(a) * d);
        c.castShadow = true;
        scene.add(c);
        obstacles.push({ x: c.position.x, z: c.position.z, r: 0.7 });
    }

    // Islas que flotan a lo lejos.
    const floaters = [];
    [[-14, 6, -30, 3], [18, 9, -38, 4], [-30, 4, -12, 2.5], [28, 5, 4, 2.2], [-8, 11, 34, 3.5], [24, 7, 30, 2.8]].forEach(([x, y, z, s], i) => {
        const g = new THREE.Group();
        const r = new THREE.Mesh(new THREE.ConeGeometry(1, 1.8, 7), rock);
        r.rotation.x = Math.PI; r.position.y = -0.9;
        const t = new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1, 0.25, 7), grass);
        g.add(r, t);
        g.position.set(x, y, z);
        g.scale.setScalar(s);
        g.userData.baseY = y;
        g.userData.phase = i * 1.7;
        scene.add(g);
        floaters.push(g);
    });

    return {
        scene, obstacles,
        setHue(h) { sky.uniforms.uHue.value = h; },
        update(t) { for (const g of floaters) g.position.y = g.userData.baseY + Math.sin(t * 0.5 + g.userData.phase) * 0.4; },
    };
}

// Un tono distinto (en radianes) para cada agujero, estable para el mismo id.
export function hueFor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return ((h % 360) / 360) * Math.PI * 2;
}
