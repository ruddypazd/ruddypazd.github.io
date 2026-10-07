/* ===========================================================
   Teléfono: llamada de voz con el agente IA (ElevenLabs SDK)
   Reemplaza al widget de ElevenLabs con una interfaz propia
   que muestra la conversación transcrita en la pantalla.
   =========================================================== */

const SDK = 'https://cdn.jsdelivr.net/npm/@elevenlabs/client@1.26.0/+esm';

const root = document.getElementById('phone');
if (root) {
    const $ = (s) => root.querySelector(s);
    const AGENT_ID = root.dataset.agentId;
    const phone = $('.phone');
    const status = $('[data-phone-status]');
    const tr = $('[data-phone-transcript]');
    const btnCall = $('[data-phone-call]');
    const btnEnd = $('[data-phone-end]');
    const fab = $('.phonew__fab');

    const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const mmss = (t) => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const clockEl = $('[data-phone-clock]');
    const tick = () => (clockEl.textContent = new Date().toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }));
    tick();
    setInterval(tick, 30000);

    let session = null;
    let live = false;
    let lines = 0;
    let started = 0;
    let clock = null;

    const note = (text) => { tr.innerHTML = `<p class="phone__empty">${esc(text)}</p>`; };

    const addLine = (who, text, ai) => {
        tr.querySelector('.phone__empty')?.remove();
        lines++;
        tr.insertAdjacentHTML('beforeend', `<p class="phone__line${ai ? ' phone__line--ai' : ''}"><b>${esc(who)}</b>${esc(text)}</p>`);
        tr.scrollTop = tr.scrollHeight;
    };

    const setState = (s) => {
        phone.classList.toggle('is-ringing', s === 'ringing');
        phone.classList.toggle('is-live', s === 'live');
        if (s !== 'live') phone.classList.remove('is-speaking');
        btnCall.disabled = s !== 'idle';
        btnEnd.disabled = s === 'idle';
    };

    const reset = () => {
        setState('idle');
        status.textContent = 'Agente de voz';
        note('Presiona Llamar para hablar con mi agente IA. La conversación aparecerá aquí.');
    };

    const hangUp = () => {
        const s = session;
        session = null;
        s?.endSession().catch(() => {});
        clearInterval(clock);
        const dur = live ? (Date.now() - started) / 1000 : 0;
        live = false;
        setState('idle');
        if (!lines) return reset();
        status.textContent = `Llamada finalizada · ${mmss(dur)}`;
    };

    const call = async () => {
        setState('ringing');
        status.textContent = 'Llamando…';
        note('Permite el acceso al micrófono para hablar con el agente.');
        lines = 0;
        try {
            const { Conversation } = await import(SDK);
            session = await Conversation.startSession({
                agentId: AGENT_ID,
                connectionType: 'webrtc',
                onConnect: () => {
                    live = true;
                    started = Date.now();
                    setState('live');
                    note('Conectado. Habla cuando el agente te salude.');
                    clock = setInterval(() => live && (status.textContent = `En llamada · ${mmss((Date.now() - started) / 1000)}`), 1000);
                },
                onMessage: (m) => {
                    const text = (m.message || '').trim();
                    if (!text) return;
                    const user = m.source === 'user' || m.role === 'user';
                    addLine(user ? 'Tú' : 'Agente IA', text, !user);
                },
                // El orbe late cuando habla el agente y ondula cuando escucha
                onModeChange: ({ mode }) => phone.classList.toggle('is-speaking', mode === 'speaking'),
                onDisconnect: () => { if (session || live) hangUp(); },
                onError: (msg) => console.warn('ElevenLabs:', msg),
            });
        } catch (err) {
            console.warn(err);
            session = null;
            live = false;
            setState('idle');
            status.textContent = 'No se pudo iniciar la llamada';
            note(/permission|notallowed/i.test(String(err))
                ? 'Se necesita permiso del micrófono para hablar con el agente.'
                : 'No se pudo conectar con el agente de voz. Intenta de nuevo.');
        }
    };

    btnCall.addEventListener('click', call);
    btnEnd.addEventListener('click', hangUp);

    const toggle = (open = !root.classList.contains('open')) => {
        root.classList.toggle('open', open);
        fab.setAttribute('aria-expanded', open);
        if (!open && (session || live)) hangUp();
    };
    root.querySelectorAll('[data-phone-toggle]').forEach((b) => b.addEventListener('click', () => toggle()));
    document.addEventListener('keydown', (e) => e.key === 'Escape' && root.classList.contains('open') && toggle(false));
    window.addEventListener('pagehide', () => session && hangUp());

    reset();
}
