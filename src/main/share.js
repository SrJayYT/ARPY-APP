// Compartir proyectos: exportar a .zip e importar desde .zip.
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');
const project = require('./project');

const SKIP_DIRS = new Set(['.git', '.venv', 'venv', 'node_modules', '__pycache__', 'dist', 'build']);
const SKIP_ARPY = new Set(['sim', 'pybuild', 'backups']);
const CHAT_ARPY = new Set(['chats', 'images', 'memory.md']);

function collect(root, withChats, dir = root, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const rel = path.relative(root, full).split(path.sep);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (rel[0] === '.arpy' && rel.length === 2 && (SKIP_ARPY.has(e.name) || (!withChats && CHAT_ARPY.has(e.name)))) continue;
      collect(root, withChats, full, out);
    } else {
      if (rel[0] === '.arpy' && rel.length === 2 && !withChats && CHAT_ARPY.has(e.name)) continue;
      out.push(full);
    }
  }
  return out;
}

function exportZip(root, file, withChats) {
  const zip = new AdmZip();
  const base = path.basename(root);
  for (const full of collect(root, withChats)) {
    const rel = path.relative(root, full).split(path.sep).join('/');
    zip.addFile(`${base}/${rel}`, fs.readFileSync(full));
  }
  zip.writeZip(file);
  return file;
}

// Extrae el .zip en una carpeta nueva dentro de `parent` y devuelve la raíz del proyecto.
function importZip(file, parent) {
  const zip = new AdmZip(file);
  const entries = zip.getEntries().filter((e) => !e.isDirectory);
  const arpy = entries.map((e) => e.entryName.replace(/\\/g, '/')).filter((n) => /\.arpy$/i.test(n) && n.split('/').length <= 2)
    .sort((a, b) => a.split('/').length - b.split('/').length)[0];
  const prefix = arpy && arpy.includes('/') ? arpy.slice(0, arpy.lastIndexOf('/') + 1) : '';
  let name = (prefix ? prefix.slice(0, -1) : path.basename(file, path.extname(file))).replace(/[<>:"/\\|?*]/g, '') || 'proyecto';
  let dest = path.join(parent, name);
  for (let i = 2; fs.existsSync(dest); i++) dest = path.join(parent, `${name}-${i}`);
  fs.mkdirSync(dest, { recursive: true });
  let count = 0;
  for (const e of entries) {
    let rel = e.entryName.replace(/\\/g, '/');
    if (prefix) { if (!rel.startsWith(prefix)) continue; rel = rel.slice(prefix.length); }
    if (!rel) continue;
    const out = path.resolve(dest, rel);
    // Protección: ningún archivo puede salir de la carpeta destino.
    if (path.relative(dest, out).startsWith('..') || path.isAbsolute(path.relative(dest, out))) continue;
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, e.getData());
    count++;
  }
  if (!count) throw new Error('El .zip está vacío.');
  if (!project.isProject(dest)) project.adopt(dest);
  return dest;
}

module.exports = { exportZip, importZip };
