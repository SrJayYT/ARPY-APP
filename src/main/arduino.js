const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const settings = require('./settings');
const proc = require('./proc');
const { coreOf } = require('../shared/boards');

const exe = process.platform === 'win32' ? 'arduino-cli.exe' : 'arduino-cli';

function bundledPath() {
  return path.join(app.getPath('userData'), 'bin', exe);
}

let resolved = null;
function cliPath() {
  const s = settings.load();
  if (s.arduinoCliPath && fs.existsSync(s.arduinoCliPath)) return s.arduinoCliPath;
  if (fs.existsSync(bundledPath())) return bundledPath();
  if (resolved === null) resolved = proc.works('arduino-cli', ['version']) ? 'arduino-cli' : '';
  return resolved || null;
}

function status() {
  const p = cliPath();
  if (!p) return { installed: false };
  const v = proc.works(p, ['version']);
  return { installed: !!v, path: p, version: v };
}

// Descarga arduino-cli oficial y lo deja en la carpeta de datos de la app.
async function install(onData) {
  const plat = process.platform === 'win32' ? 'Windows_64bit.zip'
    : process.platform === 'darwin' ? (process.arch === 'arm64' ? 'macOS_ARM64.tar.gz' : 'macOS_64bit.tar.gz')
    : (process.arch === 'arm64' ? 'Linux_ARM64.tar.gz' : 'Linux_64bit.tar.gz');
  const url = `https://downloads.arduino.cc/arduino-cli/arduino-cli_latest_${plat}`;
  const binDir = path.dirname(bundledPath());
  fs.mkdirSync(binDir, { recursive: true });
  const archive = path.join(binDir, path.basename(url));
  onData(`Descargando ${url}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Descarga fallida (${res.status})`);
  fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
  onData('Extrayendo...\n');
  let r;
  if (process.platform === 'win32') {
    const sysTar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    r = fs.existsSync(sysTar) ? await proc.run(sysTar, ['-xf', archive, '-C', binDir], { onData }).promise : { code: 1 };
    if (r.code !== 0) {
      r = await proc.run('powershell.exe', ['-NoProfile', '-Command',
        `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${binDir.replace(/'/g, "''")}' -Force`], { onData }).promise;
    }
  } else {
    r = await proc.run('tar', ['-xzf', archive, '-C', binDir], { onData }).promise;
  }
  fs.rmSync(archive, { force: true });
  if (r.code !== 0 || !fs.existsSync(bundledPath())) throw new Error('No se pudo extraer arduino-cli');
  resolved = null;
  onData('Actualizando índice de placas...\n');
  await cli(['core', 'update-index'], onData);
  onData('arduino-cli instalado correctamente.\n');
  return status();
}

function cli(args, onData) {
  const p = cliPath();
  if (!p) {
    const msg = 'arduino-cli no está instalado. Ve a Configuración → "Instalar arduino-cli".\n';
    onData && onData(msg, 'stderr');
    return Promise.resolve({ code: -1, output: msg });
  }
  return proc.run(p, args, { onData }).promise;
}

async function cliJson(args) {
  const r = await cli([...args, '--format', 'json']);
  try { return JSON.parse(r.output); } catch { return null; }
}

async function installedCores() {
  const data = await cliJson(['core', 'list']);
  const list = Array.isArray(data) ? data : (data && data.platforms) || [];
  return list.map((p) => p.id || p.ID).filter(Boolean);
}

// Instala el core de la placa si hace falta (ej. arduino:renesas_uno para UNO R4).
async function ensureCore(fqbn, onData) {
  const core = coreOf(fqbn);
  const cores = await installedCores();
  if (cores.includes(core)) return true;
  onData(`\n⏬ Instalando soporte para la placa (${core}). Solo ocurre la primera vez...\n`);
  await cli(['core', 'update-index'], onData);
  const r = await cli(['core', 'install', core], onData);
  return r.code === 0;
}

async function compile(sketchDir, fqbn, onData) {
  if (!(await ensureCore(fqbn, onData))) return { code: 1, output: 'No se pudo instalar el core.' };
  onData(`\n▶ Compilando para ${fqbn}...\n`);
  return cli(['compile', '--fqbn', fqbn, '--warnings', 'default', sketchDir], onData);
}

async function compileTo(sketchDir, fqbn, outDir, onData) {
  if (!(await ensureCore(fqbn, onData))) return { code: 1 };
  return cli(['compile', '--fqbn', fqbn, '--output-dir', outDir, sketchDir], onData);
}

async function upload(sketchDir, fqbn, port, onData) {
  const c = await compile(sketchDir, fqbn, onData);
  if (c.code !== 0) return c;
  // Puertos de red (placas WiFi con OTA: Nano ESP32, UNO R4 WiFi con ArduinoOTA, UNO Q…)
  const network = /^\d{1,3}(\.\d{1,3}){3}$/.test(port);
  onData(`\n⬆ Subiendo a ${port}${network ? ' por WiFi (OTA)' : ''}...\n`);
  return cli(['upload', '-p', port, ...(network ? ['-l', 'network'] : []), '--fqbn', fqbn, sketchDir], onData);
}

async function boardList() {
  const data = await cliJson(['board', 'list']);
  const list = Array.isArray(data) ? data : (data && data.detected_ports) || [];
  return list.map((d) => {
    const port = d.port || d;
    const match = (d.matching_boards || d.boards || [])[0];
    return {
      address: port.address,
      label: port.label || port.address,
      protocol: port.protocol,
      board: match ? { name: match.name, fqbn: match.fqbn } : null,
    };
  }).filter((p) => p.address);
}

async function libSearch(q) {
  const data = await cliJson(['lib', 'search', q, '--omit-releases-details']);
  const libs = (data && data.libraries) || [];
  return libs.slice(0, 40).map((l) => ({
    name: l.name,
    version: l.latest?.version || (l.releases ? Object.keys(l.releases).pop() : ''),
    sentence: l.latest?.sentence || '',
    author: l.latest?.author || '',
  }));
}

async function libList() {
  const data = await cliJson(['lib', 'list']);
  const libs = Array.isArray(data) ? data : (data && data.installed_libraries) || [];
  return libs.map((l) => l.library?.name).filter(Boolean);
}

function libInstall(name, onData) {
  onData(`\n📚 Instalando librería "${name}"...\n`);
  return cli(['lib', 'install', name], onData);
}

// ---- Gestor de placas (cores) ----
async function coreList() {
  const data = await cliJson(['core', 'list', '--all']);
  const list = (data && data.platforms) || (Array.isArray(data) ? data : []);
  return list
    .filter((p) => p.id && p.id.startsWith('arduino:'))
    .map((p) => {
      const rel = p.releases || {};
      const latest = p.latest_version || Object.keys(rel).pop() || '';
      return {
        id: p.id,
        name: (rel[latest] && rel[latest].name) || (rel[p.installed_version] && rel[p.installed_version].name) || p.id,
        installed: p.installed_version || '',
        latest,
        deprecated: !!p.deprecated,
      };
    })
    .sort((x, y) => (!!y.installed - !!x.installed) || x.name.localeCompare(y.name));
}

async function coreInstall(id, onData) {
  onData(`
⏬ Instalando/actualizando ${id}...
`);
  await cli(['core', 'update-index'], onData);
  return cli(['core', 'install', id], onData);
}

function coreUninstall(id, onData) {
  onData(`
🗑 Desinstalando ${id}...
`);
  return cli(['core', 'uninstall', id], onData);
}

module.exports = { compileTo, coreList, coreInstall, coreUninstall, status, install, compile, upload, boardList, libSearch, libInstall, libList, ensureCore };
