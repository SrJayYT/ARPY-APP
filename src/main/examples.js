// Ejemplos listos para usar (src/examples/<id>/): sketch, app Python, conexiones y vista previa.
const fs = require('fs');
const path = require('path');
const project = require('./project');
const P = require('../shared/parts');

const DIR = path.join(__dirname, '..', 'examples');
const ORDER = ['semaforo', 'luces', 'piano', 'clima', 'huerto', 'alarma', 'radar', 'bluetooth'];

// Programa Python mínimo para los ejemplos sin app: muestra lo que envía la placa.
const LECTOR = `"""Lector serie: muestra lo que envía el Arduino y te deja responderle."""
import os
import threading

import serial  # pip install pyserial

PORT = os.environ.get("ARPY_PORT", "COM3")
BAUD = int(os.environ.get("ARPY_BAUD", "9600"))

placa = serial.Serial(PORT, BAUD, timeout=1)
print(f"Conectado a {PORT} @ {BAUD}. Escribe un comando y pulsa Enter.")


def escuchar():
    while True:
        linea = placa.readline().decode(errors="ignore").strip()
        if linea:
            print("Arduino:", linea)


threading.Thread(target=escuchar, daemon=True).start()
while True:
    placa.write((input() + "\\n").encode())
`;

function readMeta(id) {
  try { return JSON.parse(fs.readFileSync(path.join(DIR, id, 'example.json'), 'utf8')); } catch { return null; }
}

function list() {
  const ids = fs.readdirSync(DIR).filter((d) => fs.existsSync(path.join(DIR, d, 'example.json')));
  ids.sort((a, b) => (ORDER.indexOf(a) + 1 || 99) - (ORDER.indexOf(b) + 1 || 99));
  return ids.map((id) => {
    const m = readMeta(id);
    const prev = path.join(DIR, id, 'preview.jpg');
    return {
      id, title: m.title, description: m.description, level: m.level, tags: m.tags || [], app: !!m.app, accent: m.accent,
      preview: fs.existsSync(prev) ? `data:image/jpeg;base64,${fs.readFileSync(prev).toString('base64')}` : null,
      // nombres genéricos del catálogo (se traducen en la interfaz)
      parts: ((m.wiring && m.wiring.parts) || []).map((p) => (P.find(p.type) || { name: p.label }).name),
    };
  });
}

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (e.name === '__pycache__' || e.name.endsWith('.pyc')) continue;
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

// Crea el proyecto y devuelve { root, libs } (librerías de Arduino que hay que instalar).
function create(id, parent, name) {
  const meta = readMeta(id);
  if (!meta) throw new Error('Ejemplo no encontrado');
  if (!String(name || '').trim()) throw new Error('Nombre inválido');
  const safe = String(name).trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-');
  const root = path.join(parent, safe);
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('La carpeta ya existe y no está vacía');
  for (const sub of ['sketch', 'python']) {
    const s = path.join(DIR, id, sub);
    if (fs.existsSync(s)) copyDir(s, path.join(root, sub));
  }
  fs.mkdirSync(path.join(root, 'python'), { recursive: true });
  const main = path.join(root, 'python', 'main.py');
  if (!fs.existsSync(main)) fs.writeFileSync(main, LECTOR);
  fs.writeFileSync(path.join(root, 'python', 'requirements.txt'), meta.requirements || 'pyserial\n');
  project.writeConfig(root, {
    name: String(name).trim(),
    board: meta.board || 'arduino:avr:uno',
    port: '',
    baud: meta.baud || 9600,
    venv: true,
    sketch: 'sketch',
    pythonMain: 'python/main.py',
    template: `example:${id}`,
    created: new Date().toISOString(),
  });
  if (meta.wiring) project.saveWiring(root, meta.wiring);
  return { root, libs: meta.libs || [] };
}

module.exports = { list, create, DIR };
