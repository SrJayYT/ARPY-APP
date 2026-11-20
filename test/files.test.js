// Acciones de archivos de la IA: papelera del proyecto, mover/renombrar y rutas protegidas.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const project = require('../src/main/project');

const fresh = () => project.create(fs.mkdtempSync(path.join(os.tmpdir(), 'arpy-files-')), 'Prueba', '', null, { tech: ['python', 'web'] });

test('borrar una carpeta entera va a la papelera y se recupera igual', () => {
  const root = fresh();
  fs.writeFileSync(path.join(root, 'web', 'logo.bin'), Buffer.from([0, 1, 2, 255]));
  const id = project.trash(root, 'web');
  assert.ok(!fs.existsSync(path.join(root, 'web')));
  const info = project.untrash(root, id);
  assert.strictEqual(info.path, 'web');
  assert.ok(fs.existsSync(path.join(root, 'web', 'index.html')));
  assert.deepStrictEqual([...fs.readFileSync(path.join(root, 'web', 'logo.bin'))], [0, 1, 2, 255]);
});

test('mover y renombrar archivos y carpetas', () => {
  const root = fresh();
  project.move(root, 'web/style.css', 'web/css/estilos.css');
  assert.ok(fs.existsSync(path.join(root, 'web', 'css', 'estilos.css')));
  project.move(root, 'web', 'sitio');
  assert.ok(fs.existsSync(path.join(root, 'sitio', 'index.html')));
  assert.throws(() => project.move(root, 'sitio', 'python'), /Ya existe/);
  assert.throws(() => project.move(root, 'sitio', 'sitio/dentro'), /dentro de sí misma/);
  assert.throws(() => project.move(root, 'no-existe.txt', 'x.txt'), /No existe/);
});

test('el archivo .arpy, la carpeta .arpy y la raíz están protegidos', () => {
  const root = fresh();
  const arpy = fs.readdirSync(root).find((f) => f.endsWith('.arpy') && fs.statSync(path.join(root, f)).isFile());
  for (const rel of [arpy, '.arpy', '.arpy/chats', '', '.']) {
    assert.throws(() => project.trash(root, rel), /No se puede borrar/, rel);
  }
  assert.throws(() => project.move(root, arpy, 'otro.arpy'), /No se puede mover/);
  assert.throws(() => project.trash(root, '../fuera'), /fuera del proyecto/);
});
