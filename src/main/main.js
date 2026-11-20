const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const project = require('./project');
const arduino = require('./arduino');
const python = require('./python');
const serial = require('./serial');
const ai = require('./ai');
const tools = require('./tools');
const sim = require('./sim');

let win = null;
let root = null; // carpeta del proyecto abierto
let watcher = null;

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

const logTo = (channel) => (text, stream) => send('log', { channel, text, stream });

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 920,
    minWidth: 1000,
    minHeight: 640,
    backgroundColor: '#0d1117',
    title: 'ARPY Copiler',
    icon: path.join(__dirname, '..', 'renderer', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
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
h('settings:get', () => ({ ...settings.load(), builtinKey: settings.hasBuiltinKey() }));
h('settings:set', (patch) => settings.save(patch));
h('status', () => ({ arduino: arduino.status(), python: python.status(root, root ? project.readConfig(root) : null), git: tools.gitAvailable() }));
h('open-external', (url) => shell.openExternal(url));

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
  const r = await dialog.showOpenDialog(win, { title: 'Carpeta donde guardar el proyecto nuevo', defaultPath: current || defaultFolder(), properties: ['openDirectory', 'createDirectory'] });
  if (r.canceled) return null;
  settings.save({ projectsFolder: r.filePaths[0] });
  return r.filePaths[0];
});
h('project:create', async ({ name, template, board, parent }) => {
  const dir = parent || settings.load().projectsFolder || defaultFolder();
  fs.mkdirSync(dir, { recursive: true });
  return openProject(project.create(dir, name, template, board));
});
h('project:open-dialog', async () => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Abrir proyecto ARPY',
    defaultPath: settings.load().projectsFolder || defaultFolder(),
    filters: [{ name: 'Proyecto ARPY', extensions: ['arpy'] }],
    properties: ['openFile'],
  });
  if (r.canceled) return null;
  return openProject(projectRoot(r.filePaths[0]));
});
h('project:import-dialog', async () => {
  const r = await dialog.showOpenDialog(win, { title: 'Importar carpeta (sketch de Arduino IDE o scripts Python)', properties: ['openDirectory'] });
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
h('project:launch-file', () => { const f = launchFile; launchFile = null; return f; });
h('project:close', () => {
  root = null;
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
h('python:stop', () => python.stop());
h('python:stdin', (text) => python.write(text));
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
h('serial:open', (p, baud) => serial.open(p, baud, (d) => send('serial:data', d), () => send('serial:closed')));
h('serial:close', () => serial.close());
h('serial:write', (t) => serial.write(t));
h('serial:info', () => serial.info());

// ---- Simulador ----
h('sim:start', () => {
  const cfg = project.readConfig(need());
  return sim.start(root, path.join(root, cfg.sketch || 'sketch'), logTo('build'), (s) => send('sim:state', s));
});
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
h('ai:load', () => ({ chats: project.listChats(need()), memory: project.loadMemory(need()) }));
h('ai:load-chat', (id) => project.loadChat(need(), id));
h('ai:save-chat', (id, messages, title) => project.saveChat(need(), id, messages, title));
h('ai:delete-chat', (id) => project.deleteChat(need(), id));
h('ai:image-save', (dataUrl) => project.saveImage(need(), dataUrl));
h('ai:image-read', (name) => { const i = project.readImage(need(), name); return `data:${i.mime};base64,${i.data}`; });
h('ai:memory', (text) => project.saveMemory(need(), text));
h('ai:models', () => ai.listModels());
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
if (!app.requestSingleInstanceLock()) app.quit();
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
    win.webContents.on('console-message', (e) => { if (e.message === 'ARPY_SHOT') shot(); });
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
