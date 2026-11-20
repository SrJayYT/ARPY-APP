const { spawn, spawnSync } = require('child_process');

// Ejecuta un proceso y transmite su salida en tiempo real.
function run(cmd, args, { cwd, env, onData, shell = false } = {}) {
  let child;
  const promise = new Promise((resolve) => {
    let output = '';
    try {
      child = spawn(cmd, args, { cwd, env: { ...process.env, ...(env || {}) }, shell, windowsHide: true });
    } catch (err) {
      const msg = `No se pudo ejecutar "${cmd}": ${err.message}\n`;
      onData && onData(msg, 'stderr');
      return resolve({ code: -1, output: msg });
    }
    const handle = (stream) => (buf) => {
      const text = buf.toString('utf8');
      output += text;
      onData && onData(text, stream);
    };
    child.stdout.on('data', handle('stdout'));
    child.stderr.on('data', handle('stderr'));
    child.on('error', (err) => {
      const msg = `Error al ejecutar "${cmd}": ${err.message}\n`;
      output += msg;
      onData && onData(msg, 'stderr');
    });
    child.on('close', (code) => resolve({ code: code ?? -1, output }));
  });
  return { promise, get child() { return child; } };
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  } else {
    try { child.kill('SIGTERM'); } catch {}
  }
}

function works(cmd, args) {
  try {
    const r = spawnSync(cmd, args, { windowsHide: true, encoding: 'utf8', timeout: 8000 });
    return r.status === 0 ? (r.stdout || r.stderr || '').trim() : null;
  } catch {
    return null;
  }
}

module.exports = { run, killTree, works };
