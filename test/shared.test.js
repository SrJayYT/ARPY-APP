// Catálogo de componentes, generador de apps Tkinter, ejemplos y diccionario de inglés.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const P = require('../src/shared/parts');
const G = require('../src/shared/uigen');
const examples = require('../src/main/examples');
const EN = require('../src/shared/i18n-en');

const python = (() => {
  for (const [cmd, pre] of [['py', ['-3']], ['python3', []], ['python', []]]) {
    const r = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8' });
    if (r.status === 0 && /Python 3/.test(r.stdout + r.stderr)) return { cmd, pre };
  }
  return null;
})();
const pyCompile = (file) => spawnSync(python.cmd, [...python.pre, '-m', 'py_compile', file], { encoding: 'utf8' });

test('autoPin no repite pines de señal', () => {
  const used = new Set();
  const pins = Array.from({ length: 6 }, () => { const p = P.autoPin('digital', used); used.add(p); return p; });
  assert.strictEqual(new Set(pins).size, pins.length);
  assert.strictEqual(P.autoPin('analog', new Set(['A0'])), 'A1');
});

test('check detecta pines compartidos y PWM inválido', () => {
  const w = { parts: [
    { type: 'led', label: 'L1', pins: { anode: 'D2', cathode: 'GND' } },
    { type: 'button', label: 'B1', pins: { sig: 'D2', gnd: 'GND' } },
    { type: 'servo', label: 'S1', pins: { sig: 'D4', vcc: '5V', gnd: 'GND' } },
  ] };
  const warn = P.check(w).join('\n');
  assert.match(warn, /D2 está usado por L1 y B1/);
  assert.match(warn, /S1: D4 no tiene PWM/);
});

test('el generador produce Python válido con todos los controles', { skip: !python && 'sin Python' }, () => {
  const widgets = G.WIDGETS.map((w, i) => ({ id: 'w' + i, type: w.type, x: 10, y: 10 + i * 40, w: w.w, h: w.h, props: { ...w.props } }));
  widgets.push({ id: 'raro', type: 'label', x: 0, y: 0, w: 100, h: 20, props: { text: 'comillas " y \\ barra """ triple' } });
  for (const theme of Object.keys(G.THEMES)) {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'arpy-ui-')), 'panel.py');
    fs.writeFileSync(file, G.generate({ title: 'Prueba "x"', theme, width: 700, height: 500, widgets }));
    const r = pyCompile(file);
    assert.strictEqual(r.status, 0, r.stderr);
  }
});

test('todos los ejemplos tienen sketch, conexiones completas y Python válido', () => {
  const list = examples.list();
  assert.ok(list.length >= 8);
  for (const ex of list) {
    const dir = path.join(examples.DIR, ex.id);
    assert.ok(fs.existsSync(path.join(dir, 'sketch', 'sketch.ino')), ex.id);
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'example.json'), 'utf8'));
    const missing = P.check(meta.wiring).filter((w) => /falta conectar|está usado por/.test(w));
    assert.deepStrictEqual(missing, [], ex.id);
    if (meta.app) {
      assert.ok(ex.preview, `${ex.id} sin vista previa`);
      if (python) assert.strictEqual(pyCompile(path.join(dir, 'python', 'main.py')).status, 0, ex.id);
    }
  }
});

test('crear un proyecto desde un ejemplo copia todo y guarda las conexiones', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'arpy-ex-'));
  const { root, libs } = examples.create('clima', parent, 'Mi clima');
  assert.ok(fs.existsSync(path.join(root, 'Mi-clima.arpy')));
  assert.ok(fs.existsSync(path.join(root, 'python', 'main.py')));
  assert.ok(fs.existsSync(path.join(root, '.arpy', 'wiring.json')));
  assert.deepStrictEqual(libs, ['DHT sensor library']);
});

test('diccionario de inglés: patrones válidos y sin traducciones vacías', () => {
  for (const [k, v] of Object.entries(EN.exact)) assert.ok(v && v.trim(), `vacío: ${k}`);
  for (const [re, rep] of EN.patterns) { assert.ok(re instanceof RegExp); assert.ok(typeof rep === 'string'); }
  const t = (s) => { for (const [re, rep] of EN.patterns) { const m = re.exec(s); if (m) return rep.replace(/\$(\d)/g, (_, i) => m[+i] || ''); } return EN.exact[s] || s; };
  assert.strictEqual(t('hace 5 min'), '5 min ago');
  assert.strictEqual(t('⬆ Subiendo a Arduino Uno R3 en COM3'), '⬆ Uploading to Arduino Uno R3 on COM3');
  assert.strictEqual(t('Conectado a COM5 @ 9600'), 'Connected to COM5 @ 9600');
});
