// Mundo Empresas: las empresas de S-ERP dentro del Mundo 3D (el servidor es serp.py en nvidianim).
//
// Ajustes → Mundo → 🏢 Mundo Empresas pide el usuario y la contraseña de S-ERP. Con eso se entra a:
//   «empresas»      un barrio con un edificio por cada empresa de la que eres miembro
//   «e-<empresa>»   un edificio por sucursal, la torre con el estado de la empresa y cuatro plazas:
//                   integrantes (en la entrada), tus notas, las publicaciones y tus tareas por fecha
//   «s-<sucursal>»  sus puntos de venta (luz verde = caja abierta), las ventas de hoy y los movimientos del mes
// Se entra por la puerta iluminada de cada edificio; la puerta suelta del lugar vuelve un nivel atrás
// y el puente (a un costado) vuelve al Mundo 3D. Como las salas privadas, solo te ven quienes están en
// el mismo lugar (tus compañeros de esa empresa).
//
// La contraseña no se guarda: el servidor da un token de sesión (TOKEN_KEY en localStorage) con el que,
// al recargar o reconectar, se vuelve a entrar solo y se aparece donde estabas. «Salir de S-ERP» lo anula.
// Lo que se interpone entre la cámara y tu personaje se vuelve transparente mientras estorba.
import * as THREE from 'three';

export const LOBBY = 'empresas';
export const TOKEN_KEY = 'rp_serp_token';
const KEY = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SCENE_RE = new RegExp(`^(?:${LOBBY}|[es]-${KEY})$`);
const DOOR_R = 1.2;        // a esta distancia de la puerta se entra
const ARM_DIST = 2.6;      // y hay que alejarse esto de todas las puertas para que vuelvan a funcionar
const REFRESH_MS = 60000;  // los datos de una sucursal se piden otra vez cada minuto mientras estás adentro

const money = (n) => Number(n || 0).toLocaleString('es-BO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function hueOf(key) {
    let h = 0;
    for (const c of key) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return h % 360;
}
function when(iso) {
    if (!iso) return 'sin actividad';
    const d = new Date(iso.length <= 16 ? iso + ':00' : iso);
    if (Number.isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    if (days <= 0) return `activo hoy ${d.toLocaleTimeString('es-BO', { hour: '2-digit', minute: '2-digit' })}`;
    if (days === 1) return 'activo ayer';
    if (days < 30) return `activo hace ${days} días`;
    return `activo el ${d.toLocaleDateString('es-BO', { day: 'numeric', month: 'short', year: 'numeric' })}`;
}

// ---------- Textos en canvas ----------
function textCanvas(lines, { w = 512, h = 256, bg = 'rgba(10,14,30,0.86)', border = '#7c4dff', radius = 28 } = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (bg) {
        g.fillStyle = bg;
        g.beginPath();
        g.roundRect(4, 4, w - 8, h - 8, radius);
        g.fill();
        if (border) { g.lineWidth = 6; g.strokeStyle = border; g.stroke(); }
    }
    const total = lines.reduce((s, l) => s + l.size * 1.25, 0);
    let y = (h - total) / 2;
    g.textAlign = 'center';
    g.textBaseline = 'top';
    for (const l of lines) {
        g.font = `${l.bold ? 700 : 500} ${l.size}px "Space Grotesk", system-ui, sans-serif`;
        g.fillStyle = l.color || '#ffffff';
        let text = String(l.text ?? '');
        while (text.length > 3 && g.measureText(text).width > w - 40) text = text.slice(0, -2);
        if (text !== String(l.text ?? '')) text = text.replace(/.$/, '…');
        g.fillText(text, w / 2, y + l.size * 0.1);
        y += l.size * 1.25;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return tex;
}
function textPlane(lines, width, opts = {}) {
    const tex = textCanvas(lines, opts);
    const h = width * (opts.h || 256) / (opts.w || 512);
    return new THREE.Mesh(new THREE.PlaneGeometry(width, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}
function textSprite(lines, width, opts = {}) {
    const tex = textCanvas(lines, opts);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    s.scale.set(width, width * (opts.h || 256) / (opts.w || 512), 1);
    return s;
}
function windowsTexture(hue) {
    const c = document.createElement('canvas');
    c.width = 128; c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = `hsl(${hue} 30% 12%)`;
    g.fillRect(0, 0, 128, 256);
    for (let y = 10; y < 246; y += 22) for (let x = 10; x < 118; x += 27) {
        const on = Math.random() < 0.55;
        g.fillStyle = on ? `hsl(${(hue + 30) % 360} 90% ${60 + Math.random() * 20}%)` : `hsl(${hue} 25% 20%)`;
        g.fillRect(x, y, 17, 12);
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    return tex;
}

// Dónde está el puente de regreso al Mundo 3D en cada lugar (a un costado, lejos de puertas y pantallas).
function holeFor(id) {
    if (id.startsWith('s-')) return { x: -15, z: 6 };
    if (id.startsWith('e-')) return { x: -9.5, z: -9.5 };   // entre las plazas de tareas y publicaciones
    return { x: -9, z: 6 };
}

export function createEmpresas({ wormholes, net, travel, flashHint, hereId, MAIN, radius, onLeave, onInfo, onRadius, onShift, makeNpc, camera, player }) {
    // ---------- La escena (una sola para todos los lugares: se rearma al cambiar) ----------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b1a);
    scene.fog = new THREE.Fog(0x070b1a, 30, 125);
    scene.add(new THREE.HemisphereLight(0x8fb4ff, 0x1a1030, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(12, 20, 8);
    scene.add(sun);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(radius + 2, 96),
        new THREE.MeshStandardMaterial({ color: 0x0d1428, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    const grid = new THREE.GridHelper((radius + 2) * 2, 52, 0x2b3a6b, 0x18223f);
    grid.position.y = 0.01;
    scene.add(grid);
    // Anillos suaves alrededor del centro (en el barrio y las sucursales; la empresa es una calle recta).
    const rings = [5, 11].map((r) => {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r + 0.06, 96),
            new THREE.MeshBasicMaterial({ color: 0x3d5bd9, transparent: true, opacity: 0.5 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        scene.add(ring);
        return ring;
    });
    // Tamaño del lugar: la calle de una empresa puede ser más larga que el mundo de siempre.
    let size = radius;
    function setSize(r, ringsOn) {
        size = r;
        const k = (r + 2) / (radius + 2);
        ground.scale.set(k, k, 1);
        grid.scale.set(k, 1, k);
        for (const ring of rings) ring.visible = ringsOn;
        onRadius?.(r);
    }
    const fixed = new Set(scene.children);   // suelo, grilla, calles y luces: nunca se desvanecen
    const returnHole = wormholes.makeHole({ scene, x: 0, z: 0 });
    fixed.add(returnHole.group);
    returnHole.id = MAIN;

    const content = new THREE.Group();
    scene.add(content);
    const obstacles = [];
    let doors = [];            // { x, z, to, from? }
    let armed = false;
    const animated = [];       // cosas que se mueven (puertas que brillan, luces)
    // Dónde agregan las funciones de abajo (target.add, anims.push, obs.push): el lugar entero, o el grupo
    // de las pantallas de la calle de una empresa, que se rehace solo cuando llegan sus datos (ver buildScreens).
    let target = content, anims = animated, obs = obstacles;
    let plazas = null;         // { group, anims, obs }
    const loader = new THREE.TextureLoader();
    loader.setCrossOrigin('anonymous');

    // ---------- Estado ----------
    let session = null;        // { nombre, empresas: [...] }
    const saveToken = (t) => { try { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); } catch { /* modo privado */ } };
    const empresas = new Map();    // key -> datos de serp_empresa
    const sucursales = new Map();  // key -> datos de serp_sucursal
    const parentOf = new Map();    // key_sucursal -> key_empresa
    let refreshTimer = 0;
    let shownFor = null;
    let comeFrom = null;           // lugar del que vienes (para aparecer delante de su puerta)
    let justEntered = false;       // apareciste en la entrada de la calle de una empresa (no al recargar)

    const owns = (id) => typeof id === 'string' && SCENE_RE.test(id);

    function clear() {
        content.traverse((o) => {
            o.geometry?.dispose();
            const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
            for (const m of mats) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); }
        });
        content.clear();
        plazas = null;
        for (const r of fading.keys()) setFade(r, 1);   // lo que puso la gente sigue en la escena: que vuelva a verse
        fading.clear();
        obstacles.length = 0;
        doors = [];
        animated.length = 0;
    }

    // Una puerta que brilla. facing: ángulo hacia donde mira (hacia afuera del edificio).
    function door(x, z, facing, to, color = 0x7c4dff) {
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = facing;
        const frameMat = new THREE.MeshStandardMaterial({ color: 0x20243a, metalness: 0.5, roughness: 0.4 });
        for (const sx of [-0.85, 0.85]) {
            const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.5, 0.16), frameMat);
            post.position.set(sx, 1.25, 0);
            g.add(post);
        }
        const top = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.16, 0.16), frameMat);
        top.position.y = 2.5;
        g.add(top);
        const glow = new THREE.Mesh(new THREE.PlaneGeometry(1.54, 2.42), new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false,   // se ve desde el lado del centro
        }));
        glow.position.y = 1.21;
        g.add(glow);
        anims.push((t) => { glow.material.opacity = 0.4 + 0.2 * Math.sin(t * 2.4 + x); });
        target.add(g);
        doors.push({ x: x + Math.sin(facing) * 0.6, z: z + Math.cos(facing) * 0.6, to, facing });
        return g;
    }

    // Un edificio con su puerta, su letrero y (si hay) el logo. Mira al centro, o hacia `facing` (en la calle).
    function building({ x, z, w, d, h, hue, title, subtitle, to, logo, facing: face }) {
        const facing = face ?? Math.atan2(x, z) + Math.PI;
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = facing;
        const tex = windowsTexture(hue);
        tex.repeat.set(Math.max(1, Math.round(w / 2.5)), Math.max(1, Math.round(h / 3)));
        const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), new THREE.MeshStandardMaterial({
            color: new THREE.Color().setHSL(hue / 360, 0.25, 0.32), map: tex, emissive: 0xffffff, emissiveMap: tex,
            emissiveIntensity: 0.55, roughness: 0.6, metalness: 0.2,
        }));
        body.position.y = h / 2;
        g.add(body);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.3, 0.25, d + 0.3),
            new THREE.MeshStandardMaterial({ color: new THREE.Color().setHSL(hue / 360, 0.7, 0.55), emissive: new THREE.Color().setHSL(hue / 360, 0.8, 0.35) }));
        roof.position.y = h + 0.12;
        g.add(roof);
        const sign = textPlane([{ text: title, size: 54, bold: true }, ...(subtitle ? [{ text: subtitle, size: 30, color: '#b9c3ff' }] : [])],
            Math.min(w - 0.3, 4.6), { border: `hsl(${hue} 80% 65%)` });
        sign.position.set(0, 3.25, d / 2 + 0.02);
        g.add(sign);
        if (logo) {
            const holder = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 1.7), new THREE.MeshBasicMaterial({ color: 0xffffff }));
            holder.position.set(0, Math.min(h - 1.2, 5.2), d / 2 + 0.02);
            holder.visible = false;
            g.add(holder);
            loader.load(logo, (t) => {
                t.colorSpace = THREE.SRGBColorSpace;
                const img = t.image;
                const ratio = img && img.width && img.height ? img.width / img.height : 1;
                holder.scale.set(ratio >= 1 ? 1 : ratio, ratio >= 1 ? 1 / ratio : 1, 1);
                holder.material.map = t;
                holder.material.needsUpdate = true;
                holder.visible = true;
            }, undefined, () => { /* sin logo */ });
        }
        target.add(g);
        const r = Math.max(w, d) / 2 + 0.4;
        obs.push({ x, z, r });
        // La puerta, delante del frente (afuera del obstáculo para poder llegar).
        door(x + Math.sin(facing) * (r + 0.15), z + Math.cos(facing) * (r + 0.15), facing, to, new THREE.Color().setHSL(hue / 360, 0.9, 0.6).getHex());
    }

    // Puestos en anillo: n posiciones alrededor del centro, empezando por el fondo (lejos de la salida).
    function ring(n, r0, gap) {
        const r = Math.max(r0, (n * gap) / (2 * Math.PI));
        return Array.from({ length: n }, (_, i) => {
            const a = Math.PI + (i - (n - 1) / 2) * (n > 1 ? Math.min(2 * Math.PI / n, gap / r) : 0);
            return { x: Math.sin(a) * r, z: Math.cos(a) * r };
        });
    }

    function title(lines, z = -radius + 8, width = 12, y = 7.5) {
        const s = textSprite(lines, width, { w: 1024, h: 256, border: '#7c4dff' });
        s.position.set(0, y, z);
        target.add(s);
    }

    function loading(text) {
        const s = textSprite([{ text, size: 60, bold: true }], 6);
        s.position.set(0, 2.4, -6);
        target.add(s);
    }

    // ---------- Los tres tipos de lugar ----------
    function buildLobby() {
        const list = session?.empresas || [];
        title([{ text: 'Mundo Empresas', size: 90, bold: true }, { text: `Hola, ${session?.nombre || ''} · entra a tu empresa por su puerta`, size: 40, color: '#b9c3ff' }]);
        ring(list.length, 22, 9).forEach((p, i) => {
            const e = list[i];
            const hue = hueOf(e.key);
            building({ ...p, w: 5.4, d: 4.4, h: 6 + (hue % 5), hue, title: e.nombre, to: `e-${e.key}`, logo: e.logo });
        });
        if (!list.length) loading('Sin empresas');
    }

    // ---------- La empresa: una calle ----------
    // La calle va de la entrada (z = +largo/2, la puerta al barrio) hasta el fondo (el puente al Mundo 3D).
    // A cada lado, por turnos, una pantalla de vidrio y un edificio de sucursal; el largo crece con las
    // sucursales. Las pantallas (estado, integrantes, notas, tareas, publicaciones) se rehacen solas cuando
    // llegan sus datos (buildScreens) sin rearmar los edificios.
    // Una avenida ancha (24 m de asfalto): desde una vereda se mira la otra sin que lo de este lado tape la cámara.
    const STREET = { half: 12, walk: 4, lot: 13, first: 11, end: 14, bx: 19.6, sx: 15, panel: 10.5 };
    const SCREENS = ['resumen', 'equipo', 'ranking', 'notas', 'dias', 'tareas', 'publicaciones'];
    let street = null;   // { key, L, z0, lots: [{ side, z, kind, sucursal? | screen? }], hole }

    function layoutStreet(key, e) {
        const sucs = e?.sucursales || [];
        const sides = [-1, 1].map((side, k) => {
            const b = sucs.filter((_, i) => i % 2 === k);
            const sc = SCREENS.filter((_, i) => i % 2 === k);
            const lots = [];
            while (b.length || sc.length) {         // pantalla, edificio, pantalla, edificio…
                if (sc.length) lots.push({ side, kind: 'screen', screen: sc.shift() });
                if (b.length) lots.push({ side, kind: 'building', sucursal: b.shift() });
            }
            return lots;
        });
        const n = Math.max(sides[0].length, sides[1].length);
        const L = STREET.first + n * STREET.lot + STREET.end;
        const z0 = L / 2;
        const lots = [];
        for (const list of sides) list.forEach((lot, i) => lots.push({ ...lot, z: z0 - STREET.first - i * STREET.lot }));
        return { key, L, z0, lots, hole: { x: 0, z: -z0 + 5 } };
    }

    // La avenida (de la empresa o de la sucursal): asfalto, veredas, líneas, faroles, el arco de la entrada con
    // su nombre y la puerta de vuelta (backTo).
    function avenue(L, z0, title, subtitle, backTo, backLabel) {
        // Asfalto, veredas, línea del medio, bordes de neón y faroles.
        const asphalt = new THREE.Mesh(new THREE.PlaneGeometry(STREET.half * 2, L), new THREE.MeshStandardMaterial({ color: 0x0b0e1a, roughness: 0.9 }));
        asphalt.rotation.x = -Math.PI / 2;
        asphalt.position.y = 0.03;
        target.add(asphalt);
        for (const side of [-1, 1]) {
            const walk = new THREE.Mesh(new THREE.BoxGeometry(STREET.walk, 0.16, L), new THREE.MeshStandardMaterial({ color: 0x1f2540, roughness: 0.8 }));
            walk.position.set(side * (STREET.half + STREET.walk / 2), 0.08, 0);
            target.add(walk);
            const edge = new THREE.Mesh(new THREE.PlaneGeometry(0.12, L), new THREE.MeshBasicMaterial({ color: side < 0 ? 0x4ad6ff : 0xff5ca8, transparent: true, opacity: 0.8 }));
            edge.rotation.x = -Math.PI / 2;
            edge.position.set(side * STREET.half, 0.05, 0);
            target.add(edge);
            for (let z = z0 - 6; z > -z0 + 4; z -= 16) {
                const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.2), new THREE.MeshStandardMaterial({ color: 0x2a3150, metalness: 0.6 }));
                pole.position.set(side * (STREET.half + 0.5), 2.1, z);
                target.add(pole);
                const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffe6b0, emissive: 0xffd27a, emissiveIntensity: 2.2 }));
                bulb.position.set(side * (STREET.half + 0.5), 4.3, z);
                target.add(bulb);
            }
        }
        const dashMat = new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.7 });
        const laneMat = new THREE.MeshBasicMaterial({ color: 0xdfe4ff, transparent: true, opacity: 0.35 });
        for (let z = z0 - 3; z > -z0 + 2; z -= 5) {
            for (const [x, mat] of [[0, dashMat], [-STREET.half / 2, laneMat], [STREET.half / 2, laneMat]]) {
                const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.18, 2.2), mat);
                dash.rotation.x = -Math.PI / 2;
                dash.position.set(x, 0.04, z);
                target.add(dash);
            }
        }

        // La entrada: un arco con el nombre y la puerta de vuelta.
        const archMat = new THREE.MeshStandardMaterial({ color: 0x20243a, metalness: 0.6, roughness: 0.35, emissive: 0x1d1450 });
        for (const side of [-1, 1]) {
            const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.6, 8, 0.6), archMat);
            pillar.position.set(side * (STREET.half + 0.8), 4, z0 - 4);
            target.add(pillar);
            obs.push({ x: side * (STREET.half + 0.8), z: z0 - 4, r: 0.6 });
        }
        const beam = new THREE.Mesh(new THREE.BoxGeometry(STREET.half * 2 + 2.2, 0.5, 0.6), archMat);
        beam.position.set(0, 8, z0 - 4);
        target.add(beam);
        const sign = textPlane([{ text: title, size: 80, bold: true }, { text: subtitle, size: 40, color: '#b9c3ff' }],
            16, { w: 1024, h: 256, border: '#7c4dff' });
        sign.position.set(0, 10.4, z0 - 4);
        sign.material.side = THREE.DoubleSide;
        target.add(sign);
        door(0, z0 + 1, Math.PI, backTo, 0x3d8bff);
        const back = textSprite([{ text: backLabel, size: 52, bold: true }], 2.2, { h: 128 });
        back.position.set(0, 2.95, z0 + 1);
        target.add(back);
    }

    function buildEmpresa(key) {
        const e = empresas.get(key);
        street = layoutStreet(key, e);
        const { L, z0 } = street;
        setSize(Math.max(radius, L / 2 + 16), false);
        returnHole.group.position.set(street.hole.x, returnHole.group.position.y, street.hole.z);
        const nombre = e?.nombre || session?.empresas.find((x) => x.key === key)?.nombre || 'Empresa';

        avenue(L, z0, nombre, e ? `${e.sucursales.length} sucursal${e.sucursales.length === 1 ? '' : 'es'} · ${e.usuarios.length} personas` : 'Cargando…', LOBBY, '← Barrio de empresas');

        // Los edificios de las sucursales, mirando a la calle.
        street.lots.filter((l) => l.kind === 'building').forEach((l, i) => {
            const su = l.sucursal;
            const hue = (hueOf(key) + i * 37) % 360;
            building({
                x: l.side * STREET.bx, z: l.z, w: 7, d: 5, h: 5 + (hueOf(su.key) % 4), hue, title: su.nombre, subtitle: su.direccion,
                to: `s-${su.key}`, facing: l.side < 0 ? Math.PI / 2 : -Math.PI / 2,
            });
        });
        buildScreens(key);
        if (!e) loading('Cargando la empresa…');
    }

    // ---------- La sucursal: una avenida por partes ----------
    // Igual que la calle de la empresa, pero por zonas de ZONE metros: parte 1, las cajas (izquierda) y los
    // movimientos del mes (derecha); parte 2, los almacenes (izquierda) y quienes entrenaron hoy (derecha).
    const ZONE = 44;
    let sucStreet = null;   // { key, L, z0, hole }

    // Lo que fn agregue queda en un grupo parado en (x, z) mirando hacia face (±1 en x), con el origen a R
    // detrás del vidrio (las funciones de pantallas dibujan alrededor de su origen). Obstáculos al mundo.
    function inPanel(x, z, face, R, fn) {
        const panel = new THREE.Group();
        panel.position.set(x + face * R, 0, z);
        panel.rotation.y = Math.atan2(face, 0);
        target.add(panel);
        panel.updateMatrixWorld(true);
        const local = [];
        const prev = [target, obs];
        [target, obs] = [panel, local];
        try { fn(); } finally { [target, obs] = prev; }
        const v = new THREE.Vector3();
        for (const o of local) {
            v.set(o.x, 0, o.z);
            panel.localToWorld(v);
            obs.push({ x: v.x, z: v.z, r: o.r });
        }
        return panel;
    }

    // Un cartel alto en la vereda que nombra la parte de la avenida.
    function zoneSign(side, z, text, sub, color) {
        const x = side * (STREET.half + STREET.walk - 0.7);
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.12, 6.2), new THREE.MeshStandardMaterial({ color: 0x2a3150, metalness: 0.6 }));
        post.position.set(x, 3.1, z);
        target.add(post);
        obs.push({ x, z, r: 0.4 });
        const s = textSprite([{ text, size: 72, bold: true }, ...(sub ? [{ text: sub, size: 38, color: '#b9c3ff' }] : [])], 6, { w: 1024, h: 220, border: color });
        s.position.set(x, 7, z);
        target.add(s);
    }

    // Un punto de venta: mostrador con su luz (verde = caja abierta) y lo vendido hoy.
    function kiosk(pv, x, z, facing, i) {
        const open = pv.caja === 'abierta';
        const g = new THREE.Group();
        g.position.set(x, 0, z);
        g.rotation.y = facing;
        const counter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.05, 0.8), new THREE.MeshStandardMaterial({ color: 0x2a3150, roughness: 0.5, metalness: 0.3 }));
        counter.position.y = 0.525;
        g.add(counter);
        const top = new THREE.Mesh(new THREE.BoxGeometry(2, 0.06, 0.9), new THREE.MeshStandardMaterial({ color: 0xc9d2ff }));
        top.position.y = 1.08;
        g.add(top);
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.4), new THREE.MeshStandardMaterial({ color: 0x555b75 }));
        pole.position.set(0.8, 1.8, -0.2);
        g.add(pole);
        const lampColor = open ? 0x2bff88 : 0xff3b5c;
        const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 20, 14), new THREE.MeshStandardMaterial({ color: lampColor, emissive: lampColor, emissiveIntensity: 2 }));
        lamp.position.set(0.8, 2.55, -0.2);
        g.add(lamp);
        if (open) anims.push((t) => { lamp.material.emissiveIntensity = 1.6 + 0.6 * Math.sin(t * 3 + i); });
        target.add(g);
        const label = textSprite([
            { text: pv.nombre, size: 46, bold: true },
            { text: open ? '● Caja abierta' : '● Caja cerrada', size: 34, color: open ? '#2bff88' : '#ff7088' },
            { text: `Hoy: ${money(pv.ventas_hoy)} · ${pv.ventas_cantidad} venta${pv.ventas_cantidad === 1 ? '' : 's'}`, size: 34, color: '#dfe4ff' },
        ], 2.6, { border: open ? '#2bff88' : '#ff3b5c' });
        label.position.set(x, 3.3, z);
        target.add(label);
        obs.push({ x, z, r: 1.15 });
    }

    // Un almacén: su pantalla (lo que hay en stock) y, detrás, un estante con cajitas.
    function almacenPanel(a, z) {
        inPanel(-(STREET.half + 3), z, 1, SPOT.R, () => {
            glass(SPOT.R, SPOT.c, SPOT.span, SPOT.y0 - 0.1, SPOT.h + 0.2, 0xffb02b);
            plazaLabel(a.nombre, SPOT.c, '#ffb02b');
            const cv = canvasFor(SPOT.R, SPOT.span, SPOT.h, SPOT.px);
            const g = cv.getContext('2d');
            const W = cv.width, H = cv.height;
            const tiles = [['Productos', String(a.productos)], ['Unidades', money(a.unidades).replace(/,00$/, '')], ['Valor (precio de venta)', money(a.valor)]];
            const tw = (W - 60 - 2 * 16) / 3;
            tiles.forEach(([label, value], i) => {
                const x = 30 + i * (tw + 16);
                g.fillStyle = 'rgba(60,40,10,0.55)'; g.beginPath(); g.roundRect(x, 24, tw, 110, 16); g.fill();
                g.strokeStyle = '#ffb02b'; g.lineWidth = 3; g.stroke();
                g.fillStyle = '#ffd38a'; g.font = FONT(600, 24); g.textBaseline = 'top'; g.textAlign = 'left';
                g.fillText(label, x + 16, 38);
                g.fillStyle = '#ffffff'; g.font = FONT(700, 44);
                g.fillText(value, x + 16, 72);
            });
            const items = a.items;
            if (!items.length) {
                g.fillStyle = '#ffd38a'; g.font = FONT(600, 36); g.textAlign = 'center';
                g.fillText('Sin productos en stock', W / 2, H / 2);
            }
            const cols = 2, rowH = 38, top = 160, colW = (W - 60) / cols, rows = Math.floor((H - top - 16) / rowH);
            items.slice(0, cols * rows).forEach((it, i) => {
                const x = 30 + Math.floor(i / rows) * colW, y = top + (i % rows) * rowH;
                g.textAlign = 'left'; g.textBaseline = 'top';
                g.fillStyle = '#ffffff'; g.font = FONT(600, 24);
                let n = it.nombre;
                while (n.length > 3 && g.measureText(n).width > colW - 200) n = n.slice(0, -2) + '…';
                g.fillText(n, x, y);
                g.textAlign = 'right';
                g.fillStyle = it.stock < 0 ? '#ff7088' : '#ffd166'; g.font = FONT(700, 24);
                g.fillText(`${money(it.stock).replace(/,00$/, '')} u`, x + colW - 24, y);
            });
            if (items.length > cols * rows) {
                g.fillStyle = '#ffd38a'; g.font = FONT(500, 20); g.textAlign = 'right'; g.textBaseline = 'bottom';
                g.fillText(`y ${items.length - cols * rows} más`, W - 24, H - 4);
            }
            screenLayer(SPOT.R, SPOT.c, SPOT.span, SPOT.y0, SPOT.h, cv);
        });
        // El estante: tres repisas con cajitas de colores (más cajitas, más productos).
        const rack = new THREE.Group();
        rack.position.set(-(STREET.half + STREET.walk + 4.5), 0, z);
        const metal = new THREE.MeshStandardMaterial({ color: 0x3a405c, metalness: 0.7, roughness: 0.4 });
        for (const dz of [-4, 4]) for (const dx of [-0.6, 0.6]) {
            const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3, 0.08), metal);
            leg.position.set(dx, 1.5, dz);
            rack.add(leg);
        }
        const boxes = Math.min(36, Math.max(3, a.productos));
        for (let shelf = 0; shelf < 3; shelf++) {
            const plank = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.06, 8.2), metal);
            plank.position.set(0, 0.4 + shelf * 1.05, 0);
            rack.add(plank);
            for (let k = 0; k < Math.ceil(boxes / 3) && shelf * Math.ceil(boxes / 3) + k < boxes; k++) {
                const color = new THREE.Color().setHSL(((k * 53 + shelf * 97) % 360) / 360, 0.6, 0.55);
                const b = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.45 + (k % 3) * 0.12, 0.55), new THREE.MeshStandardMaterial({ color, roughness: 0.7 }));
                b.position.set(0, 0.43 + shelf * 1.05 + b.geometry.parameters.height / 2, -3.6 + k * 0.62);
                rack.add(b);
            }
        }
        target.add(rack);
        obs.push({ x: rack.position.x, z: z - 2.5, r: 1.6 }, { x: rack.position.x, z: z + 2.5, r: 1.6 });
    }

    // Quienes entrenaron hoy: un piso de gimnasio con un NPC por persona (su nombre y la hora a la que marcó).
    const NPC_F = ['sofia', 'candie', 'androide18'], NPC_M = ['ruddy', 'leo', 'marco'];
    function gym(list, zc) {
        const x0 = STREET.half + 3, w = 13, len = ZONE - 8;
        const mat = new THREE.Mesh(new THREE.PlaneGeometry(w, len), new THREE.MeshStandardMaterial({ color: 0x12352b, roughness: 0.95 }));
        mat.rotation.x = -Math.PI / 2;
        mat.position.set(x0 + w / 2, 0.18, zc);
        target.add(mat);
        // Barras de dominadas al fondo.
        const metal = new THREE.MeshStandardMaterial({ color: 0x9aa3c7, metalness: 0.8, roughness: 0.3 });
        for (const dz of [-9, 0, 9]) {
            const bx = x0 + w - 1;
            for (const s of [-1.1, 1.1]) {
                const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 2.6), metal);
                post.position.set(bx, 1.3, zc + dz + s);
                target.add(post);
            }
            const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.3), metal);
            bar.rotation.x = Math.PI / 2;
            bar.position.set(bx, 2.55, zc + dz);
            target.add(bar);
            obs.push({ x: bx, z: zc + dz, r: 1.2 });
        }
        if (!list.length) {
            const s = textSprite([{ text: 'Nadie marcó asistencia hoy', size: 52, bold: true }, { text: 'Las asistencias de S-ERP aparecen aquí', size: 34, color: '#b9ffd6' }], 5, { border: '#2bff88' });
            s.position.set(x0 + w / 2, 2.4, zc);
            target.add(s);
            return;
        }
        const myAnims = anims;
        list.forEach((p, i) => {
            const col = i % 3, row = Math.floor(i / 3);
            const x = x0 + 2 + col * 3.4, z = zc + len / 2 - 2.5 - row * 3.2;
            const holder = new THREE.Group();
            holder.position.set(x, 0.18, z);
            holder.rotation.y = -Math.PI / 2;   // mirando a la avenida
            target.add(holder);
            obs.push({ x, z, r: 0.5 });
            const pool = p.sexo === 'F' ? NPC_F : NPC_M;
            makeNpc?.(pool[hueOf(p.nombre) % pool.length]).then(({ object, mixer }) => {
                if (!holder.parent) return;   // ya se rearmó el lugar
                holder.add(object);
                if (mixer) myAnims.push((t, dt) => mixer.update(dt));
            }, () => { /* sin modelo */ });
            const label = textSprite([{ text: p.nombre, size: 44, bold: true }, { text: `entrenó ${p.hora}`, size: 32, color: '#b9ffd6' }], 2.3, { h: 160, border: '#2bff88' });
            label.position.set(x, 2.55, z);
            target.add(label);
        });
    }

    function buildSucursal(key) {
        const s = sucursales.get(key);
        const empresaKey = parentOf.get(key);
        const name = s?.nombre || empresas.get(empresaKey)?.sucursales.find((x) => x.key === key)?.nombre || 'Sucursal';
        const L = STREET.first + 2 * ZONE + STREET.end, z0 = L / 2;
        sucStreet = { key, L, z0, hole: { x: 0, z: -z0 + 5 } };
        setSize(Math.max(radius, L / 2 + 16), false);
        returnHole.group.position.set(sucStreet.hole.x, returnHole.group.position.y, sucStreet.hole.z);
        avenue(L, z0, name, s ? `${s.empresa} · actualizado ${s.actualizado}` : 'Cargando…', `e-${empresaKey}`, '← Volver a la empresa');
        if (!s) return loading('Cargando la sucursal…');
        const zA = z0 - STREET.first - ZONE / 2, zB = zA - ZONE;

        // Parte 1 · izquierda: las cajas.
        zoneSign(-1, zA + ZONE / 2 - 2, 'Cajas', `Ventas de hoy: ${money(s.total_hoy)}`, '#2bff88');
        const pvs = s.puntos_venta;
        const gapK = Math.min(5.5, (ZONE - 10) / Math.max(1, pvs.length - 1));
        pvs.forEach((pv, i) => kiosk(pv, -(STREET.half + 2.5), zA + ((pvs.length - 1) / 2 - i) * gapK, Math.PI / 2, i));
        if (!pvs.length) {
            const n = textSprite([{ text: 'Sin puntos de venta', size: 52, bold: true }], 4);
            n.position.set(-(STREET.half + 2.5), 2.2, zA);
            target.add(n);
        }
        // Parte 1 · derecha: los movimientos del mes.
        zoneSign(1, zA + ZONE / 2 - 2, 'Movimientos del mes', s.mes?.nombre || '', '#7c4dff');
        inPanel(STREET.half + 3, zA, -1, 32, () => monthScreen(s));

        // Parte 2 · izquierda: los almacenes.
        const alms = s.almacenes || [];
        zoneSign(-1, zB + ZONE / 2 - 2, 'Almacenes', `${alms.length} almacén${alms.length === 1 ? '' : 'es'}`, '#ffb02b');
        alms.slice(0, 3).forEach((a, i, arr) => almacenPanel(a, zB + ((arr.length - 1) / 2 - i) * 13.5));
        if (!alms.length) {
            const n = textSprite([{ text: 'Sin almacenes', size: 52, bold: true }], 4);
            n.position.set(-(STREET.half + 3), 2.2, zB);
            target.add(n);
        }
        // Parte 2 · derecha: quienes entrenaron hoy.
        const people = s.entrenaron || [];
        zoneSign(1, zB + ZONE / 2 - 2, 'Entrenaron hoy', `${people.length} persona${people.length === 1 ? '' : 's'}`, '#2bff88');
        gym(people, zB);
    }

    // ---------- Pantallas de vidrio curvas ----------
    // Un pedazo de cilindro de radio R alrededor del centro, mirando al centro. c: ángulo de su centro
    // (Math.PI = al fondo, 0 = detrás de la entrada); span: cuánto abarca (radianes).
    // out: mira hacia afuera (los paneles de la torre del centro de una empresa).
    function arcPlane(R, c, span, y0, h, seg = 48, out = false) {
        const g = new THREE.PlaneGeometry(R * span, h, seg, 1);
        const pos = g.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const a = out ? c + pos.getX(i) / R : c - pos.getX(i) / R;
            pos.setXYZ(i, R * Math.sin(a), y0 + h / 2 + pos.getY(i), R * Math.cos(a));
        }
        g.computeBoundingSphere();
        return g;
    }

    // El vidrio con su marco que brilla (como la puerta) y dos patas.
    function glass(R, c, span, y0, h, color = 0x4aa8ff, out = false) {
        const d = out ? -1 : 1;   // hacia dónde queda «atrás» del vidrio
        const glassMat = new THREE.MeshBasicMaterial({ color: 0x0a1836, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide });
        // Orden de dibujo fijo: vidrio (0) → brillo (1) → contenido (3) → bordes y línea de luz (4).
        // Todos están en el centro del mundo, así que three.js no los puede ordenar por distancia.
        const back = new THREE.Mesh(arcPlane(R + 0.04 * d, c, span, y0, h, 48, out), glassMat);
        back.renderOrder = 0;
        target.add(back);
        const sheen = new THREE.Mesh(arcPlane(R + 0.02 * d, c, span, y0, h, 48, out), new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        sheen.renderOrder = 1;
        target.add(sheen);
        const edgeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        for (const y of [y0 - 0.04, y0 + h - 0.02]) {
            const line = new THREE.Mesh(arcPlane(R, c, span + 0.004, y, 0.07, 48, out), edgeMat);
            line.renderOrder = 4;
            target.add(line);
        }
        const postMat = new THREE.MeshStandardMaterial({ color: 0x20243a, metalness: 0.6, roughness: 0.35 });
        for (const a of [c - span / 2, c + span / 2]) {
            const edge = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), edgeMat);
            edge.position.set(R * Math.sin(a), y0 + h / 2, R * Math.cos(a));
            target.add(edge);
            if (y0 > 0.3) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, y0, 0.18), postMat);
                leg.position.set(R * Math.sin(a), y0 / 2, R * Math.cos(a));
                target.add(leg);
            }
            obs.push({ x: R * Math.sin(a), z: R * Math.cos(a), r: 0.5 });
        }
        // Una línea de luz que recorre el vidrio de arriba abajo.
        const scan = new THREE.Mesh(arcPlane(R + 0.01 * d, c, span, 0, 0.05, 48, out), new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        scan.renderOrder = 4;
        target.add(scan);
        anims.push((t) => { scan.position.y = y0 + ((t * 0.35) % 1) * h; });
    }

    // Lo que se dibuja sobre el vidrio (un canvas transparente, un poco más cerca del centro).
    function screenLayer(R, c, span, y0, h, canvas, out = false) {
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const mesh = new THREE.Mesh(arcPlane(R - 0.02 * (out ? -1 : 1), c, span, y0, h, 48, out), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        mesh.renderOrder = 3;
        target.add(mesh);
        return { mesh, tex };
    }

    function canvasFor(R, span, h, pxPerM) {
        const c = document.createElement('canvas');
        c.width = Math.min(2048, Math.round(R * span * pxPerM));
        c.height = Math.min(2048, Math.round(h * pxPerM));
        return c;
    }

    // ---------- Pantalla grande: movimientos del mes ----------
    const TIPO_COLOR = { venta: '#2bff88', compra: '#ffb02b', gasto: '#ff5c7a', ingreso: '#4ad6ff', egreso: '#ff8a4a', apertura: '#9f8bff', cierre: '#c9d2ff', traspaso: '#7ab8ff' };
    function monthScreen(s) {
        const m = s.mes || { nombre: '', totales: [], por_dia: [], ultimos: [], cantidad: 0 };
        const R = 32, c = Math.PI, y0 = 1.2, h = 8.5;
        glass(R, c, 1.24, y0 - 0.1, h + 0.2, 0x7c4dff);

        // Izquierda: título, totales por tipo y ventas por día.
        const sSpan = 0.72, sC = c + 0.25;
        const cv = canvasFor(R, sSpan, h, 118);
        const g = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        g.textBaseline = 'top';
        g.fillStyle = '#ffffff';
        g.font = '700 64px "Space Grotesk", system-ui, sans-serif';
        g.fillText(`Movimientos de ${m.nombre}`, 48, 36);
        g.fillStyle = '#b9c3ff';
        g.font = '500 32px "Space Grotesk", system-ui, sans-serif';
        g.fillText(`${s.nombre} · ${m.cantidad} movimiento${m.cantidad === 1 ? '' : 's'} · actualizado ${s.actualizado}`, 50, 112);
        const tiles = m.totales.slice(0, 5);
        const tw = tiles.length ? Math.min(360, (W - 96 - (tiles.length - 1) * 20) / tiles.length) : 0;
        tiles.forEach((t, i) => {
            const x = 48 + i * (tw + 20), y = 176;
            const col = TIPO_COLOR[t.tipo] || '#ffffff';
            g.fillStyle = 'rgba(20,40,90,0.55)';
            g.beginPath(); g.roundRect(x, y, tw, 150, 20); g.fill();
            g.strokeStyle = col; g.lineWidth = 3; g.stroke();
            g.fillStyle = col;
            g.font = '600 30px "Space Grotesk", system-ui, sans-serif';
            g.fillText(t.label, x + 22, y + 18);
            g.fillStyle = '#ffffff';
            g.font = '700 46px "Space Grotesk", system-ui, sans-serif';
            g.fillText(money(t.monto), x + 22, y + 56);
            g.fillStyle = '#b9c3ff';
            g.font = '500 26px "Space Grotesk", system-ui, sans-serif';
            g.fillText(`${t.cantidad} mov.`, x + 22, y + 110);
        });
        if (!tiles.length) {
            g.fillStyle = '#b9c3ff';
            g.font = '600 44px "Space Grotesk", system-ui, sans-serif';
            g.fillText('Sin movimientos este mes', 48, 200);
        }
        // Ventas por día.
        const days = m.por_dia;
        const top = 370, bottom = H - 70, left = 60, right = W - 40;
        g.fillStyle = '#dfe4ff';
        g.font = '600 32px "Space Grotesk", system-ui, sans-serif';
        g.fillText('Ventas por día', left, top);
        const vmax = Math.max(...days, 0);
        if (days.length && vmax > 0) {
            const chartTop = top + 60, bw = (right - left) / days.length;
            g.strokeStyle = 'rgba(185,195,255,0.25)'; g.lineWidth = 2;
            for (let k = 0; k <= 4; k++) {
                const y = chartTop + (bottom - chartTop) * k / 4;
                g.beginPath(); g.moveTo(left, y); g.lineTo(right, y); g.stroke();
            }
            days.forEach((v, i) => {
                const bh = (bottom - chartTop) * v / vmax;
                const grad = g.createLinearGradient(0, bottom - bh, 0, bottom);
                grad.addColorStop(0, '#2bff88'); grad.addColorStop(1, 'rgba(43,255,136,0.25)');
                g.fillStyle = grad;
                g.fillRect(left + i * bw + bw * 0.15, bottom - bh, bw * 0.7, bh);
                g.fillStyle = '#b9c3ff';
                g.font = '500 22px "Space Grotesk", system-ui, sans-serif';
                g.textAlign = 'center';
                g.fillText(String(i + 1), left + i * bw + bw / 2, bottom + 12);
                g.textAlign = 'left';
            });
            g.fillStyle = '#2bff88';
            g.font = '600 26px "Space Grotesk", system-ui, sans-serif';
            g.textAlign = 'right';
            g.fillText(`máx. ${money(vmax)}`, right, top + 4);
            g.textAlign = 'left';
        } else {
            g.fillStyle = '#b9c3ff';
            g.font = '500 30px "Space Grotesk", system-ui, sans-serif';
            g.fillText('Todavía no hay ventas este mes', left, top + 70);
        }
        screenLayer(R, sC, sSpan, y0, h, cv);

        // Derecha: los últimos movimientos, pasando hacia arriba.
        const lSpan = 0.46, lC = c - 0.37, headH = 1;
        const hc = canvasFor(R, lSpan, headH, 118);
        const hg = hc.getContext('2d');
        hg.fillStyle = '#ffffff';
        hg.font = '700 52px "Space Grotesk", system-ui, sans-serif';
        hg.textBaseline = 'middle';
        hg.fillText('Últimos movimientos', 32, hc.height / 2);
        screenLayer(R, lC, lSpan, y0 + h - headH, headH, hc);
        const rows = m.ultimos;
        const listH = h - headH - 0.15;
        const rowPx = 46, lw = canvasFor(R, lSpan, 1, 118).width;
        const visible = Math.round(listH * 118);
        const lc = document.createElement('canvas');
        lc.width = lw;
        lc.height = Math.min(4096, Math.max(visible, rows.length * rowPx));
        const lg = lc.getContext('2d');
        lg.textBaseline = 'middle';
        rows.forEach((r, i) => {
            const y = i * rowPx + rowPx / 2;
            if (i % 2) { lg.fillStyle = 'rgba(120,150,255,0.08)'; lg.fillRect(0, i * rowPx, lw, rowPx); }
            const col = TIPO_COLOR[r.tipo] || '#ffffff';
            lg.fillStyle = col;
            lg.beginPath(); lg.arc(22, y, 7, 0, Math.PI * 2); lg.fill();
            lg.fillStyle = '#b9c3ff';
            lg.font = '500 24px "JetBrains Mono", monospace';
            lg.fillText(`${r.fecha.slice(8, 10)}/${r.fecha.slice(5, 7)} ${r.fecha.slice(11, 16)}`, 40, y);
            lg.fillStyle = '#ffffff';
            lg.font = '500 25px "Space Grotesk", system-ui, sans-serif';
            // De una venta, a quién fue (cliente); si no, la descripción del movimiento.
            let d = `${(TIPO_COLOR[r.tipo] ? r.tipo[0].toUpperCase() + r.tipo.slice(1) : r.tipo)} · ${r.cliente || r.descripcion || r.pv}`;
            while (d.length > 4 && lg.measureText(d).width > lw - 430) d = d.slice(0, -2);
            lg.fillText(d, 232, y);
            lg.fillStyle = r.monto < 0 ? '#ff7088' : col;
            lg.font = '700 26px "JetBrains Mono", monospace';
            lg.textAlign = 'right';
            lg.fillText(money(r.monto), lw - 24, y);
            lg.textAlign = 'left';
        });
        if (!rows.length) {
            lg.fillStyle = '#b9c3ff';
            lg.font = '500 30px "Space Grotesk", system-ui, sans-serif';
            lg.fillText('Sin movimientos este mes', 32, 60);
        }
        const list = screenLayer(R, lC, lSpan, y0 + 0.1, listH, lc);
        const frac = visible / lc.height;
        if (frac < 1) {
            list.tex.wrapT = THREE.RepeatWrapping;
            list.tex.repeat.y = frac;
            let off = 0;
            anims.push((t, dt) => {
                off = (off + dt * 0.6 * rowPx / lc.height) % 1;   // ~0,6 filas por segundo
                list.tex.offset.y = 1 - frac - off;
            });
        }
    }

    // ---------- Estado de la empresa: tres pantallas de la calle (resumen, ventas por sucursal y por día) ----------
    // Se redibujan cuando llega serp_empresa_estado (cada 2 minutos).
    const estados = new Map();   // key_empresa -> datos de serp_empresa_estado

    function drawTower(key, panels) {
        const e = estados.get(key);
        const font = (w, size) => `${w} ${size}px "Space Grotesk", system-ui, sans-serif`;
        for (const { cv } of panels) cv.getContext('2d').clearRect(0, 0, cv.width, cv.height);
        const [A, B, C] = panels.map((p) => p.cv);
        const head = (cv, title, sub) => {
            const g = cv.getContext('2d');
            g.textBaseline = 'top'; g.textAlign = 'left';
            g.fillStyle = '#ffffff'; g.font = font(700, 54);
            let t = title;
            while (t.length > 3 && g.measureText(t).width > cv.width - 60) t = t.slice(0, -2) + '…';
            g.fillText(t, 30, 22);
            g.fillStyle = '#b9c3ff'; g.font = font(500, 28);
            g.fillText(sub, 32, 88);
            return g;
        };
        const nombre = e?.nombre || session?.empresas.find((x) => x.key === key)?.nombre || 'Empresa';
        if (!e) {
            for (const cv of [A, B, C]) head(cv, nombre, 'Cargando el estado de la empresa…');
            for (const p of panels) p.layer.tex.needsUpdate = true;
            return;
        }
        // A: resumen.
        let g = head(A, `Estado de ${nombre}`, `${e.mes} · actualizado ${e.actualizado}`);
        const tiles = [
            ['Ventas de hoy', money(e.ventas_hoy), '#2bff88', 'en cajas de hoy o abiertas'],
            ['Ventas del mes', money(e.ventas_mes), '#2bff88', `${e.cajas_mes} cajas`],
            ['Compras del mes', money(e.compras_mes), '#ffb02b', ''],
            ['Egresos del mes', money(e.egresos_mes), '#ff5c7a', 'compras, gastos y otros'],
            ['Cajas abiertas', String(e.cajas_abiertas), e.cajas_abiertas ? '#2bff88' : '#ff7088', 'ahora'],
            ['Sucursales · equipo', `${e.sucursales} · ${e.equipo}`, '#4ad6ff', 'personas en la empresa'],
        ];
        const cols = 3, gap = 18, tw = (A.width - 60 - gap * (cols - 1)) / cols, th = (A.height - 150 - gap) / 2;
        tiles.forEach(([label, value, col, note], i) => {
            const x = 30 + (i % cols) * (tw + gap), y = 140 + Math.floor(i / cols) * (th + gap);
            g.fillStyle = 'rgba(20,40,90,0.55)';
            g.beginPath(); g.roundRect(x, y, tw, th, 18); g.fill();
            g.strokeStyle = col; g.lineWidth = 3; g.stroke();
            g.fillStyle = col; g.font = font(600, 26); g.fillText(label, x + 18, y + 16);
            g.fillStyle = '#ffffff'; g.font = font(700, 50); g.fillText(value, x + 18, y + 52);
            if (note) { g.fillStyle = '#b9c3ff'; g.font = font(500, 22); g.fillText(note, x + 18, y + th - 36); }
        });
        // B: ventas del mes por sucursal.
        g = head(B, 'Ventas del mes por sucursal', `${e.mes} · luz verde = tiene caja abierta`);
        const rank = e.por_sucursal.slice(0, 8);
        const vmax = Math.max(...rank.map((r) => r.ventas_mes), 0);
        const rowH = (B.height - 150) / Math.max(rank.length, 1), nameW = 300;
        rank.forEach((r, i) => {
            const y = 140 + i * rowH, mid = y + rowH / 2;
            g.textBaseline = 'middle';
            g.fillStyle = r.cajas_abiertas ? '#2bff88' : 'rgba(185,195,255,0.35)';
            g.beginPath(); g.arc(42, mid, 8, 0, Math.PI * 2); g.fill();
            g.fillStyle = '#ffffff'; g.font = font(600, 28);
            let n = r.nombre;
            while (n.length > 3 && g.measureText(n).width > nameW - 70) n = n.slice(0, -2) + '…';
            g.fillText(n, 60, mid);
            const bw = vmax > 0 ? (B.width - nameW - 200) * r.ventas_mes / vmax : 0;
            const grad = g.createLinearGradient(nameW, 0, nameW + bw, 0);
            grad.addColorStop(0, 'rgba(43,255,136,0.35)'); grad.addColorStop(1, '#2bff88');
            g.fillStyle = grad;
            g.fillRect(nameW, mid - rowH * 0.3, Math.max(2, bw), rowH * 0.6);
            g.fillStyle = '#dfe4ff'; g.font = font(700, 26);
            g.fillText(money(r.ventas_mes), nameW + bw + 14, mid);
        });
        if (!rank.length) { g.fillStyle = '#b9c3ff'; g.font = font(500, 30); g.fillText('Sin sucursales', 30, 170); }
        // C: ventas por día.
        g = head(C, 'Ventas por día', `${e.mes} · ingresos del mes ${money(e.ingresos_mes)}`);
        const days = e.por_dia, dmax = Math.max(...days, 0);
        const left = 40, right = C.width - 30, top = 150, bottom = C.height - 50;
        if (days.length && dmax > 0) {
            const bw = (right - left) / days.length;
            days.forEach((v, i) => {
                const bh = (bottom - top) * v / dmax;
                const grad = g.createLinearGradient(0, bottom - bh, 0, bottom);
                grad.addColorStop(0, '#4ad6ff'); grad.addColorStop(1, 'rgba(74,214,255,0.25)');
                g.fillStyle = grad;
                g.fillRect(left + i * bw + bw * 0.15, bottom - bh, bw * 0.7, bh);
                if (days.length <= 16 || i % 2 === 0) {
                    g.fillStyle = '#b9c3ff'; g.font = font(500, 20); g.textAlign = 'center'; g.textBaseline = 'top';
                    g.fillText(String(i + 1), left + i * bw + bw / 2, bottom + 8);
                    g.textAlign = 'left';
                }
            });
            g.fillStyle = '#4ad6ff'; g.font = font(600, 24); g.textAlign = 'right'; g.textBaseline = 'top';
            g.fillText(`máx. ${money(dmax)}`, right, 92);
            g.textAlign = 'left';
        } else { g.fillStyle = '#b9c3ff'; g.font = font(500, 30); g.fillText('Todavía no hay ventas este mes', left, 180); }
        for (const p of panels) p.layer.tex.needsUpdate = true;
    }

    // ---------- Pantalla del equipo: la sucursal y los usuarios pasando con sus fotos ----------
    const photos = new Map();   // url -> canvas chico (o null si no hay foto)
    const photoQueue = [];
    let photoBusy = false;
    function loadPhoto(url, done) {
        if (photos.has(url)) return done(photos.get(url));
        photoQueue.push({ url, done });
        if (!photoBusy) nextPhoto();
    }
    function nextPhoto() {
        const job = photoQueue.shift();
        if (!job) { photoBusy = false; return; }
        photoBusy = true;
        if (photos.has(job.url)) { job.done(photos.get(job.url)); return nextPhoto(); }
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.decoding = 'async';
        img.onload = () => {
            // Se achica a 192 px: las originales pueden pesar más de 1 MB.
            const c = document.createElement('canvas');
            c.width = c.height = 192;
            const side = Math.min(img.width, img.height);
            c.getContext('2d').drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, 192, 192);
            photos.set(job.url, c);
            job.done(c);
            nextPhoto();
        };
        img.onerror = () => { photos.set(job.url, null); job.done(null); nextPhoto(); };
        img.src = job.url;
    }

    function initials(name) {
        return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '?';
    }

    function drawUserCard(g, W, H, u, photo) {
        const hue = hueOf(u.nombre);
        g.clearRect(0, 0, W, H);
        g.fillStyle = 'rgba(16,32,80,0.6)';
        g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 28); g.fill();
        g.strokeStyle = `hsl(${hue} 85% 65%)`; g.lineWidth = 4; g.stroke();
        const r = 92, cx = W / 2, cy = 40 + r;
        g.save();
        g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.closePath();
        if (photo) { g.clip(); g.drawImage(photo, cx - r, cy - r, r * 2, r * 2); }
        else {
            g.fillStyle = `hsl(${hue} 55% 35%)`; g.fill();
            g.fillStyle = '#ffffff';
            g.font = '700 72px "Space Grotesk", system-ui, sans-serif';
            g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(initials(u.nombre), cx, cy + 4);
        }
        g.restore();
        g.beginPath(); g.arc(cx, cy, r + 4, 0, Math.PI * 2);
        g.strokeStyle = `hsl(${hue} 85% 65%)`; g.lineWidth = 5; g.stroke();
        g.textAlign = 'center'; g.textBaseline = 'top';
        g.fillStyle = '#ffffff';
        g.font = '700 38px "Space Grotesk", system-ui, sans-serif';
        const words = u.nombre.split(/\s+/);
        let l1 = '', l2 = '';
        for (const w of words) {
            if (!l2 && g.measureText((l1 + ' ' + w).trim()).width <= W - 40) l1 = (l1 + ' ' + w).trim();
            else l2 = (l2 + ' ' + w).trim();
        }
        while (l2.length > 3 && g.measureText(l2).width > W - 40) l2 = l2.slice(0, -2) + '…';
        g.fillText(l1, cx, cy + r + 26);
        if (l2) g.fillText(l2, cx, cy + r + 70);
        g.fillStyle = '#b9c3ff';
        g.font = '500 28px "Space Grotesk", system-ui, sans-serif';
        g.fillText(when(u.ultima_actividad), cx, cy + r + (l2 ? 120 : 82));
    }

    const FONT = (w, size) => `${w} ${size}px "Space Grotesk", system-ui, sans-serif`;
    // Parte un texto en líneas que entren en maxW (como mucho maxLines; la última con «…»).
    function wrap(g, text, maxW, maxLines) {
        const out = [];
        for (const para of String(text || '').replace(/\r/g, '').split('\n')) {
            let line = '';
            for (let w of para.split(/\s+/).filter(Boolean)) {
                // Una palabra que no entra sola (una URL, un token) se corta donde haga falta.
                while (g.measureText(w).width > maxW && out.length < maxLines) {
                    let k = w.length - 1;
                    while (k > 1 && g.measureText(w.slice(0, k)).width > maxW) k--;
                    if (line) { out.push(line); line = ''; }
                    if (out.length < maxLines) out.push(w.slice(0, k));
                    w = w.slice(k);
                }
                const next = line ? `${line} ${w}` : w;
                if (g.measureText(next).width <= maxW) line = next;
                else { if (line) out.push(line); line = w; }
                if (out.length >= maxLines) break;
            }
            if (line && out.length < maxLines) out.push(line);
            if (out.length >= maxLines) break;
        }
        if (out.length === maxLines) {
            let last = out[maxLines - 1];
            while (last.length > 2 && g.measureText(last + '…').width > maxW) last = last.slice(0, -1);
            out[maxLines - 1] = last + '…';
        }
        return out;
    }
    const plain = (t) => String(t || '').replace(/^[\s#>*\-]+/gm, '').replace(/[*_`]/g, '');
    function dayLabel(iso, hoy) {
        if (!iso) return 'Sin fecha';
        const d = iso.slice(0, 10);
        const diff = Math.round((new Date(d + 'T12:00') - new Date(hoy + 'T12:00')) / 86400000);
        if (diff === 0) return 'Hoy';
        if (diff === 1) return 'Mañana';
        if (diff === -1) return 'Ayer';
        return new Date(d + 'T12:00').toLocaleDateString('es-BO', { weekday: 'short', day: 'numeric', month: 'short', year: d.slice(0, 4) === hoy.slice(0, 4) ? undefined : 'numeric' });
    }

    // Tarjetas con lo que se quiera (lines: [texto, 'peso tamaño', color]).
    function drawInfoCard(g, W, H, lines, accent = '#7c4dff') {
        g.clearRect(0, 0, W, H);
        g.fillStyle = 'rgba(60,30,120,0.6)';
        g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 28); g.fill();
        g.strokeStyle = accent; g.lineWidth = 4; g.stroke();
        g.textAlign = 'center'; g.textBaseline = 'top';
        let y = 40;
        for (const [text, font, color] of lines) {
            const size = parseInt(font.split(' ')[1], 10);
            g.font = `${font} "Space Grotesk", system-ui, sans-serif`;
            g.fillStyle = color;
            let t = String(text);
            while (t.length > 3 && g.measureText(t).width > W - 40) t = t.slice(0, -2) + '…';
            if (t) g.fillText(t, W / 2, y);
            y += size * 1.35;
        }
    }

    // ---------- Carrusel en una pantalla curva: las tarjetas pasan de derecha a izquierda ----------
    const shifts = new Map();   // dónde iba cada carrusel (no salta al actualizar los datos)
    function carousel({ id, R, c, span, y0, h, cards, cw, cvW, cvH, draw, speed = 0.07 }) {
        const step = (cw + 0.35) / R;              // ancho de una tarjeta, en radianes
        const loop = Math.max(cards.length * step, span + step);
        const tiles = cards.map((card, i) => {
            const cv = document.createElement('canvas');
            cv.width = cvW; cv.height = cvH;
            const tex = new THREE.CanvasTexture(cv);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            draw(cv.getContext('2d'), cv.width, cv.height, card, () => { tex.needsUpdate = true; });
            const mesh = new THREE.Mesh(arcPlane(R - 0.03, 0, cw / R, y0 + 0.2, h - 0.4, 12),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
            mesh.renderOrder = 3;
            const holder = new THREE.Group();
            holder.add(mesh);
            target.add(holder);
            return { holder, mesh, i };
        });
        const place = () => {
            const shift = shifts.get(id) || 0;
            for (const t of tiles) {
                const p = ((t.i * step - shift) % loop + loop) % loop;   // 0 = borde izquierdo
                const inside = p <= span - step;
                t.holder.visible = inside;
                if (!inside) continue;
                t.holder.rotation.y = c + span / 2 - step / 2 - p;
                const edge = Math.min(p, span - step - p) / (step * 0.6);
                t.mesh.material.opacity = Math.max(0, Math.min(1, edge));
            }
        };
        place();
        anims.push((t, dt) => { shifts.set(id, ((shifts.get(id) || 0) + dt * speed) % loop); place(); });
    }

    function userCard(g, W, H, u, redraw) {
        drawUserCard(g, W, H, u, u.foto ? photos.get(u.foto) : null);
        if (u.foto && !photos.has(u.foto)) loadPhoto(u.foto, (p) => { if (p) { drawUserCard(g, W, H, u, p); redraw(); } });
    }

    // ---------- Las pantallas de la calle de una empresa ----------
    // Integrantes, tus notas, tus tareas por fecha y las publicaciones (más las tres del estado). Notas y
    // tareas son de cada uno (las manda serp para quien mira); publicaciones, de todos.
    // Cada pantalla es un vidrio apenas curvo (un pedazo de cilindro de radio SPOT.R) dentro de su propio
    // grupo, parado en la vereda y mirando a la calle; las funciones de abajo dibujan en el SPOT actual.
    const mundos = new Map();   // key_empresa -> datos de serp_empresa_mundo
    const SPOT = { R: 40, c: Math.PI, span: STREET.panel / 40, y0: 1, h: 5.2, px: 125 };
    const SCREEN_COLOR = { resumen: 0x7c4dff, ranking: 0x2bff88, dias: 0x4ad6ff, equipo: 0x4ad6ff, notas: 0xffd166, tareas: 0x2bff88, publicaciones: 0xff5ca8 };

    function buildScreens(key) {
        if (plazas) {
            plazas.group.traverse((o) => {
                o.geometry?.dispose();
                const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
                for (const m of mats) { m.map?.dispose(); m.dispose(); }
            });
            content.remove(plazas.group);
            for (const o of plazas.obs) { const i = obstacles.indexOf(o); if (i >= 0) obstacles.splice(i, 1); }
            for (const r of [...fading.keys()]) if (!r.parent) fading.delete(r);
            plazas = null;
        }
        if (!street || street.key !== key) return;
        const group = new THREE.Group();
        group.userData.box = true;
        content.add(group);
        plazas = { group, anims: [], obs: [] };
        const prev = [target, anims, obs];
        const e = empresas.get(key), m = mundos.get(key);
        const estadoPanels = [];
        const v = new THREE.Vector3();
        try {
            for (const lot of street.lots.filter((l) => l.kind === 'screen')) {
                // El grupo se para en la vereda y mira a la calle: el vidrio queda a SPOT.R de su origen.
                const face = -lot.side;   // hacia el centro de la calle
                const panel = new THREE.Group();
                panel.position.set(lot.side * STREET.sx + face * SPOT.R, 0, lot.z);
                panel.rotation.y = Math.atan2(face, 0);
                group.add(panel);
                panel.updateMatrixWorld(true);
                const local = [];
                [target, anims, obs] = [panel, plazas.anims, local];
                glass(SPOT.R, SPOT.c, SPOT.span, SPOT.y0 - 0.1, SPOT.h + 0.2, SCREEN_COLOR[lot.screen]);
                if (lot.screen === 'equipo') plazaEquipo(key, e);
                else if (lot.screen === 'notas') plazaNotas(m);
                else if (lot.screen === 'tareas') plazaTareas(m);
                else if (lot.screen === 'publicaciones') plazaPublicaciones(m);
                else {
                    const titles = { resumen: 'Estado de la empresa', ranking: 'Ventas por sucursal', dias: 'Ventas por día' };
                    plazaLabel(titles[lot.screen], SPOT.c, `#${SCREEN_COLOR[lot.screen].toString(16).padStart(6, '0')}`);
                    const cv = canvasFor(SPOT.R, SPOT.span, SPOT.h, SPOT.px);
                    estadoPanels[['resumen', 'ranking', 'dias'].indexOf(lot.screen)] = { cv, layer: screenLayer(SPOT.R, SPOT.c, SPOT.span, SPOT.y0, SPOT.h, cv) };
                }
                // Los obstáculos (las patas) estaban en coordenadas del grupo: al mundo.
                for (const o of local) {
                    v.set(o.x, 0, o.z);
                    panel.localToWorld(v);
                    plazas.obs.push({ x: v.x, z: v.z, r: o.r });
                }
            }
            if (estadoPanels.length === 3 && estadoPanels.every(Boolean)) drawTower(key, estadoPanels);
        } finally {
            [target, anims, obs] = prev;
            obstacles.push(...plazas.obs);
        }
    }

    function plazaLabel(text, c, color) {
        const s = textSprite([{ text, size: 64, bold: true }], 6.5, { w: 1024, h: 160, border: color });
        s.position.set(SPOT.R * Math.sin(c), SPOT.y0 + SPOT.h + 0.8, SPOT.R * Math.cos(c));
        target.add(s);
    }

    function plazaEquipo(key, e) {
        const c = SPOT.c;
        const nombre = e?.nombre || session?.empresas.find((x) => x.key === key)?.nombre || 'Empresa';
        plazaLabel(`Integrantes de ${nombre}`, c, '#4ad6ff');
        if (!e) return;
        const est = estados.get(key);
        const info = [
            ['🏢 Empresa', '500 28px', '#b9c3ff'],
            [nombre, '700 44px', '#ffffff'],
            ['', '0 10px', ''],
            [`${e.sucursales.length} sucursal${e.sucursales.length === 1 ? '' : 'es'}`, '600 30px', '#ffffff'],
            [`Equipo: ${e.usuarios.length} personas`, '600 30px', '#ffffff'],
            ...(est ? [[`Ventas del mes: ${money(est.ventas_mes)}`, '600 30px', '#2bff88'], [`Cajas abiertas: ${est.cajas_abiertas}`, '500 28px', '#b9c3ff']] : []),
        ];
        carousel({
            id: `equipo:${key}`, R: SPOT.R - 0.05, c, span: SPOT.span, y0: SPOT.y0, h: SPOT.h, cw: 2.9, cvW: 384, cvH: 500,
            cards: [{ info }, ...e.usuarios],
            draw: (g, W, H, card, redraw) => (card.info ? drawInfoCard(g, W, H, card.info) : userCard(g, W, H, card, redraw)),
        });
    }

    function plazaNotas(m) {
        const c = SPOT.c;
        plazaLabel(m ? `Tus notas · ${m.notas.length}` : 'Tus notas', c, '#ffd166');
        const cv = canvasFor(SPOT.R, SPOT.span, SPOT.h, SPOT.px);
        const g = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        if (!m || !m.notas.length) {
            g.fillStyle = '#ffe9a8'; g.font = FONT(600, 40); g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(m ? 'No tienes notas en esta empresa' : 'Cargando tus notas…', W / 2, H / 2);
        } else {
            const cols = Math.max(3, Math.round(W / 250)), rows = 2, gap = 18, cw = (W - 40 - gap * (cols - 1)) / cols, ch = (H - 40 - gap) / rows;
            m.notas.slice(0, cols * rows).forEach((n, i) => {
                const x = 20 + (i % cols) * (cw + gap), y = 20 + Math.floor(i / cols) * (ch + gap);
                g.save();
                g.translate(x + cw / 2, y + ch / 2);
                g.rotate(((i * 37) % 7 - 3) * 0.008);   // un poco torcidas, como papelitos
                g.fillStyle = n.color || '#fff1a8';
                g.shadowColor = 'rgba(0,0,0,0.45)'; g.shadowBlur = 14; g.shadowOffsetY = 6;
                g.fillRect(-cw / 2, -ch / 2, cw, ch);
                g.restore();
                g.fillStyle = '#1c1630'; g.textAlign = 'left'; g.textBaseline = 'top';
                g.font = FONT(700, 24);
                wrap(g, n.titulo, cw - 28, 2).forEach((l, k) => g.fillText(l, x + 14, y + 14 + k * 28));
                g.font = FONT(500, 18);
                const body = plain(n.texto).split('\n').slice(1).join('\n');
                const fit = Math.max(1, Math.floor((ch - 76 - 36) / 22));   // que no pise la fecha de abajo
                wrap(g, body, cw - 28, fit).forEach((l, k) => g.fillText(l, x + 14, y + 76 + k * 22));
                g.fillStyle = 'rgba(28,22,48,0.6)'; g.font = FONT(500, 16);
                g.fillText(`${n.fecha}${n.participantes > 1 ? ` · 👥 ${n.participantes}` : ''}`, x + 14, y + ch - 26);
            });
            if (m.notas.length > cols * rows) {
                g.fillStyle = '#ffe9a8'; g.font = FONT(600, 22); g.textAlign = 'right'; g.textBaseline = 'bottom';
                g.fillText(`y ${m.notas.length - cols * rows} más en S-ERP`, W - 20, H - 2);
            }
        }
        screenLayer(SPOT.R, c, SPOT.span, SPOT.y0, SPOT.h, cv);
    }

    function plazaTareas(m) {
        const c = SPOT.c;
        const abiertas = m ? m.tareas.filter((t) => !t.cerrada) : [];
        plazaLabel(m ? `Tus tareas · ${abiertas.length} pendiente${abiertas.length === 1 ? '' : 's'}` : 'Tus tareas', c, '#2bff88');
        const cv = canvasFor(SPOT.R, SPOT.span, SPOT.h, SPOT.px);
        const g = cv.getContext('2d');
        const W = cv.width, H = cv.height;
        if (!m || !m.tareas.length) {
            g.fillStyle = '#b9ffd6'; g.font = FONT(600, 40); g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(m ? 'No tienes tareas en esta empresa' : 'Cargando tus tareas…', W / 2, H / 2);
        } else {
            // Dos columnas: pendientes (por fecha, las vencidas en rojo) y las últimas cerradas.
            const cerradas = m.tareas.filter((t) => t.cerrada).sort((a, b) => (b.inicio || '').localeCompare(a.inicio || ''));
            const col = (x, w, title, list, done) => {
                g.textAlign = 'left'; g.textBaseline = 'top';
                g.fillStyle = done ? '#9f8bff' : '#2bff88'; g.font = FONT(700, 34);
                g.fillText(title, x, 18);
                let y = 70, lastDay = null;
                for (const t of list) {
                    const day = dayLabel(t.inicio, m.hoy);
                    if (day !== lastDay) {
                        if (y > H - 80) break;
                        lastDay = day;
                        g.fillStyle = '#b9c3ff'; g.font = FONT(600, 22);
                        g.fillText(day.toUpperCase(), x, y);
                        y += 30;
                    }
                    if (y > H - 46) break;
                    const vencida = !done && (t.fin || t.inicio) && (t.fin || t.inicio).slice(0, 10) < m.hoy;
                    g.fillStyle = t.color || (done ? '#9f8bff' : vencida ? '#ff5c7a' : '#2bff88');
                    g.beginPath(); g.roundRect(x, y + 4, 8, 30, 4); g.fill();
                    g.fillStyle = done ? 'rgba(223,228,255,0.55)' : '#ffffff'; g.font = FONT(600, 26);
                    const hora = t.inicio && t.inicio.slice(11, 16) !== '00:00' ? `${t.inicio.slice(11, 16)}  ` : '';
                    let text = `${done ? '✓ ' : vencida ? '⚠ ' : ''}${hora}${t.descripcion}`;
                    while (text.length > 3 && g.measureText(text).width > w - 30) text = text.slice(0, -2) + '…';
                    g.fillText(text, x + 20, y + 6);
                    y += 44;
                }
                if (!list.length) { g.fillStyle = 'rgba(223,228,255,0.55)'; g.font = FONT(500, 26); g.fillText(done ? 'Ninguna' : '¡Nada pendiente!', x, 76); }
            };
            col(56, W * 0.56, 'Pendientes', abiertas, false);
            col(W * 0.62, W * 0.36, 'Cerradas', cerradas, true);
        }
        screenLayer(SPOT.R, c, SPOT.span, SPOT.y0, SPOT.h, cv);
    }

    function pubCard(g, W, H, p, redraw) {
        const paint = (photo) => {
            g.clearRect(0, 0, W, H);
            g.fillStyle = 'rgba(40,16,60,0.62)';
            g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 26); g.fill();
            g.strokeStyle = '#ff5ca8'; g.lineWidth = 4; g.stroke();
            const r = 34, cx = 30 + r, cy = 30 + r;
            g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.closePath();
            if (photo) { g.clip(); g.drawImage(photo, cx - r, cy - r, r * 2, r * 2); }
            else {
                g.fillStyle = `hsl(${hueOf(p.autor)} 55% 35%)`; g.fill();
                g.fillStyle = '#fff'; g.font = FONT(700, 28); g.textAlign = 'center'; g.textBaseline = 'middle';
                g.fillText(initials(p.autor), cx, cy + 2);
            }
            g.restore();
            g.textAlign = 'left'; g.textBaseline = 'top';
            g.fillStyle = '#ffffff'; g.font = FONT(700, 28);
            let a = p.autor;
            while (a.length > 3 && g.measureText(a).width > W - 130) a = a.slice(0, -2) + '…';
            g.fillText(a, cx + r + 16, 36);
            g.fillStyle = '#d9b8ff'; g.font = FONT(500, 22);
            g.fillText(when(p.fecha).replace(/^activo /, ''), cx + r + 16, 72);
            g.fillStyle = '#f3eaff'; g.font = FONT(500, 26);
            wrap(g, plain(p.texto), W - 60, 12).forEach((l, k) => g.fillText(l, 30, 124 + k * 34));
            g.fillStyle = '#ff8cc2'; g.font = FONT(700, 28);
            g.fillText(`❤ ${p.likes}    💬 ${p.comentarios}`, 30, H - 58);
        };
        paint(p.foto ? photos.get(p.foto) : null);
        if (p.foto && !photos.has(p.foto)) loadPhoto(p.foto, (ph) => { if (ph) { paint(ph); redraw(); } });
    }

    function plazaPublicaciones(m) {
        const c = SPOT.c;
        plazaLabel(m ? `Publicaciones · ${m.publicaciones.length}` : 'Publicaciones', c, '#ff5ca8');
        if (!m || !m.publicaciones.length) {
            const cv = canvasFor(SPOT.R, SPOT.span, SPOT.h, SPOT.px);
            const g = cv.getContext('2d');
            g.fillStyle = '#ffc2e0'; g.font = FONT(600, 40); g.textAlign = 'center'; g.textBaseline = 'middle';
            g.fillText(m ? 'Todavía no hay publicaciones en esta empresa' : 'Cargando publicaciones…', cv.width / 2, cv.height / 2);
            screenLayer(SPOT.R, c, SPOT.span, SPOT.y0, SPOT.h, cv);
            return;
        }
        carousel({
            id: `pubs:${m.key}`, R: SPOT.R - 0.05, c, span: SPOT.span, y0: SPOT.y0, h: SPOT.h, cw: 3.4, cvW: 460, cvH: 560,
            cards: m.publicaciones, draw: pubCard, speed: 0.05,
        });
    }

    // Arma el lugar (o lo rearma cuando llegan datos nuevos).
    function build(id) {
        clear();
        shownFor = id;
        if (!id.startsWith('e-')) street = null;
        if (!id.startsWith('s-')) sucStreet = null;
        if (id === LOBBY) setSize(radius, true);
        if (id === LOBBY) buildLobby();
        else if (id.startsWith('e-')) buildEmpresa(id.slice(2));
        else buildSucursal(id.slice(2));
    }

    // Al entrar a un lugar (lo llama goTo de world.js).
    function show(id) {
        clearInterval(refreshTimer);
        justEntered = false;   // lo marca spawnFor si apareces en la entrada
        const h = holeFor(id);
        returnHole.group.position.x = h.x;
        returnHole.group.position.z = h.z;
        build(id);
        armed = false;
        if (id.startsWith('e-')) {
            net.send({ type: 'serp_empresa', key: id.slice(2) });
            net.send({ type: 'serp_empresa_estado', key: id.slice(2) });
            net.send({ type: 'serp_empresa_mundo', key: id.slice(2) });
            refreshTimer = setInterval(() => {
                if (hereId() !== id) return;
                net.send({ type: 'serp_empresa_estado', key: id.slice(2) });
                net.send({ type: 'serp_empresa_mundo', key: id.slice(2) });
            }, REFRESH_MS * 2);
        }
        if (id.startsWith('s-')) {
            net.send({ type: 'serp_sucursal', key: id.slice(2) });
            refreshTimer = setInterval(() => { if (hereId() === id) net.send({ type: 'serp_sucursal', key: id.slice(2) }); }, REFRESH_MS);
        }
    }

    // Dónde apareces: delante de la puerta del lugar del que vienes, o junto a la salida.
    function spawnFor(id, from) {
        const d = from && doors.find((x) => x.to === from);
        if (d) {
            const ry = d.facing ?? Math.atan2(-d.x, -d.z);   // saliendo por la puerta, de espaldas a ella
            justEntered = id.startsWith('e-') && d.to === LOBBY;   // la puerta de la entrada de la calle
            return { x: d.x + Math.sin(ry) * 3.2, z: d.z + Math.cos(ry) * 3.2, ry };
        }
        if (id === LOBBY) return { x: 0, z: 3.2, ry: Math.PI };
        if (id.startsWith('s-') && sucStreet) return { x: 0, z: sucStreet.z0 - 2.5, ry: Math.PI };   // al inicio de la avenida
        if (id.startsWith('e-') && street) {   // al inicio de la calle
            justEntered = true;
            return { x: 0, z: street.z0 - 2.5, ry: Math.PI };
        }
        return { x: 0, z: 8.8, ry: Math.PI };
    }

    function go(to) {
        if (!session) return openLogin();
        comeFrom = hereId();
        travel(to);
    }

    // Cada cuadro, desde checkHoles: ¿entraste por una puerta?
    function checkDoors(x, z) {
        let nearest = Infinity, hit = null;
        for (const d of doors) {
            const dd = Math.hypot(x - d.x, z - d.z);
            if (dd < nearest) nearest = dd;
            if (dd < DOOR_R) hit = d;
        }
        if (!armed) { armed = nearest > ARM_DIST; return false; }
        if (hit) { armed = false; go(hit.to); return true; }
        return false;
    }

    // ---------- Que nada tape a tu personaje ----------
    // Rayos desde su cabeza y su cintura hasta la cámara: lo que cruzan (edificios, pantallas, carteles)
    // se vuelve casi transparente y vuelve a la normalidad cuando deja de estorbar.
    const ray = new THREE.Raycaster();
    const from = new THREE.Vector3(), dir = new THREE.Vector3();
    const fading = new Map();   // objeto de primer nivel en content -> cuánto se ve (0..1)
    // Lo de cada lugar (content) y lo que pone la gente (letreros, ítems, gráficos: hijos directos de la escena).
    const isBox = (p) => p === content || p === scene || p?.userData.box;
    function rootOf(o) {
        while (o.parent && !isBox(o.parent)) o = o.parent;
        return isBox(o.parent) ? o : null;
    }
    const fadeable = (o) => o !== content && !fixed.has(o) && !o.isLight && o !== player.parent;
    // (el grupo de las plazas no se desvanece entero: rootOf se detiene en cada cosa de adentro)
    function setFade(root, f) {
        root.traverse((o) => {
            const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
            for (const m of mats) {
                const u = m.userData;
                if (u.baseOpacity === undefined) { u.baseOpacity = m.opacity; u.baseTransparent = m.transparent; u.baseDepthWrite = m.depthWrite; }
                const faded = f < 0.999;
                if (m.transparent !== (faded || u.baseTransparent)) { m.transparent = faded || u.baseTransparent; m.needsUpdate = true; }
                m.depthWrite = faded ? false : u.baseDepthWrite;
                m.opacity = u.baseOpacity * f;
            }
        });
    }
    function updateOcclusion(dt) {
        const blocking = new Set();
        ray.camera = camera;
        for (const y of [1.5, 0.9]) {
            from.set(player.position.x, y, player.position.z);
            dir.subVectors(camera.position, from);
            const dist = dir.length();
            if (dist < 0.3) continue;
            ray.set(from, dir.normalize());
            ray.far = dist;
            for (const hit of ray.intersectObjects([...content.children, ...scene.children.filter(fadeable)], true)) {
                const r = rootOf(hit.object);
                if (r) blocking.add(r);
            }
        }
        // Los carteles flotantes muy cerca de la cámara también tapan la vista aunque no estén en la línea.
        for (const o of content.children) if (o.isSprite && o.position.distanceTo(camera.position) < 4) blocking.add(o);
        for (const r of blocking) if (!fading.has(r)) fading.set(r, 1);
        for (const [r, f] of fading) {
            const target = blocking.has(r) ? 0.15 : 1;
            const next = f + (target - f) * Math.min(1, dt * 8);
            if (Math.abs(next - f) > 0.001 || target !== 1) setFade(r, next);
            if (target === 1 && next > 0.995) { setFade(r, 1); fading.delete(r); }
            else fading.set(r, next);
        }
    }

    function update(dt, t) {
        for (const fn of animated) fn(t, dt);
        if (plazas) for (const fn of plazas.anims) fn(t, dt);
        updateOcclusion(dt);
    }

    function banner(id) {
        if (!owns(id)) return null;
        const byline = '🏢 S-ERP · solo te ven tus compañeros de la empresa';
        if (id === LOBBY) return { name: 'Mundo Empresas', description: 'Entra a una empresa por la puerta de su edificio. El puente (a un costado) vuelve al Mundo 3D.', byline };
        if (id.startsWith('e-')) {
            const k = id.slice(2);
            return { name: empresas.get(k)?.nombre || session?.empresas.find((x) => x.key === k)?.nombre || 'Empresa', description: 'Cada edificio es una sucursal.', byline };
        }
        const k = id.slice(2);
        const s = sucursales.get(k);
        const e = empresas.get(parentOf.get(k));
        const name = s?.nombre || e?.sucursales.find((x) => x.key === k)?.nombre || 'Sucursal';
        return { name, description: `${s?.empresa || e?.nombre || ''} · luz verde = caja abierta`.replace(/^ · /, ''), byline };
    }

    // ---------- Login (Ajustes → Mundo → 🏢 Mundo Empresas) ----------
    const box = document.querySelector('[data-serp-box]');
    const form = box.querySelector('[data-serp-form]');
    const errorEl = box.querySelector('[data-serp-error]');
    const submit = box.querySelector('[data-serp-submit]');
    const logoutBtn = box.querySelector('[data-serp-logout]');
    const who = box.querySelector('[data-serp-who]');
    let sending = false;

    function message(text) {
        errorEl.hidden = !text;
        errorEl.textContent = text || '';
    }
    function fillBox() {
        const inside = !!session;
        form.querySelector('[data-serp-fields]').hidden = inside;
        who.hidden = !inside;
        who.textContent = inside ? `Conectado como ${session.nombre} · ${session.empresas.length} empresa${session.empresas.length === 1 ? '' : 's'}` : '';
        submit.textContent = inside ? 'Ir al Mundo Empresas' : 'Entrar al Mundo Empresas';
        logoutBtn.hidden = !inside;
    }
    function openLogin() {
        message('');
        fillBox();
        box.hidden = false;
        if (!session) setTimeout(() => form.usuario.focus(), 50);
    }
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (session) { box.hidden = true; return go(LOBBY); }
        if (sending) return;
        if (!net.loggedIn) return message('Sin conexión con el servidor. Prueba otra vez en un momento.');
        const usuario = form.usuario.value.trim();
        const password = form.password.value;
        if (!usuario || !password) return message('Escribe tu usuario y tu contraseña de S-ERP.');
        sending = true;
        submit.disabled = true;
        message('');
        net.send({ type: 'serp_login', usuario, password });
    });
    box.querySelector('[data-serp-close]').addEventListener('click', () => { box.hidden = true; });
    logoutBtn.addEventListener('click', () => {
        let token = null;
        try { token = localStorage.getItem(TOKEN_KEY); } catch { /* modo privado */ }
        net.send({ type: 'serp_logout', token });
        logout();
    });

    function logout() {
        saveToken(null);
        session = null;
        empresas.clear(); sucursales.clear(); parentOf.clear();
        form.reset();
        fillBox();
        if (owns(hereId())) { onLeave(); flashHint('Saliste del Mundo Empresas'); }
    }

    net.on('serp_ok', (m) => {
        const first = !session;
        session = { nombre: m.nombre, empresas: m.empresas || [] };
        if (m.token) saveToken(m.token);
        sending = false;
        submit.disabled = false;
        form.password.value = '';
        fillBox();
        const id = hereId();
        if (owns(id) && box.hidden) {
            // Se cortó la conexión estando adentro y el token volvió a entrar: se vuelve a pedir el lugar
            // (y su empresa, para que el servidor conozca la sucursal).
            if (id.startsWith('s-') && parentOf.has(id.slice(2))) net.send({ type: 'serp_empresa', key: parentOf.get(id.slice(2)) });
            show(id);
            return;
        }
        if (first && !box.hidden) {
            box.hidden = true;
            go(LOBBY);
        } else if (hereId() === LOBBY) build(LOBBY);
    });
    net.on('serp_empresa_mundo', (m) => {
        mundos.set(m.key, m);
        if (shownFor === `e-${m.key}`) buildScreens(m.key);   // solo las pantallas: los edificios no se rearman
    });
    net.on('serp_empresa_estado', (m) => {
        estados.set(m.key, m);
        if (shownFor === `e-${m.key}`) buildScreens(m.key);
    });
    net.on('serp_empresa', (m) => {
        empresas.set(m.key, m);
        for (const s of m.sucursales) parentOf.set(s.key, m.key);
        if (shownFor === `e-${m.key}`) {
            // Antes de que lleguen las sucursales la calle es corta: al alargarse, la entrada se corre.
            // Solo si estás donde se aparece al entrar (recién llegaste por la puerta), te corres con ella. Al
            // recargar apareces en tu posición guardada, que ya es de la calle larga: ahí no se toca nada.
            const oldZ0 = street?.key === m.key ? street.z0 : null;
            build(shownFor);
            onInfo(shownFor);
            if (justEntered && oldZ0 !== null && street.z0 !== oldZ0) onShift(street.z0 - oldZ0);
            justEntered = false;
        }
        // Al recargar dentro de una sucursal, su nombre sale de la lista de la empresa.
        for (const s of m.sucursales) if (shownFor === `s-${s.key}`) onInfo(shownFor);
    });
    net.on('serp_sucursal', (m) => {
        sucursales.set(m.key, m);
        parentOf.set(m.key, m.key_empresa);
        if (shownFor === `s-${m.key}`) { build(shownFor); onInfo(shownFor); }
    });
    net.on('serp_error', (m) => {
        if (m.for === 'serp_login') {
            sending = false;
            submit.disabled = false;
            return message(m.message);
        }
        if (m.for === 'serp_resume') {
            // serp no respondió: el token sigue valiendo, se reintenta en la próxima conexión.
            if (owns(hereId())) onLeave();
            return flashHint(`Mundo Empresas: ${m.message}`);
        }
        flashHint(m.message);
        if (owns(hereId()) && hereId() !== LOBBY) go(LOBBY);
    });
    net.on('serp_login_required', () => {
        session = null;
        fillBox();
        if (owns(hereId())) { onLeave(); flashHint('Vuelve a entrar al Mundo Empresas desde Ajustes → Mundo'); }
    });
    net.on('serp_token_invalid', () => {
        saveToken(null);
        session = null;
        fillBox();
        if (owns(hereId())) { onLeave(); flashHint('Tu sesión de S-ERP venció: vuelve a entrar desde Ajustes → Mundo'); }
    });
    let kickAt = 0;
    net.on('serp_denied', (m) => flashHint(m.message));
    net.on('serp_kick', (m) => {
        const id = hereId();
        if (m.scene !== id) return;   // un aviso atrasado de un lugar del que ya saliste
        if (session && performance.now() - kickAt > 5000) {
            // Con sesión: el servidor todavía no sabe de este lugar (p. ej. justo después de reconectar).
            // Se le vuelve a pedir; si ya no eres miembro, responde serp_error y vuelves al barrio.
            kickAt = performance.now();
            const empresa = id.startsWith('e-') ? id.slice(2) : parentOf.get(id.slice(2));
            if (empresa) net.send({ type: 'serp_empresa', key: empresa });
            if (id.startsWith('s-')) net.send({ type: 'serp_sucursal', key: id.slice(2) });
            return;
        }
        if (session && performance.now() - kickAt <= 5000) return;
        session = null;
        if (owns(id)) { onLeave(); flashHint('Tu sesión de S-ERP terminó: vuelve a entrar desde Ajustes → Mundo'); }
    });
    // Reconexión: la sesión de S-ERP era de la conexión anterior. Si hay token, el servidor manda serp_ok
    // enseguida (después de login_ok); si no, se sale del Mundo Empresas.
    net.tap('login_ok', () => {
        session = null;
        fillBox();
        let token = null;
        try { token = localStorage.getItem(TOKEN_KEY); } catch { /* modo privado */ }
        if (!token && owns(hereId())) onLeave();
    });

    return {
        scene, obstacles, returnHole, owns, show, spawnFor, checkDoors, update, banner, openLogin,
        hole: (id) => (id.startsWith('e-') && street?.key === id.slice(2) ? street.hole
            : id.startsWith('s-') && sucStreet?.key === id.slice(2) ? sucStreet.hole : holeFor(id)),
        radius: () => size,
        ready: () => !!session,
        get comeFrom() { return comeFrom; },
    };
}
