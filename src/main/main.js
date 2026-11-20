const { app, BrowserWindow, ipcMain, dialog, shell, Menu, net } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const settings = require('./settings');
const project = require('./project');
const arduino = require('./arduino');
const python = require('./python');
const serial = require('./serial');
const ai = require('./ai');
const tools = require('./tools');
const sim = require('./sim');
const drivers = require('./drivers');
const updater = require('./updater');
const share = require('./share');
const examples = require('./examples');
const runners = require('./runners');
const runtimes = require('./runtimes');
const preview = require('./preview');
const TECHS = require('../shared/techs');
const I18N_EN = require('../shared/i18n-en');
const L = (s) => ((settings.load().lang || 'en') === 'en' && I18N_EN.exact[s]) || s;

let win = null;
let root = null; // carpeta del proyecto abierto
let watcher = null;

// Equipos modestos (≤ 8 GB de RAM o ≤ 4 núcleos): la interfaz usa el "modo ligero" por defecto.
const LOW_END = os.totalmem() <= 8.6 * 1024 ** 3 || os.cpus().length <= 4;
// Pruebas automáticas en desarrollo: carpeta de datos propia para no chocar con la app instalada.
const TEST_RUN = !app.isPackaged && !!process.env.ARPY_SCREENSHOT;
if (!app.isPackaged && process.env.ARPY_USERDATA) app.setPath('userData', process.env.ARPY_USERDATA);
if (TEST_RUN) { app.commandLine.appendSwitch('disable-renderer-backgrounding'); app.commandLine.appendSwitch('disable-backgrounding-occluded-windows'); }
const PERF_MODE = (() => { try { return settings.load().perfMode || 'auto'; } catch { return 'auto'; } })();
const LITE = PERF_MODE === 'lite' || (PERF_MODE !== 'full' && LOW_END);
// En modo ligero se dibuja sin GPU: el proceso de GPU pasa de ~350 MB a ~90 MB de RAM.
// (En laptops con gráficos integrados esa memoria sale de la RAM del sistema.)
if (LITE) {
  app.disableHardwareAcceleration();
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-software-rasterizer'); // no se usa WebGL: no cargar SwiftShader
}
// Menos procesos en segundo plano de Chromium = menos RAM.
app.commandLine.appendSwitch('disable-features', 'SpareRendererForSitePerProcess,MediaRouter,DialMediaRouteProvider,HardwareMediaKeyHandling');

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

const logTo = (channel) => (text, stream) => send('log', { channel, text, stream });

function createWindow() {
  win = new BrowserWindow({
    width: TEST_RUN && process.env.ARPY_SIZE ? +process.env.ARPY_SIZE.split("x")[0] : 1500,
    height: TEST_RUN && process.env.ARPY_SIZE ? +process.env.ARPY_SIZE.split("x")[1] : 920,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0b0f14',
    show: false,
    title: 'ARPY Copiler',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: !TEST_RUN, // en pruebas se sigue pintando aunque la ventana esté tapada
    },
  });
  win.once('ready-to-show', () => win.show());
  // Al cerrar la ventana: primero se guarda la conversación pendiente (máx. 2 s).
  let closing = false;
  win.on('close', (e) => {
    if (closing) return;
    e.preventDefault();
    closing = true;
    const flush = win.webContents.executeJavaScript(SAVE_ALL_JS, true).catch(() => true);
    Promise.race([flush, new Promise((r) => setTimeout(r, 2000))]).finally(() => { if (!win.isDestroyed()) win.close(); });
  });
  // Windows se apaga o cierra sesión: guardar todo ya.
  win.on('session-end', () => { saveEverything(); });
  // Si la ventana se cuelga o su proceso muere, se intenta guardar y se recarga (los archivos ya se guardan solos).
  win.on('unresponsive', () => { saveEverything(); });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('GONE', JSON.stringify(d));
    if (d.reason !== 'clean-exit' && !closing && !win.isDestroyed()) setTimeout(() => { if (!win.isDestroyed()) win.reload(); }, 800);
  });
  Menu.setApplicationMenu(null);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type === 'keyDown' && input.key === 'F12') win.webContents.toggleDevTools();
  });
}

// Guarda archivos abiertos y la conversación del chat (si la ventana sigue viva).
const SAVE_ALL_JS = 'Promise.all([window.A && A.editor && A.editor.saveAll ? A.editor.saveAll().catch(() => 0) : 0, window.A && A.chat && A.chat.flush ? A.chat.flush().catch(() => 0) : 0]).then(() => true)';
function saveEverything() {
  if (!win || win.isDestroyed() || win.webContents.isCrashed()) return Promise.resolve();
  return Promise.race([win.webContents.executeJavaScript(SAVE_ALL_JS, true).catch(() => 0), new Promise((r) => setTimeout(r, 2000))]);
}
process.on('uncaughtException', (e) => {
  console.error('Error inesperado:', e);
  saveEverything();
});

function watch(dir) {
  if (watcher) { watcher.close(); watcher = null; }
  let t = null;
  try {
    watcher = fs.watch(dir, { recursive: true }, (_ev, file) => {
      if (file && /(^|[\\/])(\.arpy|\.git|__pycache__|build|dist|\.venv)([\\/]|$)/.test(file)) return;
      clearTimeout(t);
      t = setTimeout(() => send('fs:changed', file ? String(file).split(path.sep).join('/') : null), 250);
    });
  } catch {}
}

function openProject(dir) {
  if (!project.isProject(dir)) project.adopt(dir);
  preview.stopAll();
  root = dir;
  settings.addRecent(dir);
  watch(dir);
  win.setTitle(`${path.basename(dir)} — ARPY Copiler`);
  return { root: dir, config: project.readConfig(dir) };
}

function need() {
  if (!root) throw new Error('No hay proyecto abierto');
  return root;
}

const h = (name, fn) => ipcMain.handle(name, (_e, ...args) => fn(...args));

// ---- App / configuración ----
const withEnv = (s) => ({ ...s, appVersion: app.getVersion(), builtinKey: settings.hasBuiltinKey(), lowEnd: LOW_END, ramGB: Math.round(os.totalmem() / 1024 ** 3), cores: os.cpus().length });
h('settings:get', () => withEnv(settings.load()));
h('settings:set', (patch) => withEnv(settings.save(patch)));
h('status', () => ({ arduino: arduino.status(), python: python.status(root, root ? project.readConfig(root) : null), git: tools.gitAvailable() }));
h('open-external', (url) => shell.openExternal(url));
// ¿Hay internet? (para bloquear el chat de IA sin conexión)
h('app:online', async () => {
  if (!net.isOnline()) return false;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 6000);
  try { await fetch('https://generativelanguage.googleapis.com/', { method: 'HEAD', signal: ctl.signal }); return true; } catch { return false; } finally { clearTimeout(t); }
});

// ---- Proyecto ----
// Acepta la carpeta del proyecto o su archivo .arpy.
function projectRoot(p) {
  if (!p || !fs.existsSync(p)) throw new Error('El proyecto ya no existe en esa ubicación');
  return fs.statSync(p).isDirectory() ? p : path.dirname(p);
}
function defaultFolder() {
  return path.join(app.getPath('documents'), 'ARPY Proyectos');
}
h('project:default-folder', () => settings.load().projectsFolder || defaultFolder());
h('project:pick-folder', async (current) => {
  const r = await dialog.showOpenDialog(win, { title: L('Carpeta donde guardar el proyecto nuevo'), defaultPath: current || defaultFolder(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  settings.save({ projectsFolder: r.filePaths[0] });
  return r.filePaths[0];
});
h('project:create', async ({ name, template, board, parent, arduino = true, tech }) => {
  const dir = parent || settings.load().projectsFolder || defaultFolder();
  fs.mkdirSync(dir, { recursive: true });
  return openProject(project.create(dir, name, template, board, { arduino, tech }));
});
// Activar / desactivar tecnologías del proyecto abierto
h('project:techs', (tech) => project.setTechs(need(), tech));
h('project:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: L('Abrir proyecto ARPY'),
    defaultPath: settings.load().projectsFolder || defaultFolder(),
    filters: [{ name: L('Proyecto ARPY'), extensions: ['arpy'] }],
    properties: ['openFile'],
  });
  if (r.canceled) return null;
  return openProject(projectRoot(r.filePaths[0]));
});
h('project:import-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: L('Importar carpeta (sketch de Arduino IDE o scripts Python)'), properties: ['openDirectory'] });
  if (r.canceled) return null;
  return openProject(r.filePaths[0]);
});
h('project:open', (p) => openProject(projectRoot(p)));
h('project:recent', () => settings.load().recentProjects.map((d) => project.info(d)));
h('project:forget', (dir) => {
  const s = settings.load();
  settings.save({ recentProjects: s.recentProjects.filter((p) => p !== dir), lastProject: s.lastProject === dir ? '' : s.lastProject });
  return true;
});
h('project:export', async ({ withChats }) => {
  const r0 = need();
  const r = await dialog.showSaveDialog(win, { title: L('Exportar proyecto'), defaultPath: path.join(app.getPath('documents'), path.basename(r0) + '.zip'), filters: [{ name: L('Proyecto comprimido'), extensions: ['zip'] }] });
  if (r.canceled) return null;
  return share.exportZip(r0, r.filePath, !!withChats);
});
h('project:import-zip', async () => {
  const r = await dialog.showOpenDialog(win, { title: L('Importar proyecto (.zip)'), filters: [{ name: L('Proyecto comprimido'), extensions: ['zip'] }], properties: ['openFile'] });
  if (r.canceled) return null;
  const dest = share.importZip(r.filePaths[0], settings.load().projectsFolder || defaultFolder());
  return openProject(dest);
});
h('examples:list', () => examples.list());
h('examples:create', async ({ id, name, parent }) => {
  const dir = parent || settings.load().projectsFolder || defaultFolder();
  fs.mkdirSync(dir, { recursive: true });
  const { root: r, libs } = examples.create(id, dir, name);
  const res = openProject(r);
  // Librerías que necesita el ejemplo: se instalan en segundo plano.
  if (libs.length && arduino.status().installed) {
    (async () => { for (const l of libs) { try { await arduino.libInstall(l, logTo('build')); } catch {} } })();
  }
  return res;
});
h('project:launch-file', () => { const f = launchFile; launchFile = null; return f; });
h('project:close', () => {
  root = null;
  runners.stop();
  preview.stopAll();
  if (watcher) watcher.close();
  watcher = null;
  win.setTitle('ARPY Copiler');
});
h('project:config', (patch) => (patch ? project.writeConfig(need(), patch) : project.readConfig(need())));
h('project:reveal', () => shell.openPath(need()));

// ---- Archivos ----
h('fs:tree', () => project.tree(need()));
h('fs:read', (rel) => fs.readFileSync(project.resolveIn(need(), rel), 'utf8'));
h('fs:exists', (rel) => fs.existsSync(project.resolveIn(need(), rel)));
h('fs:write', (rel, content) => {
  const full = project.resolveIn(need(), rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return true;
});
h('fs:mkdir', (rel) => fs.mkdirSync(project.resolveIn(need(), rel), { recursive: true }));
h('fs:trash', (rel) => project.trash(need(), rel));
h('fs:untrash', (id) => project.untrash(need(), id));
h('fs:move', (from, to) => project.move(need(), from, to));
h('fs:rmdir-empty', (rel) => { const full = project.resolveIn(need(), rel); if (!project.isProtected(need(), rel) && fs.existsSync(full) && !fs.readdirSync(full).length) fs.rmdirSync(full); });
h('fs:rename', (from, to) => {
  const dest = project.resolveIn(need(), to);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(project.resolveIn(need(), from), dest);
});
h('fs:delete', (rel) => fs.rmSync(project.resolveIn(need(), rel), { recursive: true, force: true }));
h('fs:backup', (rel) => project.backup(need(), rel));
h('fs:restore', (id) => project.restore(need(), id));
h('fs:backup-read', (id) => project.readBackup(need(), id));

// ---- Arduino ----
h('arduino:install', () => arduino.install(logTo('build')));
// Asistente de primer uso: sube un "parpadeo" de prueba a la placa elegida.
h('arduino:test-blink', async ({ fqbn, port }) => {
  const dir = path.join(app.getPath('userData'), 'blink-test');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'blink-test.ino'), [
    '// Prueba de ARPY Copiler: el LED de la placa parpadea rápido 3 veces y luego cada segundo.',
    'void setup() {',
    '  pinMode(LED_BUILTIN, OUTPUT);',
    '  for (int i = 0; i < 6; i++) { digitalWrite(LED_BUILTIN, i % 2 == 0); delay(120); }',
    '}',
    'void loop() {',
    '  digitalWrite(LED_BUILTIN, HIGH);',
    '  delay(500);',
    '  digitalWrite(LED_BUILTIN, LOW);',
    '  delay(500);',
    '}',
    '',
  ].join('\n'));
  const log = logTo('build');
  const r = await arduino.upload(dir, fqbn, port, log);
  return { ok: r.code === 0, output: (r.output || '').slice(-3000) };
});
h('python:install', () => python.installPython(logTo('build')));
h('arduino:boards', () => arduino.boardList());
h('arduino:compile', () => {
  const cfg = project.readConfig(need());
  return arduino.compile(path.join(root, cfg.sketch || 'sketch'), cfg.board, logTo('build'));
});
h('arduino:upload', () => {
  const cfg = project.readConfig(need());
  if (!cfg.port) throw new Error('Selecciona un puerto primero');
  return arduino.upload(path.join(root, cfg.sketch || 'sketch'), cfg.board, cfg.port, logTo('build'));
});
h('arduino:lib-search', (q) => arduino.libSearch(q));
h('arduino:lib-install', (name) => arduino.libInstall(name, logTo('build')));
h('arduino:lib-list', () => arduino.libList());

// ---- Gestor de placas ----
h('arduino:cores', () => arduino.coreList());
h('arduino:core-install', (id) => arduino.coreInstall(id, logTo('build')));
h('arduino:core-uninstall', (id) => arduino.coreUninstall(id, logTo('build')));

// ---- Python ----
function pyEnv(cfg) {
  return { ARPY_PORT: cfg.port || '', ARPY_BAUD: String(cfg.baud || 9600), ARPY_BOARD: cfg.board || '' };
}
// opts: { file, debug: { breakpoints }, remote: bool }
h('python:run', (opts = {}) => {
  if (typeof opts === 'string') opts = { file: opts };
  const cfg = project.readConfig(need());
  const exit = (code) => send('python:exit', code);
  if (opts.remote) {
    if (!cfg.remoteHost) throw new Error('Configura el equipo remoto (usuario@ip) en el panel Python');
    return python.startRemote(root, cfg.remoteHost, pyEnv(cfg), logTo('python'), exit);
  }
  const rel = opts.file || cfg.pythonMain || 'python/main.py';
  const full = project.resolveIn(root, rel);
  if (!fs.existsSync(full)) throw new Error(`No existe ${rel}`);
  send('log', { channel: 'python', text: `\n▶ python ${rel}${opts.debug ? ' (depuración)' : ''}\n`, stream: 'info' });
  const debug = opts.debug ? { breakpoints: (opts.debug.breakpoints || []).map((b) => ({ file: project.resolveIn(root, b.file), line: b.line })) } : null;
  return python.start(full, path.dirname(full), pyEnv(cfg), logTo('python'), exit, { root, cfg, debug });
});
h('python:stop', () => { python.stop(); runners.stop(); });
h('python:stdin', (text) => { python.write(text); runners.write(text); });

// ---- Ejecutar cualquier archivo: JavaScript, Java, PHP, SQL (Python usa python:run) ----
h('run:file', (rel) => {
  const r = need();
  const kind = TECHS.runnerFor(rel);
  if (!kind) throw new Error('Este tipo de archivo no se puede ejecutar');
  if (kind === 'python' || kind === 'preview') return { kind };
  const full = project.resolveIn(r, rel);
  if (!fs.existsSync(full)) throw new Error(`No existe ${rel}`);
  python.stop();
  const cfg = project.readConfig(r) || {};
  const res = runners.start(kind, full, r, pyEnv(cfg), logTo('python'), (code) => send('python:exit', code));
  return { kind, ...res };
});
h('runtimes:status', () => runtimes.status());
h('runtimes:install', (name) => runtimes.install(name, logTo('python')));
h('preview:url', (rel) => preview.urlFor(need(), rel, logTo('python')));
h('python:pip', (pkg) => python.pipInstall(need(), project.readConfig(root), pkg, logTo('python')));
h('python:requirements', async () => {
  const req = project.resolveIn(need(), 'python/requirements.txt');
  if (!fs.existsSync(req)) return { code: 0 };
  return python.pipInstall(root, project.readConfig(root), ['-r', req], logTo('python'));
});
h('python:venv', () => python.createVenv(need(), project.readConfig(root), logTo('python')));
h('python:check', (files) => python.check(need(), project.readConfig(root), files));
h('python:build-exe', async (windowed) => {
  const cfg = project.readConfig(need());
  const r = await python.buildExe(root, cfg, cfg.pythonMain || 'python/main.py', windowed, logTo('python'));
  if (r.code === 0) shell.showItemInFolder(r.out);
  return r;
});
h('python:status', () => python.status(root, root ? project.readConfig(root) : null));

// ---- Serie ----
h('serial:list', () => serial.list());
h('drivers:diagnose', () => drivers.diagnose());
h('update:check', async () => ({ ...(await updater.check()), private: settings.hasBuiltinKey() }));
h('update:install', () => { if (settings.hasBuiltinKey()) throw new Error('Esta copia es privada: pide la versión nueva a quien te la compartió.'); return updater.install(logTo('build')); });
h('drivers:install-ch340', () => drivers.installCH340(logTo('build'), (f) => shell.openPath(f)));
h('serial:open', (p, baud) => serial.open(p, baud, (path, text) => send('serial:data', { path, text }), (path) => send('serial:closed', { path })));
h('serial:close', (p) => serial.close(p));
h('serial:write', (p, t) => serial.write(p, t));
h('serial:info', () => serial.info());

// ---- Simulador ----
h('sim:start', () => {
  const cfg = project.readConfig(need());
  return sim.start(root, path.join(root, cfg.sketch || 'sketch'), logTo('build'), (s) => send('sim:state', s), cfg.board || '');
});
// Conexiones del proyecto (editor visual): .arpy/wiring.json
h('wiring:load', () => project.loadWiring(need()));
h('wiring:save', (w) => project.saveWiring(need(), w));
h('ui:list', () => project.listUI(need()));
h('ui:load', (file) => project.loadUI(need(), file));
h('ui:save', (d) => project.saveUI(need(), d));
h('sim:stop', () => sim.stop());
h('sim:input', (msg) => sim.send(msg));

// ---- Búsqueda / historial / diálogos ----
h('search:find', (q, opts) => tools.search(need(), q, opts));
h('search:replace', (q, rep, opts) => tools.replaceAll(need(), q, rep, opts));
h('git:commit', (msg) => tools.commit(need(), msg));
h('git:log', () => tools.log(need()));
h('git:pending', () => tools.pending(need()));
h('git:restore', (hash) => tools.restore(need(), hash));
h('git:show', (hash, file) => tools.showFile(need(), hash, file));
h('git:files', (hash) => tools.changedFiles(need(), hash));
h('dialog:save-text', async (name, content) => {
  const r = await dialog.showSaveDialog(win, { defaultPath: path.join(root || app.getPath('documents'), name) });
  if (r.canceled) return null;
  fs.writeFileSync(r.filePath, content);
  return r.filePath;
});

// ---- IA ----
// Las conversaciones se guardan SIEMPRE en el proyecto al que pertenecen (r), aunque mientras tanto
// se haya cerrado o cambiado de proyecto. Cada proyecto tiene sus propias conversaciones en .arpy/chats.
function chatRoot(r) {
  if (r && typeof r === 'string' && fs.existsSync(r) && project.isProject(r)) return r;
  return need();
}
h('ai:load', (r) => { const pr = chatRoot(r); return { chats: project.listChats(pr), active: project.getActiveChat(pr), memory: project.loadMemory(pr) }; });
h('ai:load-chat', (id, r) => project.loadChat(chatRoot(r), id));
h('ai:save-chat', (id, messages, title, r) => project.saveChat(chatRoot(r), id, messages, title));
h('ai:delete-chat', (id, r) => project.deleteChat(chatRoot(r), id));
h('ai:set-active', (id, r) => project.setActiveChat(chatRoot(r), id));
h('ai:image-save', (dataUrl) => project.saveImage(need(), dataUrl));
h('ai:image-read', (name) => { const i = project.readImage(need(), name); return `data:${i.mime};base64,${i.data}`; });
h('ai:memory', (text, r) => project.saveMemory(chatRoot(r), text));
h('ai:models', () => ai.listModels());
h('ai:providers', () => ai.providerList());
h('ai:verify-all', () => ai.verifyKeys());
h('ai:verify', (pid, key) => ai.verifyKey(pid, key));
h('ai:usage', () => ai.usage());
h('ai:complete', (args) => ai.complete(args));
h('ai:stop', () => ai.stop());
h('ai:chat', async ({ reqId, history, live, model }) => {
  try {
    const r = await ai.chat({ root: need(), history, live, model }, (t) => send('ai:chunk', { reqId, text: t }), (st) => send('ai:status', { reqId, text: st }));
    return { ok: true, ...r };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: err.message };
  }
});

// Archivo .arpy con el que se abrió la app (doble clic en el Explorador de Windows).
const arpyArg = (argv) => argv.slice(1).find((x) => /\.arpy$/i.test(x) && fs.existsSync(x)) || null;
let launchFile = arpyArg(process.argv);
if (!TEST_RUN && !app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', (_e, argv) => {
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
  const f = arpyArg(argv);
  if (f) send('app:open-file', f);
});

app.whenReady().then(() => {
  if (!app.isPackaged && process.env.ARPY_OPEN) launchFile = process.env.ARPY_OPEN;
  createWindow();
  // Modo de prueba: ARPY_SCREENSHOT=ruta.png captura la ventana y cierra.
  if (!app.isPackaged && process.env.ARPY_SCREENSHOT) {
    win.webContents.on('console-message', (e) => console.log('[renderer]', e.message));
    win.webContents.on('render-process-gone', (_e, d) => console.log('GONE', JSON.stringify(d)));
    win.webContents.on('did-start-navigation', (e) => console.log('NAV', e.url));
    const shot = async () => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(process.env.ARPY_SCREENSHOT, img.toPNG());
      app.quit();
    };
    win.webContents.on('console-message', (e) => {
      if (e.message === 'ARPY_SHOT') shot();
      // ARPY_SHOT:nombre → captura intermedia sin cerrar (ruta.png → ruta-nombre.png)
      const m = /^ARPY_SHOT:([\w-]+)$/.exec(e.message);
      if (m) win.webContents.capturePage().then((img) => fs.writeFileSync(process.env.ARPY_SCREENSHOT.replace(/\.png$/i, `-${m[1]}.png`), img.toPNG()));
    });
    if (process.env.ARPY_EVAL) setTimeout(() => win.webContents.executeJavaScript(process.env.ARPY_EVAL).catch((e) => console.log('eval error', e)), 4000);
    else setTimeout(shot, Number(process.env.ARPY_SCREENSHOT_DELAY || 6000));
  }
});
app.on('window-all-closed', () => {
  python.stop();
  sim.stop();
  serial.close();
  app.quit();
});
