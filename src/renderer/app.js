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
  async function refreshPorts(announce) {
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
    statusbar();
  }

  // ---------- proyecto ----------
  async function openProject(res) {
    if (!res) return;
    A.app.config = res.config;
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
    if (!A.app.config) return;
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
    if (!A.app.config) return false;
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
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    A.editor.setTheme(theme);
    try { localStorage.setItem('arpy.theme', theme); } catch {}
    const b = A.$('#btnTheme');
    b.innerHTML = A.icon(theme === 'light' ? 'moon' : 'sun');
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
    if (await upload()) {
      A.panels.line('build', '⏳ Esperando a que la placa reinicie…', 'info');
      setTimeout(() => runPython(), 1800);
    }
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
    const introChk = A.el('input', { type: 'checkbox' });
    introChk.checked = settings.intro !== false;

    const field = (label, input, hint) => A.el('div', { class: 'field' }, A.el('label', {}, label), input, hint ? A.el('small', {}, hint) : null);
    const showKey = A.el('button', { class: 'btn sm ghost', onclick: () => { key.type = key.type === 'password' ? 'text' : 'password'; } }, 'Ver');
    const body = A.el('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      A.el('div', { class: 'field' }, A.el('label', {}, settings.builtinKey ? 'API key propia de Gemini (opcional)' : 'API key de Google Gemini'), A.el('div', { class: 'row' }, key, showKey),
        A.el('small', {}, settings.builtinKey ? 'La app ya trae una key integrada. Pon una tuya solo si quieres usar tu propia cuota.' : 'Consíguela gratis en aistudio.google.com → Get API key. Se guarda solo en este equipo.')),
      field('Modelo de IA por defecto', model, 'Los modelos "pro" razonan mejor; los "flash" responden más rápido.'),
      A.el('div', { class: 'field' }, A.el('label', {}, 'arduino-cli'),
        A.el('div', { class: 'row' }, cli, A.el('button', { class: 'btn sm ino', onclick: installCli }, env.arduino.installed ? 'Actualizar' : 'Instalar')),
        A.el('small', {}, env.arduino.installed ? `✔ ${env.arduino.version}` : '⚠ No instalado. Pulsa "Instalar": se descarga la versión oficial automáticamente.')),
      field('Intérprete de Python', py, env.python.installed ? `✔ Detectado: ${env.python.cmd} — ${env.python.version}` : '⚠ No se encontró Python 3'),
      field('Tamaño de letra del editor', font),
      field('Rendimiento', perf, 'El modo ligero dibuja sin GPU, quita el minimapa y reduce animaciones: usa casi la mitad de RAM. Ideal para laptops con 8 GB. Reinicia la app para aplicarlo del todo.'),
      A.el('label', { class: 'chk' }, introChk, 'Mostrar la animación de apertura'),
      A.el('label', { class: 'chk' }, auto, 'Aplicar automáticamente los cambios de la IA (sin pulsar "Aplicar")'),
      A.el('label', { class: 'chk' }, inline, 'Autocompletado con IA mientras escribes (texto gris, Tab para aceptar). Usa cuota de Gemini.'),
      A.el('div', { class: 'modal-foot' }, A.el('button', {
        class: 'btn ino',
        onclick: async () => {
          settings = await A.api('settings:set', {
            geminiApiKey: key.value.trim(), model: model.value, pythonPath: py.value.trim(),
            arduinoCliPath: cli.value.trim(), fontSize: +font.value || 14, autoApply: auto.checked, aiComplete: inline.checked,
            perfMode: perf.value, intro: introChk.checked,
          });
          applySettings();
          env = await A.api('status');
          statusbar();
          renderEnv();
          A.modal.close();
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
  }

  async function applySettings() {
    A.editor.setFontSize(settings.fontSize || 14);
    A.$('#autoApply').checked = !!settings.autoApply;
    A.$('#agentMode').checked = !!settings.agentMode;
    A.editor.setAiComplete(!!settings.aiComplete);
    applyTheme(settings.theme || 'dark');
    applyPerf();
    const sel = A.$('#modelSelect');
    let models = [];
    try { models = await A.api('ai:models'); } catch {}
    const prefer = ['gemini-flash-latest', 'gemini-3.8-flash', 'gemini-flash-lite-latest'];
    const list = [...new Set([settings.model, ...prefer, ...models].filter(Boolean))];
    sel.innerHTML = '';
    list.forEach((m) => sel.append(A.el('option', { value: m }, m)));
    sel.value = settings.model;
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
    A.$('#btnRunPy').addEventListener('click', () => runPython());
    A.$('#btnStopPy').addEventListener('click', () => A.api('python:stop'));
    A.$('#btnRunAll').addEventListener('click', runAll);
    A.$('#btnLibs').addEventListener('click', openLibs);
    A.$('#btnBoards').addEventListener('click', openBoards);
    A.$('#btnSaveVersion').addEventListener('click', saveVersion);
    A.$('#btnHistory').addEventListener('click', openHistory);
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
      await A.editor.saveAll();
      await A.panels.serialDisconnect(true);
      await A.api('python:stop');
      await A.api('project:close');
      A.editor.closeAll();
      showWelcome();
    });
    A.$('#modalClose').addEventListener('click', () => A.modal.close());
    A.$('#modal').addEventListener('mousedown', (e) => { if (e.target.id === 'modal') A.modal.close(); });
    A.$('#modelSelect').addEventListener('change', (e) => A.api('settings:set', { model: e.target.value }));
    A.$('#autoApply').addEventListener('change', (e) => A.api('settings:set', { autoApply: e.target.checked }));

    // bienvenida
    let template = 'app';
    A.$$('#newTemplate button').forEach((b) => b.addEventListener('click', () => {
      template = b.dataset.t;
      A.$$('#newTemplate button').forEach((x) => x.classList.toggle('active', x === b));
    }));
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
        openProject(await A.api('project:create', { name: A.$('#newName').value, template, board: A.$('#newBoard').value, parent: newFolder }));
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
        await A.editor.saveAll();
        await A.panels.serialDisconnect(true);
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
      else if (e.key === 'F5') { e.preventDefault(); runPython(); }
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
      if (!A.app.config || document.hidden) return;
      let ports = [];
      try { ports = await A.api('serial:list'); } catch { return; }
      const sig = ports.map((p) => p.address).sort().join('|');
      if (sig !== lastPorts) { const first = lastPorts === null; lastPorts = sig; if (!first) refreshPorts(true); }
    }, 3000);

    settings = await A.api('settings:get');
    env = await A.api('status');
    await applySettings();
    statusbar();
    // Primera vez en un equipo nuevo: descarga arduino-cli sin que el usuario tenga que hacer nada.
    if (!env.arduino.installed) setTimeout(installCli, 800);

    const launch = await A.api('project:launch-file');
    if (launch) {
      try { await openProject(await A.api('project:open', launch)); return; } catch (e) { A.toast(e.message, 'err'); }
    }
    showWelcome();
  }

  Object.assign(A.app, { verify, upload, runAll, init, openBoards, openHistory, saveVersion, quickOpen, applyTheme, updatePyEnv, setBoard, runPython, pythonStopped, refreshPorts, openSettings });
})();
