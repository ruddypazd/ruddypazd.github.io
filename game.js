// Juego del mundo 3D: chispas para atrapar, objetivos del día, regalo diario, niveles, ranking
// de la semana y una meta que se cumple entre todos. La lógica y los puntos viven en el servidor
// (nvidianim/game.py); aquí se dibujan las chispas, se avisa al servidor cuando pasas por una
// y se muestran el marcador, el panel de objetivos y los avisos.
//
// Pensado para que dé gusto volver y no obligación: no hay rachas que se pierden, el regalo del
// día es una sorpresa, los objetivos son pocos y se puede cambiar uno, y la meta grande es de todos.

const TIERS = [
    [10, 0xffd400], [8, 0xff8a3d], [6, 0xff3da6], [4, 0xa060ff], [2, 0x36f1a0], [1, 0x00e5ff],
];
export const tierColor = (level) => TIERS.find(([min]) => (level || 1) >= min)[1];
const hex = (c) => `#${c.toString(16).padStart(6, '0')}`;

const QUEST_ICONS = { orbs: '✦', gold: '🌟', walk: '👣', jump: '🦘', say: '💬', meet: '🤝', portal: '🌀', chart: '📊', ball: '⚽' };
const TAKE_DIST = 1.25;     // pasar a esta distancia de una chispa la atrapa
const MAX_ORBS = 64;

export function createGame({ THREE, net, player, here, actors, camera, onMyLevel, onLevel }) {
    const state = { me: null, board: null, levels: new Map(), rain: false, tab: 'week' };
    const orbs = new Map();   // id -> { data, born, taking, phase }

    // ---------- Chispas en 3D (pocas mallas instanciadas: una sola llamada de dibujo por tipo) ----------
    const group = new THREE.Group();
    actors.add(group);   // actors viaja con la escena donde estás
    const coreGeo = new THREE.OctahedronGeometry(0.26);
    // Sin mezcla aditiva: el lienzo es transparente (el cielo es CSS) y lo aditivo se ve oscuro.
    const haloGeo = new THREE.RingGeometry(0.28, 0.5, 32).rotateX(-Math.PI / 2);   // brillo en el piso
    const beamGeo = new THREE.CylinderGeometry(0.04, 0.04, 7, 6, 1, true).translate(0, 3.5, 0);
    function orbSet(color, emissive, beam) {
        const core = new THREE.InstancedMesh(coreGeo, new THREE.MeshStandardMaterial({ color, emissive, emissiveIntensity: 1.8, metalness: 0.2, roughness: 0.25 }), MAX_ORBS);
        const halo = new THREE.InstancedMesh(haloGeo, new THREE.MeshBasicMaterial({ color: emissive, transparent: true, opacity: 0.45, depthWrite: false }), MAX_ORBS);
        const set = { core, halo, beam: null };
        if (beam) set.beam = new THREE.InstancedMesh(beamGeo, new THREE.MeshBasicMaterial({ color: emissive, transparent: true, opacity: 0.5, depthWrite: false }), MAX_ORBS);
        for (const m of [core, halo, set.beam].filter(Boolean)) {
            m.count = 0;
            m.frustumCulled = false;   // las instancias están repartidas por todo el mapa
            m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            group.add(m);
        }
        return set;
    }
    const sets = { blue: orbSet(0x6ff3ff, 0x00e5ff, false), gold: orbSet(0xfff0b0, 0xffb000, true) };

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const v = new THREE.Vector3();
    const s = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    const orbY = (o, t) => 1.0 + Math.sin(t * 2.2 + o.phase) * 0.14;

    // Flecha en el piso que apunta a la chispa más cercana cuando no hay ninguna a la vista.
    const arrowShape = new THREE.Shape();
    arrowShape.moveTo(0, 0.32); arrowShape.lineTo(0.2, -0.12); arrowShape.lineTo(0, -0.02); arrowShape.lineTo(-0.2, -0.12); arrowShape.closePath();
    const arrow = new THREE.Mesh(new THREE.ShapeGeometry(arrowShape).scale(0.6, 0.6, 1), new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.8, depthWrite: false }));
    arrow.rotation.order = 'YXZ';
    arrow.rotation.x = -Math.PI / 2;
    arrow.visible = false;
    group.add(arrow);

    // Destellos al atrapar una chispa (un solo Points con un pool de partículas).
    const SPARKS = 240;
    const sparkPos = new Float32Array(SPARKS * 3);
    const sparkCol = new Float32Array(SPARKS * 3);
    const sparkVel = new Float32Array(SPARKS * 3);
    const sparkLife = new Float32Array(SPARKS);
    let sparkNext = 0;
    for (let k = 0; k < SPARKS; k++) sparkPos[k * 3 + 1] = -99;
    const sparkGeo = new THREE.BufferGeometry();
    sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
    sparkGeo.setAttribute('color', new THREE.BufferAttribute(sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
    const sparks = new THREE.Points(sparkGeo, new THREE.PointsMaterial({ size: 0.14, vertexColors: true, depthWrite: false }));
    sparks.frustumCulled = false;
    group.add(sparks);
    let sparksAlive = 0;
    const tmpColor = new THREE.Color();
    function burst(x, y, z, color, n = 26, speed = 3.2) {
        tmpColor.set(color);
        for (let i = 0; i < n; i++) {
            const k = sparkNext; sparkNext = (sparkNext + 1) % SPARKS;
            sparkPos.set([x, y, z], k * 3);
            const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2;
            const sp = speed * (0.4 + Math.random() * 0.6);
            sparkVel.set([Math.cos(a) * Math.cos(b) * sp, Math.abs(Math.sin(b)) * sp + 1, Math.sin(a) * Math.cos(b) * sp], k * 3);
            sparkCol.set([tmpColor.r, tmpColor.g, tmpColor.b], k * 3);
            sparkLife[k] = 0.7 + Math.random() * 0.5;
        }
        sparksAlive = 2;
    }
    function updateSparks(dt) {
        if (sparksAlive <= 0) return;
        sparksAlive -= dt;
        for (let k = 0; k < SPARKS; k++) {
            if (sparkLife[k] <= 0) continue;
            sparkLife[k] -= dt;
            const i = k * 3;
            sparkVel[i + 1] -= 6 * dt;
            sparkPos[i] += sparkVel[i] * dt; sparkPos[i + 1] += sparkVel[i + 1] * dt; sparkPos[i + 2] += sparkVel[i + 2] * dt;
            if (sparkLife[k] <= 0) sparkPos[i + 1] = -99;   // apagada: bajo el piso
            sparksAlive = Math.max(sparksAlive, 0.1);
        }
        sparkGeo.attributes.position.needsUpdate = true;
        sparkGeo.attributes.color.needsUpdate = true;
    }

    // Fuegos artificiales (meta de todos cumplida o subiste de nivel): ráfagas alrededor tuyo.
    let party = 0, partyNext = 0;
    const PARTY_COLORS = [0x00e5ff, 0xff3da6, 0xffd400, 0x36f1a0, 0xa060ff];
    function updateParty(dt) {
        if (party <= 0) return;
        party -= dt; partyNext -= dt;
        if (partyNext > 0) return;
        partyNext = 0.35;
        const a = Math.random() * Math.PI * 2, r = 2 + Math.random() * 4;
        burst(player.position.x + Math.cos(a) * r, 4 + Math.random() * 3, player.position.z + Math.sin(a) * r,
            PARTY_COLORS[(Math.random() * PARTY_COLORS.length) | 0], 40, 4.5);
    }

    // ---------- Sonido (sintetizado, sin archivos) ----------
    let audio = null;
    function chime(gold) {
        try {
            audio ||= new (window.AudioContext || window.webkitAudioContext)();
            const now = audio.currentTime;
            (gold ? [784, 988, 1319] : [880, 1320]).forEach((f, i) => {
                const o = audio.createOscillator(), g = audio.createGain();
                o.type = 'triangle'; o.frequency.value = f;
                g.gain.setValueAtTime(0.0001, now + i * 0.07);
                g.gain.exponentialRampToValueAtTime(0.08, now + i * 0.07 + 0.01);
                g.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.25);
                o.connect(g).connect(audio.destination);
                o.start(now + i * 0.07); o.stop(now + i * 0.07 + 0.3);
            });
        } catch { /* sin audio */ }
    }

    // ---------- Interfaz ----------
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = new URL('./game.css?v=1', import.meta.url).href;
    document.head.append(css);

    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'game-pill';
    pill.hidden = true;
    pill.setAttribute('aria-label', 'Objetivos y puntos');
    pill.innerHTML = '<span class="game-pill__lvl" data-g-lvl>1</span><span class="game-pill__pts"><b data-g-pts>0</b> ✦</span><span class="game-pill__q" data-g-q></span><i class="game-pill__bar"><i data-g-bar></i></i>';
    document.querySelector('[data-settings]').before(pill);

    const feed = document.createElement('div');
    feed.className = 'game-feed';
    feed.setAttribute('aria-live', 'polite');
    document.body.append(feed);

    const gift = document.createElement('div');
    gift.className = 'game-gift';
    gift.hidden = true;
    gift.innerHTML = '<div class="game-gift__card"><p class="game-gift__box" aria-hidden="true">🎁</p><p class="totem-panel__tag">Regalo del día</p><h2 data-g-gift></h2><p>Mañana hay otro, si te da gusto pasar.</p></div>';
    document.body.append(gift);
    gift.addEventListener('click', () => { gift.hidden = true; });

    const box = document.createElement('div');
    box.className = 'login login--scroll';
    box.hidden = true;
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-labelledby', 'game-title');
    box.innerHTML = `
        <div class="login__card game">
            <p class="totem-panel__tag">Objetivos y puntos</p>
            <div class="game__level">
                <span class="game__badge" data-g-badge>1</span>
                <div><h2 id="game-title" data-g-title></h2><p class="login__note" data-g-sub></p></div>
            </div>
            <i class="game__bar"><i data-g-lvlbar></i></i>
            <h3>Hoy <small data-g-day></small></h3>
            <ul class="game__quests" data-g-quests></ul>
            <p class="game__hint" data-g-reroll-note></p>
            <h3>Esta semana</h3>
            <div class="game__days" data-g-days></div>
            <h3>Meta de todos</h3>
            <p class="login__note" data-g-community-text></p>
            <i class="game__bar game__bar--all"><i data-g-community></i></i>
            <h3>Ranking</h3>
            <div class="game__tabs" role="tablist">
                <button type="button" role="tab" data-g-tab="week" aria-selected="true">Esta semana</button>
                <button type="button" role="tab" data-g-tab="total" aria-selected="false">Siempre</button>
            </div>
            <ol class="game__board" data-g-board></ol>
            <details class="game__help">
                <summary>¿Cómo se juega?</summary>
                <ul>
                    <li>✦ Las chispas aparecen por el mundo: pasa por encima para atraparlas. Las doradas 🌟 (con un rayo de luz) valen 5. Si no ves ninguna, sigue la flecha del piso.</li>
                    <li>🎯 Cada día hay 3 objetivos, los mismos para todos. Cada uno da 10 puntos y los tres juntos, 20 más. Si uno no te gusta, puedes cambiarlo una vez al día.</li>
                    <li>🎁 La primera vez que entras cada día hay un regalo sorpresa.</li>
                    <li>📅 Si pasas 3 días distintos en la semana ganas 25; si pasas 5, 50 más. Faltar un día no te quita nada.</li>
                    <li>☄️ En los primeros 3 minutos de cada hora llueven chispas: hay el triple y más doradas.</li>
                    <li>🤝 Meta de todos: si entre todos juntamos las chispas de la semana, cada persona que ayudó gana 30.</li>
                    <li>🏅 Con los puntos subes de nivel: los demás ven tu nivel junto a tu nombre y el color de tu aura cambia.</li>
                </ul>
            </details>
            <button class="login__back" type="button" data-g-close>Cerrar</button>
        </div>`;
    document.body.append(box);
    const $ = (sel) => box.querySelector(sel);
    pill.addEventListener('click', () => { box.hidden = false; net.send({ type: 'game_board' }); render(); });
    $('[data-g-close]').addEventListener('click', () => { box.hidden = true; });
    box.addEventListener('click', (e) => { if (e.target === box) box.hidden = true; });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !box.hidden) box.hidden = true; });
    box.querySelectorAll('[data-g-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.gTab; renderBoard(); }));

    const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

    function render() {
        const me = state.me;
        if (!me) return;
        pill.hidden = false;
        const done = me.quests.filter((x) => x.n >= x.goal).length;
        pill.querySelector('[data-g-lvl]').textContent = me.level;
        pill.querySelector('[data-g-pts]').textContent = me.points;
        pill.querySelector('[data-g-q]').textContent = `${done}/${me.quests.length}`;
        pill.querySelector('[data-g-q]').classList.toggle('is-done', done === me.quests.length);
        const pct = Math.min(100, ((me.points - me.floor) / Math.max(1, me.next - me.floor)) * 100);
        pill.querySelector('[data-g-bar]').style.width = `${pct}%`;
        pill.style.setProperty('--tier', hex(tierColor(me.level)));
        pill.classList.toggle('is-rain', state.rain);
        pill.title = `Nivel ${me.level} · ${me.points} puntos · objetivos de hoy ${done}/${me.quests.length}`;
        if (box.hidden) return;

        $('[data-g-badge]').textContent = me.level;
        box.querySelector('.game').style.setProperty('--tier', hex(tierColor(me.level)));
        $('[data-g-title]').textContent = me.title;
        $('[data-g-sub]').textContent = `Nivel ${me.level} · ${me.points} puntos · faltan ${me.next - me.points} para el nivel ${me.level + 1}`
            + (me.rank ? ` · puesto ${me.rank} de la semana` : '');
        $('[data-g-lvlbar]').style.width = `${pct}%`;
        $('[data-g-day]').textContent = me.all_done ? '· ¡todo listo! 🏁' : '· se renuevan a medianoche';
        $('[data-g-quests]').innerHTML = me.quests.map((x, i) => {
            const ok = x.n >= x.goal;
            const canSwap = !me.rerolled && !ok && i > 0;
            return `<li class="${ok ? 'is-done' : ''}">
                <span class="game__qicon" aria-hidden="true">${ok ? '✓' : QUEST_ICONS[x.k] || '🎯'}</span>
                <span class="game__qtext">${esc(x.text)}<i class="game__bar"><i style="width:${(x.n / x.goal) * 100}%"></i></i></span>
                <span class="game__qnum">${x.n}/${x.goal}</span>
                ${canSwap ? `<button type="button" class="game__swap" data-g-swap="${i}" aria-label="Cambiar este objetivo" title="Cambiar este objetivo">↻</button>` : ''}
            </li>`;
        }).join('');
        $('[data-g-reroll-note]').textContent = me.rerolled ? 'Hoy ya cambiaste un objetivo.' : 'Puedes cambiar uno de los objetivos con ↻ (una vez por día).';
        box.querySelectorAll('[data-g-swap]').forEach((b) => b.addEventListener('click', () => net.send({ type: 'game_reroll', index: Number(b.dataset.gSwap) })));
        const days = me.week_days;
        $('[data-g-days]').innerHTML = Array.from({ length: 7 }, (_, i) => {
            const n = i + 1;
            const bonus = me.week_bonus[n];
            return `<span class="game__day ${n <= days ? 'is-on' : ''} ${bonus ? 'has-bonus' : ''}">${bonus ? `+${bonus}` : n}</span>`;
        }).join('') + `<span class="game__dayinfo">${days} ${days === 1 ? 'día' : 'días'}</span>`;
        renderBoard();
    }

    function renderBoard() {
        const b = state.board;
        box.querySelectorAll('[data-g-tab]').forEach((t) => t.setAttribute('aria-selected', String(t.dataset.gTab === state.tab)));
        if (!b) return;
        const c = b.community;
        $('[data-g-community-text]').textContent = c.done
            ? `¡Lo logramos! ${c.count} chispas entre ${c.helpers} ${c.helpers === 1 ? 'persona' : 'personas'} esta semana. 🎆`
            : `${c.count} de ${c.goal} chispas entre ${c.helpers} ${c.helpers === 1 ? 'persona' : 'personas'}. Si llegamos, cada quien que ayudó gana 30.`;
        $('[data-g-community]').style.width = `${Math.min(100, (c.count / c.goal) * 100)}%`;
        const rows = b[state.tab] || [];
        $('[data-g-board]').innerHTML = rows.length
            ? rows.map((r, i) => `<li class="${r.id === net.myId ? 'is-me' : ''}" style="--tier:${hex(tierColor(r.level))}">
                <span class="game__pos">${['🥇', '🥈', '🥉'][i] || i + 1}</span>
                <span class="game__who">${esc(r.name)} <small>Nv ${r.level}</small></span>
                <b>${r.points}</b></li>`).join('')
            : '<li class="game__empty">Todavía nadie. ¡Atrapa la primera chispa!</li>';
    }

    // Avisos que se apilan arriba a la izquierda y se van solos.
    function toast(icon, text, big = false) {
        const el = document.createElement('p');
        el.className = `game-feed__item${big ? ' is-big' : ''}`;
        el.innerHTML = `<span aria-hidden="true">${icon}</span> ${esc(text)}`;
        feed.prepend(el);
        while (feed.children.length > 4) feed.lastElementChild.remove();
        setTimeout(() => { el.classList.add('is-out'); setTimeout(() => el.remove(), 400); }, big ? 6500 : 4200);
    }

    // «+1» que sube desde donde estaba la chispa.
    function floatText(text, pos, gold) {
        v.copy(pos).project(camera);
        if (v.z > 1) return;
        const el = document.createElement('span');
        el.className = `game-float${gold ? ' is-gold' : ''}`;
        el.textContent = text;
        el.style.left = `${(v.x * 0.5 + 0.5) * window.innerWidth}px`;
        el.style.top = `${(-v.y * 0.5 + 0.5) * window.innerHeight}px`;
        document.body.append(el);
        setTimeout(() => el.remove(), 1100);
    }

    // ---------- Mensajes del servidor ----------
    function addOrb(o) {
        if (orbs.has(o.id) || orbs.size >= MAX_ORBS * 2) return;
        orbs.set(o.id, { data: o, born: performance.now(), taking: 0, phase: Math.random() * 6.28 });
    }
    net.on('game_orbs', (m) => { orbs.clear(); m.orbs.forEach(addOrb); });
    net.on('game_orb', (m) => addOrb(m.orb));
    net.on('game_orb_miss', (m) => orbs.delete(m.id));
    net.on('game_orb_taken', (m) => {
        const o = orbs.get(m.id);
        orbs.delete(m.id);
        if (!o || o.data.scene !== here.id) return;
        const mine = m.by && m.by === net.myId;
        if (!m.by) return;   // se apagó sola
        burst(o.data.x, 1, o.data.z, o.data.gold ? 0xffd400 : 0x00e5ff, mine ? 30 : 16);
        if (mine) {
            chime(o.data.gold);
            floatText(o.data.gold ? '+5 ✦' : '+1 ✦', v.set(o.data.x, 1.4, o.data.z), o.data.gold);
        }
    });
    net.on('game_me', (m) => {
        const before = state.me;
        state.me = m;
        if (before && m.level > before.level) {
            toast('🎉', `¡Nivel ${m.level}! Ahora eres «${m.title}»`, true);
            party = 2.5;
        }
        if (!before || m.level !== before.level) onMyLevel?.(m.level);
        render();
    });
    net.on('game_board', (m) => { state.board = m; state.rain = m.rain; render(); renderBoard(); });
    net.on('game_community', (m) => {
        if (!state.board) return;
        state.board.community = { count: m.count, goal: m.goal, done: m.done, helpers: m.helpers };
        if (!box.hidden) renderBoard();
    });
    net.on('game_levels', (m) => {
        state.levels = new Map(Object.entries(m.levels));
        for (const [id, level] of state.levels) onLevel?.(id, level);
    });
    net.on('game_level', (m) => {
        state.levels.set(m.id, m.level);
        onLevel?.(m.id, m.level);
        if (m.id !== net.myId) toast('🏅', `${m.name} subió a nivel ${m.level} · ${m.title}`);
    });
    net.on('game_points', (m) => {
        // Las chispas ya se ven con su «+1»; el regalo tiene su propia tarjeta.
        if (m.reason === 'Chispa' || m.reason === 'Chispa dorada' || m.reason === 'Regalo del día') return;
        toast('✨', `+${m.points} · ${m.reason}`, m.points >= 20);
    });
    net.on('game_gift', (m) => {
        gift.querySelector('[data-g-gift]').textContent = `+${m.points} puntos`;
        gift.classList.toggle('is-big', m.points >= 20);
        gift.hidden = false;
        setTimeout(() => { gift.hidden = true; }, 4200);
    });
    net.on('game_feed', (m) => toast(m.icon || '✨', m.text, !!m.big));
    net.on('game_party', () => { party = 4; });
    net.on('game_rain', (m) => { state.rain = m.on; render(); });
    net.on('game_error', (m) => toast('⚠️', m.message));

    // ---------- Cada cuadro ----------
    const pending = new Map();   // id -> momento en que se pidió
    function update(dt, t) {
        const now = performance.now();
        const counts = { blue: 0, gold: 0 };
        let nearest = null, nearestD = Infinity;
        const px = player.position.x, pz = player.position.z;
        for (const [id, o] of orbs) {
            if (o.data.scene !== here.id) continue;
            const d = Math.hypot(o.data.x - px, o.data.z - pz);
            if (d < TAKE_DIST && net.loggedIn && !(now - (pending.get(id) || -1e9) < 1500)) {
                pending.set(id, now);
                o.taking = now;
                net.send({ type: 'game_take', id });
            }
            const taking = o.taking && now - o.taking < 1500;
            if (!taking && d < nearestD) { nearest = o; nearestD = d; }
            const set = o.data.gold ? 'gold' : 'blue';
            const k = counts[set]++;
            if (k >= MAX_ORBS) continue;
            const grow = Math.min(1, (now - o.born) / 450);
            const scale = taking ? 0.35 : 0.2 + 0.8 * (1 - (1 - grow) ** 3);
            v.set(o.data.x, orbY(o, t), o.data.z);
            q.setFromAxisAngle(yAxis, t * 1.6 + o.phase);
            s.setScalar(scale * (o.data.gold ? 1.25 : 1));
            m4.compose(v, q, s);
            sets[set].core.setMatrixAt(k, m4);
            v.y = 0.02;
            s.setScalar(scale * (1 + Math.sin(t * 4 + o.phase) * 0.15) * (o.data.gold ? 1.4 : 1));
            m4.compose(v, q, s);
            sets[set].halo.setMatrixAt(k, m4);
            if (sets[set].beam) {
                v.y = 0; s.setScalar(scale);
                m4.compose(v, q.identity(), s);
                sets[set].beam.setMatrixAt(k, m4);
            }
        }
        for (const key of ['blue', 'gold']) {
            const set = sets[key];
            for (const m of [set.core, set.halo, set.beam].filter(Boolean)) {
                m.count = Math.min(MAX_ORBS, counts[key]);
                m.instanceMatrix.needsUpdate = true;
            }
        }
        for (const [id, at] of pending) if (now - at > 1500) { pending.delete(id); const o = orbs.get(id); if (o) o.taking = 0; }

        arrow.visible = !!nearest && nearestD > 7;
        if (arrow.visible) {
            const a = Math.atan2(nearest.data.x - px, nearest.data.z - pz);
            arrow.position.set(px + Math.sin(a) * 1.35, 0.02, pz + Math.cos(a) * 1.35);
            arrow.rotation.y = a + Math.PI;
            arrow.rotation.x = -Math.PI / 2;
            arrow.material.color.setHex(nearest.data.gold ? 0xffd400 : 0x00e5ff);
            arrow.material.opacity = 0.45 + Math.sin(t * 4) * 0.25;
        }
        updateParty(dt);
        updateSparks(dt);
    }

    return {
        update,
        levelOf: (id) => state.levels.get(id) || 1,
    };
}
