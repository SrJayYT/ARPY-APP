/* Panel inferior: salida de compilación, monitor serie, terminal Python, gráfica y problemas */
(() => {
  const MAX = 300000;
  const raw = { build: '', python: '', serial: '' };
  let problems = [];
  let current = 'output';

  // ---------- pestañas ----------
  function show(name) {
    current = name;
    A.$$('.ptabs [data-panel]').forEach((b) => b.classList.toggle('active', b.dataset.panel === name));
    A.$$('#bottom .panel').forEach((p) => p.classList.toggle('active', p.id === 'panel-' + name));
    if (name === 'plot') drawPlot();
  }
  A.$$('.ptabs [data-panel]').forEach((b) => b.addEventListener('click', () => show(b.dataset.panel)));

  A.$('#btnClearPanel').addEventListener('click', () => {
    if (current === 'output') { A.$('#outputLog').innerHTML = ''; raw.build = ''; }
    if (current === 'python') { A.$('#pythonLog').innerHTML = ''; raw.python = ''; }
    if (current === 'serial') { A.$('#serialLog').innerHTML = ''; raw.serial = ''; const c = conns.get(active); if (c) { c.chunks = []; c.size = 0; c.raw = ''; } }
    if (current === 'plot') { series.clear(); drawPlot(); }
  });

  function classify(line, stream) {
    if (/\berror\b[:]/i.test(line) || /^Traceback|Error:|Exception/.test(line)) return 'err';
    if (/\bwarning:/i.test(line)) return 'warn';
    if (stream === 'info') return 'info';
    if (stream === 'stderr') return 'stderr';
    return '';
  }

  function append(pre, text, stream) {
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 30;
    const frag = document.createDocumentFragment();
    for (const part of text.split(/(?<=\n)/)) {
      const cls = classify(part, stream);
      frag.append(cls ? A.el('span', { class: cls }, part) : document.createTextNode(part));
    }
    pre.append(frag);
    while (pre.textContent.length > MAX && pre.firstChild) pre.firstChild.remove();
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }

  function cap(s) { return s.length > MAX ? s.slice(-MAX) : s; }

  window.arpy.on('log', ({ channel, text, stream }) => {
    if (channel === 'python') {
      raw.python = cap(raw.python + text);
      append(A.$('#pythonLog'), text, stream);
    } else {
      raw.build = cap(raw.build + text);
      append(A.$('#outputLog'), text, stream);
    }
  });

  function startBuild(title) {
    raw.build = '';
    A.$('#outputLog').innerHTML = '';
    append(A.$('#outputLog'), title + '\n', 'info');
    show('output');
  }

  function line(channel, text, cls) {
    const pre = channel === 'python' ? A.$('#pythonLog') : A.$('#outputLog');
    pre.append(A.el('span', { class: cls }, text + '\n'));
    pre.scrollTop = pre.scrollHeight;
    if (channel === 'python') raw.python += text + '\n'; else raw.build += text + '\n';
  }

  // ---------- problemas ----------
  function matchFile(p) {
    const norm = p.replace(/\\/g, '/');
    const files = A.app.files || [];
    return files.find((f) => norm.endsWith('/' + f) || norm === f) || null;
  }

  function parseBuild(text) {
    const out = [];
    const re = /^(.+?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning):\s*(.+)$/gm;
    let m;
    while ((m = re.exec(text))) {
      const file = matchFile(m[1]);
      if (!file) continue;
      out.push({ file, line: +m[2], col: m[3] ? +m[3] : 1, severity: m[4].includes('error') ? 'error' : 'warning', message: m[5].trim(), source: 'Arduino' });
    }
    return dedupe(out);
  }

  function parsePython(text) {
    const idx = text.lastIndexOf('Traceback (most recent call last)');
    const se = /File "(.+?)", line (\d+)/g;
    const chunk = idx >= 0 ? text.slice(idx) : text;
    let m, last = null;
    while ((m = se.exec(chunk))) { const f = matchFile(m[1]); if (f) last = { file: f, line: +m[2] }; }
    if (!last) return [];
    const lines = chunk.trim().split('\n').map((l) => l.trim()).filter(Boolean);
    const msg = [...lines].reverse().find((l) => /^\w*(Error|Exception)\b|^\w+Error:/.test(l)) || lines[lines.length - 1];
    return [{ ...last, col: 1, severity: 'error', message: msg, source: 'Python' }];
  }

  function dedupe(list) {
    const seen = new Set();
    return list.filter((p) => { const k = `${p.file}:${p.line}:${p.message}`; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function setProblems(list, source) {
    problems = [...problems.filter((p) => p.source !== source), ...list];
    A.editor.setMarkers(problems);
    const errs = problems.filter((p) => p.severity === 'error').length;
    const badge = A.$('#problemCount');
    badge.textContent = problems.length;
    badge.classList.toggle('err', errs > 0);
    A.$('#btnFixWithAI').classList.toggle('hidden', errs === 0);
    const host = A.$('#problemsList');
    host.innerHTML = '';
    if (!problems.length) host.append(A.el('div', { class: 'muted', style: 'padding:12px' }, 'Sin problemas detectados.'));
    for (const p of problems) {
      const row = A.el('div', { class: 'problem', onclick: () => A.editor.open(p.file, { line: p.line }) });
      row.innerHTML = `<span class="sev ${p.severity}">${p.severity === 'error' ? 'Error' : 'Aviso'}</span><span>${A.esc(p.message)}</span><span class="loc">${A.esc(p.file)}:${p.line}</span>`;
      host.append(row);
    }
  }

  function finishBuild(ok) {
    const list = parseBuild(raw.build);
    setProblems(list, 'Arduino');
    if (!ok && list.some((p) => p.severity === 'error')) show('problems');
    return list;
  }

  function finishPython() {
    setProblems(parsePython(raw.python), 'Python');
  }

  A.$('#btnFixWithAI').addEventListener('click', () => {
    const errs = problems.filter((p) => p.severity === 'error');
    const desc = errs.slice(0, 15).map((p) => `- [${p.source}] ${p.file}:${p.line} → ${p.message}`).join('\n');
    A.chat.send(`Hay errores. Analízalos (tienes la salida completa en el contexto) y corrígelos en los archivos:\n${desc}`);
  });

  // ---------- monitor serie (una pestaña por placa conectada) ----------
  const BAUDS = [300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 74880, 115200, 230400, 250000, 500000, 1000000, 2000000];
  const baudSel = A.$('#baudSelect');
  BAUDS.forEach((b) => baudSel.append(A.el('option', { value: b }, `${b} baudios`)));
  const conns = new Map(); // path -> { path, baud, chunks: [{t, cls}], size, lineStart, partial, raw }
  let active = null;
  const CMAX = 100000;
  const projectPort = () => (A.app && A.app.config && A.app.config.port) || '';

  function conn(path) {
    if (!conns.has(path)) conns.set(path, { path, baud: +baudSel.value, chunks: [], size: 0, lineStart: true, partial: '', raw: '' });
    return conns.get(path);
  }

  function push(c, t, cls = '') {
    c.chunks.push({ t, cls });
    c.size += t.length;
    while (c.size > CMAX && c.chunks.length > 1) c.size -= c.chunks.shift().t.length;
    if (c.path !== active) return;
    const pre = A.$('#serialLog');
    pre.append(cls ? A.el('span', { class: cls }, t) : document.createTextNode(t));
    while (pre.textContent.length > CMAX && pre.firstChild) pre.firstChild.remove();
    if (A.$('#serialAutoscroll').checked) pre.scrollTop = pre.scrollHeight;
  }

  function showConn(path) {
    active = path;
    const pre = A.$('#serialLog');
    pre.innerHTML = '';
    const c = conns.get(path);
    if (c) {
      for (const ch of c.chunks) pre.append(ch.cls ? A.el('span', { class: ch.cls }, ch.t) : document.createTextNode(ch.t));
      baudSel.value = c.baud;
    }
    pre.scrollTop = pre.scrollHeight;
    renderConns();
  }

  function renderConns() {
    const host = A.$('#serialConns');
    host.innerHTML = '';
    const pp = projectPort();
    for (const c of conns.values()) {
      const x = A.el('span', { class: 'sc-x', title: 'Desconectar', onclick: (e) => { e.stopPropagation(); serialDisconnect(false, c.path); } });
      x.innerHTML = A.icon('x');
      host.append(A.el('button', { class: 'sc-tab' + (c.path === active ? ' active' : ''), onclick: () => showConn(c.path), title: `${c.path} @ ${c.baud}` },
        A.el('i', { class: 'dot on' }), c.path, c.path === pp ? A.el('small', {}, 'proyecto') : null, x));
    }
    host.append(A.el('button', { class: 'sc-add', title: 'Abrir otra placa en una pestaña nueva', onclick: addOther }, '+ Otra placa'));
    host.classList.toggle('hidden', conns.size === 0);
    const open = conns.has(pp);
    A.$('#btnSerialToggle').textContent = open ? 'Desconectar' : 'Conectar';
    A.$('#btnSerialToggle').classList.toggle('ino', !open);
    A.$('#serialDot').classList.toggle('on', conns.size > 0);
  }
  renderConns();

  async function serialConnect(path = projectPort(), baud = +baudSel.value) {
    if (!path) return A.toast('Selecciona un puerto en la barra superior', 'err');
    try {
      await A.api('serial:open', path, baud);
      const c = conn(path);
      c.baud = baud;
      active = path;
      showConn(path);
      sys(c, `Conectado a ${path} @ ${baud}`);
      return true;
    } catch (e) {
      A.toast(`No se pudo abrir ${path}: ${e.message}`, 'err');
      return false;
    }
  }

  // Cierra la conexión del puerto del proyecto (antes de subir o de ejecutar Python).
  async function serialDisconnect(silent, path = projectPort()) {
    if (!conns.has(path)) return false;
    await A.api('serial:close', path);
    const c = conns.get(path);
    if (!silent) sys(c, 'Desconectado');
    conns.delete(path);
    if (active === path) showConn(conns.size ? [...conns.keys()][0] : null);
    else renderConns();
    return true;
  }

  async function addOther() {
    let ports = [];
    try { ports = await A.api('serial:list'); } catch {}
    const free = ports.filter((p) => !conns.has(p.address));
    if (!free.length) return A.toast('No hay otros puertos libres. Conecta otra placa por USB.', 'err');
    const sel = A.el('select', {}, ...free.map((p) => A.el('option', { value: p.address }, `${p.address}${p.manufacturer ? ' — ' + p.manufacturer : ''}`)));
    const bd = A.el('select', {}, ...BAUDS.map((b) => A.el('option', { value: b }, `${b} baudios`)));
    bd.value = baudSel.value;
    const body = A.el('div', { style: 'display:flex;flex-direction:column;gap:12px' },
      A.el('div', { class: 'field' }, A.el('label', {}, 'Puerto'), sel),
      A.el('div', { class: 'field' }, A.el('label', {}, 'Velocidad'), bd),
      A.el('div', { class: 'modal-foot' }, A.el('button', { class: 'btn ino', onclick: async () => { A.modal.close(); await serialConnect(sel.value, +bd.value); } }, 'Conectar')));
    A.modal.open('Abrir otra placa', body);
  }

  function sys(c, t) {
    push(c, `${c.lineStart ? '' : '\n'}— ${t} —\n`, 'info');
    c.lineStart = true;
  }

  A.$('#btnSerialToggle').addEventListener('click', () => (conns.has(projectPort()) ? serialDisconnect() : serialConnect()));
  baudSel.addEventListener('change', async () => {
    const path = active || projectPort();
    if (path === projectPort()) A.api('project:config', { baud: +baudSel.value }).then((c) => { A.app.config = c; });
    if (conns.has(path)) { await A.api('serial:close', path); conns.delete(path); serialConnect(path, +baudSel.value); }
  });

  window.arpy.on('serial:closed', ({ path }) => {
    const c = conns.get(path);
    if (!c) return;
    sys(c, 'Puerto cerrado');
    conns.delete(path);
    if (active === path) active = conns.size ? [...conns.keys()][0] : null;
    renderConns();
  });

  window.arpy.on('serial:data', ({ path, text }) => {
    const c = conns.get(path);
    if (!c) return;
    c.raw = (c.raw + text).slice(-20000);
    raw.serial = conns.size > 1
      ? [...conns.values()].map((x) => `[${x.path}]\n${x.raw.slice(-8000)}`).join('\n')
      : c.raw;
    const ts = A.$('#serialTimestamps').checked;
    let out = '';
    if (A.$('#serialHex').checked) {
      for (const b of new TextEncoder().encode(text)) {
        if (c.lineStart && ts) out += `[${new Date().toLocaleTimeString()}] `;
        out += b.toString(16).padStart(2, '0').toUpperCase() + ' ';
        c.lineStart = b === 10;
        if (b === 10) out += '\n';
      }
    } else {
      for (const ch of text) {
        if (c.lineStart && ts) out += `[${new Date().toLocaleTimeString()}] `;
        out += ch;
        c.lineStart = ch === '\n';
      }
    }
    push(c, out);

    c.partial += text;
    const lines = c.partial.split(/\r?\n/);
    c.partial = lines.pop();
    const prefix = conns.size > 1 && path !== projectPort() ? `${path}·` : '';
    for (const l of lines) {
      if (l.trim()) { csvRows.push([new Date().toISOString(), l, path]); if (csvRows.length > 200000) csvRows.shift(); }
      plotLine(l, prefix);
    }
  });

  let simPartial = '';
  function feedPlot(text) {
    simPartial += text;
    const ls = simPartial.split(/\r?\n/);
    simPartial = ls.pop();
    ls.forEach((l) => plotLine(l));
  }

  // ---------- exportar CSV ----------
  const csvRows = [];
  A.$('#btnSerialCsv').addEventListener('click', async () => {
    if (!csvRows.length) return A.toast('Aún no hay datos recibidos', 'err');
    const keys = [];
    const parsed = csvRows.map(([t, l, port]) => {
      const vals = {};
      let idx = 0;
      for (const tok of l.trim().split(/[\s,;\t]+/)) {
        const m = tok.match(/^([A-Za-z_][\w.]*)[:=](-?\d+(?:\.\d+)?)$/) || tok.match(/^()(-?\d+(?:\.\d+)?)$/);
        if (!m) continue;
        const k = m[1] || `valor${++idx}`;
        if (!keys.includes(k)) keys.push(k);
        vals[k] = m[2];
      }
      return [t, l, vals, port || ''];
    });
    const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
    const csv = [['tiempo', 'puerto', 'linea', ...keys].join(','), ...parsed.map(([t, l, v, port]) => [t, port, q(l), ...keys.map((k) => v[k] ?? '')].join(','))].join('\n');
    const file = await A.api('dialog:save-text', `serie-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`, csv);
    if (file) A.toast(`Guardado: ${file}`, 'ok');
  });

  // ---------- buscar en el proyecto ----------
  async function runSearch() {
    const q = A.$('#searchInput').value;
    const host = A.$('#searchResults');
    host.innerHTML = '';
    if (!q) return;
    let res = [];
    try { res = await A.api('search:find', q, { regex: A.$('#searchRegex').checked, caseSensitive: A.$('#searchCase').checked }); } catch (e) { host.append(A.el('div', { class: 'muted', style: 'padding:12px' }, e.message)); return; }
    if (!res.length) { host.append(A.el('div', { class: 'muted', style: 'padding:12px' }, 'Sin resultados.')); return; }
    const byFile = new Map();
    res.forEach((r) => { if (!byFile.has(r.file)) byFile.set(r.file, []); byFile.get(r.file).push(r); });
    host.append(A.el('div', { class: 'muted', style: 'padding:6px 12px' }, `${res.length} resultado(s) en ${byFile.size} archivo(s)`));
    for (const [file, list] of byFile) {
      const head = A.el('div', { class: 'sr-file' });
      head.innerHTML = `${A.fileIcon(file)}${A.esc(file)} <span class="badge">${list.length}</span>`;
      host.append(head);
      for (const r of list.slice(0, 200)) {
        const lead = r.text.slice(0, r.col - 1).replace(/^\s+/, '');
        const hit = r.text.slice(r.col - 1, r.col - 1 + r.len);
        const rest = r.text.slice(r.col - 1 + r.len);
        const row = A.el('div', { class: 'sr-line', onclick: () => A.editor.open(file, { line: r.line }) });
        row.innerHTML = `<span class="ln">${r.line}</span>${A.esc(lead)}<mark>${A.esc(hit)}</mark>${A.esc(rest)}`;
        host.append(row);
      }
    }
  }
  A.$('#searchInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') runSearch(); });
  A.$('#searchCase').addEventListener('change', runSearch);
  A.$('#searchRegex').addEventListener('change', runSearch);
  A.$('#btnReplaceAll').addEventListener('click', async () => {
    const q = A.$('#searchInput').value;
    if (!q) return;
    const rep = A.$('#replaceInput').value;
    if (!(await A.confirm('Reemplazar en todo el proyecto', `¿Reemplazar todas las apariciones de "${q}" por "${rep}"? Puedes deshacerlo restaurando una versión del historial.`, 'Reemplazar'))) return;
    await A.editor.saveAll();
    const changed = await A.api('search:replace', q, rep, { regex: A.$('#searchRegex').checked, caseSensitive: A.$('#searchCase').checked });
    A.toast(`${changed.length} archivo(s) modificados`, 'ok');
    await A.editor.syncFromDisk();
    runSearch();
  });
  function focusSearch(text) {
    show('search');
    const i = A.$('#searchInput');
    if (text) i.value = text;
    i.focus();
    i.select();
    if (text) runSearch();
  }

  A.$('#serialInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value;
    const c = conns.get(active);
    if (!c) return A.toast('Conecta el monitor serie primero', 'err');
    A.api('serial:write', c.path, v + A.$('#lineEnding').value);
    push(c, `${c.lineStart ? '' : '\n'}» ${v}\n`, 'sent');
    c.lineStart = true;
    e.target.value = '';
  });
  // los <option value="\n"> llegan como texto literal: normalizamos
  A.$$('#lineEnding option').forEach((o) => { o.value = o.value.replace(/\\n/g, '\n').replace(/\\r/g, '\r'); });

  // ---------- terminal Python ----------
  A.$('#pythonInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const v = e.target.value;
    A.api('python:stdin', v + '\n');
    append(A.$('#pythonLog'), v + '\n', 'info');
    e.target.value = '';
  });
  A.$('#pipInput').addEventListener('keydown', async (e) => {
    if (e.key !== 'Enter' || !e.target.value.trim()) return;
    const pkg = e.target.value.trim().replace(/^pip\s+install\s+/, '');
    e.target.value = '';
    show('python');
    const r = await A.api('python:pip', pkg);
    line('python', r.code === 0 ? `✔ ${pkg} instalado` : `✖ Falló la instalación de ${pkg}`, r.code === 0 ? 'ok' : 'err');
  });
  A.$('#btnPipReq').addEventListener('click', async () => {
    show('python');
    const r = await A.api('python:requirements');
    line('python', r.code === 0 ? '✔ requirements instalados' : '✖ Error instalando requirements', r.code === 0 ? 'ok' : 'err');
  });

  function startPython() {
    raw.python = '';
    A.$('#pythonLog').innerHTML = '';
    A.$('#pyDot').classList.add('on');
    show('python');
  }

  window.arpy.on('python:exit', (code) => {
    A.$('#pyDot').classList.remove('on');
    line('python', `\n■ Proceso terminado (código ${code})`, code === 0 ? 'ok' : 'err');
    finishPython();
    A.app.pythonStopped();
    if (/ModuleNotFoundError: No module named '([^']+)'/.test(raw.python)) {
      const mod = raw.python.match(/No module named '([^']+)'/)[1].split('.')[0];
      const pkg = { serial: 'pyserial', cv2: 'opencv-python', PIL: 'pillow', sklearn: 'scikit-learn', yaml: 'pyyaml' }[mod] || mod;
      const pre = A.$('#pythonLog');
      const a = A.el('a', { onclick: async () => { const r = await A.api('python:pip', pkg); line('python', r.code === 0 ? `✔ ${pkg} instalado. Ejecuta de nuevo.` : '✖ Falló', r.code === 0 ? 'ok' : 'err'); } }, `Instalar "${pkg}" con pip`);
      pre.append(A.el('span', { class: 'info' }, '💡 Falta un paquete: '), a, document.createTextNode('\n'));
    }
  });

  // ---------- gráfica ----------
  const COLORS = ['#22d3ee', '#f2c94c', '#8b5cf6', '#3ccf91', '#ff6b6b', '#f78c6c', '#4b8bbe', '#c792ea'];
  const series = new Map();
  const N = 300;
  let drawPending = false;

  function plotLine(l, prefix = '') {
    const tokens = l.trim().split(/[\s,;\t]+/).filter(Boolean);
    let idx = 0;
    for (const t of tokens) {
      const m = t.match(/^([A-Za-z_][\w.]*)[:=](-?\d+(?:\.\d+)?)$/) || t.match(/^()(-?\d+(?:\.\d+)?)$/);
      if (!m) continue;
      const name = prefix + (m[1] || `valor ${++idx}`);
      if (!series.has(name)) series.set(name, []);
      const arr = series.get(name);
      arr.push(parseFloat(m[2]));
      if (arr.length > N) arr.shift();
    }
    if (current === 'plot' && !drawPending) { drawPending = true; requestAnimationFrame(drawPlot); }
  }

  function drawPlot() {
    drawPending = false;
    const c = A.$('#plotCanvas');
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    if (!w || !h) return;
    c.width = w * dpr; c.height = h * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    g.clearRect(0, 0, w, h);
    const all = [...series.values()].flat();
    const legend = A.$('#plotLegend');
    legend.innerHTML = '';
    if (!all.length) {
      g.fillStyle = '#66768a'; g.font = '12px Segoe UI';
      g.fillText('Esperando datos numéricos del monitor serie (conéctalo primero)…', 16, 24);
      return;
    }
    let min = Math.min(...all), max = Math.max(...all);
    if (min === max) { min -= 1; max += 1; }
    const pad = 36;
    g.strokeStyle = '#1b2430'; g.fillStyle = '#66768a'; g.font = '11px Consolas'; g.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
      const y = 10 + (h - 20) * (i / 4);
      g.beginPath(); g.moveTo(pad, y); g.lineTo(w - 8, y); g.stroke();
      g.fillText((max - (max - min) * (i / 4)).toFixed(1), 2, y + 4);
    }
    let ci = 0;
    for (const [name, arr] of series) {
      const color = COLORS[ci++ % COLORS.length];
      g.strokeStyle = color; g.lineWidth = 1.8; g.beginPath();
      arr.forEach((v, i) => {
        const x = pad + (w - pad - 8) * (i / (N - 1));
        const y = 10 + (h - 20) * (1 - (v - min) / (max - min));
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
      g.stroke();
      legend.append(A.el('span', { style: `--c:${color}` }, `${name}: ${arr[arr.length - 1]}`));
    }
  }
  new ResizeObserver(() => current === 'plot' && drawPlot()).observe(A.$('#panel-plot'));

  A.panels = {
    show, startBuild, finishBuild, line, startPython, setProblems, focusSearch, feedPlot,
    serialConnect, serialDisconnect,
    get serialOpen() { return conns.has(projectPort()); },
    serialPorts: () => [...conns.keys()],
    get current() { return current; },
    serialCloseAll: async () => { await A.api('serial:close'); conns.clear(); showConn(null); },
    setBaud: (b) => { baudSel.value = b || 9600; },
    logs: () => ({ buildLog: raw.build, pythonLog: raw.python, serialLog: raw.serial }),
    clearAll: () => { raw.build = raw.python = raw.serial = ''; ['#outputLog', '#pythonLog', '#serialLog'].forEach((s) => (A.$(s).innerHTML = '')); series.clear(); setProblems([], 'Arduino'); setProblems([], 'Python'); },
  };
})();
