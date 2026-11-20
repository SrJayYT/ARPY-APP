/* Orquestación: proyecto, barra de herramientas, configuración, librerías, atajos */
(() => {
  const { BOARDS, findBoard } = window.ARPY_BOARDS;
  let settings = {};
  let env = { arduino: {}, python: {} };
  let pyRunning = false;

  A.app = { config: null, files: [] };

  // ---------- selects de placa ----------
  function fillBoards(select) {
    select.innerHTML = '';
    const fams = [...new Set(BOARDS.map((b) => b.family))];
    for (const f of fams) {
      const g = A.el('optgroup', { label: f });
      BOARDS.filter((b) => b.family === f).forEach((b) => g.append(A.el('option', { value: b.fqbn }, b.name)));
      select.append(g);
    }
  }

  function boardCard() {
    const cfg = A.app.config;
    const card = A.$('#boardCard');
    if (!cfg) { card.innerHTML = ''; return; }
    const b = findBoard(cfg.board);
    card.innerHTML = `<h4>${A.esc(b.name)}</h4><div class="muted" style="font-family:var(--mono);font-size:11px;margin-bottom:4px">${A.esc(b.fqbn)}</div>${b.features.map((f) => `<span class="feat">${A.esc(f)}</span>`).join('')}`;
  }

  function statusbar() {
    const cfg = A.app.config || {};
    A.$('#stBoard').textContent = cfg.board ? '⬢ ' + findBoard(cfg.board).name : '';
    A.$('#stPort').textContent = cfg.port ? '⏚ ' + cfg.port : '⏚ sin puerto';
    const cli = A.$('#stCli');
    cli.className = env.arduino.installed ? 'ok' : 'bad';
    cli.textContent = env.arduino.installed ? '✔ arduino-cli' : '⚠ arduino-cli no instalado (clic)';
    cli.onclick = env.arduino.installed ? null : openSettings;
    const py = A.$('#stPy');
    py.className = env.python.installed ? 'ok' : 'bad';
    py.textContent = env.python.installed ? '✔ ' + (env.python.version || 'Python') : '⚠ Python no encontrado';
  }

  async function setBoard(fqbn) {
    A.app.config = await A.api('project:config', { board: fqbn });
    A.$('#boardSelect').value = fqbn;
    boardCard();
    statusbar();
    A.chat.renderCtx();
  }

  // ---------- puertos ----------
  let knownPorts = null; // para detectar placas recién conectadas
  async function refreshPorts(announce) {
    if (A.app.config && A.app.config.arduino === false) return;
    const sel = A.$('#portSelect');
    let ports = [];
    try { ports = await A.api('serial:list'); } catch {}
    let detected = [];
    if (env.arduino.installed) { try { detected = await A.api('arduino:boards'); } catch {} }
    const byAddr = new Map(detected.map((d) => [d.address, d]));
    const all = new Map();
    ports.forEach((p) => all.set(p.address, { address: p.address, label: p.manufacturer ? `${p.address} (${p.manufacturer})` : p.address }));
    detected.filter((d) => d.protocol === 'serial' || !all.has(d.address)).forEach((d) => { if (!all.has(d.address)) all.set(d.address, { address: d.address, label: d.label }); });
    for (const [addr, p] of all) { const d = byAddr.get(addr); if (d && d.board) p.label = `${addr} — ${d.board.name}`; p.board = d && d.board; }

    const cfg = A.app.config || {};
    sel.innerHTML = '';
    if (!all.size) sel.append(A.el('option', { value: '' }, 'Sin placas conectadas'));
    for (const p of all.values()) sel.append(A.el('option', { value: p.address }, p.label));
    if (cfg.port && !all.has(cfg.port)) sel.append(A.el('option', { value: cfg.port }, `${cfg.port} (desconectado)`));

    let port = cfg.port;
    if ((!port || !all.has(port)) && all.size) {
      const withBoard = [...all.values()].find((p) => p.board) || [...all.values()][0];
      port = withBoard.address;
      if (A.app.config) A.app.config = await A.api('project:config', { port });
    }
    sel.value = port || '';
    const info = all.get(port);
    if (announce && info && info.board) {
      if (info.board.fqbn && info.board.fqbn !== cfg.board) {
        A.toast(`Detectada ${info.board.name} en ${port}. Cambiando la placa del proyecto.`, 'ok');
        await setBoard(info.board.fqbn);
      } else A.toast(`${info.board.name} en ${port}`, 'ok');
    }
    // Placa recién enchufada en otro puerto: ofrecer usarla.
    const added = knownPorts ? [...all.values()].filter((p) => !knownPorts.has(p.address) && p.address !== port) : [];
    knownPorts = new Set(all.keys());
    for (const p of added.slice(0, 2)) {
      const use = async () => {
        A.app.config = await A.api('project:config', { port: p.address });
        if (p.board && p.board.fqbn && p.board.fqbn !== A.app.config.board) await setBoard(p.board.fqbn);
        sel.value = p.address;
        statusbar();
        A.toast(`Usando ${p.board ? p.board.name : 'la placa'} en ${p.address}`, 'ok');
      };
      const text = p.board
        ? `Se conectó ${p.board.name} en ${p.address}`
        : `Se conectó una placa sin identificar en ${p.address} (puede ser un clon con chip CH340)`;
      A.toast(text, 'ok', { action: { label: 'Usar', fn: use } });
    }
    renderPortHelp(all.size === 0);
    statusbar();
  }

  // ---------- tecnologías del proyecto ----------
  const TECH = window.ARPY_TECHS;
  const techs = () => TECH.techsOf(A.app.config || {});
  const hasTech = (id) => techs().includes(id);
  const arduinoOn = () => !A.app.config || hasTech('arduino');

  // Muestra solo las herramientas de las tecnologías activas.
  function applyTechMode() {
    const t = A.app.config ? techs() : ['arduino', 'python'];
    document.body.classList.toggle('no-arduino', !t.includes('arduino'));
    document.body.classList.toggle('no-python', !t.includes('python'));
    document.body.classList.toggle('no-preview', !t.some((id) => TECH.find(id).preview));
    A.$('#projTechs') && A.$('#projTechs').remove();
    if (A.app.config) {
      const shown = t.slice(0, 3).map((id) => A.el('i', { style: `--tc:${TECH.find(id).color}` }, TECH.find(id).short));
      if (t.length > 3) shown.push(A.el('i', { class: 'more' }, `+${t.length - 3}`));
      A.$('#projName').after(A.el('span', { id: 'projTechs', class: 'proj-techs', title: t.map((id) => TECH.find(id).name).join(' · ') }, ...shown));
    }
    if (!t.includes('arduino') && A.panels.current === 'sim') A.panels.show('python');
  }

  // Selector de tecnologías (proyecto nuevo y Configuración). Devuelve { el, get() }.
  function techPicker(initial, onChange) {
    const sel = new Set(initial);
    const el = A.el('div', { class: 'tech-grid' });
    const draw = () => {
      el.innerHTML = '';
      for (const t of TECH.TECHS) {
        const on = sel.has(t.id);
        el.append(A.el('button', { type: 'button', class: 'tech-chip' + (on ? ' on' : ''), style: `--tc:${t.color}`, title: t.desc, onclick: () => {
          if (on && sel.size === 1) return A.toast('Elige al menos una tecnología', 'err');
          on ? sel.delete(t.id) : sel.add(t.id);
          draw();
          onChange && onChange([...sel]);
        } }, A.el('span', { class: 'tc-badge' }, t.short), A.el('span', {}, t.name, A.el('small', {}, t.desc))));
      }
    };
    draw();
    return { el, get: () => TECH.TECHS.map((t) => t.id).filter((id) => sel.has(id)) };
  }

  async function setTechs(list) {
    const before = techs();
    A.app.config = await A.api('project:techs', list);
    await A.explorer.refresh();
    applyTechMode();
    A.$('#boardSelect').value = A.app.config.board || '';
    boardCard();
    if (hasTech('arduino') && !before.includes('arduino')) refreshPorts(false);
    statusbar();
    A.chat.renderCtx && A.chat.renderCtx();
    A.toast('Tecnologías del proyecto actualizadas', 'ok');
  }

  // ---------- ejecutar el archivo abierto (o el principal de cada tecnología) ----------
  const MAINS = [['python', () => A.app.config.pythonMain || 'python/main.py'], ['javascript', () => 'js/main.js'], ['java', () => 'java/Main.java'],
    ['sql', () => 'sql/consultas.sql'], ['web', () => 'web/index.html'], ['ejs', () => 'views/index.ejs'], ['php', () => 'php/index.php']];

  async function askRuntime(name) {
    const st = await A.api('runtimes:status');
    const info = st[name] || {};
    if (!(await A.confirm(`Falta ${info.label || name}`, `Para ejecutar este archivo hace falta ${info.label || name} (${info.size || ''}). ¿Lo descargo e instalo ahora? No pide permisos de administrador.`, 'Instalar'))) return false;
    A.panels.startPython();
    try { await A.api('runtimes:install', name); return true; } catch (e) { A.toast(e.message, 'err'); return false; }
  }

  async function runActive() {
    if (!A.app.config) return;
    let file = A.editor.liveContext().activeFile;
    let kind = file && TECH.runnerFor(file);
    if (!kind || (kind === 'preview' && !hasTech('web') && !hasTech('ejs') && !hasTech('php'))) {
      const main = MAINS.find(([id, fn]) => hasTech(id) && A.app.files.includes(fn()));
      file = main ? main[1]() : null;
      kind = file && TECH.runnerFor(file);
    }
    if (!file || !kind) return A.toast('Abre un archivo que se pueda ejecutar (.py, .js, .java, .php, .sql o una página web)', 'err');
    if (kind === 'python') return runPython(file);
    if (kind === 'preview') return openPreview(file);
    await A.editor.saveAll();
    A.panels.startPython();
    pyRunning = true;
    A.$('#btnStopPy').disabled = false;
    try {
      const r = await A.api('run:file', file);
      if (r.missing) {
        pythonStopped();
        if (await askRuntime(r.missing)) return runActive();
      }
    } catch (e) {
      A.toast(e.message, 'err');
      pythonStopped();
    }
  }

  // ---------- vista previa web ----------
  let previewState = null;
  async function openPreview(rel) {
    if (!A.app.config) return;
    await A.editor.saveAll();
    let r = await A.api('preview:url', rel || null).catch((e) => ({ error: e.message }));
    if (r.missing && (await askRuntime(r.missing))) r = await A.api('preview:url', rel || null);
    if (r.missing) return;
    if (r.error) return A.toast(r.error, 'err');
    previewState = r;
    A.$('#previewFrame').src = r.url;
    A.$('#previewUrl').textContent = r.url;
    A.$('#previewEmpty').classList.add('hidden');
    const pages = A.app.files.filter((p) => /\.(html?|ejs|php)$/i.test(p));
    const sel = A.$('#previewPage');
    sel.innerHTML = '';
    pages.forEach((p) => sel.append(A.el('option', { value: p }, p)));
    sel.value = r.rel;
    A.panels.show('preview');
  }
  const reloadPreview = A.debounce(() => { if (previewState) A.$('#previewFrame').src = previewState.url; }, 350);

  // "¿No aparece tu placa?" junto al selector de puertos.
  function renderPortHelp(show) {
    const b = A.$('#btnPortHelp');
    if (b) b.classList.toggle('attention', !!show);
  }

  // ---------- proyecto ----------
  async function openProject(res) {
    if (!res) return;
    A.app.config = res.config;
    A.app.root = res.root;
    applyTechMode();
    A.$('#welcome').classList.add('hidden');
    A.$('#projName').textContent = res.config.name || res.root.split(/[\\/]/).pop();
    A.$('#boardSelect').value = res.config.board;
    A.panels.setBaud(res.config.baud);
    A.panels.clearAll();
    A.editor.closeAll();
    await A.explorer.refresh();
    await A.chat.load();
    const sketch = res.config.sketch || 'sketch';
    const inoName = `${sketch === '.' ? '' : sketch + '/'}${(sketch === '.' ? res.root.split(/[\\/]/).pop() : sketch.split('/').pop())}.ino`;
    const ino = A.app.files.find((f) => f === inoName) || A.app.files.find((f) => f.endsWith('.ino'));
    const py = A.app.files.find((f) => f === res.config.pythonMain) || A.app.files.find((f) => f.endsWith('.py'));
    if (py) await A.editor.open(py);
    if (ino) await A.editor.open(ino);
    boardCard();
    refreshPorts(false);
    updatePyEnv();
    refreshGitDot();
    statusbar();
    A.sim.refreshParts();
  }

  const TPL_NAMES = { app: 'App Python', blink: 'Blink', ctk: 'CustomTkinter', web: 'Web Flask', empty: 'Vacío' };
  function ago(ms) {
    if (!ms) return '';
    const m = Math.round((Date.now() - ms) / 60000);
    if (m < 1) return 'ahora';
    if (m < 60) return `hace ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `hace ${h} h`;
    const d = Math.round(h / 24);
    if (d < 30) return d === 1 ? 'ayer' : `hace ${d} días`;
    return new Date(ms).toLocaleDateString();
  }

  let recent = [];
  async function showWelcome() {
    A.app.config = null;
    settings = await A.api('settings:get');
    try { recent = await A.api('project:recent'); } catch { recent = []; }
    welcomeTab(recent.some((r) => r.file) ? 'open' : 'new');
    renderRecent();
    updateNewPreview();
    renderEnv();
    A.$('#welcome').classList.remove('hidden');
  }

  function welcomeTab(t) {
    A.$$('.welcome-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.w === t));
    A.$$('.welcome-pane').forEach((p) => p.classList.toggle('hidden', p.dataset.pane !== t));
    if (t === 'new') setTimeout(() => { A.$('#newName').focus(); A.$('#newName').select(); }, 30);
    if (t === 'examples') renderExamples();
  }

  async function openFrom(p) {
    try { openProject(await A.api('project:open', p)); } catch (e) { A.toast(e.message, 'err'); }
  }

  function renderRecent() {
    const list = A.$('#recentList');
    const q = A.$('#recentFilter').value.trim().toLowerCase();
    list.innerHTML = '';
    const items = recent.filter((r) => !q || (r.name || r.root).toLowerCase().includes(q) || r.root.toLowerCase().includes(q));
    if (!items.length) {
      list.append(A.el('div', { class: 'recent-empty' }, q ? 'Ningún proyecto coincide.' : 'Aún no has trabajado en ningún proyecto. Crea uno nuevo o abre un archivo .arpy.'));
      return;
    }
    for (const r of items) {
      const missing = !r.exists;
      const name = r.name || r.root.split(/[\\/]/).pop();
      const forget = A.el('button', { class: 'r-x', title: 'Quitar de la lista (no borra archivos)', onclick: async (e) => {
        e.stopPropagation();
        await A.api('project:forget', r.root);
        recent = recent.filter((x) => x.root !== r.root);
        renderRecent();
      } });
      forget.innerHTML = A.icon('x');
      const meta = A.el('div', { class: 'r-meta' });
      if (missing) meta.append(A.el('span', { class: 'chip' }, 'No encontrado'));
      else {
        if (r.board) meta.append(A.el('span', { class: 'chip' }, findBoard(r.board).name));
        if (r.template && TPL_NAMES[r.template]) meta.append(A.el('span', {}, TPL_NAMES[r.template]));
        if (r.mtime) meta.append(A.el('span', {}, ago(r.mtime)));
      }
      list.append(A.el('div', {
        class: 'recent' + (missing ? ' missing' : ''),
        title: r.file || r.root,
        onclick: () => { if (!missing) openFrom(r.root); },
      },
      A.el('div', { class: 'r-ico' }, '.arpy'),
      A.el('div', { class: 'r-body' }, A.el('b', {}, name), meta, A.el('small', {}, r.root)),
      forget));
    }
  }

  // ---------- ejemplos ----------
  let examples = null;
  let exFilter = 'all';
  async function renderExamples() {
    if (!examples) { try { examples = await A.api('examples:list'); } catch (e) { examples = []; A.toast(e.message, 'err'); } }
    const filters = [['all', 'Todos'], ['app', 'Con app de escritorio'], ['basic', 'Solo Arduino']];
    const fhost = A.$('#exFilter');
    fhost.innerHTML = '';
    for (const [k, label] of filters) fhost.append(A.el('button', { class: exFilter === k ? 'active' : '', onclick: () => { exFilter = k; renderExamples(); } }, label));
    const list = A.$('#exampleList');
    list.innerHTML = '';
    for (const ex of examples.filter((e) => exFilter === 'all' || (exFilter === 'app' ? e.app : !e.app))) {
      const card = A.el('button', { class: 'ex-card' + (ex.app ? ' has-app' : ''), onclick: () => createExample(ex) });
      if (ex.preview) card.append(A.el('div', { class: 'ex-prev', style: `background:${ex.accent || 'var(--bg-4)'}` }, A.el('img', { src: ex.preview, alt: '' })));
      else card.append(A.el('div', { class: 'ex-prev plain', style: `--a:${ex.accent || 'var(--ino)'}` }, A.el('span', {}, Object.entries((ex.parts || []).reduce((o, p) => ((o[p] = (o[p] || 0) + 1), o), {})).map(([p, n]) => (n > 1 ? `${n} × ` : '') + A.i18n.t(p)).join('\n'))));
      card.append(A.el('div', { class: 'ex-body' },
        A.el('b', {}, ex.title),
        A.el('small', {}, ex.description),
        A.el('div', { class: 'ex-tags' }, ...(ex.tags || []).map((t) => A.el('span', {}, t)), ex.app ? A.el('span', { class: 'app' }, 'App Tkinter') : null, A.el('span', { class: 'lvl' }, ex.level || ''))));
      list.append(card);
    }
  }

  async function createExample(ex) {
    const name = await A.prompt('Crear proyecto desde ejemplo', ex.title, 'Nombre del proyecto');
    if (!name) return;
    try {
      openProject(await A.api('examples:create', { id: ex.id, name, parent: newFolder }));
      A.toast(`Ejemplo "${ex.title}" listo. Mira las conexiones en el botón Conexiones.`, 'ok');
    } catch (e) { A.toast(e.message, 'err'); }
  }

  let newFolder = '';
  function updateNewPreview() {
    const name = A.$('#newName').value.trim();
    const safe = name.replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-') || 'proyecto';
    A.$('#newFolder').value = newFolder;
    const sep = newFolder.includes('/') && !newFolder.includes('\\') ? '/' : '\\';
    const p = A.$('#newPreview');
    p.innerHTML = '';
    p.append('Se creará: ', A.el('b', {}, `${newFolder}${sep}${safe}${sep}${safe}.arpy`));
  }

  function renderEnv() {
    const host = A.$('#envStatus');
    host.innerHTML = '';
    const row = (ok, text, action) => {
      const d = A.el('div', { class: ok ? 'ok' : 'bad' }, (ok ? '✔ ' : '⚠ ') + text);
      if (action) d.append(' ', A.el('a', { style: 'color:var(--ai-2);cursor:pointer;text-decoration:underline', onclick: action[1] }, action[0]));
      host.append(d);
    };
    row(env.arduino.installed, env.arduino.installed ? 'arduino-cli listo' : 'arduino-cli no instalado', env.arduino.installed ? null : ['Instalar ahora', installCli]);
    row(env.python.installed, env.python.installed ? (env.python.version || 'Python listo') : 'Python 3 no encontrado', env.python.installed ? null : ['Instalar ahora', installPython]);
    const aiOk = !!(settings.geminiApiKey || settings.builtinKey);
    row(aiOk, aiOk ? 'IA lista' : 'Falta API key de Gemini', aiOk ? null : ['Configurar', openSettings]);
  }

  async function installPython() {
    A.toast('Instalando Python… puede tardar 1–2 minutos');
    A.panels.startBuild('Instalando Python 3');
    try {
      await A.api('python:install');
      env = await A.api('status');
      A.panels.finishBuild(true);
      A.toast('Python instalado', 'ok');
      if (A.app.root) updatePyEnv && updatePyEnv();
    } catch (e) { A.panels.finishBuild(false); A.toast(e.message, 'err'); }
    renderEnv();
    statusbar();
    if (A.$('#modal:not(.hidden)')) openSettings();
  }

  async function installCli() {
    A.toast('Descargando arduino-cli…');
    A.panels.startBuild('Instalando arduino-cli');
    try {
      await A.api('arduino:install');
      env = await A.api('status');
      A.toast('arduino-cli instalado', 'ok');
    } catch (e) { A.toast(e.message, 'err'); }
    renderEnv();
    statusbar();
    if (A.$('#modal:not(.hidden)')) openSettings();
  }

  // ---------- acciones principales ----------
  function busy(btn, on) { A.$(btn).classList.toggle('busy', on); A.$(btn).disabled = on; }

  async function verify() {
    if (!A.app.config || A.app.config.arduino === false) return;
    await A.editor.saveAll();
    busy('#btnVerify', true);
    A.panels.startBuild(`⚙ Verificando ${findBoard(A.app.config.board).name}`);
    try {
      const r = await A.api('arduino:compile');
      const probs = A.panels.finishBuild(r.code === 0);
      A.panels.line('build', r.code === 0 ? '✔ Compilación correcta' : '✖ La compilación falló', r.code === 0 ? 'ok' : 'err');
      if (r.code === 0) A.status('Compilado ✔'); else if (probs.length) A.toast('Errores de compilación — usa "Corregir con IA"', 'err');
      return r.code === 0;
    } catch (e) { A.toast(e.message, 'err'); return false; } finally { busy('#btnVerify', false); }
  }

  async function upload() {
    if (!A.app.config || A.app.config.arduino === false) return false;
    if (!A.app.config.port) { A.toast('Conecta la placa y elige el puerto', 'err'); return false; }
    await A.editor.saveAll();
    busy('#btnUpload', true);
    const wasOpen = await A.panels.serialDisconnect(true);
    A.panels.startBuild(`⬆ Subiendo a ${findBoard(A.app.config.board).name} en ${A.app.config.port}`);
    try {
      const r = await A.api('arduino:upload');
      A.panels.finishBuild(r.code === 0);
      A.panels.line('build', r.code === 0 ? '✔ Sketch subido correctamente' : '✖ La subida falló', r.code === 0 ? 'ok' : 'err');
      if (r.code === 0) A.toast('Sketch subido ✔', 'ok');
      if (r.code === 0 && wasOpen) setTimeout(() => A.panels.serialConnect(), 1500);
      return r.code === 0;
    } catch (e) { A.toast(e.message, 'err'); return false; } finally { busy('#btnUpload', false); }
  }

  // opts: { debug: true } | { remote: true }
  async function runPython(file, opts = {}) {
    if (!A.app.config) return;
    if (!opts.remote && !env.python.installed) {
      env = await A.api('status');
      if (!env.python.installed) {
        if (await A.confirm('Falta Python', 'Este equipo no tiene Python 3. ¿Lo instalo ahora automáticamente? (unos 25 MB, 1–2 minutos, no pide permisos de administrador)', 'Instalar Python')) await installPython();
        if (!env.python.installed) return;
      }
    }
    await A.editor.saveAll();
    if (!opts.remote && await A.panels.serialDisconnect(true)) A.toast('Monitor serie cerrado para que Python use el puerto');
    A.panels.startPython();
    const req = { file: typeof file === 'string' ? file : null, remote: !!opts.remote };
    if (opts.debug) {
      const bps = A.editor.breakpoints().filter((b) => b.file.endsWith('.py'));
      req.debug = { breakpoints: bps };
      if (!bps.length) A.toast('Sin puntos de parada: se detendrá al inicio. Pon puntos haciendo clic en el margen izquierdo del editor.');
    }
    pyRunning = true;
    A.$('#btnStopPy').disabled = false;
    try {
      const ok = await A.api('python:run', req);
      if (!ok) pythonStopped();
    } catch (e) {
      A.toast(e.message, 'err');
      pythonStopped();
    }
    updatePyEnv();
  }

  async function updatePyEnv() {
    try {
      const st = await A.api('python:status');
      const l = A.$('#pyEnvLabel');
      l.textContent = st.installed ? (st.venv ? '.venv del proyecto' : 'Python del sistema') : 'Sin Python';
      l.className = 'env-pill' + (st.venv ? ' venv' : '');
      l.title = st.venv ? 'Los paquetes se instalan en .venv dentro del proyecto' : 'Se creará .venv automáticamente al ejecutar';
    } catch {}
  }

  async function buildExe() {
    if (!A.app.config) return;
    await A.editor.saveAll();
    let src = '';
    try { src = await A.api('fs:read', A.app.config.pythonMain || 'python/main.py'); } catch {}
    const gui = /import\s+(tkinter|customtkinter)|from\s+(tkinter|customtkinter|PySide\d|PyQt\d)/.test(src);
    if (!(await A.confirm('Crear .exe', `Se empaquetará ${A.app.config.pythonMain || 'python/main.py'} en un solo ejecutable dentro de la carpeta dist/ del proyecto${gui ? ' (app con ventana, sin consola)' : ' (con consola)'}. Puede tardar 1-2 minutos.`, 'Crear'))) return;
    A.panels.startPython();
    A.panels.line('python', '🔨 Empaquetando…', 'info');
    const r = await A.api('python:build-exe', gui);
    A.panels.line('python', r.code === 0 ? `✔ Listo: ${r.out}` : '✖ Falló el empaquetado (revisa la salida)', r.code === 0 ? 'ok' : 'err');
    A.$('#pyDot').classList.remove('on');
    if (r.code === 0) A.toast('.exe creado en dist/', 'ok');
  }

  async function runRemote() {
    if (!A.app.config) return;
    let host = A.app.config.remoteHost;
    if (!host) {
      host = await A.prompt('Ejecutar en la placa (SSH)', 'arduino@192.168.1.50', 'Usuario@IP de tu Arduino UNO Q o Raspberry Pi. Requiere acceso SSH por clave (sin contraseña): ssh-keygen y ssh-copy-id.');
      if (!host) return;
      A.app.config = await A.api('project:config', { remoteHost: host });
    }
    A.menu(innerWidth / 2 - 100, innerHeight / 2, [
      { label: `▶ Ejecutar en ${host}`, action: () => runPython(null, { remote: true }) },
      { label: 'Cambiar equipo remoto…', action: async () => { A.app.config = await A.api('project:config', { remoteHost: '' }); runRemote(); } },
    ]);
  }

  // ---------- gestor de placas ----------
  async function openBoards() {
    const list = A.el('div', { class: 'list' }, A.el('div', { class: 'muted' }, 'Cargando…'));
    const filter = A.el('input', { placeholder: 'Filtrar placas…', class: 'sm-input', style: 'width:100%;height:34px' });
    A.modal.open('Gestor de placas', A.el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, filter, list));
    if (!env.arduino.installed) { list.innerHTML = '<div class="muted">Instala arduino-cli primero (Configuración).</div>'; return; }
    let cores = [];
    const render = () => {
      list.innerHTML = '';
      const q = filter.value.toLowerCase();
      for (const c of cores.filter((x) => !q || x.name.toLowerCase().includes(q) || x.id.includes(q))) {
        const btns = A.el('div', { style: 'display:flex;gap:6px' });
        const run = (label, cls, fn) => {
          const b = A.el('button', { class: `btn sm ${cls}` }, label);
          b.onclick = async () => { b.classList.add('busy'); b.disabled = true; A.panels.show('output'); const r = await fn(); A.toast(r.code === 0 ? `${c.name}: listo` : `Error con ${c.id}`, r.code === 0 ? 'ok' : 'err'); cores = await A.api('arduino:cores'); render(); };
          btns.append(b);
        };
        const upd = c.installed && c.latest && c.installed !== c.latest;
        if (!c.installed) run('Instalar', 'ino', () => A.api('arduino:core-install', c.id));
        if (upd) run(`Actualizar a ${c.latest}`, 'ino', () => A.api('arduino:core-install', c.id));
        if (c.installed) run('Quitar', 'ghost', () => A.api('arduino:core-uninstall', c.id));
        const tag = c.installed ? `<span class="tag ${upd ? 'up' : 'ok'}">${upd ? 'actualización disponible' : 'instalada ' + c.installed}</span>` : `<span class="tag">${c.latest}</span>`;
        list.append(A.el('div', { class: 'row-item' }, A.el('div', { html: `<b>${A.esc(c.name)}${tag}</b><small>${A.esc(c.id)}</small>` }), btns));
      }
    };
    cores = await A.api('arduino:cores');
    render();
    filter.addEventListener('input', render);
  }

  // ---------- historial de versiones (git) ----------
  async function saveVersion() {
    if (!A.app.config) return;
    if (!env.git) return A.toast('Instala Git (git-scm.com) para guardar versiones', 'err');
    const msg = await A.prompt('Guardar versión', '', 'Describe brevemente qué cambiaste (opcional):');
    if (msg === null) return;
    await A.editor.saveAll();
    try {
      const r = await A.api('git:commit', msg || `Versión del ${new Date().toLocaleString()}`);
      A.toast(r.committed ? 'Versión guardada ✔' : r.message, r.committed ? 'ok' : '');
    } catch (e) { A.toast(e.message, 'err'); }
    refreshGitDot();
  }

  async function refreshGitDot() {
    if (!A.app.config || !env.git) return;
    const n = await A.api('git:pending').catch(() => -1);
    const d = A.$('#gitDot');
    d.classList.toggle('on', n > 0);
    d.style.background = n > 0 ? 'var(--warn)' : '';
    d.style.boxShadow = n > 0 ? '0 0 6px var(--warn)' : '';
    A.$('#btnSaveVersion').title = n > 0 ? `${n} archivo(s) con cambios sin guardar como versión` : 'Guardar una versión del proyecto (Ctrl+Shift+S)';
  }

  async function openHistory() {
    if (!A.app.config) return;
    if (!env.git) return A.toast('Instala Git (git-scm.com) para usar el historial', 'err');
    const list = A.el('div', { class: 'list' });
    A.modal.open('Historial de versiones', A.el('div', { style: 'display:flex;flex-direction:column;gap:10px' },
      A.el('div', { class: 'muted' }, 'Cada versión es una copia completa del proyecto. Restaurar guarda primero el estado actual, así nunca pierdes nada.'), list));
    const log = await A.api('git:log');
    if (!log.length) { list.append(A.el('div', { class: 'muted' }, 'Aún no hay versiones. Usa "Guardar versión".')); return; }
    for (const c of log) {
      const files = A.el('div', { class: 'muted', style: 'font-size:11.5px' });
      const btnFiles = A.el('button', { class: 'btn sm ghost' }, 'Ver cambios');
      btnFiles.onclick = async () => {
        const fl = await A.api('git:files', c.hash);
        files.innerHTML = '';
        fl.forEach((f) => files.append(A.el('a', { style: 'display:block;cursor:pointer;color:var(--ai-2)', onclick: async () => {
          const old = (await A.api('git:show', c.hash + '~1', f)) || '';
          const neu = (await A.api('git:show', c.hash, f)) || '';
          A.editor.showDiff(`${f} @ ${c.short}`, old, neu, null);
        } }, f)));
      };
      const btnRestore = A.el('button', { class: 'btn sm ino' }, 'Restaurar');
      btnRestore.onclick = async () => {
        if (!(await A.confirm('Restaurar versión', `¿Volver el proyecto a "${c.subject}" (${c.date})? El estado actual se guarda antes como versión.`, 'Restaurar'))) return;
        try { await A.api('git:restore', c.hash); await A.editor.syncFromDisk(); A.explorer.refresh(); A.toast('Versión restaurada', 'ok'); } catch (e) { A.toast(e.message, 'err'); }
        refreshGitDot();
      };
      list.append(A.el('div', { class: 'row-item', style: 'flex-wrap:wrap' },
        A.el('div', { html: `<b>${A.esc(c.subject)}</b><small>${A.esc(c.date)} · ${A.esc(c.short)}${c.stat ? ' · ' + A.esc(c.stat) : ''}</small>` }),
        btnFiles, btnRestore, A.el('div', { style: 'flex-basis:100%' }, files)));
    }
  }

  // ---------- tema ----------
  // ---------- apariencia: modo (oscuro/claro/sistema) + tema de la app + tema del editor ----------
  const THM = window.ARPY_THEMES;
  const sysDark = matchMedia('(prefers-color-scheme: dark)');
  const modeNow = () => ((settings.theme || 'dark') === 'system' ? (sysDark.matches ? 'dark' : 'light') : settings.theme || 'dark');
  function applyTheme(mode) {
    if (mode) settings.theme = mode;
    const m = modeNow();
    const appP = THM.palette(settings.appTheme || 'arpy', m);
    const edId = settings.editorTheme && settings.editorTheme !== 'same' ? settings.editorTheme : settings.appTheme || 'arpy';
    const edP = THM.palette(edId, m);
    const root = document.documentElement;
    root.dataset.theme = m;
    const vars = { ...THM.cssVars(appP), ...THM.editorVars(edP) };
    for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
    A.editor.setTheme(m, edP);
    try { localStorage.setItem('arpy.theme', m); localStorage.setItem('arpy.vars', JSON.stringify(vars)); } catch {}
    const b = A.$('#btnTheme');
    b.innerHTML = A.icon(m === 'light' ? 'moon' : 'sun');
  }
  sysDark.addEventListener('change', () => { if (settings.theme === 'system') applyTheme(); });

  // Tarjetas de temas con una miniatura de cómo se ven.
  function themeGrid(current, onPick, withSame) {
    const box = A.el('div', { class: 'theme-grid' });
    const draw = (sel) => {
      box.innerHTML = '';
      if (withSame) {
        box.append(A.el('button', { type: 'button', class: 'theme-card same' + (sel === 'same' ? ' on' : ''), onclick: () => { draw('same'); onPick('same'); } },
          A.el('span', { class: 'tp' }, 'Aa'), A.el('b', {}, 'Igual que la app')));
      }
      for (const t of THM.THEMES) {
        const p = THM.palette(t.id, modeNow());
        const tp = A.el('span', { class: 'tp', style: `background:${p.editor.bg}` },
          A.el('span', { class: 'side', style: `background:${p.bg2}` }),
          A.el('span', { class: 'ln', style: `top:12px;width:30%;background:${p.syntax.keyword}` }),
          A.el('span', { class: 'ln', style: `top:22px;left:44%;width:38%;background:${p.syntax.string}` }),
          A.el('span', { class: 'ln', style: `top:32px;width:22%;background:${p.syntax.func}` }),
          A.el('span', { class: 'ln', style: `top:42px;left:44%;width:26%;background:${p.syntax.comment}` }),
          A.el('span', { class: 'dot', style: `background:${p.accent};box-shadow:0 0 0 3px ${p.bg2}` }));
        box.append(A.el('button', { type: 'button', class: 'theme-card' + (sel === t.id ? ' on' : ''), title: t.name, onclick: () => { draw(t.id); onPick(t.id); } }, tp, A.el('b', {}, t.name)));
      }
    };
    draw(current);
    return box;
  }

  function appearanceSection() {
    const save = (patch) => { Object.assign(settings, patch); applyTheme(); A.api('settings:set', patch).catch(() => {}); };
    const mode = A.el('div', { class: 'theme-mode' });
    const grids = A.el('div', { style: 'display:flex;flex-direction:column;gap:14px' });
    const drawGrids = () => {
      grids.innerHTML = '';
      grids.append(
        A.el('div', { class: 'field' }, A.el('label', {}, 'Tema de la app'), themeGrid(settings.appTheme || 'arpy', (id) => save({ appTheme: id }))),
        A.el('div', { class: 'field' }, A.el('label', {}, 'Tema del editor y la terminal'), themeGrid(settings.editorTheme || 'same', (id) => save({ editorTheme: id }), true)));
    };
    const drawMode = () => {
      mode.innerHTML = '';
      for (const [k, label] of [['dark', 'Oscuro'], ['light', 'Claro'], ['system', 'Como Windows']]) {
        mode.append(A.el('button', { type: 'button', class: (settings.theme || 'dark') === k ? 'on' : '', onclick: () => { save({ theme: k }); drawMode(); drawGrids(); } }, label));
      }
    };
    drawMode();
    drawGrids();
    return A.el('div', { class: 'field appearance' }, A.el('label', {}, 'Apariencia'), mode, A.el('small', {}, 'Cada tema tiene versión oscura y clara. Los cambios se ven al instante.'), grids);
  }

  // ---------- abrir archivo rápido (Ctrl+P) ----------
  function quickOpen() {
    if (!A.app.config) return;
    const input = A.el('input', { placeholder: 'Nombre de archivo…', class: 'sm-input', style: 'width:100%;height:36px' });
    const list = A.el('div', { class: 'quick-list' });
    let sel = 0;
    let items = [];
    const score = (f, q) => {
      if (!q) return 1;
      let i = 0;
      const s = f.toLowerCase();
      for (const ch of q.toLowerCase()) { i = s.indexOf(ch, i); if (i < 0) return 0; i++; }
      return s.split('/').pop().includes(q.toLowerCase()) ? 3 : 2;
    };
    const render = () => {
      items = A.app.files.map((f) => [f, score(f, input.value)]).filter(([, s]) => s).sort((a, b) => b[1] - a[1]).slice(0, 50).map(([f]) => f);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.innerHTML = '';
      items.forEach((f, i) => {
        const it = A.el('div', { class: 'quick-item' + (i === sel ? ' sel' : ''), onclick: () => { A.modal.close(); A.editor.open(f); } });
        it.innerHTML = `${A.fileIcon(f)}<span>${A.esc(f.split('/').pop())}</span><small>${A.esc(f)}</small>`;
        list.append(it);
      });
    };
    input.addEventListener('input', () => { sel = 0; render(); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); render(); e.preventDefault(); }
      if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
      if (e.key === 'Enter' && items[sel]) { A.modal.close(); A.editor.open(items[sel]); }
    });
    A.modal.open('Abrir archivo', A.el('div', { style: 'display:flex;flex-direction:column;gap:8px' }, input, list));
    render();
    setTimeout(() => input.focus(), 20);
  }

  function pythonStopped() { pyRunning = false; A.$('#btnStopPy').disabled = true; }

  async function runAll() {
    if (A.app.config && !hasTech('arduino')) return runActive();
    if (await upload()) {
      A.panels.line('build', '⏳ Esperando a que la placa reinicie…', 'info');
      setTimeout(() => runPython(), 1800);
    }
  }

  // ---------- proveedores de IA (Gemini, Claude, OpenAI, DeepSeek…) ----------
  const KEY_LABEL = { ok: 'Verificada', invalid: 'Key inválida', expired: 'Expirada', suspended: 'Suspendida', 'no-credit': 'Sin saldo',
    'rate-limited': 'Válida (límite alcanzado)', offline: 'Sin conexión', error: 'No se pudo verificar', missing: 'Sin key', checking: 'Verificando…' };
  const KEY_BAD = new Set(['invalid', 'expired', 'suspended', 'no-credit']);
  let providerList = null;
  async function getProviders() { if (!providerList) providerList = await A.api('ai:providers'); return providerList; }

  function keyPill(st) {
    const cls = !st ? 'none' : st === 'ok' || st === 'rate-limited' ? 'ok' : KEY_BAD.has(st) ? 'bad' : st === 'checking' ? 'wait' : 'none';
    return A.el('span', { class: 'key-pill ' + cls }, KEY_LABEL[st] || 'Sin key');
  }

  function aiSection() {
    const list = A.el('div', { class: 'ai-providers' }, A.el('div', { class: 'muted' }, 'Cargando…'));
    (async () => {
      const provs = await getProviders();
      list.innerHTML = '';
      for (const p of provs) {
        const isGemini = p.id === 'gemini';
        const value = isGemini ? settings.geminiApiKey || '' : (settings.aiKeys || {})[p.id] || '';
        let st = (settings.aiKeyStatus || {})[p.id];
        st = st ? st.status : isGemini && settings.builtinKey ? null : value ? null : 'missing';
        const pillBox = A.el('span', {}, keyPill(st));
        const radio = A.el('input', { type: 'radio', name: 'aiProv', value: p.id });
        radio.checked = (settings.aiProvider || 'gemini') === p.id;
        radio.addEventListener('change', async () => {
          settings = await A.api('settings:set', { aiProvider: p.id });
          await refreshModels();
          A.toast(`El chat ahora usa ${p.name}`, 'ok');
        });
        const input = A.el('input', { type: 'password', value, placeholder: isGemini && settings.builtinKey ? 'Usando la key integrada (déjalo vacío)' : p.keyHint || 'API key' });
        const check = async () => {
          const k = input.value.trim();
          pillBox.innerHTML = '';
          pillBox.append(keyPill('checking'));
          const r = await A.api('ai:verify', p.id, k || null).catch(() => ({ status: 'error' }));
          pillBox.innerHTML = '';
          pillBox.append(keyPill(r.status));
          pillBox.title = r.message || '';
          settings = await A.api('settings:get');
          if ((settings.aiProvider || 'gemini') === p.id) refreshModels();
        };
        input.addEventListener('change', async () => {
          const k = input.value.trim();
          settings = await A.api('settings:set', isGemini ? { geminiApiKey: k } : { aiKeys: { ...(settings.aiKeys || {}), [p.id]: k } });
          if (k || isGemini) check(); else { pillBox.innerHTML = ''; pillBox.append(keyPill('missing')); }
        });
        const show = A.el('button', { type: 'button', class: 'btn sm ghost', onclick: () => { input.type = input.type === 'password' ? 'text' : 'password'; } }, 'Ver');
        const verifyBtn = A.el('button', { type: 'button', class: 'btn sm ghost', onclick: check }, 'Comprobar');
        const get = A.el('a', { class: 'key-link', onclick: () => A.api('open-external', p.keyUrl) }, 'Obtener key');
        list.append(A.el('div', { class: 'ai-prov' + (radio.checked ? ' on' : '') },
          A.el('label', { class: 'ap-head' }, radio, A.el('b', {}, p.name), p.vision ? null : A.el('small', { class: 'muted' }, 'sin imágenes'), A.el('span', { class: 'spacer' }), pillBox),
          A.el('div', { class: 'row' }, input, show, verifyBtn), get));
        radio.addEventListener('change', () => list.querySelectorAll('.ai-prov').forEach((r) => r.classList.toggle('on', r.contains(radio))));
      }
    })();
    return A.el('div', { class: 'field' }, A.el('label', {}, 'Inteligencia artificial'), list,
      A.el('small', {}, 'Elige qué IA usa el chat. Las keys se guardan solo en este equipo y se verifican cada vez que abres la app (para avisarte si expiraron, se suspendieron o no tienen saldo).'));
  }

  // Selector de modelos del chat según el proveedor activo.
  async function refreshModels() {
    const pid = settings.aiProvider || 'gemini';
    const provs = await getProviders();
    const p = provs.find((x) => x.id === pid) || provs[0];
    const sel = A.$('#modelSelect');
    let models = [];
    try { models = await A.api('ai:models'); } catch {}
    const current = pid === 'gemini' ? settings.model : (settings.aiModels || {})[pid] || p.defaultModel || models[0] || '';
    const prefer = pid === 'gemini' ? ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest'] : [];
    const list = [...new Set([current, ...prefer, ...models].filter(Boolean))];
    sel.innerHTML = '';
    list.forEach((m) => sel.append(A.el('option', { value: m }, m)));
    sel.value = current;
    sel.title = `${p.name} · ${current}`;
  }

  // Al abrir la app: verificar las keys y avisar si la del proveedor activo falla.
  async function verifyKeysOnStart() {
    let res = {};
    try { res = await A.api('ai:verify-all'); } catch { return; }
    settings = await A.api('settings:get');
    const pid = settings.aiProvider || 'gemini';
    const provs = await getProviders();
    const name = (provs.find((x) => x.id === pid) || {}).name || pid;
    const warn = A.$('#aiKeyWarn');
    const r = res[pid];
    const bad = r && KEY_BAD.has(r.status);
    if (warn) { warn.classList.toggle('hidden', !bad); warn.title = bad ? `${name}: ${KEY_LABEL[r.status]}` : ''; }
    if (bad) A.toast(`La API key de ${name}: ${KEY_LABEL[r.status]}. El chat no funcionará hasta que la cambies.`, 'err', { action: { label: 'Configurar', fn: openSettings }, ms: 15000 });
    const others = Object.entries(res).filter(([id, v]) => id !== pid && KEY_BAD.has(v.status));
    if (others.length) console.warn('Keys con problemas:', others.map(([id, v]) => `${id}: ${v.status}`).join(', '));
  }

  // ---------- configuración ----------
  async function openSettings() {
    settings = await A.api('settings:get');
    env = await A.api('status');
    let models = [];
    try { models = await A.api('ai:models'); } catch {}
    const key = A.el('input', { type: 'password', value: settings.geminiApiKey || '', placeholder: settings.builtinKey ? 'Usando la key integrada (déjalo vacío)' : 'AIza… / AQ.…' });
    const model = A.el('select', {});
    const allModels = [...new Set([settings.model, ...models].filter(Boolean))];
    allModels.forEach((m) => model.append(A.el('option', { value: m }, m)));
    model.value = settings.model;
    const py = A.el('input', { value: settings.pythonPath || '', placeholder: 'Automático (py / python)' });
    const cli = A.el('input', { value: settings.arduinoCliPath || '', placeholder: 'Automático' });
    const font = A.el('input', { type: 'number', value: settings.fontSize || 14, min: 10, max: 28 });
    const auto = A.el('input', { type: 'checkbox' });
    auto.checked = !!settings.autoApply;
    const inline = A.el('input', { type: 'checkbox' });
    inline.checked = !!settings.aiComplete;
    const perf = A.el('select', {},
      A.el('option', { value: 'auto' }, `Automático (este equipo: ${settings.ramGB} GB RAM, ${settings.cores} núcleos → ${settings.lowEnd ? 'ligero' : 'completo'})`),
      A.el('option', { value: 'lite' }, 'Ligero: menos animaciones y sin minimapa (equipos con 8 GB o menos)'),
      A.el('option', { value: 'full' }, 'Completo: todos los efectos'));
    perf.value = settings.perfMode || 'auto';
    const projPicker = A.app.config ? techPicker(techs()) : null;
    const lang = A.el('select', {}, A.el('option', { value: 'en' }, 'English'), A.el('option', { value: 'es' }, 'Español'));
    lang.value = settings.lang || 'en';
    const introChk = A.el('input', { type: 'checkbox' });
    introChk.checked = settings.intro !== false;

    const field = (label, input, hint) => A.el('div', { class: 'field' }, A.el('label', {}, label), input, hint ? A.el('small', {}, hint) : null);
    const showKey = A.el('button', { class: 'btn sm ghost', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } }, 'Ver');
    const body = A.el('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      aiSection(),

      A.el('div', { class: 'field' }, A.el('label', {}, 'arduino-cli'),
        A.el('div', { class: 'row' }, cli, A.el('button', { class: 'btn sm ino', onclick: installCli }, env.arduino.installed ? 'Actualizar' : 'Instalar')),
        A.el('small', {}, env.arduino.installed ? `✔ ${env.arduino.version}` : '⚠ No instalado. Pulsa "Instalar": se descarga la versión oficial automáticamente.')),
      field('Intérprete de Python', py, env.python.installed ? `✔ Detectado: ${env.python.cmd} — ${env.python.version}` : '⚠ No se encontró Python 3'),
      appearanceSection(),
      field('Tamaño de letra del editor', font),
      field('Rendimiento', perf, 'El modo ligero dibuja sin GPU, quita el minimapa y reduce animaciones: usa casi la mitad de RAM. Ideal para laptops con 8 GB. Reinicia la app para aplicarlo del todo.'),
      A.el('label', { class: 'chk' }, introChk, 'Mostrar la animación de apertura'),
      field('Idioma / Language', lang, 'La ventana se recarga para aplicar el idioma.'),
      projPicker ? A.el('div', { class: 'field' }, A.el('label', {}, `Tecnologías de este proyecto (${A.app.config.name})`), projPicker.el, A.el('small', {}, 'Al activar una, se crean sus archivos iniciales. Al desactivarla no se borra nada.')) : null,
      A.el('div', { class: 'row', style: 'gap:8px;flex-wrap:wrap' },
        A.el('button', { class: 'btn ghost sm', onclick: () => { A.modal.close(); A.wizard.open(); } }, 'Asistente de configuración'),
        A.el('button', { class: 'btn ghost sm', onclick: () => A.features.checkUpdates(true) }, 'Buscar actualizaciones'),
        A.el('span', { class: 'muted', style: 'font-size:12px;align-self:center' }, `Versión ${settings.appVersion || ''}`)),
      A.el('label', { class: 'chk' }, auto, 'Aplicar automáticamente los cambios de la IA (sin pulsar "Aplicar")'),
      A.el('label', { class: 'chk' }, inline, 'Autocompletado con IA mientras escribes (texto gris, Tab para aceptar). Usa cuota de Gemini.'),
      A.el('div', { class: 'modal-foot' }, A.el('button', {
        class: 'btn ino',
        onclick: async () => {
          const prevLang = settings.lang || 'en';
          if (projPicker && projPicker.get().join() !== techs().join()) await setTechs(projPicker.get());
          settings = await A.api('settings:set', {
            pythonPath: py.value.trim(),
            arduinoCliPath: cli.value.trim(), fontSize: +font.value || 14, autoApply: auto.checked, aiComplete: inline.checked,
            perfMode: perf.value, intro: introChk.checked, lang: lang.value,
          });
          applySettings();
          env = await A.api('status');
          statusbar();
          renderEnv();
          A.modal.close();
          if ((settings.lang || 'en') !== prevLang) { A.i18n.reload(); return; }
          A.toast('Configuración guardada', 'ok');
        },
      }, 'Guardar')));
    A.modal.open('Configuración', body);
  }

  function isLite() {
    return settings.perfMode === 'lite' || (settings.perfMode !== 'full' && !!settings.lowEnd);
  }
  function applyPerf() {
    const lite = isLite();
    if (lite) document.documentElement.dataset.perf = 'lite';
    else delete document.documentElement.dataset.perf;
    A.editor.setLite(lite);
    try { localStorage.setItem('arpy.perf', lite ? 'lite' : 'full'); } catch {}
    try { localStorage.setItem('arpy.intro', settings.intro === false ? '0' : '1'); } catch {}
    try { localStorage.setItem('arpy.lang', settings.lang || 'en'); } catch {}
  }

  async function applySettings() {
    A.editor.setFontSize(settings.fontSize || 14);
    A.$('#autoApply').checked = !!settings.autoApply;
    A.$('#agentMode').checked = !!settings.agentMode;
    A.editor.setAiComplete(!!settings.aiComplete);
    applyTheme(settings.theme || 'dark');
    applyPerf();
    await refreshModels();
  }

  // ---------- librerías ----------
  async function openLibs() {
    const q = A.el('input', { placeholder: 'Buscar librería (ej. DHT, Servo, Adafruit NeoPixel, ArduinoBLE)…', style: 'height:36px;background:var(--bg);border:1px solid var(--line-2);border-radius:8px;padding:0 10px;outline:none;width:100%' });
    const results = A.el('div', { style: 'display:flex;flex-direction:column;gap:6px' });
    const installed = A.el('div', { class: 'muted', style: 'font-size:12px' }, 'Cargando instaladas…');
    const body = A.el('div', { style: 'display:flex;flex-direction:column;gap:10px' }, q, installed, results);
    A.modal.open('Librerías de Arduino', body);
    if (!env.arduino.installed) { installed.textContent = 'Instala arduino-cli primero (Configuración).'; return; }
    A.api('arduino:lib-list').then((l) => { installed.textContent = l.length ? `Instaladas: ${l.join(', ')}` : 'Ninguna librería instalada todavía.'; });
    const search = A.debounce(async () => {
      if (q.value.trim().length < 2) return;
      results.innerHTML = '<div class="muted">Buscando…</div>';
      const libs = await A.api('arduino:lib-search', q.value.trim());
      results.innerHTML = '';
      if (!libs.length) results.append(A.el('div', { class: 'muted' }, 'Sin resultados.'));
      for (const l of libs) {
        const b = A.el('button', { class: 'btn sm ino' }, 'Instalar');
        b.onclick = async () => {
          b.classList.add('busy'); b.disabled = true;
          const r = await A.api('arduino:lib-install', l.name);
          b.classList.remove('busy');
          b.textContent = r.code === 0 ? 'Instalada ✔' : 'Error';
          A.toast(r.code === 0 ? `${l.name} instalada` : `Error instalando ${l.name}`, r.code === 0 ? 'ok' : 'err');
        };
        results.append(A.el('div', { class: 'lib-item' }, A.el('div', {}, A.el('b', {}, `${l.name} `, A.el('span', { class: 'muted' }, l.version)), A.el('small', {}, l.sentence)), b));
      }
    }, 400);
    q.addEventListener('input', search);
    setTimeout(() => q.focus(), 30);
  }

  // ---------- divisores redimensionables ----------
  function splitters() {
    const root = document.documentElement;
    for (const k of ['sidebar-w', 'chat-w', 'bottom-h']) {
      try { const v = localStorage.getItem('arpy-' + k); if (v) root.style.setProperty('--' + k, v); } catch {}
    }
    A.$$('.gutter').forEach((g) => {
      g.addEventListener('mousedown', (e) => {
        e.preventDefault();
        g.classList.add('drag');
        const target = g.dataset.target;
        const varName = target === 'sidebar' ? 'sidebar-w' : target === 'chat' ? 'chat-w' : 'bottom-h';
        const start = target === 'bottom' ? e.clientY : e.clientX;
        const el = A.$('#' + target);
        const size = target === 'bottom' ? el.offsetHeight : el.offsetWidth;
        const move = (ev) => {
          const d = (target === 'bottom' ? ev.clientY : ev.clientX) - start;
          const n = target === 'sidebar' ? size + d : size - d;
          const max = target === 'bottom' ? innerHeight - 200 : innerWidth * 0.6;
          root.style.setProperty('--' + varName, Math.max(target === 'bottom' ? 90 : 160, Math.min(max, n)) + 'px');
        };
        const up = () => {
          g.classList.remove('drag');
          removeEventListener('mousemove', move);
          removeEventListener('mouseup', up);
          try { localStorage.setItem('arpy-' + varName, root.style.getPropertyValue('--' + varName)); } catch {}
        };
        addEventListener('mousemove', move);
        addEventListener('mouseup', up);
      });
    });
  }

  // ---------- inicio ----------
  async function init() {
    A.hydrateIcons();
    fillBoards(A.$('#boardSelect'));
    fillBoards(A.$('#newBoard'));
    A.$('#newBoard').value = 'arduino:renesas_uno:unor4wifi';
    splitters();

    A.$('#boardSelect').addEventListener('change', (e) => setBoard(e.target.value));
    A.$('#portSelect').addEventListener('change', async (e) => { A.app.config = await A.api('project:config', { port: e.target.value }); statusbar(); });
    A.$('#btnRefreshPorts').addEventListener('click', () => refreshPorts(true));
    A.$('#btnVerify').addEventListener('click', verify);
    A.$('#btnUpload').addEventListener('click', upload);
    A.$('#btnRunPy').addEventListener('click', () => runActive());
    A.$('#btnPreview').addEventListener('click', () => {
      const f = A.editor.liveContext().activeFile;
      openPreview(f && TECH.runnerFor(f) === 'preview' ? f : null);
    });
    A.$('#btnPreviewReload').addEventListener('click', () => (previewState ? reloadPreview() : openPreview(null)));
    A.$('#btnPreviewOpen').addEventListener('click', () => previewState && A.api('open-external', previewState.url));
    A.$('#previewPage').addEventListener('change', (e) => openPreview(e.target.value));
    window.arpy.on('fs:changed', () => reloadPreview());
    A.$('#btnStopPy').addEventListener('click', () => A.api('python:stop'));
    A.$('#btnRunAll').addEventListener('click', runAll);
    A.$('#btnLibs').addEventListener('click', openLibs);
    A.$('#btnBoards').addEventListener('click', openBoards);
    A.$('#btnSaveVersion').addEventListener('click', saveVersion);
    A.$('#btnHistory').addEventListener('click', openHistory);
    A.$('#btnWiring').addEventListener('click', () => A.wiring.open());
    A.$('#btnDesigner').addEventListener('click', () => A.designer.open());
    A.$('#btnExportProject').addEventListener('click', () => A.features.exportProject());
    A.$('#btnImportZip').addEventListener('click', () => A.features.importProject());
    A.$('#btnTheme').addEventListener('click', async () => {
      const t = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      applyTheme(t);
      settings = await A.api('settings:set', { theme: t });
    });
    A.$('#btnDebugPy').addEventListener('click', () => runPython(null, { debug: true }));
    A.$('#btnBuildExe').addEventListener('click', buildExe);
    A.$('#btnRemotePy').addEventListener('click', runRemote);
    setInterval(() => { if (!document.hidden) refreshGitDot(); }, 30000);
    A.$('#btnSettings').addEventListener('click', openSettings);
    A.$('#btnNewFile').addEventListener('click', () => A.explorer.newFile());
    A.$('#btnNewFolder').addEventListener('click', () => A.explorer.newFolder());
    A.$('#btnRevealProject').addEventListener('click', () => A.api('project:reveal'));
    A.$('#btnCloseProject').addEventListener('click', async () => {
      if (!(await A.chat.beforeClose())) return; // guarda la conversación en este proyecto
      await A.editor.saveAll();
      await A.panels.serialCloseAll();
      await A.api('python:stop');
      await A.api('project:close');
      A.app.root = null;
      A.editor.closeAll();
      showWelcome();
    });
    A.$('#modalClose').addEventListener('click', () => A.modal.close());
    A.$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') A.modal.close(); });
    A.$('#modelSelect').addEventListener('change', async (e) => {
      const pid = settings.aiProvider || 'gemini';
      settings = await A.api('settings:set', pid === 'gemini' ? { model: e.target.value } : { aiModels: { ...(settings.aiModels || {}), [pid]: e.target.value } });
    });
    A.$('#autoApply').addEventListener('change', (e) => A.api('settings:set', { autoApply: e.target.checked }));

    // bienvenida
    let template = 'app';
    const pickTemplate = (b) => {
      template = b.dataset.t;
      A.$$('#newTemplate button').forEach((x) => x.classList.toggle('active', x === b));
    };
    A.$$('#newTemplate button').forEach((b) => b.addEventListener('click', () => pickTemplate(b)));
    // Tecnologías: la placa y las plantillas de Arduino/Python aparecen según lo elegido
    let newTechs = ['arduino', 'python'];
    const picker = techPicker(newTechs, (list) => { newTechs = list; syncMode(); });
    A.$('#newTechs').append(picker.el);
    const syncMode = () => {
      const ard = newTechs.includes('arduino');
      A.$('#newTplBox').classList.toggle('hidden', !ard && !newTechs.includes('python'));
      A.$('#newBoardField').classList.toggle('hidden', !ard);
      A.$$('#newTemplate button[data-mode]').forEach((b) => b.classList.toggle('off', (b.dataset.mode === 'ard') !== ard));
      const cur = A.$(`#newTemplate button[data-t="${template}"]`);
      if (!cur || cur.classList.contains('off')) pickTemplate(A.$(`#newTemplate button[data-mode="${ard ? 'ard' : 'py'}"]`));
    };
    syncMode();
    A.$$('.welcome-tabs button').forEach((b) => b.addEventListener('click', () => welcomeTab(b.dataset.w)));
    A.api('project:default-folder').then((p) => { newFolder = p; updateNewPreview(); });
    A.$('#newName').addEventListener('input', updateNewPreview);
    A.$('#newName').addEventListener('keydown', (e) => { if (e.key === 'Enter') A.$('#btnCreate').click(); });
    A.$('#btnPickFolder').addEventListener('click', async () => {
      const p = await A.api('project:pick-folder', newFolder);
      if (p) { newFolder = p; updateNewPreview(); }
    });
    A.$('#btnCreate').addEventListener('click', async () => {
      try {
        openProject(await A.api('project:create', { name: A.$('#newName').value, template, board: A.$('#newBoard').value, parent: newFolder, tech: newTechs, arduino: newTechs.includes('arduino') }));
      } catch (e) { A.toast(e.message, 'err'); }
    });
    A.$('#btnOpen').addEventListener('click', async () => {
      try { openProject(await A.api('project:open-dialog')); } catch (e) { A.toast(e.message, 'err'); }
    });
    A.$('#btnImport').addEventListener('click', async () => {
      try { openProject(await A.api('project:import-dialog')); } catch (e) { A.toast(e.message, 'err'); }
    });
    A.$('#recentFilter').addEventListener('input', renderRecent);
    // arrastrar un .arpy a la ventana de bienvenida
    const wel = A.$('#welcome');
    wel.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); wel.classList.add('dragging'); } });
    wel.addEventListener('dragleave', (e) => { if (e.target === wel) wel.classList.remove('dragging'); });
    wel.addEventListener('drop', (e) => {
      e.preventDefault();
      wel.classList.remove('dragging');
      const file = e.dataTransfer.files[0];
      const p = file && window.arpy.pathOf(file);
      if (!p) return;
      if (!/\.arpy$/i.test(p)) { A.toast('Arrastra el archivo .arpy del proyecto (o usa "Importar carpeta").', 'err'); return; }
      openFrom(p);
    });
    // doble clic en un .arpy con la app ya abierta
    window.arpy.on('app:open-file', async (p) => {
      if (A.app.config) {
        if (!(await A.chat.beforeClose())) return;
        await A.editor.saveAll();
        await A.panels.serialCloseAll();
        await A.api('python:stop');
      }
      openFrom(p);
    });

    // atajos
    addEventListener('keydown', (e) => {
      if (!A.app.config) return;
      const k = e.key.toLowerCase();
      if (e.ctrlKey && k === 'r') { e.preventDefault(); verify(); }
      else if (e.ctrlKey && k === 'u') { e.preventDefault(); upload(); }
      else if (e.ctrlKey && e.key === 'F5') { e.preventDefault(); runAll(); }
      else if (e.shiftKey && e.key === 'F5') { e.preventDefault(); A.api('python:stop'); }
      else if (e.key === 'F5') { e.preventDefault(); runActive(); }
      else if (e.ctrlKey && k === 'l') { e.preventDefault(); A.$('#chatInput').focus(); }
      else if (e.ctrlKey && k === 'n') { e.preventDefault(); A.explorer.newFile(); }
      else if (e.ctrlKey && e.shiftKey && k === 'f') { e.preventDefault(); A.panels.focusSearch(); }
      else if (e.ctrlKey && e.shiftKey && k === 's') { e.preventDefault(); saveVersion(); }
      else if (e.ctrlKey && k === 'p') { e.preventDefault(); quickOpen(); }
      else if (e.key === 'F9') { e.preventDefault(); runPython(null, { debug: true }); }
      else if (e.key === 'Escape') A.modal.close();
    });

    // cambios externos en disco (incluye ediciones de la IA)
    const onFs = A.debounce(() => { A.explorer.refresh(); A.editor.syncFromDisk(); }, 200);
    const gitLater = A.debounce(() => refreshGitDot(), 1500);
    window.arpy.on('fs:changed', gitLater);
    window.arpy.on('fs:changed', onFs);
    let lastPorts = null;
    setInterval(async () => {
      if (!A.app.config || document.hidden || A.app.config.arduino === false) return;
      let ports = [];
      try { ports = await A.api('serial:list'); } catch { return; }
      const sig = ports.map((p) => p.address).sort().join('|');
      if (sig !== lastPorts) { const first = lastPorts === null; lastPorts = sig; if (!first) refreshPorts(true); }
    }, 3000);

    settings = await A.api('settings:get');
    env = await A.api('status');
    await applySettings();
    statusbar();
    A.features.init();
    setTimeout(verifyKeysOnStart, 2500);
    // Primera vez en un equipo nuevo: descarga arduino-cli sin que el usuario tenga que hacer nada.
    if (!env.arduino.installed) setTimeout(installCli, 800);
    if (!A.wizard.resume() && !settings.wizardDone && !(settings.recentProjects || []).length) setTimeout(() => A.wizard.open(), 900);
    if (settings.wizardBoard && settings.wizardBoard.fqbn) A.$('#newBoard').value = settings.wizardBoard.fqbn;

    // El idioma guardado manda: si la ventana se abrió con otro, se recarga una vez.
    if ((settings.lang || 'en') !== A.i18n.lang && !sessionStorage.getItem('arpy.langFix')) {
      sessionStorage.setItem('arpy.langFix', '1');
      try { localStorage.setItem('arpy.lang', settings.lang || 'en'); } catch {}
      location.reload();
      return;
    }
    const reopen = sessionStorage.getItem('arpy.reopen');
    sessionStorage.removeItem('arpy.reopen');
    if (reopen) { try { await openProject(await A.api('project:open', reopen)); return; } catch {} }
    const launch = await A.api('project:launch-file');
    if (launch) {
      try { await openProject(await A.api('project:open', launch)); return; } catch (e) { A.toast(e.message, 'err'); }
    }
    showWelcome();
  }

  Object.assign(A.app, { runActive, openPreview, hasTech, welcomeTab, openProject, verify, upload, runAll, init, openBoards, openHistory, saveVersion, quickOpen, applyTheme, updatePyEnv, setBoard, runPython, pythonStopped, refreshPorts, openSettings });
})();
