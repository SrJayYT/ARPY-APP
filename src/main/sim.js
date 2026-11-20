// Simulador: compila el sketch para Arduino Uno y lo ejecuta en un hilo con avr8js.
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const arduino = require('./arduino');

let worker = null;

async function start(root, sketchDir, onData, onState) {
  stop();
  const out = path.join(root, '.arpy', 'sim');
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  onData('\n🧪 Compilando para el simulador (Arduino Uno / ATmega328P)…\n');
  const r = await arduino.compileTo(sketchDir, 'arduino:avr:uno', out, onData);
  if (r.code !== 0) return { ok: false, error: 'El sketch no compila para Arduino Uno (el simulador emula un Uno).' };
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
