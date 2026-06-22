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
    burger.addEventListener('click', () => {
        burger.classList.toggle('open');
        links.classList.toggle('open');
    });
    links.querySelectorAll('a').forEach(a =>
        a.addEventListener('click', () => {
            burger.classList.remove('open');
            links.classList.remove('open');
        })
    );

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

    /* ---- Fondo: red de partículas estilo cyber ---- */
    initParticles(reduceMotion);
});

/* ===========================================================
   Contador de visitas
   ----------------------------------------------------------
   Reemplaza COUNTER_API con la URL de tu Worker, por ejemplo:
     https://visitas.tudominio.com
   o el subdominio por defecto:
     https://visit-counter.TU-USUARIO.workers.dev
   =========================================================== */
const COUNTER_API = 'https://visitas.ruddypazd.com';

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
        if (typeof jsVectorMap === 'function' && Object.keys(values).length) {
            new jsVectorMap({
                selector: '#world-map',
                map: 'world',
                zoomButtons: false,
                backgroundColor: 'transparent',
                regionStyle: {
                    initial: { fill: '#141a2b', stroke: '#05060a', strokeWidth: 0.4 },
                    hover: { fill: '#a060ff' },
                },
                series: {
                    regions: [{
                        attribute: 'fill',
                        scale: ['#1f6f8b', '#00e5ff'],
                        normalizeFunction: 'polynomial',
                        values: values,
                    }],
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
