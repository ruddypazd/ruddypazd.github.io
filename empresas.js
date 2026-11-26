// Mundo Empresas: las empresas de S-ERP dentro del Mundo 3D (el servidor es serp.py en nvidianim).
//
// Ajustes → Mundo → 🏢 Mundo Empresas pide el usuario y la contraseña de S-ERP. Con eso se entra a:
//   «empresas»      un barrio con un edificio por cada empresa de la que eres miembro
//   «e-<empresa>»   un edificio por sucursal
//   «s-<sucursal>»  sus puntos de venta (luz verde = caja abierta), las ventas de hoy y los usuarios
// Se entra por la puerta iluminada de cada edificio; la puerta suelta del lugar vuelve un nivel atrás
// y el puente del centro vuelve al Mundo 3D. Como las salas privadas, solo te ven quienes están en el
// mismo lugar (tus compañeros de esa empresa).
//
// La contraseña no se guarda en el navegador: queda en memoria mientras la pestaña está abierta, para
// volver a entrar solo si se corta la conexión.
import * as THREE from 'three';

export const LOBBY = 'empresas';
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

export function createEmpresas({ wormholes, net, travel, flashHint, hereId, MAIN, radius, onLeave }) {
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
    let creds = null;          // { usuario, password } solo en memoria
    let session = null;        // { nombre, empresas: [...] }
    let relogging = false;
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

    function title(lines, z = -radius + 8, width = 12) {
        const s = textSprite(lines, width, { w: 1024, h: 256, border: '#7c4dff' });
        s.position.set(0, 7.5, z);
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
        const back = textSprite([{ text: '← Barrio de empresas', size: 52, bold: true }], 3.2);
        back.position.set(0, 3.2, 8);
        content.add(back);
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
            { text: s ? `${s.empresa} · ventas de hoy: ${money(s.total_hoy)} · actualizado ${s.actualizado}` : 'Cargando…', size: 38, color: '#b9c3ff' }]);
        door(0, 9, Math.PI, `e-${empresaKey}`, 0x3d8bff);
        const back = textSprite([{ text: '← Volver a la empresa', size: 52, bold: true }], 3.2);
        back.position.set(0, 3.2, 9);
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

        // Gráfico de barras: ventas de hoy por punto de venta.
        const max = Math.max(...pvs.map((p) => p.ventas_hoy), 0);
        const cz = -radius + 22, gap = 1.6, x0 = -((pvs.length - 1) * gap) / 2;
        const base = new THREE.Mesh(new THREE.BoxGeometry(Math.max(4, pvs.length * gap + 1), 0.2, 2.2),
            new THREE.MeshStandardMaterial({ color: 0x1b2244, metalness: 0.4, roughness: 0.4 }));
        base.position.set(0, 0.1, cz);
        content.add(base);
        obstacles.push(...Array.from({ length: Math.max(1, Math.ceil(pvs.length * gap / 2)) }, (_, k) => ({ x: x0 + k * 2, z: cz, r: 1.3 })));
        pvs.forEach((pv, i) => {
            const hgt = 0.15 + (max > 0 ? 5 * pv.ventas_hoy / max : 0);
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
        const chartTitle = textSprite([{ text: 'Ventas de hoy', size: 60, bold: true }, { text: `Total ${money(s.total_hoy)}`, size: 44, color: '#2bff88' }], 4);
        chartTitle.position.set(0, 7.4 + 0.2, cz - 0.5);
        if (max > 0) content.add(chartTitle);
        else { chartTitle.position.y = 2.2; content.add(chartTitle); }

        // Usuarios de la empresa: letreros en arco detrás de la entrada.
        const users = s.usuarios || [];
        const ur = 16;
        users.forEach((u, i) => {
            const a = (i - (users.length - 1) / 2) * Math.min(0.17, 2.4 / Math.max(1, users.length));
            const x = Math.sin(a) * ur, z = Math.cos(a) * ur;
            const g = new THREE.Group();
            g.position.set(x, 0, z);
            g.rotation.y = a + Math.PI;
            const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.3), new THREE.MeshStandardMaterial({ color: 0x555b75 }));
            post.position.y = 0.65;
            g.add(post);
            const card = textPlane([{ text: u.nombre, size: 50, bold: true }, { text: when(u.ultima_actividad), size: 34, color: '#b9c3ff' }], 1.9,
                { border: `hsl(${hueOf(u.nombre)} 70% 60%)` });
            card.position.y = 1.75;
            card.material.side = THREE.DoubleSide;
            g.add(card);
            content.add(g);
        });
        if (users.length) {
            const t = textSprite([{ text: `Equipo de ${s.empresa}`, size: 54, bold: true }], 4.2);
            t.position.set(0, 3.6, ur + 1);
            content.add(t);
        }
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
        build(id);
        armed = false;
        if (id.startsWith('e-')) net.send({ type: 'serp_empresa', key: id.slice(2) });
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

    function update(dt, t) {
        for (const fn of animated) fn(t, dt);
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
        creds = { usuario, password };
        net.send({ type: 'serp_login', usuario, password });
    });
    box.querySelector('[data-serp-close]').addEventListener('click', () => { box.hidden = true; });
    logoutBtn.addEventListener('click', () => {
        net.send({ type: 'serp_logout' });
        logout();
    });

    function logout() {
        creds = null;
        session = null;
        empresas.clear(); sucursales.clear(); parentOf.clear();
        form.reset();
        fillBox();
        if (owns(hereId())) { onLeave(); flashHint('Saliste del Mundo Empresas'); }
    }

    net.on('serp_ok', (m) => {
        const first = !session;
        session = { nombre: m.nombre, empresas: m.empresas || [] };
        sending = false;
        submit.disabled = false;
        form.password.value = '';
        fillBox();
        if (relogging) {
            // Se cortó la conexión estando adentro: vuelve a pedir el lugar (y su empresa, para la sucursal).
            relogging = false;
            const id = hereId();
            if (id.startsWith('s-') && parentOf.has(id.slice(2))) net.send({ type: 'serp_empresa', key: parentOf.get(id.slice(2)) });
            if (owns(id)) show(id);
            return;
        }
        if (first && !box.hidden) {
            box.hidden = true;
            go(LOBBY);
        } else if (hereId() === LOBBY) build(LOBBY);
    });
    net.on('serp_empresa', (m) => {
        empresas.set(m.key, m);
        for (const s of m.sucursales) parentOf.set(s.key, m.key);
        if (shownFor === `e-${m.key}`) build(shownFor);
    });
    net.on('serp_sucursal', (m) => {
        sucursales.set(m.key, m);
        parentOf.set(m.key, m.key_empresa);
        if (shownFor === `s-${m.key}`) build(shownFor);
    });
    net.on('serp_error', (m) => {
        if (m.for === 'serp_login') {
            sending = false;
            submit.disabled = false;
            creds = null;
            if (relogging) { relogging = false; logout(); return flashHint(m.message); }
            return message(m.message);
        }
        flashHint(m.message);
        if (owns(hereId()) && hereId() !== LOBBY) go(LOBBY);
    });
    net.on('serp_login_required', () => {
        if (creds && !relogging) { relogging = true; net.send({ type: 'serp_login', ...creds }); }
        else if (!creds && owns(hereId())) logout();
    });
    let kickAt = 0;
    net.on('serp_kick', (m) => {
        if (relogging) return;   // la sesión vuelve enseguida
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
    // Reconexión: la sesión de S-ERP era de la conexión anterior.
    net.tap('login_ok', () => {
        session = null;
        if (creds && owns(hereId())) { relogging = true; net.send({ type: 'serp_login', ...creds }); }
        else if (owns(hereId())) onLeave();
        fillBox();
    });

    return {
        scene, obstacles, returnHole, owns, show, spawnFor, checkDoors, update, banner, openLogin,
        get comeFrom() { return comeFrom; },
    };
}
