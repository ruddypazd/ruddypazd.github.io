/* ===========================================================
   Roy Ruddy Paz — Portafolio AI/ML · Interacciones
   =========================================================== */

document.addEventListener('DOMContentLoaded', () => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    /* ---- Año dinámico ---- */
    const yearEl = document.querySelector('[data-year]');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    /* ---- Nav: estado al hacer scroll ---- */
    const nav = document.querySelector('.nav');
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    /* ---- Menú móvil ---- */
    const burger = document.querySelector('.nav__burger');
    const links = document.querySelector('.nav__links');
    const overlay = document.querySelector('.nav__overlay');
    const setMenu = (open) => {
        burger.classList.toggle('open', open);
        links.classList.toggle('open', open);
        if (overlay) overlay.classList.toggle('open', open);
        document.body.classList.toggle('nav-open', open);
        burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    };
    burger.addEventListener('click', () => setMenu(!links.classList.contains('open')));
    if (overlay) overlay.addEventListener('click', () => setMenu(false));
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });

    /* ---- Reveal al hacer scroll ---- */
    const revealEls = document.querySelectorAll('.reveal');
    if ('IntersectionObserver' in window && !reduceMotion) {
        const io = new IntersectionObserver((entries) => {
            entries.forEach((e, i) => {
                if (e.isIntersecting) {
                    setTimeout(() => e.target.classList.add('in'), i * 60);
                    io.unobserve(e.target);
                }
            });
        }, { threshold: 0.12 });
        revealEls.forEach(el => io.observe(el));
    } else {
        revealEls.forEach(el => el.classList.add('in'));
    }

    /* ---- Contadores animados ---- */
    const counters = document.querySelectorAll('[data-count]');
    const animateCount = (el) => {
        const target = +el.dataset.count;
        const dur = 1400;
        const start = performance.now();
        const step = (now) => {
            const p = Math.min((now - start) / dur, 1);
            el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target);
            if (p < 1) requestAnimationFrame(step);
            else el.textContent = target;
        };
        requestAnimationFrame(step);
    };
    if ('IntersectionObserver' in window && !reduceMotion) {
        const co = new IntersectionObserver((entries) => {
            entries.forEach(e => {
                if (e.isIntersecting) { animateCount(e.target); co.unobserve(e.target); }
            });
        }, { threshold: 0.5 });
        counters.forEach(c => co.observe(c));
    } else {
        counters.forEach(c => c.textContent = c.dataset.count);
    }

    /* ---- Efecto typing en el rol ---- */
    const roleEl = document.querySelector('[data-typing]');
    if (roleEl && !reduceMotion) {
        const roles = [
            'CEO @ Servisofts',
            'CTO @ UpLabs AI',
            'Ingeniero de Software Full-Stack',
            'IA + Telefonía IP (Asterisk)',
            'Desarrollo de ERP & CRM',
        ];
        let ri = 0, ci = 0, deleting = false;
        const tick = () => {
            const word = roles[ri];
            ci += deleting ? -1 : 1;
            roleEl.textContent = word.slice(0, ci);
            let delay = deleting ? 45 : 90;
            if (!deleting && ci === word.length) { delay = 1800; deleting = true; }
            else if (deleting && ci === 0) { deleting = false; ri = (ri + 1) % roles.length; delay = 400; }
            setTimeout(tick, delay);
        };
        roleEl.textContent = '';
        setTimeout(tick, 600);
    }

    /* ---- Aviso para el botón de CV (placeholder) ---- */
    const cvBtn = document.querySelector('[data-cv]');
    if (cvBtn) {
        cvBtn.addEventListener('click', (e) => {
            e.preventDefault();
            alert('Sube tu CV en PDF al repositorio (p.ej. cv.pdf) y enlázalo aquí desde index.html.');
        });
    }

    /* ---- Contador de visitas (Cloudflare Worker + KV) ---- */
    initVisitCounter();

    /* ---- Socket compartido: sesión en vivo + chat con IA ---- */
    initLiveSession();
    initChat();
    rpSocket.start();   // una sola conexión para ambos

    /* ---- Fondo: red de partículas estilo cyber ---- */
    initParticles(reduceMotion);

    /* ---- Diagrama de infraestructura (skills) ---- */
    initInfraDiagram();
});

/* ===========================================================
   Diagrama de infraestructura — conexiones SVG entre nodos
   ----------------------------------------------------------
   Los nodos son tarjetas HTML dentro de #infra; este código
   dibuja las conexiones (bezier), etiquetas de protocolo y
   "paquetes" animados que viajan por los enlaces.
   =========================================================== */
function initInfraDiagram() {
    const wrap = document.getElementById('infra');
    if (!wrap) return;
    const svg = wrap.querySelector('.infra__svg');
    const gLinks = svg.querySelector('.infra__links');
    const gLabels = svg.querySelector('.infra__labels');
    const gPackets = svg.querySelector('.infra__packets');
    const NS = 'http://www.w3.org/2000/svg';
    const XLINK = 'http://www.w3.org/1999/xlink';

    /* from → to, color, etiqueta de protocolo y si lleva paquetes animados */
    const LINKS = [
        { from: 'n-users',    to: 'n-dns',      c: 'cyan',   pkt: 'cyan' },
        { from: 'n-dns',      to: 'n-isp',      c: 'cyan',   label: 'HTTPS', pkt: 'cyan' },
        { from: 'n-integr',   to: 'n-isp',      c: 'violet', label: 'APIs' },
        { from: 'n-cloud',    to: 'n-isp',      c: 'violet' },
        { from: 'n-isp',      to: 'n-modem',    c: 'cyan',   label: 'WAN', pkt: 'cyan' },
        { from: 'n-modem',    to: 'n-fw',       c: 'cyan',   pkt: 'cyan' },
        { from: 'n-fw',       to: 'n-switch',   c: 'cyan',   pkt: 'cyan' },
        { from: 'n-switch',   to: 'n-nginx',    c: 'cyan',   label: 'DNAT', pkt: 'cyan' },
        { from: 'n-nginx',    to: 'n-web',      c: 'cyan',   label: '80 / 443', pkt: 'cyan' },
        { from: 'n-nginx',    to: 'n-asterisk', c: 'pink',   label: 'SIP 5060 / 5061', pkt: 'pink' },
        { from: 'n-web',      to: 'n-back',     c: 'cyan',   label: 'REST · GraphQL', pkt: 'cyan' },
        { from: 'n-back',     to: 'n-micro',    c: 'cyan',   label: 'colas · eventos', pkt: 'cyan' },
        { from: 'n-micro',    to: 'n-db',       c: 'cyan',   label: 'SQL', pkt: 'cyan' },
        { from: 'n-asterisk', to: 'n-ai',       c: 'pink',   label: 'ARI / AMI', pkt: 'pink' },
        { from: 'n-ai',       to: 'n-db',       c: 'pink',   label: 'registra llamadas', pkt: 'pink' },
        { from: 'n-n8n',      to: 'n-ai',       c: 'violet', label: 'orquesta', pkt: 'violet' },
        { from: 'n-erp',      to: 'n-back',     c: 'violet' },
        { from: 'n-siem',     to: 'n-switch',   c: 'green',  label: 'monitoreo' },
    ];

    /* Posición de un nodo relativa a #infra (ignora transforms del reveal) */
    function pos(el) {
        let x = 0, y = 0, n = el;
        while (n && n !== wrap) { x += n.offsetLeft; y += n.offsetTop; n = n.offsetParent; }
        return { x, y, w: el.offsetWidth, h: el.offsetHeight };
    }

    /* Punto medio de una bezier cúbica en t = 0.5 */
    function bezierMid(p0, p1, p2, p3) {
        return {
            x: (p0.x + 3 * p1.x + 3 * p2.x + p3.x) / 8,
            y: (p0.y + 3 * p1.y + 3 * p2.y + p3.y) / 8,
        };
    }

    /* Geometría del enlace: arco inferior si están en la misma fila,
       curva en S vertical si uno está encima del otro */
    function linkGeometry(a, b) {
        const acx = a.x + a.w / 2, bcx = b.x + b.w / 2;
        const acy = a.y + a.h / 2, bcy = b.y + b.h / 2;
        const dy = bcy - acy;
        let p0, p1, p2, p3, labelBelow = false;

        if (Math.abs(dy) < (a.h + b.h) / 2) {
            /* misma fila → arco por debajo de ambos nodos */
            const bow = Math.min(46, 20 + Math.abs(bcx - acx) * 0.04);
            p0 = { x: acx, y: a.y + a.h };
            p3 = { x: bcx, y: b.y + b.h };
            p1 = { x: acx, y: p0.y + bow };
            p2 = { x: bcx, y: p3.y + bow };
            labelBelow = true;
        } else if (dy > 0) {
            /* destino debajo */
            p0 = { x: acx, y: a.y + a.h };
            p3 = { x: bcx, y: b.y };
            const k = Math.max(26, (p3.y - p0.y) * 0.45);
            p1 = { x: acx, y: p0.y + k };
            p2 = { x: bcx, y: p3.y - k };
        } else {
            /* destino arriba */
            p0 = { x: acx, y: a.y };
            p3 = { x: bcx, y: b.y + b.h };
            const k = Math.max(26, (p0.y - p3.y) * 0.45);
            p1 = { x: acx, y: p0.y - k };
            p2 = { x: bcx, y: p3.y + k };
        }
        const mid = bezierMid(p0, p1, p2, p3);
        return {
            d: `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`,
            lx: mid.x,
            ly: labelBelow ? mid.y + 14 : mid.y - 6,
        };
    }

    /* Crear elementos SVG una sola vez */
    const paths = [], labels = [];
    LINKS.forEach((l, i) => {
        const path = document.createElementNS(NS, 'path');
        path.setAttribute('id', `ilink-${i}`);
        path.setAttribute('class', `ilink ilink--${l.c}`);
        gLinks.appendChild(path);
        paths.push(path);

        let text = null;
        if (l.label) {
            text = document.createElementNS(NS, 'text');
            text.setAttribute('class', 'ilabel');
            text.textContent = l.label;
            gLabels.appendChild(text);
        }
        labels.push(text);

        if (l.pkt) {
            const dot = document.createElementNS(NS, 'circle');
            dot.setAttribute('r', '3');
            dot.setAttribute('class', `pkt--${l.pkt}`);
            const mo = document.createElementNS(NS, 'animateMotion');
            mo.setAttribute('dur', `${2.6 + (i % 4) * 0.6}s`);
            mo.setAttribute('begin', `${-(i * 0.7)}s`);
            mo.setAttribute('repeatCount', 'indefinite');
            const mp = document.createElementNS(NS, 'mpath');
            mp.setAttribute('href', `#ilink-${i}`);
            mp.setAttributeNS(XLINK, 'xlink:href', `#ilink-${i}`);
            mo.appendChild(mp);
            dot.appendChild(mo);
            gPackets.appendChild(dot);
        }
    });

    /* (Re)dibujar todas las conexiones */
    function draw() {
        LINKS.forEach((l, i) => {
            const a = document.getElementById(l.from);
            const b = document.getElementById(l.to);
            if (!a || !b) return;
            const g = linkGeometry(pos(a), pos(b));
            paths[i].setAttribute('d', g.d);
            if (labels[i]) {
                labels[i].setAttribute('x', g.lx);
                labels[i].setAttribute('y', g.ly);
            }
        });
    }

    /* Hover / focus en un nodo → resaltar sus enlaces y vecinos */
    function setHot(id, on) {
        LINKS.forEach((l, i) => {
            if (l.from !== id && l.to !== id) return;
            paths[i].classList.toggle('hot', on);
            if (labels[i]) labels[i].classList.toggle('hot', on);
            const other = document.getElementById(l.from === id ? l.to : l.from);
            if (other) other.classList.toggle('hot', on);
        });
    }
    wrap.querySelectorAll('.inode').forEach((node) => {
        const enter = () => setHot(node.id, true);
        const leave = () => setHot(node.id, false);
        node.addEventListener('mouseenter', enter);
        node.addEventListener('mouseleave', leave);
        node.addEventListener('focus', enter);
        node.addEventListener('blur', leave);
    });

    draw();
    window.addEventListener('load', draw);
    window.addEventListener('resize', draw);
    if ('ResizeObserver' in window) new ResizeObserver(draw).observe(wrap);

    initInfraModal(wrap);
}

/* ===========================================================
   Popup de detalle: qué hace cada componente de la infra
   =========================================================== */
function initInfraModal(wrap) {
    const modal = document.getElementById('imodal');
    if (!modal) return;

    const INFO = {
        'n-users':    { zone: 'Internet', desc: 'Los clientes finales: navegadores y teléfonos. Construyo la parte web con <strong>React</strong> (diseño adaptable) y las apps móviles con <strong>React Native</strong> para Android e iOS, publicadas en sus tiendas.' },
        'n-dns':      { zone: 'Internet · Dominios', desc: 'Gestiono los dominios en <strong>GoDaddy</strong> y <strong>Cloudflare</strong>. Cloudflare actúa además como proxy, WAF, CDN y SSL: filtra y acelera el tráfico antes de que llegue a mi IP pública.' },
        'n-isp':      { zone: 'Internet', desc: 'El proveedor de internet entrega <strong>fibra con IP pública</strong> y la <strong>troncal SIP</strong> por donde entran las llamadas telefónicas (puertos 5060/5061). Es la puerta de entrada de todo el diagrama.' },
        'n-integr':   { zone: 'Internet · APIs', desc: 'Servicios externos que integro a los sistemas: <strong>Meta Business</strong> (WhatsApp), <strong>Twilio</strong> y <strong>Zadarma</strong> para telefonía, SMS y mensajería. Los agentes y n8n hablan con ellos vía API.' },
        'n-cloud':    { zone: 'Nube externa', desc: 'No todo vive en mi infraestructura: despliego cargas en <strong>Google Cloud, AWS y Azure</strong> según el proyecto — cómputo, almacenamiento y servicios administrados.' },
        'n-modem':    { zone: 'Perímetro', desc: 'Termina el enlace del ISP y entrega el tráfico WAN al firewall. Primer eslabón físico de la red.' },
        'n-fw':       { zone: 'Perímetro', desc: 'Primera línea de defensa: <strong>reglas de filtrado, NAT y VPN</strong>. Solo pasa el tráfico permitido; el resto muere aquí.' },
        'n-switch':   { zone: 'Perímetro', desc: 'El núcleo de la red local: reparte el tráfico entre servidores y <strong>segmenta con VLANs</strong> para aislar la DMZ de la LAN interna.' },
        'n-nginx':    { zone: 'DMZ · Linux', desc: 'Proxy reverso sobre <strong>Linux</strong> en la DMZ. Recibe el <strong>DNAT de 80/443</strong>, termina TLS y enruta cada dominio a su servicio interno. También <strong>reenvía 5060/5061 al Asterisk</strong> para el tráfico SIP.' },
        'n-asterisk': { zone: 'DMZ · Linux', desc: 'Central telefónica IP sobre <strong>Linux</strong>: recibe las llamadas de la troncal SIP, maneja IVR y grabaciones (con <strong>FFmpeg</strong>) y expone <strong>ARI/AMI</strong>, la interfaz por la que los agentes de IA contestan llamadas reales.' },
        'n-web':      { zone: 'LAN · Linux', desc: 'Sirve los frontends: <strong>HTML5, CSS3 y JavaScript</strong>, SPAs con <strong>React y Redux</strong>, todo con diseño adaptable. Nginx le enruta el tráfico 80/443.' },
        'n-back':     { zone: 'LAN · Linux', desc: 'Las APIs y la lógica de negocio: <strong>Java/Spring, Python, C#, C++ y Bash</strong>, exponiendo <strong>REST y GraphQL</strong> (y clásicos como JSP/Servlets y XML donde toca).' },
        'n-micro':    { zone: 'LAN · Linux', desc: 'Servicios desacoplados en contenedores <strong>Docker</strong>: <strong>Redis</strong> como caché y <strong>RabbitMQ</strong> para colas y eventos entre microservicios. Así el sistema escala y ningún proceso bloquea a otro.' },
        'n-db':       { zone: 'LAN · Linux', desc: 'El clúster de datos: <strong>Oracle, PostgreSQL, MySQL, SQL Server y Cassandra</strong> según el caso de uso. Aquí registran los backends, los microservicios y también los agentes de IA cada llamada atendida.' },
        'n-erp':      { zone: 'LAN · Linux', desc: 'Software de gestión <strong>a medida</strong>: ERPs con módulos de <strong>RRHH y contabilidad</strong>, CRMs, facturación y finanzas — incluida experiencia con brokers de seguros.' },
        'n-siem':     { zone: 'LAN · Linux', desc: '<strong>Wazuh</strong> centraliza logs y eventos de seguridad de todos los servidores: detección de intrusos, integridad de archivos y alertas en tiempo real.' },
        'n-n8n':      { zone: 'LAN · Linux', desc: 'Automatización con <strong>n8n</strong>: workflows con webhooks que conectan APIs, mueven datos y <strong>orquestan agentes</strong> e integraciones (Meta, Twilio, Zadarma) sin código repetido.' },
        'n-ai':       { zone: 'LAN · Linux', desc: 'Agentes con <strong>LLMs</strong> corriendo en local con <strong>LangChain y LangGraph</strong>: contestan llamadas vía Asterisk y mensajes de WhatsApp, hacen <strong>loops de razonamiento</strong>, orquestan herramientas y registran todo en la base de datos. Para datos: Pandas, PySpark y OpenCV.' },
        'n-devops':   { zone: 'Transversal', desc: 'Lo que sostiene todo: <strong>Git, Docker, CI/CD y Bash sobre Linux</strong>. Del commit al despliegue en producción sin pasos manuales.' },
        'n-design':   { zone: 'Transversal', desc: 'La capa visual y multimedia: <strong>UI/UX</strong>, ilustración y retoque con <strong>Illustrator y Photoshop</strong>, 3D con <strong>Blender</strong> y procesamiento de audio/video con <strong>FFmpeg</strong>.' },
        'n-win':      { zone: 'Transversal', desc: 'Algún <strong>Windows Server</strong> para casos puntuales (Active Directory, software que lo exige). El resto de la infraestructura corre en <strong>Linux 🐧</strong>, que es mi día a día.' },
    };

    const card = modal.querySelector('.imodal__card');
    const elIcon = modal.querySelector('.imodal__icon');
    const elZone = modal.querySelector('.imodal__zone');
    const elTitle = modal.querySelector('#imodal-title');
    const elBody = modal.querySelector('.imodal__body');
    const elTags = modal.querySelector('.imodal__tags');
    let lastFocus = null;

    function open(node) {
        const info = INFO[node.id];
        if (!info) return;
        elIcon.textContent = node.querySelector('.inode__icon')?.textContent || '';
        elZone.textContent = info.zone;
        elTitle.textContent = node.querySelector('h3')?.textContent || '';
        elBody.innerHTML = info.desc;
        elTags.innerHTML = node.querySelector('.inode__tags')?.innerHTML || '';
        lastFocus = node;
        modal.hidden = false;
        document.body.classList.add('nav-open'); /* reutiliza el bloqueo de scroll */
        modal.querySelector('.imodal__close').focus();
    }
    function close() {
        if (modal.hidden) return;
        modal.hidden = true;
        document.body.classList.remove('nav-open');
        if (lastFocus) lastFocus.focus();
    }

    modal.querySelectorAll('[data-imodal-close]').forEach(el => el.addEventListener('click', close));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

    wrap.querySelectorAll('.inode').forEach(node => {
        node.addEventListener('click', () => open(node));
        node.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(node); }
        });
    });
}

/* ===========================================================
   Contador de visitas
   ----------------------------------------------------------
   Reemplaza COUNTER_API con la URL de tu Worker, por ejemplo:
     https://visitas.tudominio.com
   o el subdominio por defecto:
     https://visit-counter.TU-USUARIO.workers.dev
   =========================================================== */
const COUNTER_API = 'https://visitas.ruddypazd.com';

/* ===========================================================
   Sesión en vivo — IP pública + ubicación por WebSocket
   ----------------------------------------------------------
   Al entrar, abre wss://ws.ruddypazd.com/ws. El servidor envía
   un primer mensaje {type:"session", ip, lat, lon, country, city}.
   Mostramos la IP y ponemos un marcador en el mapa. Si lat/lon
   vienen null (ipapi.co limitado), geolocalizamos como respaldo.
   =========================================================== */
const WS_URL = 'wss://ws.ruddypazd.com/ws';

/* ----------------------------------------------------------
   Socket compartido — una sola conexión para la sesión en vivo
   y el chat con la IA. Con reconexión automática (backoff) y
   suscriptores para mensajes y cambios de estado.
   ---------------------------------------------------------- */
const rpSocket = (() => {
    let ws = null;
    let delay = 2000, timer = null, dead = false;
    const msgSubs = new Set();
    const stateSubs = new Set();

    const emitMsg = (m) => msgSubs.forEach(fn => { try { fn(m); } catch (e) {} });
    const emitState = (s) => stateSubs.forEach(fn => { try { fn(s); } catch (e) {} });

    function connect() {
        if (dead) return;
        emitState('connecting');
        try {
            ws = new WebSocket(WS_URL);
        } catch (e) {
            emitState('down');
            schedule();
            return;
        }
        ws.addEventListener('open', () => { delay = 2000; emitState('live'); });
        ws.addEventListener('message', (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m) emitMsg(m);
        });
        ws.addEventListener('close', () => { if (dead) return; emitState('down'); schedule(); });
        ws.addEventListener('error', () => { try { ws.close(); } catch (e) {} });
    }

    function schedule() {
        if (dead || timer) return;
        timer = setTimeout(() => { timer = null; connect(); }, delay);
        delay = Math.min(Math.round(delay * 1.6), 15000);   // backoff hasta 15s
    }

    const kick = () => {
        if (!dead && (!ws || ws.readyState === WebSocket.CLOSED)) {
            delay = 2000;
            if (timer) { clearTimeout(timer); timer = null; }
            connect();
        }
    };
    window.addEventListener('online', kick);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) kick(); });
    window.addEventListener('beforeunload', () => { dead = true; try { ws && ws.close(); } catch (e) {} });

    return {
        start: connect,
        onMessage: (fn) => msgSubs.add(fn),
        onState: (fn) => stateSubs.add(fn),
        isOpen: () => !!ws && ws.readyState === WebSocket.OPEN,
        send: (obj) => {
            if (ws && ws.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(obj)); return true; }
            return false;
        },
    };
})();

/* Markdown mínimo y seguro (escapa HTML y aplica formato básico) */
function renderMarkdown(src) {
    let h = String(src)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    h = h.replace(/```([\s\S]*?)```/g, (m, c) => `<pre><code>${c.replace(/\n$/, '')}</code></pre>`);
    h = h.replace(/`([^`]+)`/g, '<code>$1</code>');
    h = h.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    h = h.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    h = h.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    h = h.replace(/\n/g, '<br>');
    return h;
}

function initLiveSession() {
    const section = document.getElementById('session');
    if (!section) return;

    const statusEl  = section.querySelector('[data-session-status]');
    const statusTxt = section.querySelector('[data-status-text]');
    const ipEl      = section.querySelector('[data-session-ip]');
    const cityEl    = section.querySelector('[data-session-city]');
    const countryEl = section.querySelector('[data-session-country]');
    const coordsEl  = section.querySelector('[data-session-coords]');

    // Muestra la sección y dispara su animación de entrada
    section.hidden = false;
    const reveal = section.querySelector('.reveal');
    if (reveal) reveal.classList.add('in');

    let map = null;
    let filled = false;      // ya recibimos datos del socket
    let located = false;     // ya pintamos el marcador

    const heroDot = document.querySelector('.hero__eyebrow .dot');
    const setStatus = (kind, text) => {
        statusEl.className = 'session__status' + (kind ? ' ' + kind : '');
        if (statusTxt) statusTxt.textContent = text;
        // El punto del hero (CEO @ Servisofts) también refleja la conexión
        if (heroDot) {
            heroDot.classList.toggle('is-live', kind === 'live');
            heroDot.classList.toggle('is-off', kind !== 'live');
        }
    };

    function showLocation({ ip, lat, lon, country, city }) {
        if (ip) ipEl.textContent = ip;
        if (city) cityEl.textContent = city;
        if (country) countryEl.textContent = country;
        if (lat != null && lon != null) {
            coordsEl.textContent = `${(+lat).toFixed(4)}, ${(+lon).toFixed(4)}`;
            renderMarker(+lat, +lon, city || country || 'Tu ubicación');
        }
    }

    function renderMarker(lat, lon, name) {
        const box = document.getElementById('session-map');
        if (!box || typeof jsVectorMap !== 'function') return;
        located = true;
        try {
            if (map && typeof map.destroy === 'function') map.destroy();
            box.innerHTML = '';
            map = new jsVectorMap({
                selector: '#session-map',
                map: 'world',
                zoomButtons: true,
                zoomOnScroll: false,
                backgroundColor: 'transparent',
                regionsSelectable: false,
                regionStyle: {
                    initial: { fill: '#1b2236', stroke: '#05060a', strokeWidth: 0.4 },
                    hover: { fillOpacity: 0.85 },
                },
                markers: [{ name, coords: [lat, lon] }],
                markerStyle: {
                    initial: { fill: '#ff3da6', stroke: '#ff9ad3', strokeWidth: 2, r: 7 },
                    hover: { fill: '#ff3da6' },
                },
                markerLabelStyle: {
                    initial: { fontFamily: 'JetBrains Mono, monospace', fontSize: 12, fill: '#e8ecf6' },
                },
            });
            // Acerca la cámara al punto (si la versión lo soporta)
            try { map.setFocus?.({ coords: [lat, lon], scale: 4, animate: true }); } catch (e) { /* opcional */ }
        } catch (e) { /* si el mapa falla, quedan los datos de texto */ }
    }

    // Al desconectar: quita el marcador y hace zoom-out al máximo (mundo completo)
    function clearMarker() {
        located = false;
        coordsEl.textContent = '—';
        if (!map) return;
        try { map.removeMarkers?.(); } catch (e) { /* noop */ }
        // Zoom-out al máximo. La variante {coords, scale} es la que respeta esta versión
        // (la de {x, y, scale} no aplica el zoom). Centramos el mundo a escala 1.
        try {
            if (map.setFocus) map.setFocus({ coords: [0, 0], scale: 1, animate: true });
            else map.reset?.();
        } catch (e) { /* noop */ }
    }

    // Respaldo: geolocaliza la IP desde el navegador si el socket no dio lat/lon
    async function fallbackGeo() {
        if (located) return;
        try {
            const r = await fetch('https://ipwho.is/');
            const d = await r.json();
            if (d && d.success !== false) {
                showLocation({ ip: d.ip, lat: d.latitude, lon: d.longitude, country: d.country, city: d.city });
            }
        } catch (e) { /* sin respaldo disponible */ }
    }

    // El estado y los mensajes vienen del socket compartido (rpSocket).
    rpSocket.onState((s) => {
        if (s === 'live') setStatus('live', 'Conectado en vivo');
        else if (s === 'connecting') setStatus('', 'Conectando…');
        else { // 'down'
            setStatus('err', 'Conexión perdida · reintentando…');
            clearMarker();
            if (!filled) fallbackGeo();
        }
    });

    rpSocket.onMessage((msg) => {
        if (msg.type !== 'session') return;   // el chat maneja start/token/end
        filled = true;
        setStatus('live', 'Conectado en vivo');
        showLocation(msg);
        if (msg.lat == null || msg.lon == null) fallbackGeo();
    });
}

/* ===========================================================
   Chat con la IA (Nemotron) sobre el socket compartido
   ----------------------------------------------------------
   Enviar:  {type:"stream_ia", message:"..."}
   Recibir: {type:"start"} · {type:"token",content} · {type:"end"}
   =========================================================== */
function initChat() {
    const root = document.getElementById('chat');
    if (!root) return;

    const log     = root.querySelector('[data-chat-log]');
    const form    = root.querySelector('[data-chat-form]');
    const input   = root.querySelector('[data-chat-input]');
    const sendBtn = root.querySelector('[data-chat-send]');
    const idDot   = root.querySelector('.chat__id .dot');
    const toggles = root.querySelectorAll('[data-chat-toggle]');

    // Abrir / cerrar el widget flotante
    let open = false;
    const setOpen = (v) => {
        open = v;
        root.classList.toggle('open', v);
        toggles.forEach(t => t.setAttribute('aria-expanded', String(v)));
        document.body.classList.toggle('chat-open', v);
        if (v) setTimeout(() => input.focus(), 80);
    };
    toggles.forEach(t => t.addEventListener('click', () => setOpen(!open)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && open) setOpen(false); });

    // Ajusta la altura al viewport visible: al abrirse el teclado en el móvil,
    // el panel se encoge y el input queda siempre a la vista (nunca se sale).
    if (window.visualViewport) {
        const vv = window.visualViewport;
        const applyVV = () => {
            root.style.setProperty('--vvh', vv.height + 'px');
            if (open) log.scrollTop = log.scrollHeight;
        };
        vv.addEventListener('resize', applyVV);
        vv.addEventListener('scroll', applyVV);
        applyVV();
    }

    let streaming = false, connected = false;
    let bubble = null, raw = '';
    const CURSOR = '<span class="chat__cursor">▋</span>';

    const updateBtn = () => { sendBtn.disabled = streaming || !connected; };

    function addMsg(role, content, asHTML) {
        const el = document.createElement('div');
        el.className = 'chat__msg chat__msg--' + role;
        const b = document.createElement('div');
        b.className = 'chat__bubble';
        if (asHTML) b.innerHTML = content; else b.textContent = content;
        el.appendChild(b);
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return b;
    }

    rpSocket.onState((s) => {
        connected = (s === 'live');
        root.classList.toggle('is-off', !connected);
        if (idDot) {
            idDot.classList.toggle('is-live', connected);
            idDot.classList.toggle('is-off', !connected);
        }
        if (!connected && streaming) {   // se cortó a mitad de respuesta
            if (bubble) bubble.innerHTML = renderMarkdown(raw);
            streaming = false; bubble = null; raw = '';
        }
        updateBtn();
    });

    rpSocket.onMessage((msg) => {
        if (msg.type === 'start') {
            streaming = true; raw = '';
            bubble = addMsg('ai', CURSOR, true);
            updateBtn();
        } else if (msg.type === 'token') {
            if (!bubble) bubble = addMsg('ai', '', true);
            raw += (msg.content || '');
            bubble.innerHTML = renderMarkdown(raw) + CURSOR;
            log.scrollTop = log.scrollHeight;
        } else if (msg.type === 'end') {
            if (bubble) bubble.innerHTML = renderMarkdown(raw);
            streaming = false; bubble = null; raw = '';
            updateBtn();
        }
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text || streaming || !connected) return;
        addMsg('user', text);
        rpSocket.send({ type: 'stream_ia', message: text });
        input.value = '';
        input.style.height = 'auto';
    });

    // Enter envía; Shift+Enter hace salto de línea. Autoexpande el textarea.
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); }
    });
    input.addEventListener('input', () => {
        input.style.height = 'auto';
        input.style.height = Math.min(input.scrollHeight, 120) + 'px';
    });
}

function initVisitCounter() {
    const el = document.querySelector('[data-visits]');
    const box = document.querySelector('.footer__counter');
    if (!el || !box) return;

    // Cuenta una sola visita por sesión del navegador
    const isNewVisit = !sessionStorage.getItem('rp_visited');
    const url = COUNTER_API + (isNewVisit ? '?hit=1' : '');

    fetch(url, { method: 'GET' })
        .then(r => r.ok ? r.json() : Promise.reject(r.status))
        .then(data => {
            const n = typeof data === 'number' ? data : (data.count ?? data.visits);
            if (n == null) throw new Error('respuesta sin contador');
            sessionStorage.setItem('rp_visited', '1');
            box.hidden = false;
            animateNumber(el, n);
            if (data.countries) renderVisitMap(data.countries);
        })
        .catch(() => { /* Worker no configurado aún: el contador queda oculto */ });
}

/* ---- Mapa de visitas por país ---- */
function flagEmoji(cc) {
    if (!cc || cc.length !== 2) return '🏳️';
    const base = 0x1F1E6;
    return String.fromCodePoint(base + cc.charCodeAt(0) - 65, base + cc.charCodeAt(1) - 65);
}

function countryName(cc) {
    if (cc === 'XX') return 'Desconocido';
    try { return new Intl.DisplayNames(['es'], { type: 'region' }).of(cc) || cc; }
    catch (e) { return cc; }
}

function renderVisitMap(countries) {
    const entries = Object.entries(countries).filter(([, n]) => n > 0);
    if (!entries.length) return;

    const section = document.getElementById('visitmap');
    const listEl = document.querySelector('[data-country-list]');
    if (!section || !listEl) return;

    section.hidden = false;
    const reveal = section.querySelector('.reveal');
    if (reveal) reveal.classList.add('in');

    // Lista ordenada con banderas y barras
    entries.sort((a, b) => b[1] - a[1]);
    const max = entries[0][1];
    listEl.innerHTML = entries.slice(0, 12).map(([cc, n]) => `
        <li>
            <span class="flag">${flagEmoji(cc)}</span>
            <span class="cname">${countryName(cc)}</span>
            <span class="cbar"><i style="width:${Math.max(6, (n / max) * 100)}%"></i></span>
            <span class="cnum">${n.toLocaleString('es')}</span>
        </li>`).join('');

    // Mapa mundial (jsVectorMap). Si la librería no cargó, queda solo la lista.
    const values = {};
    entries.forEach(([cc, n]) => { if (cc !== 'XX') values[cc] = n; });
    try {
        const visited = Object.keys(values);
        if (typeof jsVectorMap === 'function' && visited.length) {
            new jsVectorMap({
                selector: '#world-map',
                map: 'world',
                zoomButtons: false,
                backgroundColor: 'transparent',
                regionsSelectable: false,
                // Marca los países visitados; el estilo "selected" los pinta en neón.
                selectedRegions: visited,
                regionStyle: {
                    initial: { fill: '#1b2236', stroke: '#05060a', strokeWidth: 0.4 },
                    selected: { fill: '#00e5ff' },
                    hover: { fillOpacity: 0.85 },
                },
                onRegionTooltipShow(event, tooltip, code) {
                    const v = values[code];
                    if (v) tooltip.text(`${tooltip.text()}: ${v} ${v === 1 ? 'visita' : 'visitas'}`, true);
                },
            });
        }
    } catch (e) { /* la lista ya cubre el caso si el mapa falla */ }
}

function animateNumber(el, target) {
    const dur = 1200, start = performance.now();
    const step = (now) => {
        const p = Math.min((now - start) / dur, 1);
        el.textContent = Math.floor((1 - Math.pow(1 - p, 3)) * target).toLocaleString('es');
        if (p < 1) requestAnimationFrame(step);
        else el.textContent = target.toLocaleString('es');
    };
    requestAnimationFrame(step);
}

function initParticles(reduceMotion) {
    const canvas = document.getElementById('bg-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    let w, h, dpr, particles, mouse = { x: -999, y: -999 };

    const COLORS = ['#00e5ff', '#a060ff', '#ff3da6'];

    function resize() {
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        w = canvas.width = innerWidth * dpr;
        h = canvas.height = innerHeight * dpr;
        canvas.style.width = innerWidth + 'px';
        canvas.style.height = innerHeight + 'px';
        const count = Math.min(90, Math.floor((innerWidth * innerHeight) / 16000));
        particles = Array.from({ length: count }, () => ({
            x: Math.random() * w,
            y: Math.random() * h,
            vx: (Math.random() - 0.5) * 0.3 * dpr,
            vy: (Math.random() - 0.5) * 0.3 * dpr,
            r: (Math.random() * 1.6 + 0.6) * dpr,
            c: COLORS[Math.floor(Math.random() * COLORS.length)],
        }));
    }

    window.addEventListener('mousemove', (e) => {
        mouse.x = e.clientX * dpr;
        mouse.y = e.clientY * dpr;
    });
    window.addEventListener('mouseout', () => { mouse.x = mouse.y = -999; });

    const LINK = 140;
    function frame() {
        ctx.clearRect(0, 0, w, h);
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.x += p.vx; p.y += p.vy;
            if (p.x < 0 || p.x > w) p.vx *= -1;
            if (p.y < 0 || p.y > h) p.vy *= -1;

            // líneas hacia el cursor
            const dxm = p.x - mouse.x, dym = p.y - mouse.y;
            const dm = Math.hypot(dxm, dym);
            if (dm < LINK * dpr) {
                ctx.globalAlpha = (1 - dm / (LINK * dpr)) * 0.5;
                ctx.strokeStyle = p.c;
                ctx.lineWidth = 0.6 * dpr;
                ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
            }

            // líneas entre partículas cercanas
            for (let j = i + 1; j < particles.length; j++) {
                const q = particles[j];
                const dx = p.x - q.x, dy = p.y - q.y;
                const d = Math.hypot(dx, dy);
                if (d < LINK * dpr) {
                    ctx.globalAlpha = (1 - d / (LINK * dpr)) * 0.18;
                    ctx.strokeStyle = p.c;
                    ctx.lineWidth = 0.5 * dpr;
                    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
                }
            }

            // punto
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = p.c;
            ctx.shadowBlur = 8 * dpr; ctx.shadowColor = p.c;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
            ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
        if (!reduceMotion) requestAnimationFrame(frame);
    }

    resize();
    window.addEventListener('resize', resize);
    if (reduceMotion) {
        // render estático único, sin animación
        ctx.clearRect(0, 0, w, h);
        particles.forEach(p => {
            ctx.fillStyle = p.c; ctx.globalAlpha = 0.8;
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
        });
    } else {
        requestAnimationFrame(frame);
    }
}
