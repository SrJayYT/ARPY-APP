/* Utilidades compartidas del renderer. Todo vive en window.A */
window.A = window.A || {};
A.i18n = window.ARPY_I18N || { lang: 'es', t: (s) => s, tr: (s) => s, reload: () => location.reload() };

const ICONS = {
  check: '<path d="M20 6 9 17l-5-5"/>',
  upload: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
  play: '<polygon points="6 3 20 12 6 21 6 3"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  zap: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  book: '<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  refresh: '<path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/>',
  cpu: '<rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
  plug: '<path d="M12 22v-5"/><path d="M9 8V2"/><path d="M15 8V2"/><path d="M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8Z"/>',
  filePlus: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/><path d="M9 15h6"/><path d="M12 18v-6"/>',
  folderPlus: '<path d="M12 10v6"/><path d="M9 13h6"/><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  folder: '<path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/>',
  file: '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"/><path d="M14 2v4a2 2 0 0 0 2 2h4"/>',
  x: '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>',
  chev: '<path d="m9 18 6-6-6-6"/>',
  code: '<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
  terminal: '<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>',
  python: '<path d="M12 2c-3 0-5 1-5 3v3h5v1H5c-2 0-3 2-3 5s1 5 3 5h2v-3c0-2 1-3 3-3h5c2 0 3-1 3-3V5c0-2-2-3-6-3z"/><circle cx="9.5" cy="5" r=".5"/>',
  chart: '<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>',
  alert: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
  sparkles: '<path d="m12 3-1.9 5.8a2 2 0 0 1-1.3 1.3L3 12l5.8 1.9a2 2 0 0 1 1.3 1.3L12 21l1.9-5.8a2 2 0 0 1 1.3-1.3L21 12l-5.8-1.9a2 2 0 0 1-1.3-1.3Z"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>',
  brain: '<path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/><path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/><path d="M12 5v13"/>',
  copy: '<rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/>',
  diff: '<path d="M12 3v14"/><path d="M5 10h14"/><path d="M5 21h14"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  bug: '<path d="m8 2 1.88 1.88M14.12 3.88 16 2M9 7.13v-1a3 3 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6M12 20v-9M6.53 9C4.6 8.8 3 7.1 3 5M6 13H2M3 21c0-2.1 1.7-3.9 3.8-4M20.97 5c0 2.1-1.6 3.8-3.5 4M22 13h-4M17.2 17c2.1.1 3.8 1.9 3.8 4"/>',
  history: '<path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>',
  gitCommit: '<circle cx="12" cy="12" r="3"/><path d="M3 12h6M15 12h6"/>',
  search: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
  image: '<rect width="18" height="18" x="3" y="3" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><path d="M12 17h.01"/>',
  wifiOff: '<path d="M12 20h.01"/><path d="M8.5 16.43a5 5 0 0 1 7 0"/><path d="M2 8.82a15 15 0 0 1 4.17-2.65"/><path d="M10.66 5c4.01-.36 8.14.9 11.34 3.76"/><path d="M16.85 11.25a10 10 0 0 1 2.22 1.68"/><path d="M5 13a10 10 0 0 1 5.24-2.76"/><path d="m2 2 20 20"/>',
  cable: '<path d="M4 9a2 2 0 0 1-2-2V5h6v2a2 2 0 0 1-2 2Z"/><path d="M3 5V3"/><path d="M7 5V3"/><path d="M19 15V6.5a3.5 3.5 0 0 0-7 0v11a3.5 3.5 0 0 1-7 0V9"/><path d="M17 21v-2"/><path d="M21 21v-2"/><path d="M22 19h-6v-2a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2Z"/>',
  layout: '<rect width="18" height="18" x="3" y="3" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/><path d="M12 15V3"/>',
  archive: '<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
  wand: '<path d="m21.64 3.64-1.28-1.28a1.21 1.21 0 0 0-1.72 0L2.36 18.64a1.21 1.21 0 0 0 0 1.72l1.28 1.28a1.2 1.2 0 0 0 1.72 0L21.64 5.36a1.2 1.2 0 0 0 0-1.72"/><path d="m14 7 3 3"/><path d="M5 6v4"/><path d="M19 14v4"/><path d="M10 2v2"/><path d="M7 8H3"/><path d="M21 16h-4"/><path d="M11 3H9"/>',
  lightbulb: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/>',
  more: '<circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/><circle cx="5" cy="12" r="1"/>',
  package: '<path d="m7.5 4.27 9 5.15M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20M2 12h20"/>',
  retry: '<path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"/><path d="M21 3v5h-5"/>',
};

A.icon = (name) => `<svg viewBox="0 0 24 24">${ICONS[name] || ''}</svg>`;
A.hydrateIcons = (root = document) => {
  root.querySelectorAll('[data-icon]').forEach((n) => {
    if (!n.dataset.iconDone) { n.insertAdjacentHTML('afterbegin', A.icon(n.dataset.icon)); n.dataset.iconDone = '1'; }
  });
};

A.$ = (sel, root = document) => root.querySelector(sel);
A.$$ = (sel, root = document) => [...root.querySelectorAll(sel)];

A.el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) n.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) n.append(c);
  return n;
};

A.esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

A.debounce = (fn, ms) => {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
};

// Llamada IPC con mensajes de error limpios.
A.api = async (channel, ...args) => {
  try {
    return await window.arpy.invoke(channel, ...args);
  } catch (err) {
    const msg = String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    throw new Error(msg);
  }
};

// opts: { action: { label, fn }, ms }
A.toast = (text, kind = '', opts = {}) => {
  const t = A.el('div', { class: `toast ${kind}` }, text);
  if (opts.action) {
    t.append(A.el('button', { class: 'toast-act', onclick: () => { t.remove(); opts.action.fn(); } }, opts.action.label));
  }
  A.$('#toasts').append(t);
  setTimeout(() => t.remove(), opts.ms || (opts.action ? 9000 : kind === 'err' ? 6000 : 3500));
  return t;
};

A.status = (text) => {
  A.$('#stMsg').textContent = text || '';
};

// ---- Modal ----
A.modal = {
  open(title, body, { wide = false } = {}) {
    A.$('#modalTitle').textContent = title;
    const b = A.$('#modalBody');
    b.innerHTML = '';
    if (typeof body === 'string') b.innerHTML = body; else b.append(body);
    A.$('.modal-card').classList.toggle('wide', wide);
    A.$('#modal').classList.remove('hidden');
    A.hydrateIcons(b);
    this.onClose = null;
    return b;
  },
  close() {
    A.$('#modal').classList.add('hidden');
    if (this.onClose) { const f = this.onClose; this.onClose = null; f(); }
  },
};

A.prompt = (title, value = '', label = '') => new Promise((resolve) => {
  const input = A.el('input', { value });
  const ok = A.el('button', { class: 'btn ino', onclick: () => { resolve(input.value.trim() || null); A.modal.onClose = null; A.modal.close(); } }, 'Aceptar');
  const body = A.el('div', { class: 'field' }, label ? A.el('label', {}, label) : null, input, A.el('div', { class: 'modal-foot' }, ok));
  A.modal.open(title, body);
  A.modal.onClose = () => resolve(null);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') ok.click(); });
  setTimeout(() => { input.focus(); input.select(); }, 30);
});

A.confirm = (title, text, okText = 'Aceptar', danger = false) => new Promise((resolve) => {
  const ok = A.el('button', { class: danger ? 'btn' : 'btn ino', style: danger ? 'background:#7a2530;border-color:#a33' : '', onclick: () => { A.modal.onClose = null; A.modal.close(); resolve(true); } }, okText);
  const cancel = A.el('button', { class: 'btn ghost', onclick: () => A.modal.close() }, 'Cancelar');
  A.modal.open(title, A.el('div', {}, A.el('p', {}, text), A.el('div', { class: 'modal-foot' }, cancel, ok)));
  A.modal.onClose = () => resolve(false);
});

// ---- Menú contextual ----
A.menu = (x, y, items) => {
  const m = A.$('#ctxMenu');
  m.innerHTML = '';
  for (const it of items) {
    if (it === '-') { m.append(A.el('hr')); continue; }
    m.append(A.el('button', { class: it.danger ? 'danger' : '', onclick: () => { m.classList.add('hidden'); it.action(); } }, it.label));
  }
  m.classList.remove('hidden');
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, innerWidth - r.width - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - r.height - 8) + 'px';
};
document.addEventListener('mousedown', (e) => { if (!e.target.closest('#ctxMenu')) A.$('#ctxMenu').classList.add('hidden'); });

A.fileIcon = (name, dir) => {
  if (dir) return '<span class="fi dir">' + A.icon('folder') + '</span>';
  const ext = name.split('.').pop().toLowerCase();
  const map = { ino: ['ino', '∞'], cpp: ['ino', 'C+'], c: ['ino', 'C'], h: ['h', 'H'], hpp: ['h', 'H'], py: ['py', 'PY'], json: ['json', '{}'], md: ['md', 'M↓'], txt: ['txt', '≡'], arpy: ['ino', 'AP'],
    js: ['js', 'JS'], mjs: ['js', 'JS'], cjs: ['js', 'JS'], html: ['web', '<>'], htm: ['web', '<>'], css: ['css', '#'], ejs: ['ejs', '<%'], php: ['php', 'php'], java: ['java', 'J'], sql: ['sql', 'SQL'], sqlite: ['sql', 'DB'] };
  const [cls, label] = map[ext] || ['txt', '•'];
  return `<span class="fi ${cls}">${label}</span>`;
};

A.langOf = (path) => {
  const ext = path.split('.').pop().toLowerCase();
  return { ino: 'cpp', cpp: 'cpp', c: 'cpp', h: 'cpp', hpp: 'cpp', py: 'python', json: 'json', arpy: 'json', mjs: 'javascript', cjs: 'javascript', htm: 'html', ejs: 'html', php: 'php', java: 'java', sql: 'sql', ts: 'typescript', md: 'markdown', js: 'javascript', html: 'html', css: 'css', xml: 'xml', yaml: 'yaml', yml: 'yaml', ini: 'ini', toml: 'ini' }[ext] || 'plaintext';
};
