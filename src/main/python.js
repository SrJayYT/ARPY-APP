const fs = require('fs');
const path = require('path');
const settings = require('./settings');
const proc = require('./proc');

let cached = null;
const isWin = process.platform === 'win32';

// Intérprete base del sistema: { cmd, pre } (ej. "py -3" en Windows).
function baseInterpreter() {
  const s = settings.load();
  if (s.pythonPath) return { cmd: s.pythonPath, pre: [] };
  if (cached) return cached;
  const candidates = isWin
    ? [{ cmd: 'py', pre: ['-3'] }, { cmd: 'python', pre: [] }, { cmd: 'python3', pre: [] }]
    : [{ cmd: 'python3', pre: [] }, { cmd: 'python', pre: [] }];
  if (isWin) candidates.push(...knownWinPaths());
  for (const c of candidates) {
    const v = proc.works(c.cmd, [...c.pre, '--version']);
    if (v && /Python 3/.test(v)) { cached = c; return c; }
  }
  return null;
}

// Rutas típicas de Python en Windows (por si recién se instaló y el PATH aún no se actualizó).
function knownWinPaths() {
  const out = [];
  const roots = [path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Python'), process.env.ProgramFiles || 'C:/Program Files'];
  for (const r of roots) {
    try {
      for (const d of fs.readdirSync(r).filter((n) => /^Python3\d+$/i.test(n)).sort().reverse()) {
        const exe = path.join(r, d, 'python.exe');
        if (fs.existsSync(exe)) out.push({ cmd: exe, pre: [] });
      }
    } catch {}
  }
  return out;
}

// Descarga e instala Python oficial (solo para el usuario, sin pedir permisos de administrador).
const PY_URL = 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe';
async function installPython(onData) {
  if (!isWin) throw new Error('Instala Python 3 con el gestor de paquetes de tu sistema.');
  const os = require('os');
  const file = path.join(os.tmpdir(), 'arpy-python-setup.exe');
  onData('Descargando Python 3.12 (unos 25 MB)…\n', 'info');
  const res = await fetch(PY_URL);
  if (!res.ok) throw new Error(`Descarga fallida (${res.status})`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  onData('Instalando Python… (1–2 minutos)\n', 'info');
  const r = await proc.run(file, ['/quiet', 'InstallAllUsers=0', 'PrependPath=1', 'Include_launcher=1', 'InstallLauncherAllUsers=0', 'Include_test=0', 'Include_doc=0'], { onData }).promise;
  try { fs.rmSync(file, { force: true }); } catch {}
  cached = null;
  if (r.code !== 0 || !baseInterpreter()) throw new Error('No se pudo instalar Python (código ' + r.code + ').');
  onData('✔ Python instalado.\n', 'info');
  return true;
}

function venvPython(root) {
  return path.join(root, '.venv', isWin ? 'Scripts' : 'bin', isWin ? 'python.exe' : 'python');
}

function useVenv(root, cfg) {
  return root && (!cfg || cfg.venv !== false);
}

// Intérprete para un proyecto: su .venv si existe, si no el del sistema.
function interpreter(root, cfg) {
  if (useVenv(root, cfg) && fs.existsSync(venvPython(root))) return { cmd: venvPython(root), pre: [], venv: true };
  return baseInterpreter();
}

function status(root, cfg) {
  cached = null;
  const b = baseInterpreter();
  if (!b) return { installed: false };
  const i = interpreter(root, cfg);
  return {
    installed: true,
    cmd: [b.cmd, ...b.pre].join(' '),
    version: proc.works(b.cmd, [...b.pre, '--version']),
    venv: !!(i && i.venv),
  };
}

// Crea .venv e instala requirements la primera vez.
async function ensureVenv(root, cfg, onData) {
  if (!useVenv(root, cfg) || fs.existsSync(venvPython(root))) return true;
  const b = baseInterpreter();
  if (!b) return false;
  onData('🧪 Creando entorno virtual del proyecto (.venv)… solo la primera vez.\n', 'info');
  const r = await proc.run(b.cmd, [...b.pre, '-m', 'venv', path.join(root, '.venv')], { onData }).promise;
  if (r.code !== 0) { onData('No se pudo crear el entorno virtual; se usará el Python del sistema.\n', 'stderr'); return false; }
  const req = path.join(root, 'python', 'requirements.txt');
  if (fs.existsSync(req) && fs.readFileSync(req, 'utf8').trim()) {
    onData('📦 Instalando python/requirements.txt…\n', 'info');
    await proc.run(venvPython(root), ['-m', 'pip', 'install', '--disable-pip-version-check', '-r', req], { onData }).promise;
  }
  return true;
}

let current = null;

// opts: { root, cfg, debug: { breakpoints: [{ file, line }] } }
async function start(file, cwd, env, onData, onExit, opts = {}) {
  stop();
  await ensureVenv(opts.root, opts.cfg, onData);
  const i = interpreter(opts.root, opts.cfg);
  if (!i) {
    onData('No se encontró Python 3. Instálalo desde python.org o indica la ruta en Configuración.\n', 'stderr');
    onExit(-1);
    return false;
  }
  let args = [...i.pre, '-u', file];
  if (opts.debug) {
    const bps = opts.debug.breakpoints || [];
    onData(`🐞 Depurando con pdb. ${bps.length} punto(s) de parada. Comandos: n (siguiente), s (entrar), c (continuar), p variable, pp locals(), q (salir)\n`, 'info');
    args = [...i.pre, '-u', '-m', 'pdb', ...bps.flatMap((b) => ['-c', `b ${b.file}:${b.line}`]), '-c', bps.length ? 'c' : 'l', file];
  }
  // En depuración, pdb reinicia el programa al terminar: salimos automáticamente.
  const handle = opts.debug
    ? (text, stream) => {
      onData(text, stream);
      if (/The program finished and will be restarted/.test(text)) { write('q\n'); onData('■ Fin de la depuración\n', 'info'); }
    }
    : onData;
  const r = proc.run(i.cmd, args, {
    cwd,
    env: { PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...env },
    onData: handle,
  });
  current = r;
  r.promise.then(({ code }) => {
    if (current === r) current = null;
    onExit(code);
  });
  return true;
}

// Ejecuta en un equipo remoto por SSH (Arduino UNO Q, Raspberry Pi…). Requiere acceso por clave SSH.
async function startRemote(root, host, env, onData, onExit) {
  stop();
  const name = path.basename(root).replace(/[^\w.-]/g, '_');
  const remoteDir = `arpy/${name}`;
  const ssh = ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=8', '-o', 'StrictHostKeyChecking=accept-new'];
  onData(`🌐 Copiando python/ a ${host}:~/${remoteDir}…\n`, 'info');
  let r = await proc.run('ssh', [...ssh, host, `mkdir -p ~/${remoteDir}`], { onData }).promise;
  if (r.code !== 0) {
    onData('No se pudo conectar por SSH. Configura acceso por clave (ssh-keygen + ssh-copy-id) y verifica la IP.\n', 'stderr');
    onExit(r.code);
    return false;
  }
  r = await proc.run('scp', [...ssh, '-r', path.join(root, 'python'), `${host}:${remoteDir}/`], { onData }).promise;
  if (r.code !== 0) { onExit(r.code); return false; }
  const exports = Object.entries(env).map(([k, v]) => `${k}='${String(v).replace(/'/g, '')}'`).join(' ');
  const cmd = `cd ~/${remoteDir}/python && (test -f requirements.txt && python3 -m pip install -q --user -r requirements.txt 2>/dev/null; true) && env ${exports} PYTHONUNBUFFERED=1 python3 -u main.py`;
  onData(`▶ ${host}: python3 main.py\n`, 'info');
  const run = proc.run('ssh', [...ssh, '-tt', host, cmd], { onData });
  current = run;
  run.promise.then(({ code }) => { if (current === run) current = null; onExit(code); });
  return true;
}

function write(text) {
  const child = current && current.child;
  if (child && child.stdin && !child.stdin.destroyed) child.stdin.write(text);
}

function stop() {
  if (current) {
    proc.killTree(current.child);
    current = null;
  }
}

function running() {
  return !!current;
}

async function pipInstall(root, cfg, pkg, onData) {
  await ensureVenv(root, cfg, onData);
  const i = interpreter(root, cfg);
  if (!i) return { code: -1 };
  const args = Array.isArray(pkg) ? pkg : pkg.split(/\s+/).filter(Boolean);
  onData(`\n📦 pip install ${args.join(' ')}${i.venv ? ' (en .venv del proyecto)' : ''}\n`);
  return proc.run(i.cmd, [...i.pre, '-m', 'pip', 'install', '--disable-pip-version-check', ...args], { onData }).promise;
}

async function createVenv(root, cfg, onData) {
  if (fs.existsSync(venvPython(root))) { onData('El entorno virtual ya existe.\n'); return true; }
  return ensureVenv(root, { ...cfg, venv: true }, onData);
}

// Revisa la sintaxis de archivos .py sin ejecutarlos.
async function check(root, cfg, files) {
  const i = interpreter(root, cfg);
  if (!i || !files.length) return { code: 0, output: '' };
  const code = 'import sys,py_compile\nok=True\nfor f in sys.argv[1:]:\n  try: py_compile.compile(f, doraise=True)\n  except py_compile.PyCompileError as e: ok=False; print(e.msg)\nsys.exit(0 if ok else 1)';
  return proc.run(i.cmd, [...i.pre, '-c', code, ...files.map((f) => path.join(root, f))], { cwd: root }).promise;
}

// Empaqueta un script como .exe con PyInstaller (en dist/ del proyecto).
async function buildExe(root, cfg, file, windowed, onData) {
  await ensureVenv(root, cfg, onData);
  const i = interpreter(root, cfg);
  if (!i) return { code: -1 };
  onData('📦 Preparando PyInstaller…\n', 'info');
  let r = await proc.run(i.cmd, [...i.pre, '-m', 'pip', 'install', '-q', '--disable-pip-version-check', 'pyinstaller'], { onData }).promise;
  if (r.code !== 0) return r;
  const work = path.join(root, '.arpy', 'pybuild');
  const name = (cfg && cfg.name ? cfg.name : path.basename(file, '.py')).replace(/[^\w.-]/g, '_');
  onData(`🔨 Generando ${name}${isWin ? '.exe' : ''}…\n`, 'info');
  r = await proc.run(i.cmd, [...i.pre, '-m', 'PyInstaller', '--onefile', '--noconfirm', '--clean',
    ...(windowed ? ['--windowed'] : []), '--name', name,
    '--distpath', path.join(root, 'dist'), '--workpath', work, '--specpath', work,
    path.join(root, file)], { cwd: root, onData }).promise;
  return { ...r, out: path.join(root, 'dist', name + (isWin ? '.exe' : '')) };
}

module.exports = { installPython, status, start, startRemote, write, stop, running, pipInstall, createVenv, check, buildExe, venvPython };
