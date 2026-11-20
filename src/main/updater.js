// Actualizaciones: consulta el último release de GitHub y descarga el instalador o el portable.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { app, shell } = require('electron');

const REPO = 'SrJayYT/ARPY-APP';
let latest = null;

function cmp(a, b) {
  const pa = String(a).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).replace(/^v/, '').split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
}

const isPortable = () => !!process.env.PORTABLE_EXECUTABLE_FILE;

async function check() {
  const current = app.getVersion();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15000);
  let res;
  try {
    res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
      headers: { 'User-Agent': 'ARPY-Copiler-Updater', Accept: 'application/vnd.github+json' }, signal: ctl.signal,
    });
  } finally { clearTimeout(t); }
  if (res.status === 404) return { available: false, current };
  if (!res.ok) throw new Error(`No se pudo consultar actualizaciones (${res.status})`);
  const rel = await res.json();
  const version = String(rel.tag_name || '').replace(/^v/, '');
  const want = isPortable() ? /portable.*\.exe$/i : /setup.*\.exe$/i;
  const asset = (rel.assets || []).find((a) => want.test(a.name));
  latest = { version, asset, url: rel.html_url };
  return {
    available: !!version && cmp(version, current) > 0 && !!asset,
    current, latest: version, portable: isPortable(), notesUrl: rel.html_url,
  };
}

async function install(onData) {
  if (!app.isPackaged) throw new Error('Las actualizaciones solo funcionan en la app instalada.');
  if (!latest || !latest.asset) await check();
  if (!latest || !latest.asset) throw new Error('No hay ninguna actualización disponible.');
  const portable = isPortable();
  const dir = portable ? (process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('downloads')) : os.tmpdir();
  const file = path.join(dir, latest.asset.name);
  onData(`Descargando ${latest.asset.name}…\n`, 'info');
  const res = await fetch(latest.asset.browser_download_url, { headers: { 'User-Agent': 'ARPY-Copiler-Updater' } });
  if (!res.ok) throw new Error(`Descarga fallida (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (latest.asset.size && buf.length !== latest.asset.size) throw new Error('La descarga llegó incompleta. Inténtalo de nuevo.');
  fs.writeFileSync(file, buf);
  if (portable) {
    // Un portable no puede reemplazarse a sí mismo mientras corre: se deja junto al actual.
    shell.showItemInFolder(file);
    onData(`Nueva versión guardada en ${file}. Ciérrala y abre la nueva.\n`, 'info');
    return { file, portable: true };
  }
  onData('Abriendo el instalador… la app se cerrará.\n', 'info');
  spawn(file, [], { detached: true, stdio: 'ignore' }).unref();
  setTimeout(() => app.quit(), 1200);
  return { file, portable: false };
}

module.exports = { check, install, cmp };
