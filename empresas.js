// Mundo Empresas: las empresas de S-ERP dentro del Mundo 3D (el servidor es serp.py en nvidianim).
//
// Ajustes → Mundo → 🏢 Mundo Empresas pide el usuario y la contraseña de S-ERP. Con eso se entra a:
//   «empresas»      un barrio con un edificio por cada empresa de la que eres miembro
//   «e-<empresa>»   un edificio por sucursal
//   «s-<sucursal>»  sus puntos de venta (luz verde = caja abierta), las ventas de hoy y los usuarios
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
    if (id.startsWith('s-')) return { x: -10.5, z: 3 };
    if (id.startsWith('e-')) return { x: -6, z: 4 };
    return { x: -7, z: 4 };
}

export function createEmpresas({ wormholes, net, travel, flashHint, hereId, MAIN, radius, onLeave, onInfo, camera, player }) {
    // ---------- La escena (una sola para todos los lugares: se rearma al cambiar) ----------
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b1a);
    scene.fog = new THREE.Fog(0x070b1a, 18, 75);
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
    // Calles: anillos suaves alrededor del centro.
    for (const r of [5, 11]) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r + 0.06, 96),
            new THREE.MeshBasicMaterial({ color: 0x3d5bd9, transparent: true, opacity: 0.5 }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.y = 0.02;
        scene.add(ring);
    }
    const returnHole = wormholes.makeHole({ scene, x: 0, z: 0 });
    returnHole.id = MAIN;

    const content = new THREE.Group();
    scene.add(content);
    const obstacles = [];
    let doors = [];            // { x, z, to, from? }
    let armed = false;
    const animated = [];       // cosas que se mueven (puertas que brillan, luces)
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

    const owns = (id) => typeof id === 'string' && SCENE_RE.test(id);

    function clear() {
        content.traverse((o) => {
            o.geometry?.dispose();
            const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
            for (const m of mats) { m.map?.dispose(); m.emissiveMap?.dispose(); m.dispose(); }
        });
        content.clear();
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
        animated.push((t) => { glow.material.opacity = 0.4 + 0.2 * Math.sin(t * 2.4 + x); });
        content.add(g);
        doors.push({ x: x + Math.sin(facing) * 0.6, z: z + Math.cos(facing) * 0.6, to });
        return g;
    }

    // Un edificio mirando al centro, con su puerta, su letrero y (si hay) el logo.
    function building({ x, z, w, d, h, hue, title, subtitle, to, logo }) {
        const a = Math.atan2(x, z);          // ángulo desde el centro
        const facing = a + Math.PI;           // el frente mira al centro
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
        content.add(g);
        const r = Math.max(w, d) / 2 + 0.4;
        obstacles.push({ x, z, r });
        // La puerta, delante del frente (afuera del obstáculo para poder llegar).
        const dist = Math.hypot(x, z) - (r + 0.15);
        door(Math.sin(a) * dist, Math.cos(a) * dist, facing, to, new THREE.Color().setHSL(hue / 360, 0.9, 0.6).getHex());
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
        content.add(s);
    }

    function loading(text) {
        const s = textSprite([{ text, size: 60, bold: true }], 6);
        s.position.set(0, 2.4, -6);
        content.add(s);
    }

    // ---------- Los tres tipos de lugar ----------
    function buildLobby() {
        const list = session?.empresas || [];
        title([{ text: 'Mundo Empresas', size: 90, bold: true }, { text: `Hola, ${session?.nombre || ''} · entra a tu empresa por su puerta`, size: 40, color: '#b9c3ff' }]);
        ring(list.length, 15, 8).forEach((p, i) => {
            const e = list[i];
            const hue = hueOf(e.key);
            building({ ...p, w: 5.4, d: 4.4, h: 6 + (hue % 5), hue, title: e.nombre, to: `e-${e.key}`, logo: e.logo });
        });
        if (!list.length) loading('Sin empresas');
    }

    function buildEmpresa(key) {
        const e = empresas.get(key);
        const base = session?.empresas.find((x) => x.key === key);
        title([{ text: e?.nombre || base?.nombre || 'Empresa', size: 90, bold: true },
            { text: e ? `${e.sucursales.length} sucursal${e.sucursales.length === 1 ? '' : 'es'} · entra por la puerta de cada una` : 'Cargando…', size: 40, color: '#b9c3ff' }]);
        door(0, 8, Math.PI, LOBBY, 0x3d8bff);
        const back = textSprite([{ text: '← Barrio de empresas', size: 52, bold: true }], 2.2, { h: 128 });
        back.position.set(0, 2.95, 8);
        content.add(back);
        estadoTower(key);
        if (!e) return loading('Cargando sucursales…');
        ring(e.sucursales.length, 14, 7.5).forEach((p, i) => {
            const s = e.sucursales[i];
            const hue = (hueOf(key) + i * 37) % 360;
            building({ ...p, w: 4.6, d: 4, h: 4.5 + (hueOf(s.key) % 3), hue, title: s.nombre, subtitle: s.direccion, to: `s-${s.key}` });
        });
        if (!e.sucursales.length) loading('Esta empresa no tiene sucursales');
    }

    function buildSucursal(key) {
        const s = sucursales.get(key);
        const empresaKey = parentOf.get(key);
        const name = s?.nombre || empresas.get(empresaKey)?.sucursales.find((x) => x.key === key)?.nombre || 'Sucursal';
        title([{ text: name, size: 90, bold: true },
            { text: s ? `${s.empresa} · ventas de hoy: ${money(s.total_hoy)} · actualizado ${s.actualizado}` : 'Cargando…', size: 38, color: '#b9c3ff' }], -23, 12, 10.2);
        door(0, 9, Math.PI, `e-${empresaKey}`, 0x3d8bff);
        const back = textSprite([{ text: '← Volver a la empresa', size: 52, bold: true }], 2.2, { h: 128 });
        back.position.set(0, 2.95, 9);
        content.add(back);
        if (!s) return loading('Cargando la sucursal…');

        // Puntos de venta: un kiosco con su luz (verde = caja abierta).
        const pvs = s.puntos_venta;
        ring(pvs.length, 6.5, 4).forEach((p, i) => {
            const pv = pvs[i];
            const open = pv.caja === 'abierta';
            const g = new THREE.Group();
            g.position.set(p.x, 0, p.z);
            g.rotation.y = Math.atan2(p.x, p.z) + Math.PI;
            const counter = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.05, 0.8),
                new THREE.MeshStandardMaterial({ color: 0x2a3150, roughness: 0.5, metalness: 0.3 }));
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
            if (open) animated.push((t) => { lamp.material.emissiveIntensity = 1.6 + 0.6 * Math.sin(t * 3 + i); });
            content.add(g);
            const label = textSprite([
                { text: pv.nombre, size: 46, bold: true },
                { text: open ? '● Caja abierta' : '● Caja cerrada', size: 34, color: open ? '#2bff88' : '#ff7088' },
                { text: `Hoy: ${money(pv.ventas_hoy)} · ${pv.ventas_cantidad} venta${pv.ventas_cantidad === 1 ? '' : 's'}`, size: 34, color: '#dfe4ff' },
            ], 2.6, { border: open ? '#2bff88' : '#ff3b5c' });
            label.position.set(p.x, 3.3, p.z);
            content.add(label);
            obstacles.push({ x: p.x, z: p.z, r: 1.15 });
        });
        if (!pvs.length) loading('Sin puntos de venta');

        // Gráfico de barras: ventas de hoy por punto de venta (entre los kioscos y la pantalla del mes).
        const max = Math.max(...pvs.map((p) => p.ventas_hoy), 0);
        const cz = -14, gap = 1.6, x0 = -((pvs.length - 1) * gap) / 2;
        const base = new THREE.Mesh(new THREE.BoxGeometry(Math.max(4, pvs.length * gap + 1), 0.2, 2.2),
            new THREE.MeshStandardMaterial({ color: 0x1b2244, metalness: 0.4, roughness: 0.4 }));
        base.position.set(0, 0.1, cz);
        content.add(base);
        obstacles.push(...Array.from({ length: Math.max(1, Math.ceil(pvs.length * gap / 2)) }, (_, k) => ({ x: x0 + k * 2, z: cz, r: 1.3 })));
        pvs.forEach((pv, i) => {
            const hgt = 0.15 + (max > 0 ? 4 * pv.ventas_hoy / max : 0);
            const color = new THREE.Color().setHSL(((i * 47) % 360) / 360, 0.8, 0.58);
            const bar = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35 }));
            bar.scale.set(1.1, 0.001, 1.1);
            bar.position.set(x0 + i * gap, 0.2, cz);
            content.add(bar);
            let grown = 0;
            animated.push((t, dt) => {
                if (grown >= 1) return;
                grown = Math.min(1, grown + dt * 1.4);
                const e = 1 - (1 - grown) ** 3;
                bar.scale.y = Math.max(0.001, hgt * e);
                bar.position.y = 0.2 + bar.scale.y / 2;
            });
            const v = textSprite([{ text: money(pv.ventas_hoy), size: 56, bold: true }, { text: pv.nombre, size: 36, color: '#b9c3ff' }], 1.9, { bg: 'rgba(10,14,30,0.7)', border: null });
            v.position.set(x0 + i * gap, 0.6 + hgt + 0.55, cz);
            content.add(v);
        });
        const chartTitle = textSprite([{ text: 'Ventas de hoy', size: 60, bold: true }, { text: `Total ${money(s.total_hoy)}`, size: 44, color: '#2bff88' }], 3.4);
        chartTitle.position.set(0, max > 0 ? 5.6 : 2.2, cz - 0.5);
        content.add(chartTitle);

        monthScreen(s);
        teamScreen(s);
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
        content.add(back);
        const sheen = new THREE.Mesh(arcPlane(R + 0.02 * d, c, span, y0, h, 48, out), new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.07, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        sheen.renderOrder = 1;
        content.add(sheen);
        const edgeMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
        for (const y of [y0 - 0.04, y0 + h - 0.02]) {
            const line = new THREE.Mesh(arcPlane(R, c, span + 0.004, y, 0.07, 48, out), edgeMat);
            line.renderOrder = 4;
            content.add(line);
        }
        const postMat = new THREE.MeshStandardMaterial({ color: 0x20243a, metalness: 0.6, roughness: 0.35 });
        for (const a of [c - span / 2, c + span / 2]) {
            const edge = new THREE.Mesh(new THREE.BoxGeometry(0.08, h, 0.08), edgeMat);
            edge.position.set(R * Math.sin(a), y0 + h / 2, R * Math.cos(a));
            content.add(edge);
            if (y0 > 0.3) {
                const leg = new THREE.Mesh(new THREE.BoxGeometry(0.18, y0, 0.18), postMat);
                leg.position.set(R * Math.sin(a), y0 / 2, R * Math.cos(a));
                content.add(leg);
            }
            obstacles.push({ x: R * Math.sin(a), z: R * Math.cos(a), r: 0.5 });
        }
        // Una línea de luz que recorre el vidrio de arriba abajo.
        const scan = new THREE.Mesh(arcPlane(R + 0.01 * d, c, span, 0, 0.05, 48, out), new THREE.MeshBasicMaterial({
            color, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        scan.renderOrder = 4;
        content.add(scan);
        animated.push((t) => { scan.position.y = y0 + ((t * 0.35) % 1) * h; });
    }

    // Lo que se dibuja sobre el vidrio (un canvas transparente, un poco más cerca del centro).
    function screenLayer(R, c, span, y0, h, canvas, out = false) {
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
        const mesh = new THREE.Mesh(arcPlane(R - 0.02 * (out ? -1 : 1), c, span, y0, h, 48, out), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
        mesh.renderOrder = 3;
        content.add(mesh);
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
        const R = 24, c = Math.PI, y0 = 1, h = 7;
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
            animated.push((t, dt) => {
                off = (off + dt * 0.6 * rowPx / lc.height) % 1;   // ~0,6 filas por segundo
                list.tex.offset.y = 1 - frac - off;
            });
        }
    }

    // ---------- Torre del centro de una empresa: su estado en tres paneles de vidrio ----------
    // Mirando hacia afuera: hacia la entrada, el resumen; a los lados, el ranking de sucursales y las ventas
    // por día. Se redibuja cuando llega serp_empresa_estado (cada 2 minutos) sin rearmar el lugar.
    const estados = new Map();   // key_empresa -> datos de serp_empresa_estado
    let tower = null;            // { key, draw() }
    const TOWER = { R: 3.6, y0: 0.7, h: 3, span: (2 * Math.PI) / 3 - 0.16, px: 170 };
    function estadoTower(key) {
        const { R, y0, h, span, px } = TOWER;
        const panels = [0, (2 * Math.PI) / 3, (-2 * Math.PI) / 3].map((c, i) => {
            glass(R, c, span, y0 - 0.1, h + 0.2, [0x7c4dff, 0x2bff88, 0x4ad6ff][i], true);
            const cv = canvasFor(R, span, h, px);
            return { cv, layer: screenLayer(R, c, span, y0, h, cv, true) };
        });
        // Un pedestal que brilla debajo.
        const base = new THREE.Mesh(new THREE.CylinderGeometry(R + 0.3, R + 0.5, 0.3, 64),
            new THREE.MeshStandardMaterial({ color: 0x141a36, metalness: 0.6, roughness: 0.35, emissive: 0x1d1450 }));
        base.position.y = 0.15;
        content.add(base);
        obstacles.push({ x: 0, z: 0, r: R + 0.6 });
        tower = { key, draw: () => drawTower(key, panels) };
        tower.draw();
    }

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

    function drawInfoCard(g, W, H, s) {
        g.clearRect(0, 0, W, H);
        g.fillStyle = 'rgba(60,30,120,0.6)';
        g.beginPath(); g.roundRect(6, 6, W - 12, H - 12, 28); g.fill();
        g.strokeStyle = '#7c4dff'; g.lineWidth = 4; g.stroke();
        g.textAlign = 'center'; g.textBaseline = 'top';
        const cx = W / 2;
        const open = s.puntos_venta.filter((p) => p.caja === 'abierta').length;
        const venta = s.mes?.totales.find((t) => t.tipo === 'venta');
        const lines = [
            ['📍 Sucursal', '500 28px', '#b9c3ff'],
            [s.nombre, '700 44px', '#ffffff'],
            [s.direccion || s.empresa, '500 24px', '#b9c3ff'],
            ['', '0 12px', ''],
            [`Cajas abiertas: ${open} de ${s.puntos_venta.length}`, '600 30px', open ? '#2bff88' : '#ff7088'],
            [`Ventas de hoy: ${money(s.total_hoy)}`, '600 30px', '#ffffff'],
            [`Ventas del mes: ${money(venta?.monto || 0)}`, '600 30px', '#ffffff'],
            [`Equipo: ${s.usuarios.length} personas`, '500 26px', '#b9c3ff'],
        ];
        let y = 40;
        for (const [text, font, color] of lines) {
            const size = parseInt(font.split(' ')[1], 10);
            g.font = `${font} "Space Grotesk", system-ui, sans-serif`;
            g.fillStyle = color;
            let t = String(text);
            while (t.length > 3 && g.measureText(t).width > W - 40) t = t.slice(0, -2) + '…';
            if (t) g.fillText(t, cx, y);
            y += size * 1.35;
        }
    }

    let teamShift = 0;   // se mantiene al actualizar los datos (la pantalla no salta)
    function teamScreen(s) {
        const R = 15.5, c = 0, span = 1.5, y0 = 1.1, h = 3.4;
        glass(R, c, span, y0 - 0.1, h + 0.2, 0x4ad6ff);
        const cards = [{ info: true }, ...s.usuarios];
        const cw = 2.6, step = (cw + 0.35) / R;              // ancho de una tarjeta, en radianes
        const loop = Math.max(cards.length * step, span + step);
        const tiles = cards.map((card, i) => {
            const cv = document.createElement('canvas');
            cv.width = 384; cv.height = 500;
            const g = cv.getContext('2d');
            const tex = new THREE.CanvasTexture(cv);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            if (card.info) drawInfoCard(g, cv.width, cv.height, s);
            else {
                drawUserCard(g, cv.width, cv.height, card, card.foto ? photos.get(card.foto) : null);
                if (card.foto && !photos.has(card.foto)) loadPhoto(card.foto, (p) => { if (p) { drawUserCard(g, cv.width, cv.height, card, p); tex.needsUpdate = true; } });
            }
            const mesh = new THREE.Mesh(arcPlane(R - 0.03, 0, cw / R, y0 + 0.2, h - 0.4, 12),
                new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
            mesh.renderOrder = 3;
            const holder = new THREE.Group();
            holder.add(mesh);
            content.add(holder);
            return { holder, mesh, i };
        });
        // Pasan de derecha a izquierda (vistas desde el centro) y se desvanecen en los bordes.
        const place = () => {
            for (const t of tiles) {
                const p = ((t.i * step - teamShift) % loop + loop) % loop;   // 0 = borde izquierdo
                const a = c + span / 2 - step / 2 - p;
                const inside = p <= span - step;
                t.holder.visible = inside;
                if (!inside) continue;
                t.holder.rotation.y = a;
                const edge = Math.min(p, span - step - p) / (step * 0.6);
                t.mesh.material.opacity = Math.max(0, Math.min(1, edge));
            }
        };
        place();
        animated.push((t, dt) => { teamShift = (teamShift + dt * 0.07) % loop; place(); });
        const label = textSprite([{ text: `Equipo de ${s.empresa}`, size: 64, bold: true }], 7, { w: 1024, h: 160, border: '#4ad6ff' });
        label.position.set(0, y0 + h + 0.8, R);
        content.add(label);
    }

    // Arma el lugar (o lo rearma cuando llegan datos nuevos).
    function build(id) {
        clear();
        shownFor = id;
        if (id === LOBBY) buildLobby();
        else if (id.startsWith('e-')) buildEmpresa(id.slice(2));
        else buildSucursal(id.slice(2));
    }

    // Al entrar a un lugar (lo llama goTo de world.js).
    function show(id) {
        clearInterval(refreshTimer);
        const h = holeFor(id);
        returnHole.group.position.x = h.x;
        returnHole.group.position.z = h.z;
        build(id);
        armed = false;
        if (id.startsWith('e-')) {
            net.send({ type: 'serp_empresa', key: id.slice(2) });
            net.send({ type: 'serp_empresa_estado', key: id.slice(2) });
            refreshTimer = setInterval(() => { if (hereId() === id) net.send({ type: 'serp_empresa_estado', key: id.slice(2) }); }, REFRESH_MS * 2);
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
            const ry = Math.atan2(-d.x, -d.z);   // mirando al centro
            return { x: d.x + Math.sin(ry) * 2.2, z: d.z + Math.cos(ry) * 2.2, ry };
        }
        if (id === LOBBY) return { x: 0, z: 3.2, ry: Math.PI };
        return { x: 0, z: id.startsWith('s-') ? 7.4 : 6.4, ry: Math.PI };
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
    function rootOf(o) {
        while (o.parent && o.parent !== content) o = o.parent;
        return o.parent === content ? o : null;
    }
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
            for (const hit of ray.intersectObjects(content.children, true)) {
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
        updateOcclusion(dt);
    }

    function banner(id) {
        if (!owns(id)) return null;
        const byline = '🏢 S-ERP · solo te ven tus compañeros de la empresa';
        if (id === LOBBY) return { name: 'Mundo Empresas', description: 'Entra a una empresa por la puerta de su edificio. El puente del centro vuelve al Mundo 3D.', byline };
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
    net.on('serp_empresa_estado', (m) => {
        estados.set(m.key, m);
        if (shownFor === `e-${m.key}` && tower?.key === m.key) tower.draw();
    });
    net.on('serp_empresa', (m) => {
        empresas.set(m.key, m);
        for (const s of m.sucursales) parentOf.set(s.key, m.key);
        if (shownFor === `e-${m.key}`) { build(shownFor); onInfo(shownFor); }
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
        hole: (id) => holeFor(id),
        ready: () => !!session,
        get comeFrom() { return comeFrom; },
    };
}
