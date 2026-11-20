// Tecnologías por proyecto, ejecución de SQL con SQLite y temas (contraste legible).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const T = require('../src/shared/techs');
const TH = require('../src/shared/themes');
const project = require('../src/main/project');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arpy-tech-'));

test('proyectos antiguos se interpretan como Arduino + Python (o solo Python)', () => {
  assert.deepStrictEqual(T.techsOf({}), ['arduino', 'python']);
  assert.deepStrictEqual(T.techsOf({ arduino: false }), ['python']);
  assert.deepStrictEqual(T.techsOf({ tech: ['javascript', 'nada'] }), ['javascript']);
});

test('cada archivo sabe cómo ejecutarse', () => {
  const cases = { 'python/main.py': 'python', 'js/main.js': 'node', 'web/script.js': 'preview', 'java/Main.java': 'java',
    'php/index.php': 'php', 'sql/q.sql': 'sql', 'web/index.html': 'preview', 'views/index.ejs': 'preview', 'sketch/sketch.ino': null };
  for (const [f, kind] of Object.entries(cases)) assert.strictEqual(T.runnerFor(f), kind, f);
});

test('crear un proyecto mixto crea los archivos de cada tecnología', () => {
  const root = project.create(tmp(), 'Mixto', 'app', 'arduino:avr:uno', { tech: ['arduino', 'python', 'javascript', 'web', 'java', 'sql'] });
  for (const f of ['sketch/sketch.ino', 'python/main.py', 'js/main.js', 'web/index.html', 'web/style.css', 'java/Main.java', 'sql/consultas.sql']) {
    assert.ok(fs.existsSync(path.join(root, f)), f);
  }
  assert.ok(!fs.existsSync(path.join(root, 'php')));
  assert.deepStrictEqual(project.readConfig(root).tech, ['arduino', 'python', 'javascript', 'web', 'java', 'sql']);
});

test('proyecto solo de JavaScript y activar tecnologías después', () => {
  const root = project.create(tmp(), 'Solo JS', '', null, { tech: ['javascript'] });
  assert.ok(!fs.existsSync(path.join(root, 'python')));
  assert.ok(!fs.existsSync(path.join(root, 'sketch')));
  const cfg = project.setTechs(root, ['javascript', 'ejs', 'arduino']);
  assert.strictEqual(cfg.arduino, true);
  assert.ok(fs.existsSync(path.join(root, 'views', 'index.ejs')));
  assert.ok(fs.existsSync(path.join(root, 'sketch', 'sketch.ino')));
  assert.throws(() => project.setTechs(root, []), /al menos una/);
});

test('importar una carpeta detecta sus tecnologías', () => {
  const root = tmp();
  fs.writeFileSync(path.join(root, 'App.java'), 'class App {}');
  fs.writeFileSync(path.join(root, 'index.html'), '<p>hola</p>');
  assert.deepStrictEqual(project.adopt(root).tech.sort(), ['java', 'web']);
});

test('los archivos iniciales de JavaScript funcionan', () => {
  const root = project.create(tmp(), 'JS', '', null, { tech: ['javascript'] });
  const r = spawnSync(process.execPath, [path.join(root, 'js', 'main.js'), 'ARPY'], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /Hola, ARPY/);
});

test('SQL: se ejecuta contra SQLite y muestra tablas', () => {
  const root = project.create(tmp(), 'SQL', '', null, { tech: ['sql'] });
  const db = path.join(root, 'sql', 'database.sqlite');
  const run = () => spawnSync(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'src', 'main', 'sqlrun.js'), db, path.join(root, 'sql', 'consultas.sql')], { encoding: 'utf8' });
  const r = run();
  assert.strictEqual(r.status, 0, r.stderr);
  assert.match(r.stdout, /│ sensor\s+│ promedio\s+│ lecturas │/);
  assert.match(r.stdout, /temperatura/);
  // la base persiste: al ejecutar de nuevo hay 2 lecturas por sensor
  assert.match(run().stdout, /│ temperatura │ 23\.5\s+│ 2\s+│/);
  fs.writeFileSync(path.join(root, 'sql', 'mal.sql'), 'SELEC * FROM nada;');
  const bad = spawnSync(process.execPath, ['--no-warnings', path.join(__dirname, '..', 'src', 'main', 'sqlrun.js'), db, path.join(root, 'sql', 'mal.sql')], { encoding: 'utf8' });
  assert.notStrictEqual(bad.status, 0);
  assert.match(bad.stderr, /Error en la sentencia 1/);
});

test('los 10 temas, en oscuro y claro, tienen contraste legible', () => {
  assert.strictEqual(TH.THEMES.length, 10);
  for (const t of TH.THEMES) {
    for (const mode of ['dark', 'light']) {
      const p = TH.palette(t.id, mode);
      assert.ok(TH.contrast(p.text, p.bg) >= 7, `${t.id} ${mode} texto`);
      assert.ok(TH.contrast(p.text2, p.bg) >= 4.5, `${t.id} ${mode} texto secundario`);
      assert.ok(TH.contrast(p.accent, p.bg) >= 4, `${t.id} ${mode} acento`);
      for (const [k, v] of Object.entries(p.syntax)) assert.ok(TH.contrast(v, p.editor.bg) >= (k === 'comment' ? 3.5 : 4.5), `${t.id} ${mode} código ${k}`);
      const mt = TH.monacoTheme(p);
      for (const v of Object.values(mt.colors)) assert.match(v, /^#[0-9a-f]{6}([0-9a-f]{2})?$/i);
      assert.strictEqual(Object.keys(TH.cssVars(p)).length, 15);
    }
  }
});

test('proveedores de IA: los errores de key se clasifican bien', () => {
  const { classify, PROVIDERS } = require('../src/main/providers');
  assert.strictEqual(classify(401, 'Incorrect API key provided'), 'invalid');
  assert.strictEqual(classify(400, 'API key expired. Please renew the API key.'), 'expired');
  assert.strictEqual(classify(403, 'Your account has been suspended'), 'suspended');
  assert.strictEqual(classify(402, 'Insufficient Balance'), 'no-credit');
  assert.strictEqual(classify(429, 'You exceeded your current quota, please check your plan and billing details'), 'no-credit');
  assert.strictEqual(classify(429, 'Rate limit reached'), 'rate-limited');
  assert.deepStrictEqual(PROVIDERS.map((p) => p.id), ['gemini', 'anthropic', 'openai', 'deepseek', 'mistral', 'groq', 'openrouter']);
  assert.strictEqual(PROVIDERS.find((p) => p.id === 'anthropic').defaultModel, 'claude-opus-5-5');
});
