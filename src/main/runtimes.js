// Entornos para ejecutar Java y PHP: se usan los del sistema o se instalan con un clic
// en la carpeta de datos de la app (sin permisos de administrador). Node.js y SQLite vienen con la app.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { app } = require('electron');
const proc = require('./proc');

const DOWNLOADS = {
  java: { url: 'https://api.adoptium.net/v3/binary/latest/21/ga/windows/x64/jdk/hotspot/normal/eclipse', size: '≈ 200 MB', exe: 'java.exe', label: 'Java (JDK 21 de Eclipse Temurin)' },
  php: { url: 'https://windows.php.net/downloads/releases/latest/php-8.4-nts-Win32-vs17-x64-latest.zip', size: '≈ 35 MB', exe: 'php.exe', label: 'PHP 8.4' },
};

const dir = (name) => path.join(app.getPath('userData'), 'runtimes', name);
const cache = {};

// Busca el ejecutable dentro de la carpeta instalada (el zip trae una subcarpeta con versión).
function findIn(base, exe) {
  if (!fs.existsSync(base)) return null;
  const stack = [base];
  for (let depth = 0; stack.length && depth < 4000; depth++) {
    const d = stack.shift();
    let entries = [];
    try { entries = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isFile() && e.name.toLowerCase() === exe) return full;
      if (e.isDirectory() && full.split(path.sep).length - base.split(path.sep).length < 3) stack.push(full);
    }
  }
  return null;
}

function locate(name) {
  if (cache[name]) return cache[name];
  const def = DOWNLOADS[name];
  const local = findIn(dir(name), def.exe);
  if (local) return (cache[name] = { cmd: local, source: 'app' });
  const cmd = name === 'java' ? 'java' : 'php';
  const v = proc.works(cmd, name === 'java' ? ['-version'] : ['-v']);
  if (v) return (cache[name] = { cmd, source: 'system' });
  return null;
}

function status() {
  const out = {};
  for (const name of Object.keys(DOWNLOADS)) {
    const r = locate(name);
    out[name] = r ? { installed: true, cmd: r.cmd, source: r.source } : { installed: false, size: DOWNLOADS[name].size, label: DOWNLOADS[name].label };
  }
  out.node = { installed: true, version: process.versions.node, source: 'app' };
  out.sqlite = { installed: true, source: 'app' };
  return out;
}

async function install(name, onData) {
  const def = DOWNLOADS[name];
  if (!def) throw new Error('Entorno desconocido');
  if (process.platform !== 'win32') throw new Error(`Instala ${def.label} con el gestor de paquetes de tu sistema.`);
  const target = dir(name);
  const zip = path.join(os.tmpdir(), `arpy-${name}.zip`);
  onData(`Descargando ${def.label} (${def.size})…\n`, 'info');
  const res = await fetch(def.url, { headers: { 'User-Agent': 'ARPY-Copiler' } });
  if (!res.ok) throw new Error(`Descarga fallida (${res.status})`);
  const total = +res.headers.get('content-length') || 0;
  const out = fs.createWriteStream(zip);
  let got = 0, lastPct = -10;
  for await (const chunk of res.body) {
    out.write(chunk);
    got += chunk.length;
    const pct = total ? Math.floor((got / total) * 100) : 0;
    if (pct >= lastPct + 10) { lastPct = pct; onData(`  ${pct}%\n`, 'info'); }
  }
  await new Promise((r) => out.end(r));
  onData('Extrayendo…\n', 'info');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
  let r = fs.existsSync(sysTar) ? await proc.run(sysTar, ['-xf', zip, '-C', target], { onData }).promise : { code: 1 };
  if (r.code !== 0) {
    r = await proc.run('powershell.exe', ['-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zip.replace(/'/g, "''")}' -DestinationPath '${target.replace(/'/g, "''")}' -Force`], { onData }).promise;
  }
  fs.rmSync(zip, { force: true });
  delete cache[name];
  const found = locate(name);
  if (!found || found.source !== 'app') throw new Error(`No se pudo instalar ${def.label}.`);
  if (name === 'php') {
    // configuración mínima: extensiones habituales (sqlite, mbstring) activadas
    const phpDir = path.dirname(found.cmd);
    const ini = path.join(phpDir, 'php.ini');
    if (!fs.existsSync(ini) && fs.existsSync(path.join(phpDir, 'php.ini-development'))) {
      let txt = fs.readFileSync(path.join(phpDir, 'php.ini-development'), 'utf8');
      txt = txt.replace(/^;\s*extension_dir = "ext"/m, 'extension_dir = "ext"');
      for (const ext of ['mbstring', 'pdo_sqlite', 'sqlite3', 'openssl', 'curl', 'fileinfo']) txt = txt.replace(new RegExp(`^;extension=${ext}\\b`, 'm'), `extension=${ext}`);
      fs.writeFileSync(ini, txt);
    }
  }
  onData(`✔ ${def.label} listo.\n`, 'info');
  return status();
}

module.exports = { status, install, locate, DOWNLOADS };
