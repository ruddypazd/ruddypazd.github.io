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

// ---------- Escena de destino: el mismo mapa, en otro universo ----------
// Cada puente lleva a una copia del mundo principal (piso, pilares, galería, video, tótem)
// con otra paleta y un cielo de estrellas. El tono sale del id del puente, así que el mismo
// puente siempre lleva al mismo universo. Las copias comparten geometrías y texturas.
// parts: lo que se copia del mundo principal. Devuelve también copies (original -> copia).
export function buildUniverse(parts, obstacles) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color();
    scene.fog = new THREE.Fog(scene.background, 14, 70);
    const tinted = [];      // colores que cambian con el universo: { color, base }
    const vertexTinted = [];
    const copies = new Map();
    const matCopies = new Map();
    const keepTint = (color) => { if (color) tinted.push({ color, base: color.clone() }); };

    function copyMaterial(m) {
        if (matCopies.has(m)) return matCopies.get(m);
        const c = m.clone();
        // Lo que tiene imagen (cuadros, póster, pantalla del tótem) queda igual.
        if (!c.map) { keepTint(c.color); keepTint(c.emissive); }
        matCopies.set(m, c);
        return c;
    }

    for (const part of parts) {
        const copy = part.clone(true);
        const src = [];
        part.traverse((o) => src.push(o));
        let i = 0;
        copy.traverse((o) => {
            copies.set(src[i++], o);
            if (o.isLight) { keepTint(o.color); keepTint(o.groundColor); }
            if (!o.material) return;
            o.material = Array.isArray(o.material) ? o.material.map(copyMaterial) : copyMaterial(o.material);
            const col = o.geometry?.attributes.color;
            if (o.material.vertexColors && col) {
                // La grilla: sus líneas tienen color por vértice.
                o.geometry = o.geometry.clone();
                vertexTinted.push({ attr: o.geometry.attributes.color, base: Float32Array.from(o.geometry.attributes.color.array) });
            }
        });
        scene.add(copy);
    }

    // Estrellas, para que se note que es otro cielo.
    const STARS = 900;
    const pos = new Float32Array(STARS * 3);
    for (let i = 0; i < STARS; i++) {
        const y = Math.random() * 0.95 + 0.05;
        const a = Math.random() * Math.PI * 2;
        const r = Math.sqrt(1 - y * y);
        pos.set([Math.cos(a) * r * 90, y * 90, Math.sin(a) * r * 90], i * 3);
    }
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, fog: false, transparent: true, depthWrite: false });
    const stars = new THREE.Points(starGeo, starMat);
    stars.frustumCulled = false;
    scene.add(stars);

    const tmp = new THREE.Color();
    let current = null;
    return {
        scene, copies,
        obstacles: obstacles.map((o) => ({ ...o })),
        // hue: vueltas de color (0..1) respecto del mundo principal.
        setHue(hue) {
            if (hue === current) return;
            current = hue;
            for (const t of tinted) t.color.copy(t.base).offsetHSL(hue, 0, 0);
            for (const v of vertexTinted) {
                const a = v.attr.array;
                for (let i = 0; i < a.length; i += 3) {
                    tmp.setRGB(v.base[i], v.base[i + 1], v.base[i + 2]).offsetHSL(hue, 0, 0);
                    a[i] = tmp.r; a[i + 1] = tmp.g; a[i + 2] = tmp.b;
                }
                v.attr.needsUpdate = true;
            }
            scene.background.setHSL(hue + 0.62, 0.7, 0.008);
            scene.fog.color.copy(scene.background);
            starMat.color.setHSL(hue + 0.5, 0.6, 0.85);
        },
        update(t) { starMat.opacity = 0.75 + Math.sin(t * 0.7) * 0.15; },
    };
}

// Un tono distinto para cada puente (en vueltas de color), estable para el mismo id. Nunca
// cae cerca de 0, que sería igual al mundo principal.
export function hueFor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return 0.15 + ((h % 1000) / 1000) * 0.7;
}
