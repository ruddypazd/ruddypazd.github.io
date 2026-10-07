// Mundo 3D: carga a Ruddy (GLB) con three.js.
// Si models/ruddy.glb aún no existe, muestra un avatar provisional.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

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
scene.fog = new THREE.Fog(0x05060a, 8, 22);

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

const key = new THREE.DirectionalLight(0xffffff, 2.2);
key.position.set(3, 5, 4);
key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
scene.add(key);

const rimCyan = new THREE.PointLight(0x00e5ff, 18, 10);
rimCyan.position.set(-2.5, 2, -2);
scene.add(rimCyan);

const rimPink = new THREE.PointLight(0xff3da6, 14, 10);
rimPink.position.set(2.5, 1.5, -2);
scene.add(rimPink);

// ---------- Piso ----------
const floor = new THREE.Mesh(
    new THREE.CircleGeometry(12, 64),
    new THREE.MeshStandardMaterial({ color: 0x0a0d16, roughness: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
scene.add(floor);

const grid = new THREE.GridHelper(24, 48, 0x00e5ff, 0x1a2140);
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

// ---------- Ruddy ----------
let mixer = null;
let placeholder = null;

function fitToHeight(object, height) {
    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    if (size.y > 0) object.scale.multiplyScalar(height / size.y);
    box.setFromObject(object);
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

new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
        const model = gltf.scene;
        model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
        fitToHeight(model, 1.8);
        scene.add(model);

        if (gltf.animations.length) {
            mixer = new THREE.AnimationMixer(model);
            const idle = gltf.animations.find((a) => /idle/i.test(a.name)) || gltf.animations[0];
            mixer.clipAction(idle).play();
        }
        done(false);
    },
    (e) => {
        if (e.total) loaderText.textContent = `Cargando a Ruddy… ${Math.round((e.loaded / e.total) * 100)}%`;
    },
    () => {
        placeholder = buildPlaceholder();
        scene.add(placeholder);
        done(true);
    }
);

// ---------- Bucle ----------
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
    const dt = clock.getDelta();
    const t = clock.elapsedTime;
    if (mixer) mixer.update(dt);
    if (placeholder) placeholder.position.y = Math.sin(t * 1.6) * 0.03;
    ring.material.opacity = 0.45 + Math.sin(t * 2) * 0.25;
    controls.update();
    renderer.render(scene, camera);
});

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
