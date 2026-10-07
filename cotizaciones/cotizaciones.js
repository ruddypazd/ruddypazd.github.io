/* ===========================================================
   Cotizador — ajusta precios y plazos en CONFIG
   =========================================================== */

const CONFIG = {
    whatsapp: '59175666929',
    email: 'ruddypazd@gmail.com',
    bob: 6.96, // tipo de cambio Bs por USD
    // precio fijo en USD: usa `price` en lugar de min/max
    // min/max en USD, semanas estimadas
    services: [
        { id: 'web',     icon: '🌐', name: 'Sitio web / Landing',   desc: 'Web corporativa, landing o portafolio.',          min: 400,  max: 1200,  weeks: 2 },
        { id: 'webapp',  icon: '🧩', name: 'Aplicación web',        desc: 'Sistema a medida con panel y usuarios.',          min: 2500, max: 8000,  weeks: 8 },
        { id: 'mobile',  icon: '📱', name: 'App móvil',             desc: 'Android e iOS (React Native).',                   min: 3000, max: 10000, weeks: 10 },
        { id: 'erp',     icon: '🏢', name: 'ERP',                   desc: 'Inventario, compras, ventas, facturación.',       min: 4000, max: 15000, weeks: 12 },
        { id: 'crm',     icon: '🤝', name: 'CRM',                   desc: 'Clientes, embudo de ventas y seguimiento.',       price: 4500, weeks: 8 },
        { id: 'ai',      icon: '🤖', name: 'Agente de IA',          desc: 'Asistente de voz o WhatsApp con IA.',             min: 1500, max: 5000,  weeks: 4 },
        { id: 'infra',   icon: '☁️', name: 'Infraestructura / Cloud', desc: 'Servidores, DevOps, migración, seguridad.',     min: 800,  max: 4000,  weeks: 3 },
    ],
    extras: [
        { id: 'auth',     name: 'Login y roles de usuario', min: 300, max: 700,  weeks: 1 },
        { id: 'payments', name: 'Pasarela de pagos / QR',    min: 400, max: 1200, weeks: 1 },
        { id: 'billing',  name: 'Facturación electrónica',   min: 600, max: 1500, weeks: 2 },
        { id: 'whatsapp', name: 'Integración WhatsApp',      min: 300, max: 900,  weeks: 1 },
        { id: 'reports',  name: 'Reportes y dashboards',     min: 400, max: 1200, weeks: 1 },
        { id: 'api',      name: 'Integración con APIs',      min: 300, max: 1000, weeks: 1 },
        { id: 'design',   name: 'Diseño UI/UX a medida',     min: 500, max: 1500, weeks: 2 },
        { id: 'support',  name: 'Soporte y mantenimiento (3 meses)', min: 300, max: 900, weeks: 0 },
    ],
    timelines: [
        { id: 'normal',   name: 'Normal',   factor: 1,    weeksFactor: 1 },
        { id: 'fast',     name: 'Rápido',   factor: 1.25, weeksFactor: 0.75 },
        { id: 'flexible', name: 'Flexible', factor: 0.9,  weeksFactor: 1.3 },
    ],
};

// Ítems con precio fijo
[...CONFIG.services, ...CONFIG.extras].forEach(x => {
    if (x.price) x.min = x.max = x.price;
});

const state = { services: new Set(), extras: new Set(), timeline: 'normal' };

const $ = (s) => document.querySelector(s);
const money = (n) => '$' + (Math.round(n / 50) * 50).toLocaleString('en-US');
const bs = (n) => (Math.round(n / 100) * 100).toLocaleString('es-BO') + ' Bs';
const range = (a, b, f) => f(a) === f(b) ? f(a) : `${f(a)} – ${f(b)}`;
const itemPrice = (x) => x.price ? money(x.price) : `${money(x.min)}+`;

function renderOptions() {
    $('#services').innerHTML = CONFIG.services.map(s => `
        <label class="q-card">
            <input type="checkbox" name="service" value="${s.id}">
            <span class="q-card__body">
                <span class="q-card__icon" aria-hidden="true">${s.icon}</span>
                <span class="q-card__name">${s.name}</span>
                <span class="q-card__desc">${s.desc}</span>
                <span class="q-card__price">${s.price ? money(s.price) : `desde ${money(s.min)}`}</span>
            </span>
        </label>`).join('');

    $('#extras').innerHTML = CONFIG.extras.map(e => `
        <label class="q-chip">
            <input type="checkbox" name="extra" value="${e.id}">
            <span>${e.name}</span>
        </label>`).join('');

    $('#timeline').innerHTML = CONFIG.timelines.map(t => `
        <label class="q-seg__opt">
            <input type="radio" name="timeline" value="${t.id}" ${t.id === state.timeline ? 'checked' : ''}>
            <span>${t.name}${t.factor !== 1 ? ` <small>${t.factor > 1 ? '+' : '−'}${Math.round(Math.abs(t.factor - 1) * 100)}%</small>` : ''}</span>
        </label>`).join('');
}

function compute() {
    const pick = (list, ids) => list.filter(x => ids.has(x.id));
    const services = pick(CONFIG.services, state.services);
    const extras = pick(CONFIG.extras, state.extras);
    const tl = CONFIG.timelines.find(t => t.id === state.timeline);
    const items = [...services, ...extras];
    const sum = (k) => items.reduce((a, x) => a + x[k], 0);
    return {
        services, extras, tl,
        min: sum('min') * tl.factor,
        max: sum('max') * tl.factor,
        weeks: Math.max(1, Math.round(sum('weeks') * tl.weeksFactor)),
    };
}

function update() {
    const q = compute();
    const has = q.services.length > 0;
    $('#price').textContent = has ? range(q.min, q.max, money) : '—';
    $('#price-bs').textContent = has ? `≈ ${range(q.min * CONFIG.bob, q.max * CONFIG.bob, bs)}` : '';
    $('#weeks').textContent = has ? `≈ ${q.weeks} semana${q.weeks > 1 ? 's' : ''} · plazo ${q.tl.name.toLowerCase()}` : 'Selecciona un servicio';
    $('#lines').innerHTML = [...q.services, ...q.extras]
        .map(x => `<li><span>${x.name}</span><span>${itemPrice(x)}</span></li>`).join('');
    $('#error').hidden = true;
}

function buildMessage() {
    const q = compute();
    const f = new FormData($('#quote'));
    const v = (k) => (f.get(k) || '').toString().trim();
    const lines = [
        `Hola Roy, quiero una cotización:`,
        ``,
        `*Servicios:* ${q.services.map(s => s.name).join(', ')}`,
        q.extras.length ? `*Extras:* ${q.extras.map(e => e.name).join(', ')}` : null,
        `*Plazo:* ${q.tl.name}`,
        `*Estimación:* ${range(q.min, q.max, money)} USD · ${range(q.min * CONFIG.bob, q.max * CONFIG.bob, bs)} (≈ ${q.weeks} semanas)`,
        ``,
        `*Nombre:* ${v('name')}`,
        v('company') ? `*Empresa:* ${v('company')}` : null,
        v('email') ? `*Correo:* ${v('email')}` : null,
        v('phone') ? `*WhatsApp:* ${v('phone')}` : null,
        v('details') ? `\n*Detalles:* ${v('details')}` : null,
    ];
    return lines.filter(l => l !== null).join('\n');
}

function validate() {
    const err = $('#error');
    let msg = '';
    if (!state.services.size) msg = 'Elige al menos un servicio.';
    else if (!$('#quote [name=name]').value.trim()) msg = 'Escribe tu nombre.';
    err.textContent = msg;
    err.hidden = !msg;
    if (msg === 'Escribe tu nombre.') $('#quote [name=name]').focus();
    return !msg;
}

function init() {
    renderOptions();
    update();

    $('#quote').addEventListener('change', (e) => {
        const { name, value, checked } = e.target;
        if (name === 'service') checked ? state.services.add(value) : state.services.delete(value);
        if (name === 'extra') checked ? state.extras.add(value) : state.extras.delete(value);
        if (name === 'timeline') state.timeline = value;
        update();
    });

    $('#send-wa').addEventListener('click', () => {
        if (!validate()) return;
        window.open(`https://wa.me/${CONFIG.whatsapp}?text=${encodeURIComponent(buildMessage())}`, '_blank', 'noopener');
    });

    $('#send-mail').addEventListener('click', () => {
        if (!validate()) return;
        const subject = encodeURIComponent('Solicitud de cotización');
        const body = encodeURIComponent(buildMessage().replace(/\*/g, ''));
        window.location.href = `mailto:${CONFIG.email}?subject=${subject}&body=${body}`;
    });

    document.getElementById('year').textContent = new Date().getFullYear();

    /* ---- Nav ---- */
    const nav = $('.nav');
    const onScroll = () => nav.classList.toggle('scrolled', window.scrollY > 40);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });

    const burger = $('.nav__burger');
    const links = $('.nav__links');
    const overlay = $('.nav__overlay');
    const setMenu = (open) => {
        burger.classList.toggle('open', open);
        links.classList.toggle('open', open);
        overlay.classList.toggle('open', open);
        document.body.classList.toggle('nav-open', open);
        burger.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
    };
    burger.addEventListener('click', () => setMenu(!links.classList.contains('open')));
    overlay.addEventListener('click', () => setMenu(false));
    links.querySelectorAll('a').forEach(a => a.addEventListener('click', () => setMenu(false)));
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') setMenu(false); });
}

init();
