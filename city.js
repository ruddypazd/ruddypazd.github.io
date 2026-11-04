// Ciudad cyberpunk alrededor del mundo 3D: rascacielos con ventanas encendidas, letreros de
// neón, autos voladores y un cielo con el resplandor de la ciudad. El mundo queda como una
// plaza elevada en el centro; la ciudad está más abajo y afuera, donde no se camina.
//
// Pensada para el celular: todo sale de unas pocas mallas fusionadas (6 dibujos en total) y
// las ventanas, el tráfico y los parpadeos se calculan en los shaders, sin texturas grandes
// ni trabajo por cuadro en JavaScript. Sin niebla de three: cada shader pone su propia bruma.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const GROUND_Y = -24;    // la calle, bajo la plaza: desde ahí se ven los techos cercanos
const INNER = 64;        // radio libre alrededor de la plaza (el piso del mundo llega a 56)
const OUTER = 165;
const BLOCK = 15;        // manzanas de 15 m (con su calle)
const SKY_R = 240;

// Números al azar repetibles: la ciudad es la misma para todos y en cada visita.
function rng(seed) {
    let s = seed >>> 0;
    return () => {
        s = (s + 0x6d2b79f5) >>> 0;
        let t = s;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const NEON = [0x00e5ff, 0xff3da6, 0xa060ff, 0xffd400, 0x39ff9f];

// Gira el tono en el shader (para los otros universos).
const HUE_GLSL = `
    uniform float uHue;
    vec3 hueShift(vec3 c, float h){
        if (h == 0.0) return c;
        const vec3 k = vec3(0.57735);
        float a = h * 6.2831853;
        float ca = cos(a);
        return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
`;
const HASH_GLSL = `
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
`;

export function createCity() {
    const group = new THREE.Group();
    group.name = 'city';
    const uniforms = { uTime: { value: 0 }, uHue: { value: 0 } };
    const rand = rng(20261104);

    // ---------- Cielo: la bruma de la ciudad en el horizonte ----------
    const sky = new THREE.Mesh(
        new THREE.SphereGeometry(SKY_R, 32, 16),
        new THREE.ShaderMaterial({
            uniforms,
            side: THREE.BackSide, depthWrite: false, fog: false,
            vertexShader: `varying vec3 vDir;
                void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `varying vec3 vDir; ${HUE_GLSL}
                void main(){
                    float y = vDir.y;
                    vec3 top = vec3(0.012, 0.012, 0.035);
                    vec3 mid = vec3(0.10, 0.025, 0.16);
                    vec3 low = vec3(0.55, 0.10, 0.38);
                    float h = max(y + 0.06, 0.0);
                    vec3 c = mix(low, mid, smoothstep(0.0, 0.12, h));
                    c = mix(c, top, smoothstep(0.1, 0.55, h));
                    // Un poco de cian por un lado, para que no sea todo rosado.
                    float side = 0.5 + 0.5 * vDir.x;
                    c += vec3(0.0, 0.10, 0.14) * side * (1.0 - smoothstep(0.0, 0.25, h));
                    gl_FragColor = vec4(hueShift(c, uHue), 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        })
    );
    sky.renderOrder = -10;
    sky.frustumCulled = false;
    group.add(sky);

    // ---------- Calles: el piso de la ciudad con las avenidas iluminadas ----------
    const ground = new THREE.Mesh(
        new THREE.RingGeometry(40, OUTER + 40, 96, 1),
        new THREE.ShaderMaterial({
            uniforms, fog: false,
            vertexShader: `varying vec3 vPos;
                void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vPos = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
            fragmentShader: `varying vec3 vPos; ${HUE_GLSL} ${HASH_GLSL}
                uniform float uTime;
                void main(){
                    vec2 p = vPos.xz / ${BLOCK.toFixed(1)};
                    vec2 f = abs(fract(p) - 0.5);
                    float street = smoothstep(0.42, 0.47, max(f.x, f.y));
                    vec2 cell = floor(p + 0.5);
                    vec3 col = mix(vec3(1.0, 0.45, 0.15), vec3(0.0, 0.9, 1.0), step(0.5, hash(cell)));
                    // Luces que corren por las avenidas.
                    float along = f.x > f.y ? vPos.z : vPos.x;
                    float run = 0.6 + 0.4 * sin(along * 0.8 - uTime * 6.0 + hash(cell) * 30.0);
                    vec3 c = vec3(0.01, 0.01, 0.025) + col * street * run * 0.9;
                    float d = length(vPos.xz);
                    c *= 1.0 - smoothstep(110.0, ${(OUTER + 30).toFixed(1)}, d);
                    gl_FragColor = vec4(hueShift(c, uHue), 1.0);
                    #include <tonemapping_fragment>
                    #include <colorspace_fragment>
                }`,
        })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = GROUND_Y;
    group.add(ground);

    // ---------- Edificios: cajas fusionadas, las ventanas las pinta el shader ----------
    const boxes = [];
    const tops = [];        // techos de los edificios altos: antenas y letreros
    const half = Math.ceil(OUTER / BLOCK);
    for (let gx = -half; gx <= half; gx++) {
        for (let gz = -half; gz <= half; gz++) {
            const cx = gx * BLOCK, cz = gz * BLOCK;
            const d = Math.hypot(cx, cz);
            if (d < INNER + BLOCK * 0.5 || d > OUTER) continue;
            // Más altos lejos de la plaza, con algunas torres enormes.
            const k = (d - INNER) / (OUTER - INNER);
            const lots = rand() < 0.35 ? 1 : rand() < 0.6 ? 2 : 4;
            const span = BLOCK - 3.5;     // lo que deja la calle
            for (let i = 0; i < lots; i++) {
                const n = lots === 4 ? 2 : lots;
                const ix = lots === 1 ? 0 : i % 2, iz = lots === 4 ? Math.floor(i / 2) : 0;
                const w = (lots === 1 ? span : span / 2 - 0.6) * (0.75 + rand() * 0.25);
                const dd = (lots === 4 ? span / 2 - 0.6 : span) * (0.75 + rand() * 0.25);
                const ox = lots === 1 ? 0 : (ix - 0.5) * (span / 2);
                const oz = lots === 4 ? (iz - 0.5) * (span / 2) : 0;
                const x = cx + (n === 1 ? 0 : ox), z = cz + oz;
                if (Math.hypot(x, z) < INNER) continue;
                let h = 6 + rand() * 14 + k * 55 + Math.pow(rand(), 3) * 25;
                if (rand() < 0.06) h += 45 + rand() * 35;   // megatorres
                const color = NEON[Math.floor(rand() * NEON.length)];
                boxes.push({ x, z, w, d: dd, h, color, seed: rand() });
                // Pisos escalonados en las torres: una caja más angosta encima.
                if (h > 45 && rand() < 0.6) {
                    const h2 = 8 + rand() * 20;
                    boxes.push({ x, z, w: w * 0.62, d: dd * 0.62, h: h2, base: h, color, seed: rand() });
                    h += h2;
                }
                tops.push({ x, z, w, d: dd, h, color });
            }
        }
    }

    const geos = boxes.map((b) => {
        const g = new THREE.BoxGeometry(b.w, b.h, b.d);
        g.deleteAttribute('uv');
        g.translate(b.x, GROUND_Y + (b.base || 0) + b.h / 2, b.z);
        const n = g.attributes.position.count;
        const c = new THREE.Color(b.color);
        const info = new Float32Array(n * 4);      // color de neón + semilla
        for (let i = 0; i < n; i++) info.set([c.r, c.g, c.b, b.seed], i * 4);
        g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
        const top = new Float32Array(n).fill(GROUND_Y + (b.base || 0) + b.h);
        g.setAttribute('aTop', new THREE.BufferAttribute(top, 1));
        return g;
    });
    const buildings = new THREE.Mesh(mergeGeometries(geos), new THREE.ShaderMaterial({
        uniforms, fog: false,
        vertexShader: `attribute vec4 aInfo; attribute float aTop;
            varying vec3 vPos; varying vec3 vNormal; varying vec4 vInfo; varying float vTop;
            void main(){
                vec4 w = modelMatrix * vec4(position, 1.0);
                vPos = w.xyz; vNormal = normal; vInfo = aInfo; vTop = aTop;
                gl_Position = projectionMatrix * viewMatrix * w;
            }`,
        fragmentShader: `varying vec3 vPos; varying vec3 vNormal; varying vec4 vInfo; varying float vTop;
            uniform float uTime; ${HUE_GLSL} ${HASH_GLSL}
            void main(){
                vec3 n = normalize(vNormal);
                vec3 neon = vInfo.rgb;
                float seed = vInfo.a;
                // Fachada oscura con un poco de luz de la calle desde abajo.
                vec3 base = vec3(0.012, 0.014, 0.03) + vec3(0.02, 0.006, 0.035) * (0.5 + 0.5 * n.x);
                vec3 c = base;
                if (abs(n.y) < 0.5) {
                    // Ventanas: una grilla sobre la fachada (los edificios están alineados a los ejes).
                    float u = abs(n.x) > 0.5 ? vPos.z : vPos.x;
                    vec2 g = vec2(u / 1.6, vPos.y / 1.25);
                    vec2 cell = floor(g);
                    vec2 f = fract(g);
                    float win = step(0.18, f.x) * step(f.x, 0.82) * step(0.25, f.y) * step(f.y, 0.8);
                    // De lejos las ventanas son más chicas que un píxel: se promedian (sin rayas).
                    vec2 fw = fwidth(g);
                    win = mix(win, 0.36, clamp(max(fw.x, fw.y) * 2.0 - 0.6, 0.0, 1.0));
                    float r = hash(cell + seed * 97.0 + n.xz * 13.0);
                    float on = step(0.66 - seed * 0.2, r);
                    // Algunas ventanas cambian de vez en cuando.
                    on *= step(0.04, fract(r * 13.0 + floor(uTime * 0.25 + r * 40.0) * 0.37));
                    vec3 wc = r > 0.93 ? neon : (r > 0.8 ? vec3(0.55, 0.85, 1.0) : vec3(1.0, 0.72, 0.42));
                    c += wc * win * on * (0.35 + 0.5 * fract(r * 7.0));
                    // Franjas de neón horizontales en algunos edificios.
                    float stripe = step(0.6, seed) * smoothstep(0.43, 0.48, abs(fract(vPos.y / 9.0 + seed) - 0.5));
                    c += neon * stripe * 1.6;
                    // Corona de neón arriba de todo.
                    c += neon * (1.0 - smoothstep(0.0, 0.9, vTop - vPos.y)) * 2.2;
                } else if (n.y > 0.5) {
                    c = vec3(0.02, 0.02, 0.04) + neon * 0.05;
                }
                // Bruma: lo lejano se funde con el resplandor del horizonte.
                float dist = length(vPos - cameraPosition);
                float haze = 1.0 - exp(-dist * 0.004);
                vec3 hazeCol = vec3(0.07, 0.015, 0.09);
                c = mix(c, hazeCol + c * 0.35, haze);
                // Y la parte baja se pierde en la niebla de la calle.
                c = mix(c, vec3(0.12, 0.03, 0.12), (1.0 - smoothstep(${GROUND_Y.toFixed(1)}, ${(GROUND_Y + 14).toFixed(1)}, vPos.y)) * 0.55);
                gl_FragColor = vec4(hueShift(c, uHue), 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    }));
    buildings.matrixAutoUpdate = false;
    group.add(buildings);

    // ---------- Letreros de neón (texto en una sola textura) ----------
    const WORDS = ['NEÓN', 'HOTEL', 'BAR', '24H', 'CLUB', 'CAFÉ', 'RAMEN', 'RUDDY', 'CYBER', 'DATA', 'SUSHI', 'MOTEL', 'NOODLE', 'ARCADE', 'BOT', 'PIXEL'];
    const CELL_W = 256, CELL_H = 64, COLS = 4;
    const atlas = document.createElement('canvas');
    atlas.width = CELL_W * COLS;
    atlas.height = CELL_H * Math.ceil(WORDS.length / COLS);
    const ctx = atlas.getContext('2d');
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, atlas.width, atlas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    WORDS.forEach((word, i) => {
        const x = (i % COLS) * CELL_W + CELL_W / 2, y = Math.floor(i / COLS) * CELL_H + CELL_H / 2;
        ctx.font = `bold ${word.length > 5 ? 40 : 48}px "Arial Black", Arial, sans-serif`;
        ctx.strokeStyle = 'rgba(255,255,255,0.45)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x - CELL_W / 2 + 6, y - CELL_H / 2 + 6, CELL_W - 12, CELL_H - 12);
        ctx.fillStyle = '#fff';
        ctx.fillText(word, x, y + 2);
    });
    const atlasTex = new THREE.CanvasTexture(atlas);
    atlasTex.anisotropy = 4;

    const signGeos = [];
    const rows = Math.ceil(WORDS.length / COLS);
    const signHosts = tops.filter((t) => t.h > 16).sort(() => rand() - 0.5).slice(0, 110);
    for (const t of signHosts) {
        const wi = Math.floor(rand() * WORDS.length);
        const vertical = rand() < 0.45;
        const sw = vertical ? 6 + rand() * 3 : Math.min(Math.max(t.w, t.d) * 0.95, 14);
        const sh = sw / 4;
        const g = new THREE.PlaneGeometry(sw, sh);
        // UV de la palabra en el atlas.
        const u0 = (wi % COLS) / COLS, v0 = 1 - (Math.floor(wi / COLS) + 1) / rows;
        const uv = g.attributes.uv;
        for (let i = 0; i < uv.count; i++) uv.setXY(i, u0 + uv.getX(i) / COLS, v0 + uv.getY(i) / rows);
        if (vertical) g.rotateZ(-Math.PI / 2);
        // En la cara del edificio que mira a la plaza, un poco despegado.
        const toCenter = Math.abs(t.x) > Math.abs(t.z) ? [-Math.sign(t.x), 0] : [0, -Math.sign(t.z)];
        const ry = Math.atan2(toCenter[0], toCenter[1]);
        g.rotateY(ry);
        const off = (toCenter[0] ? t.w : t.d) / 2 + 0.25;
        const y = GROUND_Y + t.h * (vertical ? 0.55 + rand() * 0.25 : 0.82 + rand() * 0.1);
        g.translate(t.x + toCenter[0] * off, y, t.z + toCenter[1] * off);
        const c = new THREE.Color(NEON[Math.floor(rand() * NEON.length)]);
        const n = g.attributes.position.count;
        const info = new Float32Array(n * 4);
        for (let i = 0; i < n; i++) info.set([c.r, c.g, c.b, rand()], i * 4);
        g.setAttribute('aInfo', new THREE.BufferAttribute(info, 4));
        g.deleteAttribute('normal');
        signGeos.push(g);
    }
    const signs = new THREE.Mesh(mergeGeometries(signGeos), new THREE.ShaderMaterial({
        uniforms: { ...uniforms, tAtlas: { value: atlasTex } },
        fog: false, side: THREE.DoubleSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute vec4 aInfo; varying vec2 vUv; varying vec4 vInfo; varying float vDist;
            void main(){
                vUv = uv; vInfo = aInfo;
                vec4 w = modelMatrix * vec4(position, 1.0);
                vDist = length(w.xyz - cameraPosition);
                gl_Position = projectionMatrix * viewMatrix * w;
            }`,
        fragmentShader: `uniform sampler2D tAtlas; uniform float uTime; varying vec2 vUv; varying vec4 vInfo; varying float vDist;
            ${HUE_GLSL}
            void main(){
                float a = texture2D(tAtlas, vUv).r;
                // Parpadeo de tubo viejo, distinto en cada letrero.
                float s = vInfo.a;
                float flick = step(0.12, fract(sin(floor(uTime * 9.0 + s * 50.0) * 12.9898 + s) * 43758.5)) * 0.85 + 0.15;
                flick = mix(1.0, flick, step(0.75, s));
                vec3 c = vInfo.rgb * (a * 2.2 + 0.12) * flick;
                c *= 1.0 - (1.0 - exp(-vDist * 0.006)) * 0.6;
                gl_FragColor = vec4(hueShift(c, uHue), 1.0);
                #include <tonemapping_fragment>
                #include <colorspace_fragment>
            }`,
    }));
    signs.matrixAutoUpdate = false;
    group.add(signs);

    // ---------- Luces: autos voladores (en el shader) y balizas de las antenas ----------
    // Cada punto es un auto: su carril (radio, altura, velocidad, fase) va en atributos y el
    // vertex shader lo mueve con el tiempo. Los que van en un sentido son blancos, los otros rojos.
    const CARS = 260;
    const lane = new Float32Array(CARS * 4);
    const kind = new Float32Array(CARS);
    for (let i = 0; i < CARS; i++) {
        const dir = rand() < 0.5 ? 1 : -1;
        const r = 66 + rand() * 80;
        lane.set([r, 4 + rand() * 40, dir * (8 + rand() * 10) / r, rand() * Math.PI * 2], i * 4);
        kind[i] = dir > 0 ? 0 : 1;
    }
    // Balizas rojas arriba de las torres más altas.
    const beacons = tops.filter((t) => t.h > 50);
    const total = CARS + beacons.length;
    const laneAll = new Float32Array(total * 4);
    const kindAll = new Float32Array(total);
    laneAll.set(lane);
    kindAll.set(kind);
    beacons.forEach((t, i) => {
        laneAll.set([t.x, GROUND_Y + t.h + 2.5, t.z, rand() * 6.28], (CARS + i) * 4);
        kindAll[CARS + i] = 2;
    });
    const lightGeo = new THREE.BufferGeometry();
    lightGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(total * 3), 3));
    lightGeo.setAttribute('aLane', new THREE.BufferAttribute(laneAll, 4));
    lightGeo.setAttribute('aKind', new THREE.BufferAttribute(kindAll, 1));
    const lights = new THREE.Points(lightGeo, new THREE.ShaderMaterial({
        uniforms: { ...uniforms, uScale: { value: 1 } },
        fog: false, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        vertexShader: `attribute vec4 aLane; attribute float aKind; uniform float uTime; uniform float uScale;
            varying vec3 vCol; varying float vAlpha;
            void main(){
                vec3 p;
                if (aKind < 1.5) {
                    float a = aLane.w + uTime * aLane.z;
                    p = vec3(cos(a) * aLane.x, aLane.y, sin(a) * aLane.x);
                    vCol = aKind < 0.5 ? vec3(1.0, 0.95, 0.85) : vec3(1.0, 0.2, 0.25);
                    vAlpha = 1.0;
                } else {
                    p = aLane.xyz;
                    vCol = vec3(1.0, 0.1, 0.1);
                    vAlpha = step(0.6, fract(uTime * 0.7 + aLane.w));
                }
                vec4 mv = viewMatrix * vec4(p, 1.0);
                gl_PointSize = clamp(uScale * 70.0 / -mv.z, 1.5, 9.0);
                gl_Position = projectionMatrix * mv;
            }`,
        fragmentShader: `varying vec3 vCol; varying float vAlpha;
            void main(){
                float d = length(gl_PointCoord - 0.5);
                float a = (1.0 - smoothstep(0.0, 0.5, d)) * vAlpha;
                if (a < 0.01) discard;
                gl_FragColor = vec4(vCol * a * 1.6, a);
            }`,
    }));
    lights.frustumCulled = false;
    group.add(lights);

    // ---------- Baranda de neón en el borde de la plaza ----------
    const rail = new THREE.Mesh(
        new THREE.TorusGeometry(56, 0.06, 6, 160),
        new THREE.MeshBasicMaterial({ color: 0x00e5ff, fog: false, toneMapped: false })
    );
    rail.rotation.x = Math.PI / 2;
    rail.position.y = 0.9;
    const railLow = rail.clone();
    railLow.material = new THREE.MeshBasicMaterial({ color: 0xff3da6, fog: false, toneMapped: false });
    railLow.position.y = 0.05;
    // Borde de la plaza visto desde afuera: un anillo oscuro que baja hasta la calle.
    const edge = new THREE.Mesh(
        new THREE.CylinderGeometry(56, 54, -GROUND_Y, 96, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x07080f, fog: false, side: THREE.DoubleSide })
    );
    edge.position.y = GROUND_Y / 2;
    group.add(rail, railLow, edge);
    const railMats = [rail.material, railLow.material];
    const railBase = railMats.map((m) => m.color.clone());

    return {
        group,
        // Escala de los puntos según el alto de la pantalla (en píxeles reales).
        setPixelHeight(px) { lights.material.uniforms.uScale.value = px / 900; },
        setHue(h) {
            uniforms.uHue.value = h;
            railMats.forEach((m, i) => m.color.copy(railBase[i]).offsetHSL(h, 0, 0));
        },
        update(t) { uniforms.uTime.value = t; },
    };
}
