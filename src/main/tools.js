// Herramientas del proyecto: búsqueda de texto e historial de versiones con git.
const fs = require('fs');
const path = require('path');
const proc = require('./proc');
const project = require('./project');

// ---------- Búsqueda en todo el proyecto ----------
function search(root, query, { regex = false, caseSensitive = false } = {}) {
  if (!query) return [];
  let re;
  try {
    re = new RegExp(regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? 'g' : 'gi');
  } catch (e) {
    throw new Error('Expresión regular inválida: ' + e.message);
  }
  const results = [];
  for (const f of project.snapshot(root, 5000000)) {
    if (f.content.startsWith('[')) continue;
    const lines = f.content.split('\n');
    lines.forEach((line, i) => {
      re.lastIndex = 0;
      const m = re.exec(line);
      if (m) results.push({ file: f.path, line: i + 1, col: m.index + 1, text: line.slice(0, 300), len: m[0].length });
    });
    if (results.length > 1000) break;
  }
  return results;
}

function replaceAll(root, query, replacement, opts = {}) {
  const re = new RegExp(opts.regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), opts.caseSensitive ? 'g' : 'gi');
  const changed = [];
  for (const f of project.snapshot(root, 5000000)) {
    if (f.content.startsWith('[')) continue;
    const next = f.content.replace(re, replacement);
    if (next !== f.content) {
      fs.writeFileSync(path.join(root, f.path), next);
      changed.push(f.path);
    }
  }
  return changed;
}

// ---------- Historial con git ----------
const IGNORE = ['.venv/', '__pycache__/', 'build/', 'dist/', '.arpy/backups/', '.arpy/pybuild/', '.arpy/images/', ''].join('\n');

function git(root, args) {
  return proc.run('git', args, { cwd: root }).promise;
}

let available = null;
function gitAvailable() {
  if (available === null) available = !!proc.works('git', ['--version']);
  return available;
}

async function ensureRepo(root) {
  if (!gitAvailable()) throw new Error('Git no está instalado. Descárgalo de git-scm.com para usar el historial.');
  if (!fs.existsSync(path.join(root, '.git'))) {
    await git(root, ['init', '-q']);
    const gi = path.join(root, '.gitignore');
    if (!fs.existsSync(gi)) fs.writeFileSync(gi, IGNORE);
  }
}

async function identityArgs(root) {
  const name = (await git(root, ['config', 'user.name'])).output.trim();
  const email = (await git(root, ['config', 'user.email'])).output.trim();
  const args = [];
  if (!name) args.push('-c', 'user.name=ARPY Copiler');
  if (!email) args.push('-c', 'user.email=arpy@local');
  return args;
}

async function commit(root, message) {
  await ensureRepo(root);
  await git(root, ['add', '-A']);
  const st = await git(root, ['status', '--porcelain']);
  if (!st.output.trim()) return { committed: false, message: 'No hay cambios desde la última versión.' };
  const r = await git(root, [...(await identityArgs(root)), 'commit', '-q', '-m', message || 'Versión guardada']);
  if (r.code !== 0) throw new Error(r.output.trim() || 'git commit falló');
  return { committed: true };
}

async function log(root) {
  if (!gitAvailable() || !fs.existsSync(path.join(root, '.git'))) return [];
  const r = await git(root, ['log', '-n', '100', '--date=format:%Y-%m-%d %H:%M', '--pretty=format:%H\x1f%h\x1f%ad\x1f%s', '--shortstat']);
  if (r.code !== 0) return [];
  const out = [];
  for (const line of r.output.split('\n')) {
    if (line.includes('\x1f')) {
      const [hash, short, date, subject] = line.split('\x1f');
      out.push({ hash, short, date, subject, stat: '' });
    } else if (line.trim() && out.length) out[out.length - 1].stat = line.trim();
  }
  return out;
}

async function pending(root) {
  if (!gitAvailable() || !fs.existsSync(path.join(root, '.git'))) return -1;
  const st = await git(root, ['status', '--porcelain']);
  return st.output.split('\n').filter(Boolean).length;
}

// Restaura el proyecto a una versión (antes guarda la actual, para poder volver).
async function restore(root, hash) {
  if (!/^[0-9a-f]{7,40}$/.test(hash)) throw new Error('Versión inválida');
  await commit(root, 'Antes de restaurar');
  const r = await git(root, ['restore', `--source=${hash}`, '--staged', '--worktree', ':/']);
  if (r.code !== 0) throw new Error(r.output.trim());
  await commit(root, `Restaurado a la versión ${hash.slice(0, 7)}`);
  return true;
}

async function showFile(root, hash, file) {
  const r = await git(root, ['show', `${hash}:${file}`]);
  return r.code === 0 ? r.output : null;
}

async function changedFiles(root, hash) {
  const r = await git(root, ['show', '--name-only', '--pretty=format:', hash]);
  return r.output.split('\n').map((s) => s.trim()).filter(Boolean);
}

module.exports = { search, replaceAll, gitAvailable, commit, log, pending, restore, showFile, changedFiles };
