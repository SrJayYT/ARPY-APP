// Lógica del renderer que no necesita ventana: diferencias en vivo y bloques buscar/reemplazar.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Carga un script del renderer en un contexto con un "A" mínimo.
function loadRenderer(file, extra = {}) {
  const ctx = { A: {}, window: {}, console, ...extra };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', file), 'utf8'), ctx);
  return ctx.A;
}

const A = loadRenderer('livediff.js');
const ops = (before, after, partial) => JSON.parse(JSON.stringify(A.livediff.diff(before, after, partial).map((o) => `${o.t}:${o.line}`)));

test('diff final marca lo quitado y lo agregado', () => {
  assert.deepStrictEqual(ops('a\nb\nc', 'a\nB\nc', false), ['eq:a', 'del:b', 'add:B', 'eq:c']);
  assert.deepStrictEqual(ops('a\nc', 'a\nb\nc', false), ['eq:a', 'add:b', 'eq:c']);
});

test('diff parcial deja como pendiente lo que la IA aún no escribe', () => {
  const before = 'uno largo\ndos largo\ntres largo\ncuatro largo';
  const r = ops(before, 'uno largo\nNUEVA línea\ndos largo', true);
  assert.deepStrictEqual(r, ['eq:uno largo', 'add:NUEVA línea', 'eq:dos largo', 'pend:tres largo', 'pend:cuatro largo']);
});

test('diff parcial con una función nueva a medias no marca el resto como borrado', () => {
  const before = 'int x = 1;\nvoid setup() {\n  pinMode(13, OUTPUT);\n}\nvoid loop() {}';
  const partial = 'int x = 1;\nvoid nueva() {\n  hacerAlgo();';
  const r = ops(before, partial, true);
  assert.ok(!r.some((o) => o.startsWith('del:')), r.join(' | '));
  assert.ok(r.includes('add:void nueva() {'));
});

test('los archivos enormes no bloquean (se usa el atajo sin LCS)', () => {
  const big = Array.from({ length: 3000 }, (_, i) => 'línea ' + i).join('\n');
  const changed = big.replace('línea 10\n', 'cambiada\n').split('\n').reverse().join('\n');
  const t0 = Date.now();
  A.livediff.diff(big, changed, false);
  assert.ok(Date.now() - t0 < 3000);
});
