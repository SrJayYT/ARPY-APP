// Ejecuta un archivo .sql contra la base SQLite del proyecto e imprime los resultados como tablas.
// Se lanza con el Node.js integrado de la app: ELECTRON_RUN_AS_NODE=1 <app> sqlrun.js <db> <archivo.sql>
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const [dbPath, sqlFile] = process.argv.slice(2);
const sql = fs.readFileSync(sqlFile, 'utf8');
const db = new DatabaseSync(dbPath);

// Separa sentencias respetando comillas y comentarios.
function statements(text) {
  const out = [];
  let cur = '', q = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (!q && c === '-' && n === '-') { while (i < text.length && text[i] !== '\n') i++; cur += '\n'; continue; }
    if (!q && c === '/' && n === '*') { i = text.indexOf('*/', i + 2); if (i < 0) break; i++; continue; }
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === '`') { q = c; cur += c; continue; }
    if (c === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function table(rows) {
  if (!rows.length) return '(sin filas)';
  const cols = Object.keys(rows[0]);
  const fmt = (v) => (v === null ? 'NULL' : String(v));
  const w = cols.map((c) => Math.min(40, Math.max(c.length, ...rows.map((r) => fmt(r[c]).length))));
  const line = (vals) => '│ ' + vals.map((v, i) => fmt(v).slice(0, 40).padEnd(w[i])).join(' │ ') + ' │';
  const sep = (l, m, r) => l + w.map((x) => '─'.repeat(x + 2)).join(m) + r;
  return [sep('┌', '┬', '┐'), line(cols), sep('├', '┼', '┤'), ...rows.map((r) => line(cols.map((c) => r[c]))), sep('└', '┴', '┘'), `${rows.length} fila${rows.length === 1 ? '' : 's'}`].join('\n');
}

let n = 0;
for (const st of statements(sql)) {
  n++;
  const head = st.replace(/\s+/g, ' ').slice(0, 70);
  try {
    if (/^\s*(select|with|pragma|explain)\b/i.test(st) || /\breturning\b/i.test(st)) {
      const rows = db.prepare(st).all();
      console.log(`\n▶ ${head}\n${table(rows)}`);
    } else {
      const r = db.prepare(st).run();
      console.log(`✔ ${head}${r.changes ? `  (${r.changes} fila${r.changes === 1 ? '' : 's'} afectada${r.changes === 1 ? '' : 's'})` : ''}`);
    }
  } catch (e) {
    console.error(`✖ Error en la sentencia ${n}: ${head}\n  ${e.message}`);
    process.exitCode = 1;
    break;
  }
}
db.close();
