// Ejecuta archivos JavaScript (Node.js integrado), Java, PHP y SQL (SQLite integrado).
// La salida va a la Consola, igual que Python.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const runtimes = require('./runtimes');
const proc = require('./proc');

let current = null;

// Archivos que viven dentro de app.asar no se pueden ejecutar desde fuera: se usa la copia desempaquetada.
const unpacked = (p) => p.replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);

function command(kind, full, root) {
  const nodeEnv = { ELECTRON_RUN_AS_NODE: '1' };
  switch (kind) {
    case 'node':
      return { cmd: process.execPath, args: [full], env: nodeEnv, label: `node ${path.basename(full)}` };
    case 'sql': {
      const db = path.join(root, 'sql', 'database.sqlite');
      fs.mkdirSync(path.dirname(db), { recursive: true });
      return { cmd: process.execPath, args: ['--no-warnings', unpacked(path.join(__dirname, 'sqlrun.js')), db, full], env: nodeEnv, label: `sqlite ${path.basename(full)} → sql/database.sqlite` };
    }
    case 'java': {
      const r = runtimes.locate('java');
      if (!r) return { missing: 'java' };
      // Java 11+ ejecuta un archivo .java directamente (compila en memoria)
      return { cmd: r.cmd, args: ['-Dfile.encoding=UTF-8', '-Dstdout.encoding=UTF-8', full], label: `java ${path.basename(full)}` };
    }
    case 'php': {
      const r = runtimes.locate('php');
      if (!r) return { missing: 'php' };
      return { cmd: r.cmd, args: [full], label: `php ${path.basename(full)}` };
    }
    default:
      return null;
  }
}

function start(kind, full, root, env, onData, onExit) {
  stop();
  const c = command(kind, full, root);
  if (!c) throw new Error('Este tipo de archivo no se puede ejecutar');
  if (c.missing) return { missing: c.missing };
  onData(`\n▶ ${c.label}\n`, 'info');
  const child = spawn(c.cmd, c.args, { cwd: path.dirname(full), env: { ...process.env, ...env, ...(c.env || {}), PYTHONIOENCODING: 'utf-8' }, windowsHide: true });
  current = child;
  child.stdout.on('data', (b) => onData(b.toString('utf8'), 'stdout'));
  child.stderr.on('data', (b) => onData(b.toString('utf8'), 'stderr'));
  child.on('error', (e) => onData(`No se pudo ejecutar: ${e.message}\n`, 'stderr'));
  child.on('close', (code) => {
    if (current === child) current = null;
    onExit(code); // la Consola ya muestra "Proceso terminado"
  });
  return { started: true };
}

function stop() {
  if (current) { proc.killTree(current); current = null; }
}

function write(text) {
  if (current && current.stdin.writable) current.stdin.write(text);
}

module.exports = { start, stop, write, running: () => !!current };
