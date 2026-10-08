// Mundo 3D: carga a Ruddy (GLB) con three.js y lo mueve con joystick o teclado.
// Si models/ruddy.glb aún no existe, muestra un avatar provisional.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

const MODEL_URL = 'models/ruddy.glb';

const canvas = document.getElementById('world');
const loader = document.querySelector('[data-loader]');
const loaderText = document.querySelector('[data-loader-text]');
const modelNote = document.querySelector('[data-model-note]');

// ---------- Renderer, escena y cámara ----------
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x05060a, 10, 32);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 4.2);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.5;
controls.maxDistance = 9;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;
controls.addEventListener('start', () => { controls.autoRotate = false; });

// ---------- Luces (tema neón del portafolio) ----------
scene.add(new THREE.HemisphereLight(0xbcd4ff, 0x0a0d16, 1.1));

// La luz principal y su sombra siguen a Ruddy (ver bucle).
const KEY_OFFSET = new THREE.Vector3(3, 5, 4);
const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.copy(KEY_OFFSET);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key, key.target);

const rimCyan = new THREE.PointLight(0x00e5ff, 18, 10);
rimCyan.position.set(-2.5, 2, -2);
const rimPink = new THREE.PointLight(0xff3da6, 14, 10);
rimPink.position.set(2.5, 1.5, -2);
const rims = new THREE.Group();
rims.add(rimCyan, rimPink);
scene.add(rims);

// ---------- Piso ----------
const WORLD_RADIUS = 26;
const floor = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD_RADIUS + 4, 96),
    new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(60, 120, 0x00e5ff, 0x1a2140);
grid.material.transparent = true;
grid.material.opacity = 0.35;
grid.position.y = 0.002;
scene.add(grid);

const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.9, 0.96, 64),
    new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.7 })
);
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.005;
scene.add(ring);

// ---------- Escenario: pilares y cubos neón para orientarse ----------
const NEON = [0x00e5ff, 0xa060ff, 0xff3da6];
const pillarGeo = new THREE.BoxGeometry(0.5, 1, 0.5);
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x141a2e, roughness: 0.4, metalness: 0.5 });
const obstacles = [];

for (let i = 0; i < 18; i++) {
    const angle = (i / 18) * Math.PI * 2 + (i % 2) * 0.17;
    const dist = 7 + (i % 3) * 5.5;
    const h = 1.5 + ((i * 7) % 5) * 0.6;
    const color = NEON[i % 3];

    const pillar = new THREE.Mesh(pillarGeo, pillarMat);
    pillar.scale.y = h;
    pillar.position.set(Math.cos(angle) * dist, h / 2, Math.sin(angle) * dist);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    scene.add(pillar);

    const cap = new THREE.Mesh(
        new THREE.BoxGeometry(0.54, 0.08, 0.54),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.6 })
    );
    cap.position.set(pillar.position.x, h + 0.04, pillar.position.z);
    scene.add(cap);

    obstacles.push({ x: pillar.position.x, z: pillar.position.z, r: 0.65 });
}

const cubes = NEON.map((color, i) => {
    const cube = new THREE.Mesh(
        new THREE.BoxGeometry(0.6, 0.6, 0.6),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9, transparent: true, opacity: 0.85 })
    );
    const angle = (i / 3) * Math.PI * 2 + 0.5;
    cube.position.set(Math.cos(angle) * 4.5, 1.2, Math.sin(angle) * 4.5);
    scene.add(cube);
    return cube;
});

// ---------- Gigantografías luminosas: una por cotización ----------
// image: la og:image de la cotización (si la tiene). fallback: imagen local por si
// la externa no carga o no existe. Al hacer clic o tocar el cartel se abre url.
// El cartel se adapta a la proporción de la imagen (ancho máximo 8 m).
const BILLBOARDS = [
    {
        title: 'ROR Logístico',
        url: 'https://s-r-o-r.github.io/cotizaciones/',
        image: 'https://s-r-o-r.github.io/assets/og/og-cotizaciones.jpg',
        fallback: 'images/cotizacion-ror.jpg',
    },
    {
        title: 'Sofía Ltda.',
        url: 'https://s-s-sofia.github.io/',
        image: 'https://s-s-sofia.github.io/image/og-image.jpg?v=20261007',
        fallback: 'images/cotizacion-sofia.jpg',
    },
    {
        title: 'Medical Center',
        url: 'https://medicalcenterbo.github.io/',
        image: 'https://medicalcenterbo.github.io/assets/og-image.jpg',
        fallback: 'images/cotizacion-medical.jpg',
    },
    {
        title: 'Calistenia Bolivia',
        url: 'https://calisteniabolivia-srl.github.io/',
        image: 'https://calisteniabolivia-srl.github.io/images/og/og-home.jpg',
        fallback: 'images/cotizacion-calistenia.jpg',
    },
    {
        title: 'Arma tu cotización',
        url: '../cotizaciones/',
        fallback: 'images/cotizacion-cotizaciones.jpg',
    },
];
const clickable = [];   // imágenes de los carteles, para el clic
const BILLBOARD_RADIUS = 15;
const BILLBOARD_HEIGHT = 3.4;   // alto de la imagen, en metros
const BILLBOARD_BOTTOM = 1.6;   // altura del borde inferior
const textureLoader = new THREE.TextureLoader().setCrossOrigin('anonymous');
const poleMat = new THREE.MeshStandardMaterial({ color: 0x141a2e, roughness: 0.4, metalness: 0.6 });

function buildBillboard(texture, color) {
    const aspect = texture.image.width / texture.image.height || 16 / 9;
    let h = BILLBOARD_HEIGHT;
    let w = h * aspect;
    if (w > 8) { w = 8; h = w / aspect; }
    const centerY = BILLBOARD_BOTTOM + h / 2;
    const group = new THREE.Group();

    // Marco luminoso detrás de la imagen.
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(w + 0.3, h + 0.3, 0.12),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2.2, fog: false })
    );
    frame.position.y = centerY;
    group.add(frame);

    // La imagen no recibe luz: brilla con sus propios colores.
    const image = new THREE.Mesh(
        new THREE.PlaneGeometry(w, h),
        new THREE.MeshBasicMaterial({ map: texture, toneMapped: false, fog: false })
    );
    image.position.set(0, centerY, 0.07);
    group.add(image);
    clickable.push(image);

    for (const side of [-1, 1]) {
        const pole = new THREE.Mesh(new THREE.BoxGeometry(0.22, BILLBOARD_BOTTOM + 0.2, 0.22), poleMat);
        pole.position.set(side * (w / 2 - 0.5), (BILLBOARD_BOTTOM + 0.2) / 2, -0.12);
        pole.castShadow = true;
        group.add(pole);
    }

    // Ilumina el piso frente al cartel.
    const glow = new THREE.PointLight(color, 22, 11);
    glow.position.set(0, centerY - h / 2, 2.2);
    group.add(glow);

    return { group, width: w, image };
}

// Intenta la og:image y, si falla, usa la imagen local.
function loadBillboardTexture(item, onLoad) {
    const local = () => textureLoader.load(item.fallback, onLoad);
    if (item.image) textureLoader.load(item.image, onLoad, undefined, local);
    else local();
}

BILLBOARDS.forEach((item, i) => {
    loadBillboardTexture(item, (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        const { group, width, image } = buildBillboard(texture, NEON[i % NEON.length]);
        image.userData = { title: item.title, url: item.url };

        const angle = (i / BILLBOARDS.length) * Math.PI * 2 + Math.PI / 2;
        group.position.set(Math.cos(angle) * BILLBOARD_RADIUS, 0, Math.sin(angle) * BILLBOARD_RADIUS);
        group.lookAt(0, 0, 0);
        scene.add(group);

        // Ruddy choca con el cartel a lo largo de su ancho.
        group.updateMatrixWorld(true);
        const p = new THREE.Vector3();
        for (let x = -width / 2; x <= width / 2 + 0.01; x += 0.6) {
            group.localToWorld(p.set(x, 0, 0));
            obstacles.push({ x: p.x, z: p.z, r: 0.5 });
        }
    });
});

// Clic o toque (sin arrastrar) sobre un cartel: abre su cotización.
const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const linkHint = document.querySelector('[data-link-hint]');
let pressAt = null;

function billboardAt(e) {
    pointerNdc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
    raycaster.setFromCamera(pointerNdc, camera);
    return raycaster.intersectObjects(clickable, false)[0]?.object ?? null;
}

canvas.addEventListener('pointerdown', (e) => { pressAt = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
    if (!pressAt) return;
    const moved = Math.hypot(e.clientX - pressAt.x, e.clientY - pressAt.y);
    const quick = performance.now() - pressAt.t < 500;
    pressAt = null;
    if (moved > 8 || !quick) return;  // fue un arrastre de cámara
    const hit = billboardAt(e);
    if (hit) window.open(hit.userData.url, '_blank', 'noopener');
});
canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const hit = billboardAt(e);
    canvas.style.cursor = hit ? 'pointer' : '';
    linkHint.hidden = !hit;
    if (hit) linkHint.textContent = `Abrir cotización: ${hit.userData.title} ↗`;
});

// ---------- Ruddy ----------
// player se mueve y gira; body lleva el balanceo al caminar.
const player = new THREE.Group();
const body = new THREE.Group();
player.add(body);
scene.add(player);

let mixer = null;
let actions = null;   // { idle, walk, run, jump } si el GLB trae animaciones
let current = null;
let jumping = false;
let placeholder = null;

// precise: mide los vértices ya deformados por el esqueleto (modelos de Mixamo).
function fitToHeight(object, height) {
    object.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(object, true);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0) object.scale.multiplyScalar(height / size.y);
    object.updateMatrixWorld(true);
    box.setFromObject(object, true);
    const center = box.getCenter(new THREE.Vector3());
    object.position.x -= center.x;
    object.position.z -= center.z;
    object.position.y -= box.min.y;
}

// Avatar provisional mientras no exista el GLB de Ruddy.
function buildPlaceholder() {
    const group = new THREE.Group();
    const body = new THREE.MeshStandardMaterial({ color: 0x1b2238, roughness: 0.35, metalness: 0.6 });
    const glow = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.4 });

    const add = (geo, mat, x, y, z) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y, z);
        m.castShadow = true;
        group.add(m);
        return m;
    };

    add(new THREE.CapsuleGeometry(0.28, 0.6, 8, 24), body, 0, 1.15, 0);         // torso
    add(new THREE.SphereGeometry(0.2, 32, 32), body, 0, 1.75, 0);               // cabeza
    add(new THREE.BoxGeometry(0.26, 0.05, 0.02), glow, 0, 1.77, 0.19);          // visor
    add(new THREE.CapsuleGeometry(0.08, 0.5, 6, 16), body, -0.4, 1.12, 0);      // brazos
    add(new THREE.CapsuleGeometry(0.08, 0.5, 6, 16), body, 0.4, 1.12, 0);
    add(new THREE.CapsuleGeometry(0.1, 0.55, 6, 16), body, -0.13, 0.38, 0);     // piernas
    add(new THREE.CapsuleGeometry(0.1, 0.55, 6, 16), body, 0.13, 0.38, 0);
    add(new THREE.TorusGeometry(0.12, 0.015, 8, 32), glow, 0, 1.3, 0.27);       // núcleo

    return group;
}

function done(isPlaceholder) {
    modelNote.hidden = !isPlaceholder;
    loader.classList.add('done');
}

new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).load(
    MODEL_URL,
    (gltf) => {
        const model = gltf.scene;
        model.traverse((o) => {
            if (!o.isMesh) return;
            o.castShadow = true;
            o.receiveShadow = true;
            // El material de Mixamo viene metálico y pulido (metal 0.4, rugosidad 0.27):
            // se deja mate para que las luces no lo hagan brillar tanto.
            for (const m of [].concat(o.material)) {
                if (m.metalness !== undefined) m.metalness = 0;
                if (m.roughness !== undefined) m.roughness = 0.9;
            }
        });
        body.add(model);

        if (gltf.animations.length) {
            mixer = new THREE.AnimationMixer(model);
            const clip = (re) => gltf.animations.find((a) => re.test(a.name));
            const idle = clip(/idle/i) || gltf.animations[0];
            const walk = clip(/walk/i);
            const run = clip(/run/i);
            const jump = clip(/jump/i);
            actions = {
                idle: mixer.clipAction(idle),
                walk: walk && mixer.clipAction(walk),
                run: run && mixer.clipAction(run),
                jump: jump && mixer.clipAction(jump),
            };
            if (actions.jump) {
                actions.jump.setLoop(THREE.LoopOnce, 1);
                actions.jump.clampWhenFinished = true;
                // Running Jump de Mixamo: despega y aterriza en el mismo clip.
                mixer.addEventListener('finished', (e) => {
                    if (e.action === actions.jump) jumping = false;
                });
            }
            current = actions.idle;
            current.play();
            mixer.update(0);  // medir con la pose de idle, no con la de enlace
            jumpBtn.hidden = !actions.jump;
        }
        fitToHeight(model, 1.8);
        done(false);
    },
    (e) => {
        if (e.total) loaderText.textContent = `Cargando a Ruddy… ${Math.round((e.loaded / e.total) * 100)}%`;
    },
    () => {
        placeholder = buildPlaceholder();
        body.add(placeholder);
        done(true);
    }
);

// ---------- Controles: joystick virtual + teclado ----------
const input = { x: 0, y: 0 };      // x: derecha, y: adelante, en [-1, 1]
const stick = { x: 0, y: 0 };
const keys = new Set();

const joy = document.querySelector('[data-joystick]');
const knob = document.querySelector('[data-joystick-knob]');
let joyPointer = null;

function moveKnob(e) {
    const rect = joy.getBoundingClientRect();
    const radius = rect.width / 2;
    let dx = e.clientX - (rect.left + radius);
    let dy = e.clientY - (rect.top + radius);
    const len = Math.hypot(dx, dy);
    if (len > radius) { dx *= radius / len; dy *= radius / len; }
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
    stick.x = dx / radius;
    stick.y = -dy / radius;
}

function releaseKnob() {
    joyPointer = null;
    stick.x = stick.y = 0;
    knob.style.transform = '';
    joy.classList.remove('active');
}

joy.addEventListener('pointerdown', (e) => {
    joyPointer = e.pointerId;
    joy.setPointerCapture(e.pointerId);
    joy.classList.add('active');
    moveKnob(e);
});
joy.addEventListener('pointermove', (e) => { if (e.pointerId === joyPointer) moveKnob(e); });
joy.addEventListener('pointerup', releaseKnob);
joy.addEventListener('pointercancel', releaseKnob);

// Salto: barra espaciadora o el botón en pantalla.
const jumpBtn = document.querySelector('[data-jump]');
function jump() {
    if (!actions?.jump || jumping) return;
    jumping = true;
    actions.jump.reset();
    actions.jump.timeScale = 1;
    fadeTo(actions.jump, 0.15);
}
// En iOS un toque no genera 'click' si otro dedo ya está en pantalla (el joystick),
// así que los botones responden en pointerdown. 'click' queda solo para el teclado.
function onPress(btn, fn) {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); fn(); });
    btn.addEventListener('click', (e) => { if (e.detail === 0) fn(); });
}
onPress(jumpBtn, jump);

// Correr: Shift en teclado o el botón en pantalla (alterna caminar / correr).
const runBtn = document.querySelector('[data-run]');
let runToggle = false;
function toggleRun() {
    runToggle = !runToggle;
    runBtn.setAttribute('aria-pressed', String(runToggle));
    runBtn.textContent = runToggle ? 'Caminar' : 'Correr';
}
onPress(runBtn, toggleRun);

// Música de fondo: el navegador solo permite sonar tras un gesto del usuario.
const music = new Audio('audio/musica.mp3');
music.loop = true;
music.volume = 0.45;
const musicBtn = document.querySelector('[data-music]');
let musicOn = true;
function syncMusicBtn() {
    musicBtn.textContent = musicOn ? '🔊' : '🔇';
    musicBtn.setAttribute('aria-label', musicOn ? 'Silenciar música' : 'Activar música');
    musicBtn.setAttribute('aria-pressed', String(musicOn));
}
function startMusic() {
    if (musicOn && music.paused) music.play().catch(() => {});
}
musicBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    musicOn = !musicOn;
    if (musicOn) startMusic(); else music.pause();
    syncMusicBtn();
});
syncMusicBtn();
window.addEventListener('pointerdown', startMusic);
window.addEventListener('keydown', startMusic);
document.addEventListener('visibilitychange', () => {
    if (document.hidden) music.pause(); else startMusic();
});

const KEYMAP = {
    KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
window.addEventListener('keydown', (e) => {
    if (e.target === chatInput) return;  // escribiendo: las teclas son del mensaje
    if (e.code === 'Enter' || e.code === 'NumpadEnter') { e.preventDefault(); openChat(); return; }
    if (e.code === 'Space') { e.preventDefault(); if (!e.repeat) jump(); return; }
    // R alterna correr sin mantener Shift: muchos teclados no registran
    // Shift + flecha/WASD + Espacio a la vez y el salto se pierde.
    if (e.code === 'KeyR' && !e.repeat) { toggleRun(); return; }
    if (KEYMAP[e.code] || e.code.startsWith('Shift')) { keys.add(e.code); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => keys.delete(e.code));
window.addEventListener('blur', () => keys.clear());

function readInput() {
    let kx = 0, ky = 0;
    for (const code of keys) if (KEYMAP[code]) { kx += KEYMAP[code][0]; ky += KEYMAP[code][1]; }
    const klen = Math.hypot(kx, ky) || 1;
    input.x = stick.x || kx / klen;
    input.y = stick.y || ky / klen;
}

// ---------- Movimiento ----------
const WALK_SPEED = 2.6;
const RUN_SPEED = 5;
const RUN_CLIP_SPEED = 4.2;   // velocidad a la que la animación de correr no patina
const WALK_CLIP_SPEED = 1.7;  // ídem para caminar
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
let walkPhase = 0;
let moving = 0;  // 0..1, suaviza el balanceo
let running = false;

function updatePlayer(dt) {
    readInput();
    const amount = Math.min(1, Math.hypot(input.x, input.y));

    // Dirección relativa a la cámara, sobre el piso.
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();
    right.crossVectors(forward, UP);
    move.copy(forward).multiplyScalar(input.y).addScaledVector(right, input.x);

    if (amount > 0.05) {
        controls.autoRotate = false;
        move.normalize();
        running = runToggle || keys.has('ShiftLeft') || keys.has('ShiftRight');
        const speed = (running ? RUN_SPEED : WALK_SPEED) * amount;
        const prev = player.position.clone();
        player.position.addScaledVector(move, speed * dt);

        // Límites del mundo y choques con los pilares.
        const r = Math.hypot(player.position.x, player.position.z);
        if (r > WORLD_RADIUS) player.position.multiplyScalar(WORLD_RADIUS / r);
        for (const o of obstacles) {
            const dx = player.position.x - o.x;
            const dz = player.position.z - o.z;
            const d = Math.hypot(dx, dz);
            if (d < o.r && d > 0) {
                player.position.x = o.x + (dx / d) * o.r;
                player.position.z = o.z + (dz / d) * o.r;
            }
        }

        // Gira suave hacia donde camina.
        const targetYaw = Math.atan2(move.x, move.z);
        let diff = targetYaw - player.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        player.rotation.y += diff * Math.min(1, dt * 10);

        // La cámara acompaña a Ruddy.
        const delta = player.position.clone().sub(prev);
        camera.position.add(delta);
        controls.target.add(delta);

        walkPhase += dt * speed * 3.2;
        if (actions?.run) actions.run.timeScale = THREE.MathUtils.clamp(speed / RUN_CLIP_SPEED, 0.6, 1.3);
        if (actions?.walk) actions.walk.timeScale = THREE.MathUtils.clamp(speed / WALK_CLIP_SPEED, 0.6, 1.5);
    }

    if (actions && !jumping) {
        const gait = running ? actions.run || actions.walk : actions.walk || actions.run;
        fadeTo(amount > 0.05 && gait ? gait : actions.idle, 0.25);
    }

    moving += ((amount > 0.05 ? 1 : 0) - moving) * Math.min(1, dt * 8);

    // Con animaciones reales no hace falta simular el paso.
    if (actions) return;

    // Sin esqueleto: simula el paso con rebote, inclinación y vaivén.
    body.position.y = Math.abs(Math.sin(walkPhase)) * 0.06 * moving;
    body.rotation.x = 0.08 * moving;
    body.rotation.z = Math.sin(walkPhase) * 0.05 * moving;
}

function fadeTo(action, duration) {
    if (action === current) return;
    action.enabled = true;
    action.setEffectiveWeight(1);
    action.play();
    current.crossFadeTo(action, duration, false);
    current = action;
}

// ---------- Bucle ----------
// ---------- Mensaje sobre Ruddy ----------
const chatForm = document.querySelector('[data-chat]');
const chatInput = chatForm.querySelector('input');
const chatOpenBtn = document.querySelector('[data-chat-open]');
const bubble = document.querySelector('[data-bubble]');
const HEAD = new THREE.Vector3();
let bubbleUntil = 0;

function openChat() {
    keys.clear();  // que no siga caminando con una tecla que quedó presionada
    chatForm.hidden = false;
    chatOpenBtn.setAttribute('aria-expanded', 'true');
    chatInput.focus();
}
function closeChat() {
    chatForm.hidden = true;
    chatOpenBtn.setAttribute('aria-expanded', 'false');
    chatInput.blur();
}
chatOpenBtn.addEventListener('click', () => (chatForm.hidden ? openChat() : closeChat()));
chatInput.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeChat(); });
chatForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = chatInput.value.trim();
    chatInput.value = '';
    closeChat();
    if (!text) return;
    bubble.textContent = text;
    bubble.hidden = false;
    bubble.classList.remove('fade');
    bubbleUntil = performance.now() + Math.min(12000, 4000 + text.length * 60);
});

function updateBubble() {
    if (bubble.hidden) return;
    const now = performance.now();
    if (now > bubbleUntil) {
        if (!bubble.classList.contains('fade')) bubble.classList.add('fade');
        if (now > bubbleUntil + 300) bubble.hidden = true;
    }
    HEAD.copy(player.position);
    HEAD.y += 1.9;
    HEAD.project(camera);
    if (HEAD.z > 1) { bubble.style.visibility = 'hidden'; return; }  // detrás de la cámara
    bubble.style.visibility = '';
    const x = (HEAD.x + 1) / 2 * window.innerWidth;
    const y = (1 - HEAD.y) / 2 * window.innerHeight;
    bubble.style.transform = `translate(${x}px, ${y}px) translate(-50%, calc(-100% - 6px))`;
}

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (mixer) mixer.update(dt);
    if (placeholder) placeholder.position.y = Math.sin(t * 1.6) * 0.03;

    updatePlayer(dt);

    ring.position.x = player.position.x;
    ring.position.z = player.position.z;
    ring.material.opacity = 0.45 + Math.sin(t * 2) * 0.25;
    rims.position.copy(player.position);
    key.position.copy(player.position).add(KEY_OFFSET);
    key.target.position.copy(player.position);
    cubes.forEach((c, i) => {
        c.rotation.x = t * 0.6 + i;
        c.rotation.y = t * 0.8 + i;
        c.position.y = 1.2 + Math.sin(t * 1.5 + i * 2) * 0.25;
    });

    controls.update();
    renderer.render(scene, camera);
    updateBubble();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
