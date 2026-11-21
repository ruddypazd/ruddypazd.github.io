// Chat de voz por proximidad: como un canal de voz de Discord, pero solo escuchas a quienes están
// cerca de ti en la misma escena (mundo principal o un universo).
//
// El audio va directo de navegador a navegador (WebRTC). El socket del mundo solo presenta a las
// dos partes (mensajes "rtc") y cuenta quién tiene la voz activada ("voice"). Ver voice.py en el
// servidor.
//
// - Te conectas con las MAX_PEERS personas más cercanas a menos de CONNECT_DIST m y te desconectas
//   al pasar DROP_DIST m (con margen, así no se corta en el borde).
// - Cada voz sale de donde está su personaje (PannerNode): más fuerte cerca, nada a HEAR_DIST m, y
//   a la izquierda o a la derecha según dónde esté respecto de la cámara.
// - El micrófono se pide recién al tocar 🎤. Sin micrófono igual escuchas a los demás.
// - Ofrece la conexión quien tiene el id menor, así nunca se cruzan dos ofertas.

const CONNECT_DIST = 15;
const DROP_DIST = 19;
const HEAR_DIST = 14;      // a esta distancia ya no se oye (modelo lineal)
const FULL_DIST = 2;       // hasta acá, volumen completo
const MAX_PEERS = 8;
const CHECK_EVERY = 0.4;   // segundos entre revisiones de quién está cerca
const RETRY_AFTER = 4000;  // ms antes de reintentar una conexión que falló
const STORE_KEY = 'rp_voice';

function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function save(v) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(v)); } catch { /* modo privado */ }
}

export function createVoice({ net, camera, getSelf, remotes, onChange }) {
    const saved = load();
    const state = {
        on: saved.on !== false,      // escuchar (activado por defecto)
        mic: false,                  // el micrófono siempre arranca apagado al cargar la página
        myLevel: 0,
        error: '',
    };
    const session = Math.random().toString(36).slice(2, 10);
    const peersOn = new Map();       // id -> { mic } de quienes tienen la voz activada
    const conns = new Map();         // id -> conexión (ver connect)
    const failedAt = new Map();      // id -> cuándo falló la última vez
    let iceServers = [{ urls: ['stun:stun.l.google.com:19302'] }];
    let ctx = null, micStream = null, micTrack = null, micAnalyser = null;
    let checkIn = 0;
    const buf = new Uint8Array(256);

    // ---------- Audio ----------
    function audio() {
        if (ctx) return ctx;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        ctx = new AC();
        return ctx;
    }
    // Los navegadores solo dejan sonar audio después de que la persona toca algo.
    const unlock = () => { const c = audio(); if (c?.state === 'suspended') c.resume().catch(() => {}); };
    for (const ev of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(ev, unlock, { capture: true, passive: true });

    function levelOf(analyser) {
        if (!analyser) return 0;
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        return Math.min(1, Math.sqrt(sum / buf.length) * 4);
    }

    // ---------- Estado compartido ----------
    function announce() {
        if (!net.loggedIn) return;
        net.send(state.on ? { type: 'voice', on: true, mic: state.mic } : { type: 'voice', on: false });
    }
    function changed() { save({ on: state.on }); onChange?.(state); }

    async function setMic(on) {
        if (on && !state.on) await setOn(true);
        if (on && !micTrack) {
            if (!navigator.mediaDevices?.getUserMedia) {
                state.error = 'Este navegador no deja usar el micrófono (¿página sin https?).';
                return changed();
            }
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
                });
            } catch (e) {
                state.error = e?.name === 'NotAllowedError'
                    ? 'No diste permiso al micrófono. Actívalo en el candado de la barra de direcciones.'
                    : 'No se encontró un micrófono.';
                return changed();
            }
            micTrack = micStream.getAudioTracks()[0];
            micTrack.addEventListener('ended', () => setMic(false));
            const c = audio();
            if (c) {
                micAnalyser = c.createAnalyser();
                micAnalyser.fftSize = 512;
                c.createMediaStreamSource(micStream).connect(micAnalyser);
            }
        }
        if (!on && micStream) {
            micStream.getTracks().forEach((t) => t.stop());   // que se apague el aviso de micrófono
            micStream = micTrack = micAnalyser = null;
        }
        state.mic = on;
        state.error = '';
        for (const c of conns.values()) c.sender?.replaceTrack(micTrack).catch(() => {});
        announce();
        changed();
    }

    async function setOn(on) {
        state.on = on;
        if (!on) {
            if (state.mic) await setMic(false);
            for (const id of [...conns.keys()]) hangUp(id, true);
        }
        unlock();
        announce();
        changed();
    }

    // ---------- Conexiones ----------
    function send(id, msg, c) {
        net.send({ type: 'rtc', to: id, s: session, ...(c?.remoteSession ? { rs: c.remoteSession } : {}), ...msg });
    }

    function connect(id, initiator) {
        const pc = new RTCPeerConnection({ iceServers });
        const c = { id, pc, initiator, remoteSession: null, pending: [], sender: null, level: 0, analyser: null, nodes: [] };
        conns.set(id, c);
        pc.onicecandidate = (e) => send(id, { kind: 'ice', c: e.candidate ? e.candidate.toJSON() : null }, c);
        pc.onconnectionstatechange = () => {
            if (conns.get(id) !== c) return;
            if (pc.connectionState === 'failed') { failedAt.set(id, performance.now()); hangUp(id, true); }
        };
        pc.ontrack = (e) => attach(c, e.streams[0] || new MediaStream([e.track]));
        if (initiator) {
            const tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
            c.sender = tr.sender;
            if (micTrack) tr.sender.replaceTrack(micTrack).catch(() => {});
            (async () => {
                try {
                    await pc.setLocalDescription(await pc.createOffer());
                    send(id, { kind: 'offer', sdp: pc.localDescription.sdp }, c);
                } catch { hangUp(id, true); }
            })();
        }
        return c;
    }

    function attach(c, stream) {
        if (c.audioEl) return;
        // Chrome no deja leer una voz de WebRTC con Web Audio si no está también en un <audio>
        // (callado: el sonido sale por el panner).
        const el = new Audio();
        el.srcObject = stream;
        el.autoplay = true;
        el.playsInline = true;
        c.audioEl = el;
        const a = audio();
        if (!a) { el.play().catch(() => {}); return; }   // sin Web Audio: sin posición, pero se oye
        el.muted = true;
        el.play().catch(() => {});
        const src = a.createMediaStreamSource(stream);
        const panner = a.createPanner();
        Object.assign(panner, {
            panningModel: 'HRTF', distanceModel: 'linear', refDistance: FULL_DIST, maxDistance: HEAR_DIST, rolloffFactor: 1,
        });
        const analyser = a.createAnalyser();
        analyser.fftSize = 512;
        src.connect(analyser);
        src.connect(panner).connect(a.destination);
        c.panner = panner;
        c.analyser = analyser;
        c.nodes = [src, panner, analyser];
        placePanner(c, true);
    }

    function hangUp(id, tell) {
        const c = conns.get(id);
        if (!c) return;
        conns.delete(id);
        if (tell) send(id, { kind: 'bye' }, c);
        try { c.pc.close(); } catch { /* ya cerrada */ }
        c.nodes.forEach((n) => { try { n.disconnect(); } catch { /* nada */ } });
        if (c.audioEl) { c.audioEl.srcObject = null; c.audioEl = null; }
        const r = remotes.get(id);
        if (r) r.voiceLevel = 0;
    }

    async function onSignal(m) {
        const id = m.from;
        if (!id || (m.rs && m.rs !== session)) return;   // para una carga anterior de esta página
        let c = conns.get(id);
        if (m.kind === 'bye') { if (c && (!m.s || !c.remoteSession || c.remoteSession === m.s)) hangUp(id, false); return; }
        // Recargó la página: lo de su conexión anterior ya no sirve.
        if (c && c.remoteSession && m.s && c.remoteSession !== m.s) { hangUp(id, false); c = null; }
        if (m.kind === 'offer') {
            const d = distanceTo(id);
            if (!state.on || d > DROP_DIST || (!c && conns.size >= MAX_PEERS + 2)) { send(id, { kind: 'bye' }, { remoteSession: m.s }); return; }
            if (!c) c = connect(id, false);
            c.remoteSession = m.s || null;
            try {
                await c.pc.setRemoteDescription({ type: 'offer', sdp: m.sdp });
                const tr = c.pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio') || c.pc.getTransceivers()[0];
                if (tr) {
                    tr.direction = 'sendrecv';
                    c.sender = tr.sender;
                    if (micTrack) await tr.sender.replaceTrack(micTrack);
                }
                await c.pc.setLocalDescription(await c.pc.createAnswer());
                send(id, { kind: 'answer', sdp: c.pc.localDescription.sdp }, c);
                flush(c);
            } catch { hangUp(id, true); }
            return;
        }
        if (!c) return;
        if (m.kind === 'answer') {
            if (c.remoteSession == null) c.remoteSession = m.s || null;
            try { await c.pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); flush(c); } catch { hangUp(id, true); }
            return;
        }
        if (m.kind === 'ice') {
            if (!c.pc.remoteDescription) c.pending.push(m.c);
            else c.pc.addIceCandidate(m.c || undefined).catch(() => {});
        }
    }
    function flush(c) {
        for (const cand of c.pending.splice(0)) c.pc.addIceCandidate(cand || undefined).catch(() => {});
    }

    // ---------- Proximidad ----------
    function distanceTo(id) {
        const r = remotes.get(id);
        const me = getSelf();
        if (!r || r.isBot || !me || r.scene !== me.scene || r.online === false) return Infinity;
        return Math.hypot(r.group.position.x - me.x, r.group.position.z - me.z);
    }

    function check() {
        if (!state.on || !net.loggedIn || !window.RTCPeerConnection) {
            for (const id of [...conns.keys()]) hangUp(id, false);
            return;
        }
        const near = [];
        for (const [id, p] of peersOn) {
            if (!p.mic && !state.mic) continue;    // ninguno de los dos habla: no hace falta conectarse
            const d = distanceTo(id);
            if (d < (conns.has(id) ? DROP_DIST : CONNECT_DIST)) near.push([id, d]);
        }
        near.sort((a, b) => a[1] - b[1]);
        const keep = new Set(near.slice(0, MAX_PEERS).map(([id]) => id));
        for (const id of [...conns.keys()]) if (!keep.has(id)) hangUp(id, true);
        const now = performance.now();
        for (const id of keep) {
            if (conns.has(id) || !(net.myId < id)) continue;   // ofrece quien tiene el id menor
            if (now - (failedAt.get(id) ?? -Infinity) < RETRY_AFTER) continue;
            connect(id, true);
        }
    }

    // ---------- Cada cuadro ----------
    const fwd = { x: 0, y: 0, z: -1 };
    function placePanner(c, now) {
        const r = remotes.get(c.id);
        const me = getSelf();
        if (!c.panner || !r || !me || !ctx) return;
        // Posición relativa a tu personaje (no a la cámara): la distancia es entre personajes.
        const x = r.group.position.x - me.x, z = r.group.position.z - me.z;
        const t = now ? 0 : ctx.currentTime + 0.05;
        if (c.panner.positionX) {
            if (now) { c.panner.positionX.value = x; c.panner.positionY.value = 0; c.panner.positionZ.value = z; }
            else { c.panner.positionX.linearRampToValueAtTime(x, t); c.panner.positionY.linearRampToValueAtTime(0, t); c.panner.positionZ.linearRampToValueAtTime(z, t); }
        } else c.panner.setPosition(x, 0, z);
    }

    function update(dt) {
        checkIn -= dt;
        if (checkIn <= 0) { checkIn = CHECK_EVERY; check(); }
        if (ctx && conns.size) {
            // El oyente mira hacia donde mira la cámara (izquierda y derecha como en la pantalla).
            const e = camera.matrixWorld.elements;
            fwd.x = -e[8]; fwd.y = 0; fwd.z = -e[10];
            const len = Math.hypot(fwd.x, fwd.z) || 1;
            const l = ctx.listener;
            if (l.forwardX) {
                l.positionX.value = 0; l.positionY.value = 0; l.positionZ.value = 0;
                l.forwardX.value = fwd.x / len; l.forwardY.value = 0; l.forwardZ.value = fwd.z / len;
                l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
            } else {
                l.setPosition(0, 0, 0);
                l.setOrientation(fwd.x / len, 0, fwd.z / len, 0, 1, 0);
            }
        }
        for (const c of conns.values()) {
            placePanner(c, false);
            const r = remotes.get(c.id);
            const lv = levelOf(c.analyser);
            c.level += (lv - c.level) * Math.min(1, dt * 12);
            if (r) r.voiceLevel = c.level;
        }
        const mine = state.mic ? levelOf(micAnalyser) : 0;
        state.myLevel += (mine - state.myLevel) * Math.min(1, dt * 12);
    }

    // ---------- Mensajes del servidor ----------
    net.tap('ice', (m) => { if (Array.isArray(m.servers) && m.servers.length) iceServers = m.servers; });
    net.tap('voice_peers', (m) => {
        peersOn.clear();
        for (const p of m.peers || []) if (p.id !== net.myId) peersOn.set(p.id, { mic: !!p.mic });
        announce();   // al (re)conectarse, el servidor olvidó tu estado
    });
    net.tap('voice', (m) => {
        if (!m.id || m.id === net.myId) return;
        if (m.on) peersOn.set(m.id, { mic: !!m.mic });
        else { peersOn.delete(m.id); hangUp(m.id, false); }
    });
    net.tap('rtc', (m) => { onSignal(m); });

    return {
        state,
        update,
        setOn,
        setMic,
        toggleMic: () => setMic(!state.mic),
        // Para mostrar en el perfil o en la etiqueta: si esa persona tiene la voz y el micrófono.
        peer: (id) => peersOn.get(id) || null,
        connectedCount: () => conns.size,
    };
}
