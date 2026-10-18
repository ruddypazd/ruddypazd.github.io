// Mundo 3D: carga a Ruddy (GLB) con three.js y lo mueve con joystick o teclado.
// Si models/ruddy.glb aún no existe, muestra un avatar provisional.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const MODEL_URL = 'models/ruddy.glb';

const canvas = document.getElementById('world');
const loader = document.querySelector('[data-loader]');
const loaderText = document.querySelector('[data-loader-text]');
const modelNote = document.querySelector('[data-model-note]');

// ---------- Renderer, escena y cámara ----------
// alpha: el letrero de video abre un hueco transparente para ver el iframe que está detrás.
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x05060a);
scene.fog = new THREE.Fog(0x05060a, 14, 70);

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.6, 4.2);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.5;
controls.maxDistance = 14;
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
const WORLD_RADIUS = 52;   // amplio, con espacio libre entre letreros para sumar más cosas
const floor = new THREE.Mesh(
    new THREE.CircleGeometry(WORLD_RADIUS + 4, 96),
    new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper((WORLD_RADIUS + 4) * 2, (WORLD_RADIUS + 4) * 4, 0x00e5ff, 0x1a2140);
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

const clickable = [];   // cuadros, póster del video y tótem, para el clic
const poleMat = new THREE.MeshStandardMaterial({ color: 0x141a2e, roughness: 0.4, metalness: 0.6 });

// ---------- Galería estilo museo: cotizaciones y sistemas como cuadros, con su ficha ----------
// Todos en una misma pared al fondo. Cada cuadro abre su página al tocarlo.
// image: og:image del sitio (si la tiene); fallback: imagen local si la externa no carga.
const GALLERY = [
    {
        title: 'ROR Logístico',
        subtitle: 'Cotización',
        text: 'Propuesta y cotización de los sistemas de R.O.R Logístico: torre de control, operaciones y seguimiento de envíos.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://s-r-o-r.github.io/cotizaciones/',
        image: 'https://s-r-o-r.github.io/assets/og/og-cotizaciones.jpg',
        fallback: 'images/cotizacion-ror.jpg',
        colors: ['#06262e', '#0b5363'],
    },
    {
        title: 'Sofía Ltda.',
        subtitle: 'Cotización',
        text: 'Propuesta y cotización del sistema para Sofía Ltda.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://s-s-sofia.github.io/',
        image: 'https://s-s-sofia.github.io/image/og-image.jpg?v=20261007',
        fallback: 'images/cotizacion-sofia.jpg',
        colors: ['#24123d', '#5a2d91'],
    },
    {
        title: 'Medical Center',
        subtitle: 'Cotización',
        text: 'Portal de autogestión de la Clínica Medical Center: citas, pagos QR, resultados y atención por WhatsApp.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://medicalcenterbo.github.io/',
        image: 'https://medicalcenterbo.github.io/assets/og-image.jpg',
        fallback: 'images/cotizacion-medical.jpg',
        colors: ['#0b2e22', '#1d6b4f'],
    },
    {
        title: 'Calistenia Bolivia',
        subtitle: 'Cotización',
        text: 'Propuesta y cotización del sitio y sistema de Calistenia Bolivia SRL.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://calisteniabolivia-srl.github.io/',
        image: 'https://calisteniabolivia-srl.github.io/images/og/og-home.jpg',
        fallback: 'images/cotizacion-calistenia.jpg',
        colors: ['#3a1206', '#8a3412'],
    },
    {
        title: 'Condominio Santa María',
        subtitle: 'Portal de copropietarios',
        text: 'Portal de la comunidad del Condominio Santa María 1 en Santa Cruz: planos, censo, finanzas, reuniones y solicitudes.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://condominio-santa-maria.github.io',
        image: 'https://condominio-santa-maria.github.io/images/og-image.png',
        colors: ['#0f3d3a', '#1f6f5c'],
    },
    {
        title: 'iFacturación',
        subtitle: 'Facturación electrónica',
        text: 'Sistema de facturación electrónica en línea de iBrokers: emisión de facturas, registro y gestión de cuentas.',
        devs: 'Roy Ruddy Paz · Strasol SRL',
        url: 'https://facturacion.ibrokers.cloud',
        colors: ['#10264f', '#2f5fb3'],
    },
    {
        title: 'SERP',
        subtitle: 'ERP empresarial',
        text: 'Sistema de planificación de recursos empresariales de Servisofts: ventas, inventario, finanzas y operación en un solo lugar.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://serp.servisofts.com',
        colors: ['#3a0f2e', '#a3246f'],
    },
    {
        title: 'R.O.R Control Tower',
        subtitle: 'Torre de control logística',
        text: 'Torre de control de R.O.R Logístico para seguir envíos, operaciones y estados en tiempo real.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://ct.rorlogistico.com',
        colors: ['#3d2a0a', '#c27a12'],
    },
    {
        title: 'iCompany',
        subtitle: 'ERP para broker de seguros',
        text: 'Sistema ERP para el broker de seguros del Banco Mercantil.',
        devs: 'Roy Ruddy Paz · Strasol SRL',
        url: 'https://icompany.segurosmsc.com',
        colors: ['#06321f', '#0f7a45'],
    },
    {
        title: 'UpLabs AI',
        subtitle: 'CRM con IA',
        text: 'CRM completo y multitenant con agentes de IA para llamadas y WhatsApp.',
        devs: 'Roy Ruddy Paz · UpLabs AI',
        url: 'https://app.uplabsai.com',
        colors: ['#0b1440', '#5b2bd6'],
    },
    {
        title: 'App Kolping',
        subtitle: 'Gestión empresarial',
        text: 'Sistema de gestión empresarial de Kolping.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://kolping.servisofts.com',
        colors: ['#2a0b0b', '#8f1f1f'],
    },
    {
        title: 'Staff Pro USA',
        subtitle: 'Sistema web',
        text: 'Sistema web de Staff Pro USA.',
        devs: 'Roy Ruddy Paz · Servisofts',
        url: 'https://staffprousa.servisofts.com/',
        colors: ['#0a1e3a', '#b0242f'],
    },
];
const PAINT_W = 5.6, PAINT_H = 3.15, PAINT_GAP = 1.2, PAINT_BOTTOM = 2.5;
const galleryWidth = GALLERY.length * PAINT_W + (GALLERY.length - 1) * PAINT_GAP;
// La pared mira al centro del mundo. Cuantos más cuadros, más ancha: se acerca al
// centro lo justo para que sus extremos sigan dentro del mundo.
const GALLERY_Z = Math.min(40, Math.sqrt((WORLD_RADIUS - 1) ** 2 - (galleryWidth / 2 + 2) ** 2));
const gallery = new THREE.Group();
gallery.position.set(0, 0, GALLERY_Z);
gallery.rotation.y = Math.PI;       // los cuadros miran hacia -z
scene.add(gallery);
{
    const wall = new THREE.Mesh(
        new THREE.BoxGeometry(galleryWidth + 4, 7.5, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x1c1a24, roughness: 0.9 })
    );
    wall.position.set(0, 3.75, -0.3);
    wall.receiveShadow = true;
    gallery.add(wall);
    const sign = makeLabelTexture(1024, 128, (c, w, h) => {
        c.fillStyle = '#e9dcc0'; c.textAlign = 'center'; c.textBaseline = 'middle';
        c.font = '600 64px "Space Grotesk", serif';
        c.fillText('GALERÍA DE PROYECTOS', w / 2, h / 2);
    });
    const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(8, 1), new THREE.MeshBasicMaterial({ map: sign, transparent: true, toneMapped: false }));
    signMesh.position.set(0, 6.6, -0.09);
    gallery.add(signMesh);
    gallery.updateMatrixWorld(true);
    const p = new THREE.Vector3();
    for (let x = -galleryWidth / 2 - 2; x <= galleryWidth / 2 + 2.01; x += 0.6) {
        gallery.localToWorld(p.set(x, 0, -0.3));
        obstacles.push({ x: p.x, z: p.z, r: 0.6 });
    }
}

function makeLabelTexture(w, h, draw) {
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    draw(cv.getContext('2d'), w, h);
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    return tex;
}

function wrapText(c, text, x, y, maxW, lineH) {
    let line = '';
    for (const word of text.split(' ')) {
        const test = line ? `${line} ${word}` : word;
        if (c.measureText(test).width > maxW && line) { c.fillText(line, x, y); line = word; y += lineH; }
        else line = test;
    }
    if (line) c.fillText(line, x, y);
}

// Lienzo del cuadro: degradado con el nombre del sistema; si hay imagen, va encima.
function drawPainting(c, w, h, item, img) {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, item.colors[0]); g.addColorStop(1, item.colors[1]);
    c.fillStyle = g; c.fillRect(0, 0, w, h);
    if (img) {
        const s = Math.min(w / img.width, h / img.height);
        c.drawImage(img, (w - img.width * s) / 2, (h - img.height * s) / 2, img.width * s, img.height * s);
        return;
    }
    // Trazos abstractos, como pinceladas.
    c.globalAlpha = 0.18;
    for (let i = 0; i < 9; i++) {
        c.beginPath();
        c.arc(w * ((i * 37) % 100) / 100, h * ((i * 61) % 100) / 100, 60 + (i * 47) % 160, 0, Math.PI * 2);
        c.fillStyle = i % 2 ? '#ffffff' : '#000000'; c.fill();
    }
    c.globalAlpha = 1;
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = 'bold 120px "Space Grotesk", sans-serif';
    c.fillText(item.title, w / 2, h / 2 - 40, w - 120);
    c.font = '44px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(255,255,255,.85)';
    c.fillText(item.subtitle, w / 2, h / 2 + 70, w - 120);
}

const frameMat = new THREE.MeshStandardMaterial({ color: 0xc9a24a, metalness: 0.85, roughness: 0.35 });
const matMat = new THREE.MeshStandardMaterial({ color: 0xf1ead8, roughness: 0.95 });
GALLERY.forEach((item, i) => {
    const x = -galleryWidth / 2 + PAINT_W / 2 + i * (PAINT_W + PAINT_GAP);
    const cy = PAINT_BOTTOM + PAINT_H / 2;
    const piece = new THREE.Group();
    piece.position.x = x;
    gallery.add(piece);

    // Marco dorado y paspartú.
    const frame = new THREE.Mesh(new THREE.BoxGeometry(PAINT_W + 0.9, PAINT_H + 0.9, 0.16), frameMat);
    frame.position.set(0, cy, 0);
    frame.castShadow = true;
    const mat = new THREE.Mesh(new THREE.PlaneGeometry(PAINT_W + 0.5, PAINT_H + 0.5), matMat);
    mat.position.set(0, cy, 0.085);
    piece.add(frame, mat);

    const tex = makeLabelTexture(1280, 720, (c, w, h) => drawPainting(c, w, h, item));
    const canvasMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(PAINT_W, PAINT_H),
        new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
    );
    canvasMesh.position.set(0, cy, 0.09);
    canvasMesh.userData = { title: item.title, url: item.url, hint: `Visitar ${item.title} ↗` };
    piece.add(canvasMesh);
    clickable.push(canvasMesh);
    const sources = [item.image, item.fallback].filter(Boolean);
    const loadNext = () => {
        if (!sources.length) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => { drawPainting(tex.image.getContext('2d'), 1280, 720, item, img); tex.needsUpdate = true; };
        img.onerror = loadNext;
        img.src = sources.shift();
    };
    loadNext();

    // Ficha del museo, abajo del cuadro.
    const plaque = makeLabelTexture(900, 360, (c, w, h) => {
        c.fillStyle = '#efe6cf'; c.fillRect(0, 0, w, h);
        c.strokeStyle = '#b08d3e'; c.lineWidth = 6; c.strokeRect(10, 10, w - 20, h - 20);
        c.fillStyle = '#1c1a24'; c.textAlign = 'left';
        c.font = 'bold 50px "Space Grotesk", serif'; c.fillText(item.title, 44, 82);
        c.font = 'italic 30px Georgia, serif'; c.fillStyle = '#5a4a2a'; c.fillText(item.subtitle, 44, 126);
        c.font = '27px Georgia, serif'; c.fillStyle = '#2a2630';
        wrapText(c, item.text, 44, 176, w - 88, 36);
        c.font = 'bold 26px "JetBrains Mono", monospace'; c.fillStyle = '#7a5a12';
        c.fillText(`Desarrollo: ${item.devs}`, 44, h - 40);
    });
    const plaqueMesh = new THREE.Mesh(
        new THREE.PlaneGeometry(3.4, 1.36),
        new THREE.MeshStandardMaterial({ map: plaque, roughness: 0.7 })
    );
    plaqueMesh.position.set(0, 1.15, 0.02);
    piece.add(plaqueMesh);

    // Foco de museo sobre el cuadro y la ficha.
    const spot = new THREE.SpotLight(0xfff1d6, 60, 12, Math.PI / 5, 0.5, 1.2);
    spot.position.set(0, PAINT_BOTTOM + PAINT_H + 1.8, 2.4);
    spot.target.position.set(0, cy - 0.8, 0);
    piece.add(spot, spot.target);
});

// ---------- Letrero de video (YouTube) a lo lejos: su audio es la música de fondo ----------
// Un iframe no puede ser textura de WebGL. Se dibuja con CSS3DRenderer detrás del canvas y
// un plano "agujero" en la escena deja ver el video, así Ruddy y los pilares lo tapan bien.
const VIDEO_ID = '22y0yNXSbQI';
const VIDEO_W = 16;                    // ancho en metros (16:9); grande porque está lejos
const VIDEO_H = VIDEO_W * 9 / 16;
const VIDEO_PX = 1280;                 // ancho del iframe en píxeles CSS
const VIDEO_BOTTOM = 2;
const VIDEO_POS = new THREE.Vector3(0, 0, -48);

const cssRenderer = new CSS3DRenderer();
cssRenderer.setSize(window.innerWidth, window.innerHeight);
cssRenderer.domElement.className = 'video-layer';
document.body.prepend(cssRenderer.domElement);
const cssScene = new THREE.Scene();

// iOS no reproduce solo un iframe de YouTube (ni mudo), así que ahí arranca con sonido
// cuando se toca su botón play; en el resto arranca mudo y suena con el primer gesto.
const IS_IOS = /iP(hone|ad|od)/.test(navigator.userAgent)
    || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const ytFrame = document.createElement('iframe');
ytFrame.src = `https://www.youtube.com/embed/${VIDEO_ID}?enablejsapi=1${IS_IOS ? '' : '&autoplay=1&mute=1'}&loop=1`
    + `&playlist=${VIDEO_ID}&controls=0&playsinline=1&rel=0&modestbranding=1&iv_load_policy=3`
    + `&origin=${encodeURIComponent(location.origin)}`;
ytFrame.title = 'Video de fondo del Mundo 3D';
ytFrame.allow = 'autoplay; encrypted-media';
ytFrame.style.cssText = IS_IOS ? 'width:100%;aspect-ratio:16/9;border:0;background:#000;display:block'
    : `width:${VIDEO_PX}px;height:${VIDEO_PX * 9 / 16}px;border:0;background:#000`;
// En iPhone el play de YouTube hay que tocarlo dentro del iframe, y Safari no siempre
// entrega el toque a un iframe con transformaciones 3D. Ahí el reproductor vive en una
// tarjeta 2D que se abre al tocar el cartel y se oculta en cuanto suena; el cartel muestra
// el póster del video.
const ytCard = document.createElement('div');
ytCard.className = 'yt-card';
ytCard.innerHTML = '<p class="yt-card__text">Toca ▶ para empezar la música</p>';
const ytCardClose = document.createElement('button');
ytCardClose.type = 'button';
ytCardClose.className = 'yt-card__close';
ytCardClose.textContent = 'Cerrar';
if (IS_IOS) {
    ytCard.append(ytFrame, ytCardClose);
    document.body.append(ytCard);
}
const videoObject = new CSS3DObject(IS_IOS ? document.createElement('div') : ytFrame);
videoObject.scale.setScalar(VIDEO_W / VIDEO_PX);

const videoBoard = new THREE.Group();
videoBoard.position.copy(VIDEO_POS);
videoBoard.lookAt(0, 0, 0);
const videoCenterY = VIDEO_BOTTOM + VIDEO_H / 2;
const videoFrame = new THREE.Mesh(
    new THREE.BoxGeometry(VIDEO_W + 0.4, VIDEO_H + 0.4, 0.14),
    new THREE.MeshStandardMaterial({ color: 0xff3da6, emissive: 0xff3da6, emissiveIntensity: 2.2, fog: false })
);
videoFrame.position.y = videoCenterY;
const videoHole = new THREE.Mesh(
    new THREE.PlaneGeometry(VIDEO_W, VIDEO_H),
    new THREE.MeshBasicMaterial({ color: 0x000000, opacity: 0, blending: THREE.NoBlending, fog: false, toneMapped: false })
);
videoHole.position.set(0, videoCenterY, 0.08);
videoBoard.add(videoFrame, videoHole);
for (const side of [-1, 1]) {
    const pole = new THREE.Mesh(new THREE.BoxGeometry(0.3, VIDEO_BOTTOM + 0.2, 0.3), poleMat);
    pole.position.set(side * (VIDEO_W / 2 - 1), (VIDEO_BOTTOM + 0.2) / 2, -0.14);
    videoBoard.add(pole);
}
const videoGlow = new THREE.PointLight(0xff3da6, 45, 20);
videoGlow.position.set(0, VIDEO_BOTTOM, 2.5);
videoBoard.add(videoGlow);
scene.add(videoBoard);
videoBoard.updateMatrixWorld(true);
videoHole.getWorldPosition(videoObject.position);
videoObject.quaternion.copy(videoBoard.quaternion);
if (!IS_IOS) cssScene.add(videoObject);
{
    const p = new THREE.Vector3();
    for (let x = -VIDEO_W / 2; x <= VIDEO_W / 2 + 0.01; x += 0.6) {
        videoBoard.localToWorld(p.set(x, 0, 0));
        obstacles.push({ x: p.x, z: p.z, r: 0.5 });
    }
}

// El video arranca mudo (el navegador lo permite) y se le activa el sonido con el primer
// gesto. Se controla con la API de mensajes del reproductor de YouTube.
let ytReady = false;
function ytCommand(func, args = []) {
    ytFrame.contentWindow?.postMessage(JSON.stringify({ event: 'command', func, args }), '*');
}
ytFrame.addEventListener('load', () => {
    ytFrame.contentWindow?.postMessage(JSON.stringify({ event: 'listening', id: 'mundo3d' }), '*');
});
// La capa del video vive detrás del canvas. Solo si hace falta tocar el play de YouTube
// (iPhone, o si el navegador bloqueó el autoplay) pasa delante hasta que se reproduce.
let ytPlaying = null;
function setVideoWaiting(waiting) {
    if (IS_IOS) ytCard.classList.toggle('is-open', waiting);
    else cssRenderer.domElement.classList.toggle('is-waiting', waiting);
}
ytCardClose.addEventListener('click', () => setVideoWaiting(false));

// Mientras el video no se reproduce, un póster luminoso tapa el hueco: así el cartel no
// queda oscuro y avisa que se toca para escuchar la música.
function drawPoster(ctx, w, h, thumb, playing = false) {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#1a0f2e'); g.addColorStop(0.55, '#3a1240'); g.addColorStop(1, '#0b2a3a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    if (thumb) {
        ctx.globalAlpha = 0.75; ctx.drawImage(thumb, 0, 0, w, h); ctx.globalAlpha = 1;
        ctx.fillStyle = 'rgba(5, 6, 10, .25)'; ctx.fillRect(0, 0, w, h);
    }
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center';
    if (playing) {
        ctx.font = 'bold 64px "Space Grotesk", sans-serif';
        ctx.fillText('♪ Sonando ahora', w / 2, h / 2 + 150);
    } else {
        ctx.beginPath(); ctx.arc(w / 2, h / 2 - 40, 110, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255, 61, 166, .92)'; ctx.fill();
        ctx.beginPath(); ctx.moveTo(w / 2 - 35, h / 2 - 105); ctx.lineTo(w / 2 + 65, h / 2 - 40); ctx.lineTo(w / 2 - 35, h / 2 + 25);
        ctx.closePath(); ctx.fillStyle = '#fff'; ctx.fill();
        ctx.font = 'bold 64px "Space Grotesk", sans-serif';
        ctx.fillText('Toca para escuchar la música', w / 2, h / 2 + 150);
    }
    ctx.font = '36px "JetBrains Mono", monospace'; ctx.fillStyle = 'rgba(255,255,255,.8)';
    ctx.fillText('Midnight Chicago Blues & Smooth Jazz', w / 2, h / 2 + 215);
}
const posterCanvas = document.createElement('canvas');
posterCanvas.width = 1280; posterCanvas.height = 720;
const posterCtx = posterCanvas.getContext('2d');
let posterThumb = null;
drawPoster(posterCtx, 1280, 720);
const posterTex = new THREE.CanvasTexture(posterCanvas);
posterTex.colorSpace = THREE.SRGBColorSpace;
{
    const thumb = new Image();
    thumb.crossOrigin = 'anonymous';
    thumb.onload = () => { posterThumb = thumb; drawPoster(posterCtx, 1280, 720, thumb, !!ytPlaying); posterTex.needsUpdate = true; };
    thumb.src = `https://i.ytimg.com/vi/${VIDEO_ID}/hqdefault.jpg`;
}
const videoPoster = new THREE.Mesh(
    new THREE.PlaneGeometry(VIDEO_W, VIDEO_H),
    new THREE.MeshBasicMaterial({ map: posterTex, toneMapped: false, fog: false })
);
videoPoster.position.set(0, videoCenterY, 0.1);
videoBoard.add(videoPoster);
clickable.push(videoPoster);
let waitTimer = 0;
videoPoster.userData = {
    hint: 'Toca para escuchar la música ▶',
    action() {
        startMusic();
        ytCommand('playVideo');
        clearTimeout(waitTimer);
        // iPhone solo arranca si se toca el play del propio video.
        waitTimer = setTimeout(() => {
            if (ytPlaying) return;
            if (!IS_IOS) videoPoster.visible = false;
            setVideoWaiting(true);
            if (!IS_IOS) flashHint('Toca ▶ en el video para empezar la música');
        }, IS_IOS ? 0 : 1200);
    },
};
window.addEventListener('message', (e) => {
    if (e.source !== ytFrame.contentWindow) return;
    if (!ytReady) { ytReady = true; music.sync(); }
    let data;
    try { data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data; } catch { return; }
    const state = data?.info?.playerState ?? (data?.event === 'onStateChange' ? data.info : undefined);
    if (typeof state !== 'number') return;
    const playing = state === 1 || state === 3;  // reproduciendo o cargando
    if (playing === ytPlaying) return;
    ytPlaying = playing;
    if (IS_IOS) {
        drawPoster(posterCtx, 1280, 720, posterThumb, playing);
        posterTex.needsUpdate = true;
    } else videoPoster.visible = !playing;
    if (playing) setVideoWaiting(false);
    if (playing) { if (musicOn) startMusic(); else music.sync(); }
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
    if (!hit) return;
    if (hit.userData.action) hit.userData.action();
    else window.open(hit.userData.url, '_blank', 'noopener');
});
canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const hit = billboardAt(e);
    canvas.style.cursor = hit ? 'pointer' : '';
    linkHint.hidden = !hit;
    if (hit) linkHint.textContent = hit.userData.hint ?? `Abrir cotización: ${hit.userData.title} ↗`;
});

// Aviso breve en el pie (por ejemplo, cómo iniciar la música en iPhone).
let hintTimer = 0;
function flashHint(text) {
    linkHint.textContent = text;
    linkHint.hidden = false;
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => { linkHint.hidden = true; }, 5000);
}

// ---------- Tótem táctil: Medical Center (el sistema se conecta más adelante) ----------
const TOTEM_INDEX = GALLERY.findIndex((g) => g.title === 'Medical Center');  // frente a su cuadro
const totemPanel = document.querySelector('[data-totem-panel]');
const totemScreenCanvas = document.createElement('canvas');
totemScreenCanvas.width = 512; totemScreenCanvas.height = 860;
{
    const c = totemScreenCanvas.getContext('2d');
    const g = c.createLinearGradient(0, 0, 0, 860);
    g.addColorStop(0, '#062a36'); g.addColorStop(1, '#0a0d16');
    c.fillStyle = g; c.fillRect(0, 0, 512, 860);
    c.strokeStyle = '#00e5ff'; c.lineWidth = 6; c.strokeRect(14, 14, 484, 832);
    c.fillStyle = '#00e5ff';
    c.fillRect(216, 150, 80, 220); c.fillRect(146, 220, 220, 80);   // cruz médica
    c.fillStyle = '#fff'; c.textAlign = 'center';
    c.font = 'bold 54px "Space Grotesk", sans-serif';
    c.fillText('MEDICAL', 256, 480); c.fillText('CENTER', 256, 540);
    c.font = '30px "JetBrains Mono", monospace'; c.fillStyle = 'rgba(255,255,255,.8)';
    c.fillText('Sistema próximamente', 256, 630);
    c.fillStyle = '#ff3da6'; c.font = 'bold 34px "JetBrains Mono", monospace';
    c.fillText('☝ Toca la pantalla', 256, 750);
}
const totemTex = new THREE.CanvasTexture(totemScreenCanvas);
totemTex.colorSpace = THREE.SRGBColorSpace;
const totem = new THREE.Group();
// La galería está girada 180°: la x local del cuadro queda invertida en el mundo.
totem.position.set(-(-galleryWidth / 2 + PAINT_W / 2 + TOTEM_INDEX * (PAINT_W + PAINT_GAP)), 0, GALLERY_Z - 6);
totem.lookAt(totem.position.x, 0, 0);
{
    const base = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.16, 0.7), poleMat);
    base.position.y = 0.08;
    const column = new THREE.Mesh(new THREE.BoxGeometry(0.8, 2.1, 0.35), poleMat);
    column.position.y = 1.2;
    column.castShadow = true;
    const edge = new THREE.Mesh(
        new THREE.BoxGeometry(0.84, 2.14, 0.3),
        new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00e5ff, emissiveIntensity: 1.8 })
    );
    edge.position.set(0, 1.2, -0.04);
    const screen = new THREE.Mesh(
        new THREE.PlaneGeometry(0.62, 1.04),
        new THREE.MeshBasicMaterial({ map: totemTex, toneMapped: false })
    );
    screen.position.set(0, 1.45, 0.18);
    screen.userData = { hint: 'Tótem Medical Center: toca la pantalla', action: () => { totemPanel.hidden = false; } };
    clickable.push(screen);
    const light = new THREE.PointLight(0x00e5ff, 6, 5);
    light.position.set(0, 1.4, 0.8);
    totem.add(base, column, edge, screen, light);
}
scene.add(totem);
obstacles.push({ x: totem.position.x, z: totem.position.z, r: 0.75 });
document.querySelector('[data-totem-close]').addEventListener('click', () => { totemPanel.hidden = true; });
totemPanel.addEventListener('click', (e) => { if (e.target === totemPanel) totemPanel.hidden = true; });

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
let headBone = null;  // la cabeza asiente mientras Ruddy habla por voz
let mouth = null;     // boca que se abre con la voz (el GLB no trae mandíbula ni visemas)
let avatarTemplate = null;  // modelo ya ajustado, para clonar a las demás personas

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
    remotes.forEach(attachAvatar);  // los que llegaron antes que el modelo
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
        model.traverse((o) => { if (o.isBone && /head$/i.test(o.name)) headBone ??= o; });
        if (headBone) {
            // Medido sobre el modelo: en el espacio del hueso Head, +z mira al frente y
            // la boca queda bajo la nariz, entre el bigote y la barba.
            mouth = new THREE.Mesh(
                new THREE.CircleGeometry(1, 32).translate(0, -1, 0),  // crece hacia abajo, como la mandíbula
                new THREE.MeshBasicMaterial({ color: 0x1a0606 })
            );
            mouth.position.set(0, 0.021, 0.087);  // borde superior bajo el bigote
            mouth.scale.set(0.017, 0.001, 1);
            mouth.visible = false;
            headBone.add(mouth);
        }

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
        avatarTemplate = { model, animations: gltf.animations };
        done(false);
    },
    (e) => {
        if (e.total) loaderText.textContent = `Cargando a Ruddy… ${Math.round((e.loaded / e.total) * 100)}%`;
    },
    () => {
        placeholder = buildPlaceholder();
        body.add(placeholder);
        avatarTemplate = { model: null, animations: [] };
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

// Música de fondo: el audio del video de YouTube. "Pausar" la silencia sin detener el video.
const music = {
    paused: true,
    play() { this.paused = false; this.sync(); return Promise.resolve(); },
    pause() { this.paused = true; this.sync(); },
    sync() {
        if (!ytReady) return;
        ytCommand('playVideo');
        if (this.paused) ytCommand('mute');
        else { ytCommand('unMute'); ytCommand('setVolume', [45]); }
    },
};
const musicBtn = document.querySelector('[data-music]');
let musicOn = true;
function syncMusicBtn() {
    musicBtn.textContent = musicOn ? '🔊 Música: activada' : '🔇 Música: apagada';
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

// ---------- Ajustes ----------
const settingsBox = document.querySelector('[data-settings]');
const settingsBtn = settingsBox.querySelector('[data-settings-open]');
const settingsPanel = settingsBox.querySelector('[data-settings-panel]');
function setSettings(open) {
    settingsPanel.hidden = !open;
    settingsBtn.setAttribute('aria-expanded', String(open));
}
settingsBtn.addEventListener('click', () => setSettings(settingsPanel.hidden));
// Captura: el botón de música detiene la propagación.
settingsPanel.addEventListener('click', () => setSettings(false), true);
document.addEventListener('pointerdown', (e) => {
    if (!settingsBox.contains(e.target)) setSettings(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setSettings(false); });

// ---------- Primera persona ----------
const fpBtn = document.querySelector('[data-fp]');
const EYE_HEIGHT = 1.65;
let firstPerson = false;
function setFirstPerson(on) {
    firstPerson = on;
    body.visible = !on;
    ring.visible = !on;
    controls.autoRotate = false;
    const yaw = player.rotation.y;
    const dir = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    if (on) {
        const eye = player.position.clone().setY(EYE_HEIGHT);
        controls.minDistance = controls.maxDistance = 0.1;
        controls.minPolarAngle = 0.15;
        controls.maxPolarAngle = Math.PI * 0.85;
        controls.target.copy(eye).addScaledVector(dir, 0.1);
        camera.position.copy(eye);
    } else {
        controls.minDistance = 1.5;
        controls.maxDistance = 14;
        controls.minPolarAngle = 0;
        controls.maxPolarAngle = Math.PI * 0.495;
        controls.target.copy(player.position).setY(1);
        camera.position.copy(controls.target).addScaledVector(dir, -4.2);
        camera.position.y += 0.6;
    }
    controls.update();
    fpBtn.setAttribute('aria-pressed', String(on));
    fpBtn.textContent = on ? '🎥 Volver a tercera persona' : '👁 Vista en primera persona';
}
fpBtn.addEventListener('click', () => setFirstPerson(!firstPerson));

const KEYMAP = {
    KeyW: [0, 1], ArrowUp: [0, 1], KeyS: [0, -1], ArrowDown: [0, -1],
    KeyA: [-1, 0], ArrowLeft: [-1, 0], KeyD: [1, 0], ArrowRight: [1, 0],
};
window.addEventListener('keydown', (e) => {
    if (e.target.matches?.('input, textarea')) return;  // escribiendo: las teclas son del texto
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
    showBubble(text);
});

function showBubble(text) {
    bubble.textContent = text;
    bubble.hidden = false;
    bubble.classList.remove('fade');
    bubbleUntil = performance.now() + Math.min(12000, 4000 + text.length * 60);
}

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

// ---------- Hablar con Ruddy por voz (agente conversacional de ElevenLabs) ----------
// Reutiliza el mismo agente que el teléfono del portafolio. Lo que dice el agente
// aparece como subtítulos de película y Ruddy mueve la cabeza al ritmo del volumen de su voz.
const SDK = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm';
const talkBtn = document.querySelector('[data-talk]');
const talkStatus = document.querySelector('[data-talk-status]');
let talkSession = null;
let talkState = 'idle';   // idle | connecting | live
let speaking = false;
let voiceLevel = 0;       // volumen suavizado de la voz del agente, 0..1
let musicWasOn = false;

// La transcripción de la llamada viaja por el socket del mundo (ver «Personas en el mundo»).
// Cada línea (tuya o de Ruddy) se envía como {type:"call_transcript", ...}; si el socket
// no está listo, espera en cola.
const transcript = (() => {
    let callId = '';
    const send = (msg) => net.send({ ...msg, call_id: callId, origin: 'mundo-3d', at: new Date().toISOString() }, true);
    return {
        start() {
            callId = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
            send({ type: 'call_transcript', event: 'start' });
        },
        line(role, message) { if (callId) send({ type: 'call_transcript', role, message }); },
        end() {
            if (!callId) return;
            send({ type: 'call_transcript', event: 'end' });
            callId = '';
        },
    };
})();

function setTalk(state, text) {
    talkState = state;
    talkBtn.setAttribute('aria-pressed', String(state !== 'idle'));
    talkBtn.setAttribute('aria-label', state === 'idle' ? 'Hablar con Ruddy por voz' : 'Colgar');
    talkBtn.textContent = state === 'idle' ? '📞 Hablar con Ruddy' : '📞 Colgar';
    settingsBox.classList.toggle('is-live', state !== 'idle');
    talkStatus.hidden = !text;
    talkStatus.textContent = text || '';
    talkStatus.classList.toggle('is-speaking', speaking);
}

function endTalk(text) {
    const s = talkSession;
    talkSession = null;
    speaking = false;
    s?.endSession().catch(() => {});
    transcript.end();
    clearSubs();
    setTalk('idle', text);
    if (text) setTimeout(() => talkState === 'idle' && setTalk('idle'), 3500);
    if (musicWasOn) { musicOn = true; startMusic(); syncMusicBtn(); }
    musicWasOn = false;
}

async function startTalk() {
    // La música taparía la voz: se pausa durante la conversación.
    musicWasOn = musicOn;
    if (musicOn) { musicOn = false; music.pause(); syncMusicBtn(); }
    setTalk('connecting', 'Llamando a Ruddy… permite el micrófono');
    try {
        const { Conversation } = await import(SDK);
        if (talkState !== 'connecting') return;  // colgó mientras cargaba
        transcript.start();
        talkSession = await Conversation.startSession({
            agentId: talkBtn.dataset.agentId,
            connectionType: 'webrtc',
            onConnect: () => talkState === 'connecting' && setTalk('live', 'En llamada con Ruddy · 📞 para colgar'),
            onMessage: (m) => {
                const text = (m.message || '').trim();
                const user = m.source === 'user' || m.role === 'user';
                if (text) transcript.line(user ? 'user' : 'agent', text);
                if (text && !user) showSubs(text);
            },
            onModeChange: ({ mode }) => {
                speaking = mode === 'speaking';
                subsHideAt = speaking ? 0 : performance.now() + 1500;
                talkStatus.classList.toggle('is-speaking', speaking);
                if (talkState === 'live') talkStatus.textContent = speaking ? 'Ruddy está hablando…' : 'Te escucho · 📞 para colgar';
            },
            onDisconnect: () => { if (talkSession) endTalk('Llamada finalizada'); },
            onError: (msg) => console.warn('ElevenLabs:', msg),
        });
        if (talkState !== 'connecting' && talkState !== 'live') endTalk();
    } catch (err) {
        console.warn(err);
        talkSession = null;
        endTalk(/permission|notallowed/i.test(String(err))
            ? 'Se necesita el micrófono para hablar con Ruddy'
            : 'No se pudo conectar con Ruddy');
    }
}

// Subtítulos como en el doblaje de una película: la respuesta del agente se parte en
// frases cortas que avanzan mientras suena la voz (no hay marcas de tiempo por palabra,
// así que se estima el ritmo por caracteres).
const subs = document.querySelector('[data-subs]');
const subsText = subs.firstElementChild;
const SUB_MAX = 84;    // caracteres por subtítulo (unas dos líneas)
const SUB_CPS = 15;    // caracteres por segundo de la voz, aproximado
let subChunks = [];
let subIndex = 0;
let subElapsed = 0;
let subsHideAt = 0;

function splitSubs(text) {
    const sentences = text.match(/[^.!?…]+[.!?…]+["”»)]*\s*|[^.!?…]+$/g) || [text];
    const chunks = [];
    for (const sentence of sentences) {
        let line = '';
        for (const word of sentence.trim().split(/\s+/)) {
            if (line && (line + ' ' + word).length > SUB_MAX) { chunks.push(line); line = word; }
            else line = line ? `${line} ${word}` : word;
        }
        if (line) chunks.push(line);
    }
    // Frases cortas seguidas ("¡Hola! Soy Ruddy.") comparten subtítulo si caben.
    return chunks.reduce((out, c) => {
        const prev = out[out.length - 1];
        if (prev && /[.!?…]["”»)]*$/.test(prev) && (prev + ' ' + c).length <= SUB_MAX) out[out.length - 1] = `${prev} ${c}`;
        else out.push(c);
        return out;
    }, []);
}

function showSubs(text) {
    subChunks = splitSubs(text);
    subIndex = 0;
    subElapsed = 0;
    subsHideAt = 0;
    subsText.textContent = subChunks[0];
    subs.hidden = false;
}

function clearSubs() {
    subChunks = [];
    subs.hidden = true;
}

// Usa el reloj real y no el dt del bucle (limitado a 0.05 s) para no atrasarse
// de la voz cuando el celular dibuja pocos cuadros por segundo.
let subsLast = 0;
function updateSubs() {
    const now = performance.now();
    const dt = (now - subsLast) / 1000;
    subsLast = now;
    if (!subChunks.length) return;
    if (subsHideAt && now > subsHideAt) return clearSubs();
    if (!speaking) return;
    subElapsed += dt;
    const duration = Math.max(1.2, subChunks[subIndex].length / SUB_CPS);
    if (subElapsed > duration && subIndex < subChunks.length - 1) {
        subIndex++;
        subElapsed = 0;
        subsText.textContent = subChunks[subIndex];
    }
}

talkBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (talkState === 'idle') startTalk(); else endTalk('Llamada finalizada');
});
window.addEventListener('pagehide', () => talkSession && endTalk());

// Se llama después de mixer.update: suma un gesto encima de la animación actual.
function updateTalking(t, dt) {
    let target = 0;
    if (speaking) {
        let v = 0;
        try { v = talkSession?.getOutputVolume() ?? 0; } catch { /* sin analizador */ }
        // Si el navegador no expone el volumen, se simula un ritmo de habla.
        target = v > 0.001 ? Math.min(1, v * 3) : 0.35 + 0.35 * Math.abs(Math.sin(t * 9) * Math.sin(t * 3.1));
    }
    voiceLevel += (target - voiceLevel) * Math.min(1, dt * 14);
    if (talkState !== 'idle' && headBone) {
        headBone.rotation.x += voiceLevel * 0.18 + Math.sin(t * 1.7) * 0.03 * (speaking ? 1 : 0);
        headBone.rotation.y += Math.sin(t * 1.1) * 0.08 * voiceLevel;
        headBone.rotation.z += Math.sin(t * 0.8) * 0.05 * voiceLevel;
    }
    if (placeholder) placeholder.scale.y = 1 + voiceLevel * 0.03;
    if (mouth) {
        // Abre y cierra a ritmo de sílabas, más grande cuanto más fuerte habla.
        const open = speaking ? voiceLevel * (0.45 + 0.55 * Math.abs(Math.sin(t * 13) * Math.sin(t * 4.7 + 1))) : 0;
        mouth.visible = open > 0.03;
        mouth.scale.set(0.012 + open * 0.003, 0.001 + open * 0.0045, 1);
    }
}

// Quieto y en llamada: Ruddy se gira hacia la cámara para hablarte de frente.
function faceCamera(dt) {
    if (talkState !== 'live' || moving > 0.05) return;
    const yaw = Math.atan2(camera.position.x - player.position.x, camera.position.z - player.position.z);
    let diff = yaw - player.rotation.y;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    player.rotation.y += diff * Math.min(1, dt * 3);
}

// ---------- Personas en el mundo ----------
// Al entrar se piden nombre, teléfono y email (la sesión del socket es por teléfono y se
// recuerda en este navegador, igual que en el chat del portafolio). Mientras te mueves se
// manda tu posición: el servidor la guarda para la próxima vez y la reenvía a los demás,
// que te ven con tu nombre encima. Quien no está conectado sigue en su última posición.
const WS_URL = 'wss://ws.ruddypazd.com/ws';
const PROFILE_KEY = 'rp_profile';

function getProfile() {
    try {
        const p = JSON.parse(localStorage.getItem(PROFILE_KEY));
        return p && p.name && p.phone && p.email ? p : null;
    } catch { return null; }
}
function saveProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* modo privado */ }
}

const net = (() => {
    let ws = null;
    let delay = 2000;
    let timer = null;
    let queue = [];          // mensajes que deben llegar aunque el socket aún no esté listo
    const handlers = {};
    const api = { loggedIn: false, myId: null, on: (type, fn) => { handlers[type] = fn; } };

    function sendLogin() {
        const p = getProfile();
        if (p && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'login', world: true, ...p }));
    }

    function connect() {
        if (ws || !getProfile()) return;
        try { ws = new WebSocket(WS_URL); } catch { ws = null; return schedule(); }
        ws.addEventListener('open', () => { delay = 2000; sendLogin(); });
        ws.addEventListener('message', (ev) => {
            let m;
            try { m = JSON.parse(ev.data); } catch { return; }
            if (m.type === 'login_ok') {
                api.loggedIn = true;
                api.myId = m.id;
                for (const q of queue) ws.send(JSON.stringify(q));
                queue = [];
            }
            if (m.type === 'login_required') sendLogin();
            handlers[m.type]?.(m);
        });
        ws.addEventListener('close', () => { api.loggedIn = false; ws = null; schedule(); });
        ws.addEventListener('error', () => { try { ws.close(); } catch { /* ya cerrado */ } });
    }

    function schedule() {
        if (timer) return;
        timer = setTimeout(() => { timer = null; connect(); }, delay);
        delay = Math.min(Math.round(delay * 1.6), 15000);
    }

    // Entrar (o reintentar con datos corregidos): reusa el socket si ya está abierto.
    api.login = () => (ws?.readyState === WebSocket.OPEN ? sendLogin() : connect());
    // keep: encola si no se puede mandar ahora (la transcripción); la posición no hace falta.
    api.send = (msg, keep = false) => {
        if (api.loggedIn && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        else if (keep && queue.length < 200) queue.push(msg);
    };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && !ws) { delay = 2000; connect(); } });
    window.addEventListener('online', () => { if (!ws) { delay = 2000; connect(); } });
    return api;
})();

// Formulario de entrada
const loginBox = document.querySelector('[data-login]');
const loginForm = loginBox.querySelector('[data-login-form]');
const loginError = loginBox.querySelector('[data-login-error]');

function showLogin(error) {
    const p = getProfile();
    if (p) { loginForm.name.value = p.name; loginForm.phone.value = p.phone; loginForm.email.value = p.email; }
    loginError.hidden = !error;
    loginError.textContent = error || '';
    loginBox.hidden = false;
    setTimeout(() => loginForm.name.focus(), 50);
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    saveProfile({
        name: loginForm.name.value.trim(),
        phone: loginForm.phone.value.trim(),
        email: loginForm.email.value.trim(),
    });
    loginBox.hidden = true;
    net.login();
});

document.querySelector('[data-logout]').addEventListener('click', () => {
    try { localStorage.removeItem(PROFILE_KEY); } catch { /* modo privado */ }
    location.reload();
});

net.on('login_error', (m) => showLogin(m.message));

// Al entrar por primera vez en esta visita, Ruddy aparece donde quedó la última vez.
let placedFromSave = false;
net.on('login_ok', (m) => {
    loginBox.hidden = true;
    if (placedFromSave) return;
    placedFromSave = true;
    // Primera vez: un lugar al azar cerca del centro, para no aparecer encima de otra persona.
    const a = Math.random() * Math.PI * 2;
    const pos = m.position || { x: Math.cos(a) * 2.5, z: Math.sin(a) * 2.5, ry: 0 };
    const delta = new THREE.Vector3(pos.x, 0, pos.z).sub(player.position);
    player.position.add(delta);
    player.rotation.y = pos.ry || 0;
    camera.position.add(delta);
    controls.target.add(delta);
    // No se marca como enviada: syncPosition la manda enseguida. Si no, quien entra por
    // primera vez (lugar al azar) se vería en el centro para los demás hasta moverse.
});

// Manda la posición cuando cambia, como mucho ~7 veces por segundo.
const lastSent = { x: NaN, z: NaN, ry: NaN, at: 0 };
function syncPosition() {
    if (!net.loggedIn) return;
    const now = performance.now();
    const { x, z } = player.position;
    const ry = player.rotation.y;
    const changed = !(Math.hypot(x - lastSent.x, z - lastSent.z) < 0.05 && Math.abs(ry - lastSent.ry) < 0.05);
    if (!changed || now - lastSent.at < 150) return;
    Object.assign(lastSent, { x, z, ry, at: now });
    net.send({ type: 'position', x, z, ry });
}

// Los demás: un clon de Ruddy (o del avatar provisional) con su nombre encima.
const remotes = new Map();   // id -> { group, avatar, mixer, actions, current, target, ry, label }

function makeNameLabel(name, online) {
    const c = document.createElement('canvas');
    c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.font = '600 52px "Space Grotesk", sans-serif';
    const w = Math.min(500, g.measureText(name).width + 70);
    g.fillStyle = 'rgba(10, 13, 22, .78)';
    g.beginPath(); g.roundRect((512 - w) / 2, 22, w, 84, 42); g.fill();
    g.fillStyle = online ? '#36f1a0' : '#6b7290';
    g.beginPath(); g.arc((512 - w) / 2 + 36, 64, 10, 0, Math.PI * 2); g.fill();
    g.fillStyle = online ? '#ffffff' : '#a9aec4';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(name, 256 + 12, 66, w - 70);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(1.6, 0.4, 1);
    sprite.position.y = 2.15;
    return sprite;
}

function attachAvatar(r) {
    if (r.avatar || !avatarTemplate) return;
    if (avatarTemplate.model) {
        r.avatar = cloneSkinned(avatarTemplate.model);
        const anims = avatarTemplate.animations;
        if (anims.length) {
            r.mixer = new THREE.AnimationMixer(r.avatar);
            const clip = (re) => anims.find((a) => re.test(a.name));
            r.actions = {
                idle: r.mixer.clipAction(clip(/idle/i) || anims[0]),
                walk: clip(/walk/i) && r.mixer.clipAction(clip(/walk/i)),
                run: clip(/run/i) && r.mixer.clipAction(clip(/run/i)),
            };
            r.current = r.actions.idle;
            r.current.play();
        }
    } else {
        r.avatar = buildPlaceholder();
    }
    r.avatar.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    r.group.add(r.avatar);
}

function upsertRemote(p) {
    if (!p.id || p.id === net.myId) return;
    let r = remotes.get(p.id);
    if (!r) {
        r = { group: new THREE.Group(), target: new THREE.Vector3(), ry: 0, label: null, avatar: null };
        r.group.position.set(p.x, 0, p.z);
        r.group.rotation.y = p.ry || 0;
        scene.add(r.group);
        remotes.set(p.id, r);
        attachAvatar(r);
    }
    r.target.set(p.x, 0, p.z);
    r.ry = p.ry || 0;
    if (r.name !== p.name || r.online !== p.online) {
        if (r.label) { r.group.remove(r.label); r.label.material.map.dispose(); r.label.material.dispose(); }
        r.label = makeNameLabel(p.name || 'Visitante', p.online);
        r.group.add(r.label);
        r.name = p.name;
        r.online = p.online;
    }
}

net.on('players', (m) => m.players.forEach(upsertRemote));
net.on('player', upsertRemote);

function updateRemotes(dt) {
    for (const r of remotes.values()) {
        const dist = r.group.position.distanceTo(r.target);
        // Si quedó muy lejos (p. ej. volvió tras un rato), salta; si no, camina hasta ahí.
        if (dist > 8) r.group.position.copy(r.target);
        else r.group.position.lerp(r.target, Math.min(1, dt * 6));
        let diff = r.ry - r.group.rotation.y;
        diff = Math.atan2(Math.sin(diff), Math.cos(diff));
        r.group.rotation.y += diff * Math.min(1, dt * 8);
        if (!r.mixer) continue;
        const speed = dist * 6;   // m/s aproximados según lo que le falta por recorrer
        const next = speed < 0.3 ? r.actions.idle : (speed > 3.5 && r.actions.run) || r.actions.walk || r.actions.idle;
        if (next !== r.current) {
            next.enabled = true;
            next.setEffectiveWeight(1);
            next.play();
            r.current.crossFadeTo(next, 0.25, false);
            r.current = next;
        }
        r.mixer.update(dt);
    }
}

if (getProfile()) net.login(); else showLogin();

const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (mixer) mixer.update(dt);
    if (placeholder) placeholder.position.y = Math.sin(t * 1.6) * 0.03;

    updatePlayer(dt);
    updateTalking(t, dt);
    updateSubs();
    faceCamera(dt);
    updateRemotes(dt);
    syncPosition();

    ring.position.x = player.position.x;
    ring.position.z = player.position.z;
    ring.material.opacity = 0.45 + Math.sin(t * 2) * 0.25 + voiceLevel * 0.3;
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
    cssRenderer.render(cssScene, camera);
    updateBubble();
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    cssRenderer.setSize(window.innerWidth, window.innerHeight);
});
