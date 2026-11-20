// Proyectos .arpy, migración, conversaciones separadas por proyecto y compartir en .zip.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const project = require('../src/main/project');
const share = require('../src/main/share');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arpy-test-'));

test('crear proyecto genera <nombre>.arpy con la configuración', () => {
  const dir = tmp();
  const root = project.create(dir, 'Mi Robot', 'blink', 'arduino:avr:uno');
  assert.ok(fs.existsSync(path.join(root, 'Mi-Robot.arpy')));
  const cfg = project.readConfig(root);
  assert.strictEqual(cfg.name, 'Mi Robot');
  assert.strictEqual(cfg.board, 'arduino:avr:uno');
  assert.ok(fs.existsSync(path.join(root, 'sketch', 'sketch.ino')));
  assert.ok(fs.existsSync(path.join(root, 'python', 'main.py')));
});

test('no crea un proyecto encima de una carpeta con archivos', () => {
  const dir = tmp();
  project.create(dir, 'x', 'empty');
  assert.throws(() => project.create(dir, 'x', 'empty'), /no está vacía/);
});

test('los proyectos antiguos con arpy.json se migran a .arpy', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'arpy.json'), JSON.stringify({ name: 'Viejo', board: 'arduino:avr:nano' }));
  assert.strictEqual(project.readConfig(root).board, 'arduino:avr:nano');
  assert.ok(fs.existsSync(path.join(root, 'Viejo.arpy')));
  assert.ok(!fs.existsSync(path.join(root, 'arpy.json')));
});

test('cada proyecto guarda sus propias conversaciones, aunque se llamen igual', () => {
  const a = project.create(tmp(), 'Igual', 'empty');
  const b = project.create(tmp(), 'Igual', 'empty');
  project.saveChat(a, 'c1', [{ role: 'user', text: 'hola desde A' }], 'Charla A');
  project.setActiveChat(a, 'c1');
  assert.strictEqual(project.loadChat(a, 'c1').length, 1);
  assert.deepStrictEqual(project.loadChat(b, 'c1'), []);
  assert.strictEqual(project.getActiveChat(a), 'c1');
  assert.strictEqual(project.getActiveChat(b), null);
  assert.ok(!project.listChats(b).some((c) => c.title === 'Charla A'));
});

test('exportar e importar .zip deja fuera .venv y, si se pide, las conversaciones', () => {
  const root = project.create(tmp(), 'Compartir', 'app');
  project.saveChat(root, 'c1', [{ role: 'user', text: 'secreto' }], 't');
  fs.mkdirSync(path.join(root, '.venv', 'Lib'), { recursive: true });
  fs.writeFileSync(path.join(root, '.venv', 'Lib', 'x.py'), '');
  const zip = path.join(tmp(), 'p.zip');
  share.exportZip(root, zip, false);
  const dest = share.importZip(zip, tmp());
  assert.ok(project.isProject(dest));
  assert.ok(fs.existsSync(path.join(dest, 'sketch', 'sketch.ino')));
  assert.ok(!fs.existsSync(path.join(dest, '.venv')));
  assert.ok(!fs.existsSync(path.join(dest, '.arpy', 'chats')));
});

test('importar un .zip malicioso no escribe fuera de la carpeta destino', () => {
  const AdmZip = require('adm-zip');
  const zip = new AdmZip();
  zip.addFile('p/p.arpy', Buffer.from('{"name":"p"}'));
  zip.addFile('p/../../escape.txt', Buffer.from('x'));
  const file = path.join(tmp(), 'mal.zip');
  zip.writeZip(file);
  const parent = tmp();
  const dest = share.importZip(file, parent);
  assert.ok(dest.startsWith(parent));
  assert.ok(!fs.existsSync(path.join(path.dirname(parent), 'escape.txt')));
});

test('resolveIn impide rutas fuera del proyecto', () => {
  const root = tmp();
  assert.throws(() => project.resolveIn(root, '../fuera.txt'), /fuera del proyecto/);
});

test('proyecto solo de Python: sin carpeta sketch ni placa', () => {
  const root = project.create(tmp(), 'Solo Py', 'py-tk', 'arduino:avr:uno', { arduino: false });
  const cfg = project.readConfig(root);
  assert.strictEqual(cfg.arduino, false);
  assert.strictEqual(cfg.board, '');
  assert.ok(!fs.existsSync(path.join(root, 'sketch')));
  assert.match(fs.readFileSync(path.join(root, 'python', 'main.py'), 'utf8'), /tkinter/);
});

test('importar una carpeta sin .ino la marca como proyecto solo de Python', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'app.py'), 'print(1)');
  assert.strictEqual(project.adopt(root).arduino, false);
});
