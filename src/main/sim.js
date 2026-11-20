// Simulador: compila el sketch para Arduino Uno y lo ejecuta en un hilo con avr8js.
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const arduino = require('./arduino');

let worker = null;

async function start(root, sketchDir, onData, onState, boardFqbn = '') {
  stop();
  const out = path.join(root, '.arpy', 'sim');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  // Uno y Nano usan el mismo chip (ATmega328P): el Nano se compila con su propia configuración.
  const fqbn = /^arduino:avr:nano/.test(boardFqbn) ? boardFqbn : 'arduino:avr:uno';
  const label = fqbn.startsWith('arduino:avr:nano') ? 'Arduino Nano' : 'Arduino Uno';
  onData(`\n🧪 Compilando para el simulador (${label} / ATmega328P)…\n`);
  const r = await arduino.compileTo(sketchDir, fqbn, out, onData);
  if (r.code !== 0) return { ok: false, error: `El sketch no compila para ${label} (el simulador emula el chip ATmega328P de Uno y Nano).` };
  const hexFile = fs.readdirSync(out).find((f) => f.endsWith('.ino.hex') && !f.includes('bootloader'));
  if (!hexFile) return { ok: false, error: 'No se generó el archivo .hex' };
  worker = new Worker(path.join(__dirname, 'simworker.js').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep), { workerData: { hex: fs.readFileSync(path.join(out, hexFile), 'utf8') } });
  worker.on('message', onState);
  worker.on('error', (e) => onData(`\n[simulador] ${e.message}\n`, 'stderr'));
  onData('▶ Simulación en marcha.\n', 'info');
  return { ok: true };
}

function stop() {
  if (worker) { worker.terminate(); worker = null; }
}

function send(msg) {
  if (worker) worker.postMessage(msg);
}

module.exports = { start, stop, send, running: () => !!worker };
