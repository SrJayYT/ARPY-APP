const fs = require('fs');
const path = require('path');

const IGNORE = new Set(['.git', '.arpy', 'dist', 'node_modules', '__pycache__', '.venv', 'venv', 'build', '.vscode', '.idea']);
const TEXT_EXT = new Set(['.ino', '.cpp', '.c', '.h', '.hpp', '.py', '.json', '.txt', '.md', '.html', '.css', '.js', '.csv', '.ini', '.cfg', '.toml', '.yaml', '.yml', '.xml']);

function resolveIn(root, rel) {
  const full = path.resolve(root, rel);
  const r = path.relative(root, full);
  if (r.startsWith('..') || path.isAbsolute(r)) throw new Error(`Ruta fuera del proyecto: ${rel}`);
  return full;
}

function toRel(root, full) {
  return path.relative(root, full).split(path.sep).join('/');
}

// El proyecto se define por un archivo <nombre>.arpy (JSON) en la raíz de la carpeta.
// Los proyectos antiguos con arpy.json se migran solos.
function projectFile(root) {
  try {
    const f = fs.readdirSync(root).find((n) => n.toLowerCase().endsWith('.arpy') && fs.statSync(path.join(root, n)).isFile());
    if (f) return path.join(root, f);
  } catch {}
  const legacy = path.join(root, 'arpy.json');
  if (fs.existsSync(legacy)) {
    let name = path.basename(root);
    try { name = JSON.parse(fs.readFileSync(legacy, 'utf8')).name || name; } catch {}
    const dest = path.join(root, safeName(name) + '.arpy');
    try { fs.renameSync(legacy, dest); return dest; } catch { return legacy; }
  }
  return null;
}

function safeName(name) {
  return String(name).trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, '-') || 'proyecto';
}

function readConfig(root) {
  const f = projectFile(root);
  if (!f) return null;
  try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; }
}

function writeConfig(root, patch) {
  const cfg = { ...(readConfig(root) || {}), ...patch };
  const f = projectFile(root) || path.join(root, safeName(cfg.name || path.basename(root)) + '.arpy');
  fs.writeFileSync(f, JSON.stringify({ arpy: 1, ...cfg }, null, 2));
  return cfg;
}

function isProject(root) {
  return !!projectFile(root);
}

// Resumen para la lista de recientes.
function info(root) {
  const f = projectFile(root);
  if (!f) return { root, exists: fs.existsSync(root), file: null };
  const cfg = readConfig(root) || {};
  let mtime = 0;
  try { mtime = fs.statSync(f).mtimeMs; } catch {}
  return { root, exists: true, file: f, name: cfg.name || path.basename(root), board: cfg.board || '', template: cfg.template || '', mtime };
}

// Convierte una carpeta existente (ej. sketch de Arduino IDE) en proyecto ARPY.
function adopt(root) {
  if (isProject(root)) return readConfig(root);
  const ino = walk(root).find((f) => f.endsWith('.ino'));
  const py = walk(root).find((f) => f.endsWith('.py'));
  return writeConfig(root, {
    name: path.basename(root),
    board: 'arduino:avr:uno',
    port: '',
    baud: 9600,
    sketch: ino ? path.dirname(ino) || '.' : 'sketch',
    pythonMain: py || 'python/main.py',
  });
}

function walk(root, dir = root, out = []) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (IGNORE.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(root, full, out);
    else out.push(toRel(root, full));
  }
  return out;
}

function tree(root, dir = root) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  return entries
    .filter((e) => !IGNORE.has(e.name))
    .sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name))
    .map((e) => {
      const full = path.join(dir, e.name);
      return e.isDirectory()
        ? { name: e.name, path: toRel(root, full), dir: true, children: tree(root, full) }
        : { name: e.name, path: toRel(root, full), dir: false };
    });
}

function isText(rel) {
  return TEXT_EXT.has(path.extname(rel).toLowerCase()) || !path.extname(rel);
}

// Todos los archivos de texto del proyecto (para dárselos a la IA).
function snapshot(root, maxChars = 600000) {
  const files = [];
  let total = 0;
  for (const rel of walk(root)) {
    if (!isText(rel)) continue;
    let content;
    try {
      const st = fs.statSync(path.join(root, rel));
      if (st.size > 200000) { files.push({ path: rel, content: `[archivo demasiado grande: ${st.size} bytes]` }); continue; }
      content = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch { continue; }
    if (total + content.length > maxChars) { files.push({ path: rel, content: '[omitido por límite de contexto]' }); continue; }
    total += content.length;
    files.push({ path: rel, content });
  }
  return files;
}

const TEMPLATES = {
  blink: {
    ino: `// Parpadeo del LED integrado
void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(9600);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("LED: ON");
  delay(500);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("LED: OFF");
  delay(500);
}
`,
    py: `"""Lee lo que el Arduino envía por el puerto serie.

ARPY Copiler define ARPY_PORT y ARPY_BAUD con el puerto y velocidad elegidos.
"""
import os
import serial  # pip install pyserial

PORT = os.environ.get("ARPY_PORT", "COM3")
BAUD = int(os.environ.get("ARPY_BAUD", "9600"))

with serial.Serial(PORT, BAUD, timeout=1) as arduino:
    print(f"Conectado a {PORT} @ {BAUD}")
    while True:
        line = arduino.readline().decode(errors="ignore").strip()
        if line:
            print("Arduino ->", line)
`,
  },
  app: {
    ino: `// Arduino <-> Python: envía la lectura de A0 y recibe órdenes para el LED.
// Protocolo de texto, una línea por mensaje:
//   Arduino -> PC:  A0:<valor 0-1023>
//   PC -> Arduino:  LED:1  /  LED:0

const unsigned long INTERVALO_MS = 100;
unsigned long ultimoEnvio = 0;
String comando = "";

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Serial.begin(115200);
}

void procesarComando(const String &cmd) {
  if (cmd == "LED:1") digitalWrite(LED_BUILTIN, HIGH);
  else if (cmd == "LED:0") digitalWrite(LED_BUILTIN, LOW);
}

void loop() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\\n') { procesarComando(comando); comando = ""; }
    else if (c != '\\r') comando += c;
  }

  if (millis() - ultimoEnvio >= INTERVALO_MS) {
    ultimoEnvio = millis();
    Serial.print("A0:");
    Serial.println(analogRead(A0));
  }
}
`,
    py: `"""App de escritorio que se comunica con el Arduino.

Muestra la lectura de A0 en vivo y permite encender/apagar el LED.
ARPY Copiler define ARPY_PORT y ARPY_BAUD automáticamente.
"""
import os
import threading
import tkinter as tk
from tkinter import ttk

import serial  # pip install pyserial

PORT = os.environ.get("ARPY_PORT", "COM3")
BAUD = int(os.environ.get("ARPY_BAUD", "115200"))


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("Panel Arduino")
        self.geometry("360x220")
        self.arduino = serial.Serial(PORT, BAUD, timeout=1)
        self.led = False

        self.valor = tk.StringVar(value="—")
        ttk.Label(self, text="Lectura A0", font=("Segoe UI", 12)).pack(pady=(20, 0))
        ttk.Label(self, textvariable=self.valor, font=("Segoe UI", 32, "bold")).pack()
        self.barra = ttk.Progressbar(self, maximum=1023, length=280)
        self.barra.pack(pady=8)
        self.boton = ttk.Button(self, text="Encender LED", command=self.toggle_led)
        self.boton.pack(pady=8)

        threading.Thread(target=self.leer, daemon=True).start()
        self.protocol("WM_DELETE_WINDOW", self.cerrar)

    def leer(self):
        while True:
            try:
                linea = self.arduino.readline().decode(errors="ignore").strip()
            except serial.SerialException:
                break
            if linea.startswith("A0:"):
                v = int(linea[3:])
                self.after(0, self.actualizar, v)

    def actualizar(self, v):
        self.valor.set(str(v))
        self.barra["value"] = v

    def toggle_led(self):
        self.led = not self.led
        self.arduino.write(b"LED:1\\n" if self.led else b"LED:0\\n")
        self.boton.config(text="Apagar LED" if self.led else "Encender LED")

    def cerrar(self):
        self.arduino.close()
        self.destroy()


if __name__ == "__main__":
    print(f"Conectando a {PORT} @ {BAUD}...")
    App().mainloop()
`,
  },
  ctk: {
    ino: null, // usa el sketch de "app"
    py: "\"\"\"Panel moderno (CustomTkinter) que se comunica con el Arduino.\n\nMuestra la lectura de A0 en vivo con una gráfica y controla el LED.\nARPY Copiler define ARPY_PORT y ARPY_BAUD automáticamente.\n\"\"\"\nimport os\nimport threading\nfrom collections import deque\n\nimport customtkinter as ctk  # pip install customtkinter\nimport serial  # pip install pyserial\n\nPORT = os.environ.get(\"ARPY_PORT\", \"COM3\")\nBAUD = int(os.environ.get(\"ARPY_BAUD\", \"115200\"))\n\nctk.set_appearance_mode(\"dark\")\nctk.set_default_color_theme(\"blue\")\n\n\nclass Panel(ctk.CTk):\n    def __init__(self):\n        super().__init__()\n        self.title(\"Panel Arduino\")\n        self.geometry(\"520x420\")\n        self.arduino = serial.Serial(PORT, BAUD, timeout=1)\n        self.historial = deque([0] * 120, maxlen=120)\n        self.led = False\n\n        ctk.CTkLabel(self, text=\"Lectura A0\", font=(\"Segoe UI\", 16)).pack(pady=(18, 0))\n        self.valor = ctk.CTkLabel(self, text=\"—\", font=(\"Segoe UI\", 44, \"bold\"))\n        self.valor.pack()\n        self.barra = ctk.CTkProgressBar(self, width=420)\n        self.barra.set(0)\n        self.barra.pack(pady=6)\n\n        self.grafica = ctk.CTkCanvas(self, width=440, height=150, bg=\"#161b22\", highlightthickness=0)\n        self.grafica.pack(pady=10)\n\n        self.boton = ctk.CTkButton(self, text=\"Encender LED\", command=self.toggle_led, width=200, height=40)\n        self.boton.pack(pady=8)\n        self.estado = ctk.CTkLabel(self, text=f\"Conectado a {PORT} @ {BAUD}\", text_color=\"gray\")\n        self.estado.pack()\n\n        threading.Thread(target=self.leer, daemon=True).start()\n        self.protocol(\"WM_DELETE_WINDOW\", self.cerrar)\n\n    def leer(self):\n        while True:\n            try:\n                linea = self.arduino.readline().decode(errors=\"ignore\").strip()\n            except serial.SerialException:\n                break\n            if linea.startswith(\"A0:\"):\n                try:\n                    v = int(linea[3:].split(\";\")[0])\n                except ValueError:\n                    continue\n                self.after(0, self.actualizar, v)\n\n    def actualizar(self, v):\n        self.historial.append(v)\n        self.valor.configure(text=str(v))\n        self.barra.set(v / 1023)\n        self.dibujar()\n\n    def dibujar(self):\n        c = self.grafica\n        c.delete(\"all\")\n        w, h = 440, 150\n        pts = []\n        for i, v in enumerate(self.historial):\n            pts += [i * w / (len(self.historial) - 1), h - 6 - v / 1023 * (h - 12)]\n        c.create_line(*pts, fill=\"#22d3ee\", width=2, smooth=True)\n\n    def toggle_led(self):\n        self.led = not self.led\n        self.arduino.write(b\"LED:1\\n\" if self.led else b\"LED:0\\n\")\n        self.boton.configure(text=\"Apagar LED\" if self.led else \"Encender LED\")\n\n    def cerrar(self):\n        self.arduino.close()\n        self.destroy()\n\n\nif __name__ == \"__main__\":\n    Panel().mainloop()\n",
    req: 'pyserial\ncustomtkinter\n',
  },
  web: {
    ino: null,
    py: "\"\"\"Panel web (Flask) para el Arduino: ábrelo en el navegador o el celular.\n\nMuestra A0 en vivo y controla el LED. Abre http://localhost:5000\nARPY Copiler define ARPY_PORT y ARPY_BAUD automáticamente.\n\"\"\"\nimport os\nimport threading\n\nimport serial  # pip install pyserial\nfrom flask import Flask, jsonify, request  # pip install flask\n\nPORT = os.environ.get(\"ARPY_PORT\", \"COM3\")\nBAUD = int(os.environ.get(\"ARPY_BAUD\", \"115200\"))\n\napp = Flask(__name__)\narduino = serial.Serial(PORT, BAUD, timeout=1)\nestado = {\"a0\": 0, \"led\": False}\n\nPAGINA = \"\"\"<!doctype html><html lang=\"es\"><head><meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>Panel Arduino</title>\n<style>body{font-family:system-ui;background:#0d1117;color:#e6edf3;display:grid;place-items:center;height:100vh;margin:0}\n.card{background:#161b22;border:1px solid #30363d;border-radius:16px;padding:32px;text-align:center;width:300px}\nh1{font-size:56px;margin:8px 0}.bar{height:10px;background:#30363d;border-radius:5px;overflow:hidden}\n.bar div{height:100%;background:#22d3ee;width:0}button{margin-top:20px;padding:12px 24px;border:0;border-radius:10px;\nbackground:#2f81f7;color:#fff;font-size:16px;cursor:pointer}</style></head><body><div class=\"card\">\n<div>Lectura A0</div><h1 id=\"v\">—</h1><div class=\"bar\"><div id=\"b\"></div></div>\n<button id=\"led\" onclick=\"toggle()\">Encender LED</button></div><script>\nlet led=false;async function tick(){const d=await (await fetch('/api/estado')).json();\nv.textContent=d.a0;b.style.width=(d.a0/1023*100)+'%';led=d.led;document.getElementById('led').textContent=led?'Apagar LED':'Encender LED'}\nasync function toggle(){await fetch('/api/led',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({on:!led})});tick()}\nsetInterval(tick,200);tick()</script></body></html>\"\"\"\n\n\ndef leer():\n    while True:\n        linea = arduino.readline().decode(errors=\"ignore\").strip()\n        if linea.startswith(\"A0:\"):\n            try:\n                estado[\"a0\"] = int(linea[3:].split(\";\")[0])\n            except ValueError:\n                pass\n\n\n@app.get(\"/\")\ndef inicio():\n    return PAGINA\n\n\n@app.get(\"/api/estado\")\ndef api_estado():\n    return jsonify(estado)\n\n\n@app.post(\"/api/led\")\ndef api_led():\n    estado[\"led\"] = bool(request.json.get(\"on\"))\n    arduino.write(b\"LED:1\\n\" if estado[\"led\"] else b\"LED:0\\n\")\n    return jsonify(estado)\n\n\nif __name__ == \"__main__\":\n    threading.Thread(target=leer, daemon=True).start()\n    print(f\"Arduino en {PORT} @ {BAUD}. Abre http://localhost:5000\")\n    app.run(host=\"0.0.0.0\", port=5000)\n",
    req: 'pyserial\nflask\n',
  },
  empty: {
    ino: `void setup() {
  Serial.begin(9600);
}

void loop() {
}
`,
    py: `import os

PORT = os.environ.get("ARPY_PORT", "COM3")
BAUD = int(os.environ.get("ARPY_BAUD", "9600"))

print("Hola desde Python. Puerto del Arduino:", PORT)
`,
  },
};

function create(parent, name, template = 'app', board = 'arduino:avr:uno') {
  if (!String(name || '').trim()) throw new Error('Nombre inválido');
  const safe = safeName(name);
  const root = path.join(parent, safe);
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error('La carpeta ya existe y no está vacía');
  const t = TEMPLATES[template] || TEMPLATES.app;
  fs.mkdirSync(path.join(root, 'sketch'), { recursive: true });
  fs.mkdirSync(path.join(root, 'python'), { recursive: true });
  fs.writeFileSync(path.join(root, 'sketch', 'sketch.ino'), t.ino || TEMPLATES.app.ino);
  fs.writeFileSync(path.join(root, 'python', 'main.py'), t.py);
  fs.writeFileSync(path.join(root, 'python', 'requirements.txt'), t.req || 'pyserial\n');
  writeConfig(root, {
    name: String(name).trim(),
    board,
    port: '',
    baud: ['app', 'ctk', 'web'].includes(template) ? 115200 : 9600,
    venv: true,
    sketch: 'sketch',
    pythonMain: 'python/main.py',
    template,
    created: new Date().toISOString(),
  });
  return root;
}

// ---- Datos de la IA por proyecto (.arpy/) ----
function arpyDir(root) {
  const d = path.join(root, '.arpy');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

// ---- Conversaciones (varias por proyecto) ----
function chatsDir(root) {
  const d = path.join(arpyDir(root), 'chats');
  fs.mkdirSync(d, { recursive: true });
  // migración del formato antiguo (un solo chat.json)
  const old = path.join(arpyDir(root), 'chat.json');
  if (fs.existsSync(old)) {
    const id = 'c' + Date.now().toString(36);
    fs.renameSync(old, path.join(d, id + '.json'));
    fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify([{ id, title: 'Conversación principal', updated: Date.now() }]));
  }
  return d;
}

function listChats(root) {
  const d = chatsDir(root);
  let idx = [];
  try { idx = JSON.parse(fs.readFileSync(path.join(d, 'index.json'), 'utf8')); } catch {}
  if (!idx.length) {
    idx = [{ id: 'c' + Date.now().toString(36), title: 'Conversación principal', updated: Date.now() }];
    fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify(idx));
  }
  return idx.sort((a, b) => b.updated - a.updated);
}

function safeId(id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('id inválido');
  return id;
}

function loadChat(root, id) {
  try { return JSON.parse(fs.readFileSync(path.join(chatsDir(root), safeId(id) + '.json'), 'utf8')); } catch { return []; }
}

function saveChat(root, id, messages, title) {
  const d = chatsDir(root);
  fs.writeFileSync(path.join(d, safeId(id) + '.json'), JSON.stringify(messages, null, 1));
  const idx = listChats(root).filter((c) => c.id !== id);
  const prev = listChats(root).find((c) => c.id === id);
  idx.push({ id, title: title || (prev && prev.title) || 'Nueva conversación', updated: Date.now() });
  fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify(idx));
}

function deleteChat(root, id) {
  const d = chatsDir(root);
  fs.rmSync(path.join(d, safeId(id) + '.json'), { force: true });
  fs.writeFileSync(path.join(d, 'index.json'), JSON.stringify(listChats(root).filter((c) => c.id !== id)));
}

// ---- Imágenes del chat (fotos del circuito, capturas) ----
function saveImage(root, dataUrl) {
  const m = dataUrl.match(/^data:(image\/(png|jpeg|webp|gif));base64,(.+)$/);
  if (!m) throw new Error('Imagen no válida');
  const d = path.join(arpyDir(root), 'images');
  fs.mkdirSync(d, { recursive: true });
  const name = Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2]);
  fs.writeFileSync(path.join(d, name), Buffer.from(m[3], 'base64'));
  return name;
}

function readImage(root, name) {
  if (!/^\w+\.(png|jpg|webp|gif)$/.test(name)) throw new Error('nombre inválido');
  const buf = fs.readFileSync(path.join(arpyDir(root), 'images', name));
  const ext = name.split('.').pop();
  const mime = 'image/' + (ext === 'jpg' ? 'jpeg' : ext);
  return { mime, data: buf.toString('base64') };
}

function loadMemory(root) {
  try { return fs.readFileSync(path.join(arpyDir(root), 'memory.md'), 'utf8'); } catch { return ''; }
}

function saveMemory(root, text) {
  fs.writeFileSync(path.join(arpyDir(root), 'memory.md'), text);
}

function backup(root, rel) {
  const full = resolveIn(root, rel);
  const exists = fs.existsSync(full);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(arpyDir(root), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify({ path: rel, existed: exists, content: exists ? fs.readFileSync(full, 'utf8') : '' }));
  return id;
}

function readBackup(root, id) {
  if (!/^[\w-]+$/.test(id)) throw new Error('id inválido');
  return JSON.parse(fs.readFileSync(path.join(arpyDir(root), 'backups', `${id}.json`), 'utf8'));
}

function restore(root, id) {
  const b = JSON.parse(fs.readFileSync(path.join(arpyDir(root), 'backups', `${id}.json`), 'utf8'));
  const full = resolveIn(root, b.path);
  if (b.existed) fs.writeFileSync(full, b.content);
  else fs.rmSync(full, { force: true });
  return b;
}

module.exports = {
  projectFile,
  info,
  resolveIn, readConfig, writeConfig, isProject, adopt, tree, snapshot, create,
  listChats, loadChat, saveChat, deleteChat, saveImage, readImage, loadMemory, saveMemory, backup, readBackup, restore, isText,
};
