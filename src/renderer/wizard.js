/* Asistente de primer uso: idioma → IA → placa → prueba del LED → listo. */
(() => {
  const { BOARDS, findBoard } = window.ARPY_BOARDS;
  let root = null;
  let step = 0;
  let st = {};
  let poll = 0;

  async function open() {
    const settings = await A.api('settings:get');
    st = { lang: settings.lang || 'en', builtin: !!settings.builtinKey, key: settings.geminiApiKey || '', board: 'arduino:avr:uno', port: '', detected: [] };
    step = 0;
    root && root.remove();
    root = A.el('div', { id: 'wizard', class: 'wz' });
    document.body.append(root);
    render();
  }

  const STEPS = ['Idioma', 'Inteligencia artificial', 'Tu placa', 'Prueba', 'Listo'];

  function shell(title, sub, body, actions) {
    root.innerHTML = '';
    const dots = A.el('div', { class: 'wz-steps' }, ...STEPS.map((n, i) => A.el('span', { class: i === step ? 'on' : i < step ? 'done' : '' }, n)));
    const skip = A.el('button', { class: 'wz-skip', onclick: finish }, 'Saltar asistente');
    root.append(A.el('div', { class: 'wz-card' }, A.el('div', { class: 'wz-top' }, dots, skip),
      A.el('h2', {}, title), sub ? A.el('p', { class: 'wz-sub' }, sub) : null, body, A.el('div', { class: 'wz-actions' }, ...actions)));
  }

  const next = () => { step++; render(); };
  const back = () => { step--; render(); };
  const btn = (label, cls, fn) => A.el('button', { class: 'btn ' + cls, onclick: fn }, label);

  function render() {
    clearInterval(poll);
    if (step === 0) {
      const opt = (code, name, sub) => A.el('button', { class: 'wz-opt' + (st.lang === code ? ' on' : ''), onclick: () => { st.lang = code; render(); } }, A.el('b', {}, name), A.el('small', {}, sub));
      shell('Bienvenido a ARPY Copiler', 'Vamos a dejar todo listo en un minuto: idioma, IA, tu placa y una prueba.',
        A.el('div', { class: 'wz-opts' }, opt('en', 'English', 'Interface in English'), opt('es', 'Español', 'Interfaz en español')),
        [btn('Continuar', 'ino', async () => {
          const prev = (await A.api('settings:get')).lang || 'en';
          await A.api('settings:set', { lang: st.lang });
          if (prev !== st.lang) { sessionStorage.setItem('arpy.wizardStep', '1'); A.i18n.reload(); return; }
          next();
        })]);
    } else if (step === 1) {
      if (st.builtin) {
        shell('La IA ya está lista', 'Esta copia de la app trae una clave de Gemini incluida: puedes usar el chat desde ya.',
          A.el('div', { class: 'wz-ok' }, '✔ Inteligencia artificial activada'), [btn('Atrás', 'ghost', back), btn('Continuar', 'ino', next)]);
        return;
      }
      const key = A.el('input', { type: 'password', placeholder: 'AIza…', value: st.key });
      const status = A.el('div', { class: 'wz-status' });
      const test = async () => {
        status.className = 'wz-status';
        status.textContent = 'Probando la clave…';
        await A.api('settings:set', { geminiApiKey: key.value.trim() });
        try {
          const models = await A.api('ai:models');
          if (!models || !models.length) throw new Error('sin modelos');
          st.key = key.value.trim();
          status.className = 'wz-status ok';
          status.textContent = '✔ Clave válida. La IA está lista.';
          return true;
        } catch {
          status.className = 'wz-status bad';
          status.textContent = 'La clave no funciona. Revisa que esté completa (empieza por "AIza").';
          return false;
        }
      };
      shell('Conecta la inteligencia artificial', 'La IA de ARPY usa Google Gemini. La clave es gratis y tarda 1 minuto en conseguirse.',
        A.el('div', { class: 'wz-col' },
          A.el('ol', { class: 'wz-list' },
            A.el('li', {}, 'Abre ', A.el('a', { onclick: () => A.api('open-external', 'https://aistudio.google.com/apikey') }, 'aistudio.google.com/apikey'), ' e inicia sesión con tu cuenta de Google.'),
            A.el('li', {}, 'Pulsa "Create API key" y copia la clave.'),
            A.el('li', {}, 'Pégala aquí abajo.')),
          A.el('div', { class: 'row' }, key, btn('Probar', 'ghost', test)), status),
        [btn('Atrás', 'ghost', back), btn('Lo haré después', 'ghost', next), btn('Continuar', 'ino', async () => { if (!key.value.trim() || await test()) next(); })]);
      setTimeout(() => key.focus(), 50);
    } else if (step === 2) {
      const list = A.el('div', { class: 'wz-boards' });
      const sel = A.el('select', {}, ...BOARDS.map((b) => A.el('option', { value: b.fqbn }, b.name)));
      sel.value = st.board;
      sel.addEventListener('change', () => { st.board = sel.value; });
      const draw = () => {
        list.innerHTML = '';
        if (!st.detected.length) {
          list.append(A.el('div', { class: 'wz-wait' }, A.el('span', { class: 'wz-pulse' }), 'Conecta tu Arduino por USB… lo detectaré solo.'));
          return;
        }
        for (const d of st.detected) {
          const on = st.port === d.address;
          list.append(A.el('button', { class: 'wz-opt' + (on ? ' on' : ''), onclick: () => { st.port = d.address; if (d.board) { st.board = d.board.fqbn; sel.value = d.board.fqbn; } draw(); } },
            A.el('b', {}, d.board ? d.board.name : 'Placa sin identificar'), A.el('small', {}, d.address + (d.board ? '' : ' · elige el modelo abajo'))));
        }
      };
      const scan = async () => {
        let ports = [];
        let boards = [];
        try { ports = await A.api('serial:list'); } catch {}
        try { boards = await A.api('arduino:boards'); } catch {}
        const byAddr = new Map(boards.map((b) => [b.address, b]));
        st.detected = ports.map((p) => ({ address: p.address, board: byAddr.get(p.address) && byAddr.get(p.address).board }));
        if (!st.port && st.detected.length) {
          const best = st.detected.find((d) => d.board) || st.detected[0];
          st.port = best.address;
          if (best.board) { st.board = best.board.fqbn; sel.value = best.board.fqbn; }
        }
        if (root && step === 2) draw();
      };
      draw();
      scan();
      poll = setInterval(scan, 2500);
      shell('Conecta tu placa', 'Usa un cable USB de datos. Si no tienes placa todavía, puedes saltar este paso y usar el simulador.',
        A.el('div', { class: 'wz-col' }, list, A.el('div', { class: 'field' }, A.el('label', {}, 'Modelo de placa'), sel),
          A.el('a', { class: 'wz-help', onclick: () => A.features.openPortHelp() }, '¿No aparece? Revisar drivers')),
        [btn('Atrás', 'ghost', back), btn('No tengo placa', 'ghost', () => { step = 4; render(); }), btn('Continuar', 'ino', () => { if (!st.port) return A.toast('Conecta la placa o pulsa "No tengo placa"', 'err'); next(); })]);
    } else if (step === 3) {
      const status = A.el('div', { class: 'wz-status' }, `Se subirá un programa de prueba a ${findBoard(st.board).name} en ${st.port}. El LED de la placa parpadeará.`);
      const run = btn('Hacer parpadear el LED', 'ino', async () => {
        run.disabled = true;
        status.className = 'wz-status';
        status.textContent = 'Compilando y subiendo… (la primera vez se descarga el soporte de la placa y puede tardar unos minutos)';
        A.panels && A.panels.startBuild && A.panels.startBuild('Prueba del asistente');
        const r = await A.api('arduino:test-blink', { fqbn: st.board, port: st.port }).catch((e) => ({ ok: false, output: e.message }));
        run.disabled = false;
        if (r.ok) {
          status.className = 'wz-status ok';
          status.textContent = '✔ ¡Listo! El LED de la placa debería estar parpadeando.';
          run.textContent = 'Repetir prueba';
        } else {
          status.className = 'wz-status bad';
          status.textContent = 'No se pudo subir. Revisa el modelo de placa y el puerto, o los drivers. Detalle: ' + (r.output || '').split('\n').filter(Boolean).slice(-2).join(' ');
        }
      });
      shell('Probemos la placa', null, A.el('div', { class: 'wz-col' }, status, run), [btn('Atrás', 'ghost', back), btn('Continuar', 'ino', next)]);
    } else {
      shell('Todo listo', 'Ya puedes empezar. Algunas ideas:',
        A.el('div', { class: 'wz-opts three' },
          A.el('button', { class: 'wz-opt', onclick: () => finish('examples') }, A.el('b', {}, 'Ver ejemplos'), A.el('small', {}, 'Proyectos listos, algunos con apps de escritorio')),
          A.el('button', { class: 'wz-opt', onclick: () => finish('new') }, A.el('b', {}, 'Proyecto nuevo'), A.el('small', {}, 'Empieza desde una plantilla')),
          A.el('button', { class: 'wz-opt', onclick: () => finish('open') }, A.el('b', {}, 'Abrir un proyecto'), A.el('small', {}, 'Un .arpy que ya tengas'))),
        [btn('Terminar', 'ino', () => finish())]);
    }
  }

  async function finish(tab) {
    clearInterval(poll);
    const patch = { wizardDone: true };
    if (st.port) patch.wizardBoard = { fqbn: st.board, port: st.port };
    await A.api('settings:set', patch);
    root && root.remove();
    root = null;
    if (typeof tab === 'string' && A.app.welcomeTab) A.app.welcomeTab(tab);
  }

  // Si se cambió de idioma en el paso 1, la ventana se recarga y el asistente sigue donde iba.
  function resume() {
    const s = sessionStorage.getItem('arpy.wizardStep');
    if (!s) return false;
    sessionStorage.removeItem('arpy.wizardStep');
    open().then(() => { step = +s; render(); });
    return true;
  }

  A.wizard = { open, resume };
})();
