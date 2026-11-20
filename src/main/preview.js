// Vista previa web: servidor local para HTML/CSS/JS y plantillas EJS, y el servidor integrado de PHP.
// Solo escucha en 127.0.0.1 y solo sirve archivos de dentro del proyecto.
const fs = require('fs');
const net = require('net');
const http = require('http');
const path = require('path');
const { spawn } = require('child_process');
const ejs = require('ejs');
const runtimes = require('./runtimes');
const proc = require('./proc');

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4',
};

let staticSrv = null; // { server, port, root }
let phpSrv = null; // { child, port, root }

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on('error', reject);
});

function inside(root, p) {
  const r = path.relative(root, p);
  return !r.startsWith('..') && !path.isAbsolute(r);
}

// Datos para una plantilla EJS: <nombre>.json junto a la plantilla (opcional).
function ejsData(file) {
  const json = file.replace(/\.ejs$/i, '.json');
  try { return JSON.parse(fs.readFileSync(json, 'utf8')); } catch { return {}; }
}

function errorPage(title, msg) {
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<!doctype html><meta charset="utf-8"><body style="font-family:Consolas,monospace;background:#1e1416;color:#ffb4b4;padding:24px;white-space:pre-wrap"><h2 style="font-family:system-ui">${esc(title)}</h2>${esc(msg)}</body>`;
}

async function ensureStatic(root) {
  if (staticSrv && staticSrv.root === root) return staticSrv.port;
  stopStatic();
  const port = await freePort();
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://x');
      let p = path.join(root, decodeURIComponent(url.pathname));
      if (!inside(root, p)) { res.writeHead(403); return res.end('Fuera del proyecto'); }
      if (fs.existsSync(p) && fs.statSync(p).isDirectory()) {
        const idx = ['index.html', 'index.htm', 'index.ejs'].map((n) => path.join(p, n)).find((f) => fs.existsSync(f));
        if (!idx) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(errorPage('Sin página de inicio', 'Esta carpeta no tiene index.html ni index.ejs.')); }
        p = idx;
      }
      if (!fs.existsSync(p)) { res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(errorPage('No encontrado', url.pathname)); }
      const ext = path.extname(p).toLowerCase();
      if (ext === '.ejs') {
        try {
          const html = await ejs.renderFile(p, ejsData(p), { root: path.dirname(p), views: [path.dirname(p)], async: false });
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
          return res.end(html);
        } catch (e) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          return res.end(errorPage('Error en la plantilla EJS', e.message));
        }
      }
      res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      fs.createReadStream(p).pipe(res);
    } catch (e) {
      res.writeHead(500); res.end(String(e.message));
    }
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  staticSrv = { server, port, root };
  return port;
}

async function ensurePhp(root, onData) {
  if (phpSrv && phpSrv.root === root && phpSrv.child.exitCode === null) return phpSrv.port;
  stopPhp();
  const r = runtimes.locate('php');
  if (!r) return null;
  const port = await freePort();
  const child = spawn(r.cmd, ['-S', `127.0.0.1:${port}`, '-t', root], { cwd: root, windowsHide: true });
  child.stderr.on('data', (b) => onData && onData(b.toString('utf8'), 'info'));
  phpSrv = { child, port, root };
  await new Promise((r2) => setTimeout(r2, 400)); // dar tiempo a que abra el puerto
  return port;
}

// URL de vista previa para un archivo (o la página principal del proyecto si no se indica).
async function urlFor(root, rel, onData) {
  if (!rel) {
    rel = ['web/index.html', 'views/index.ejs', 'php/index.php', 'index.html', 'index.php'].find((f) => fs.existsSync(path.join(root, f)));
    if (!rel) return { error: 'El proyecto no tiene una página para previsualizar (web/index.html, views/index.ejs o php/index.php).' };
  }
  rel = rel.replace(/\\/g, '/');
  // CSS o JS de una página: se muestra la página de su carpeta
  if (/\.(css|js|mjs)$/i.test(rel)) {
    const dir = path.posix.dirname(rel);
    const page = ['index.html', 'index.htm'].map((n) => (dir === '.' ? n : `${dir}/${n}`)).find((f) => fs.existsSync(path.join(root, f)));
    if (page) rel = page;
  }
  const enc = rel.split('/').map(encodeURIComponent).join('/');
  if (/\.php$/i.test(rel)) {
    const port = await ensurePhp(root, onData);
    if (!port) return { missing: 'php' };
    return { url: `http://127.0.0.1:${port}/${enc}`, rel, kind: 'php' };
  }
  const port = await ensureStatic(root);
  return { url: `http://127.0.0.1:${port}/${enc}`, rel, kind: /\.ejs$/i.test(rel) ? 'ejs' : 'static' };
}

function stopStatic() { if (staticSrv) { staticSrv.server.close(); staticSrv = null; } }
function stopPhp() { if (phpSrv) { proc.killTree(phpSrv.child); phpSrv = null; } }
function stopAll() { stopStatic(); stopPhp(); }

module.exports = { urlFor, stopAll };
