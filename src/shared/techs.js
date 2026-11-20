/* Tecnologías que puede usar un proyecto. Cada una tiene su carpeta, extensiones, archivo inicial
   y cómo se ejecuta. Un proyecto puede combinar varias (ej. Arduino + Python + Web). */
(function (root) {
  const TECHS = [
    { id: 'arduino', name: 'Arduino', short: 'INO', color: '#00a6ad', folder: 'sketch', ext: ['.ino'],
      desc: 'Placas Arduino (C/C++): compilar, subir y simular' },
    { id: 'python', name: 'Python', short: 'PY', color: '#f2c94c', folder: 'python', ext: ['.py'],
      desc: 'Scripts y apps de escritorio, con entorno virtual' },
    { id: 'javascript', name: 'JavaScript (Node.js)', short: 'JS', color: '#e8d44d', folder: 'js', ext: ['.js', '.mjs', '.cjs'],
      desc: 'Programas de Node.js, sin instalar nada' },
    { id: 'web', name: 'Web (HTML, CSS, JS)', short: 'HTML', color: '#e44d26', folder: 'web', ext: ['.html', '.htm', '.css'], preview: true,
      desc: 'Páginas web con vista previa en vivo' },
    { id: 'ejs', name: 'EJS', short: 'EJS', color: '#a91e50', folder: 'views', ext: ['.ejs'], preview: true,
      desc: 'Plantillas HTML con datos, con vista previa' },
    { id: 'php', name: 'PHP', short: 'PHP', color: '#7a86b8', folder: 'php', ext: ['.php'], preview: true, runtime: 'php',
      desc: 'Scripts y páginas PHP (se instala con un clic)' },
    { id: 'java', name: 'Java', short: 'JAVA', color: '#e76f00', folder: 'java', ext: ['.java'], runtime: 'java',
      desc: 'Programas Java (el JDK se instala con un clic)' },
    { id: 'sql', name: 'SQL (SQLite)', short: 'SQL', color: '#3ca0dc', folder: 'sql', ext: ['.sql'],
      desc: 'Bases de datos SQLite: ejecuta consultas y ve tablas' },
  ];

  const STARTERS = {
    javascript: [['js/main.js', `// Programa de Node.js. Ejecútalo con F5 (la salida aparece en la Consola).
const nombre = process.argv[2] || 'mundo';

function saludar(quien) {
  return \`Hola, \${quien}. Son las \${new Date().toLocaleTimeString()}.\`;
}

console.log(saludar(nombre));
`]],
    web: [
      ['web/index.html', `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Mi página</title>
  <link rel="stylesheet" href="style.css" />
</head>
<body>
  <main>
    <h1>Hola desde ARPY</h1>
    <p>Edita <code>web/index.html</code> y mira los cambios en la vista previa.</p>
    <button id="boton">Púlsame</button>
    <p id="contador">0 clics</p>
  </main>
  <script src="script.js"></script>
</body>
</html>
`],
      ['web/style.css', `body {
  font-family: system-ui, sans-serif;
  background: #f3eee4;
  color: #2b2a28;
  display: grid;
  place-items: center;
  min-height: 100vh;
  margin: 0;
}
main { text-align: center; }
button {
  padding: 10px 22px;
  border: 0;
  border-radius: 8px;
  background: #c8553d;
  color: #fff;
  font-size: 16px;
  cursor: pointer;
}
`],
      ['web/script.js', `let clics = 0;
document.getElementById('boton').addEventListener('click', () => {
  clics++;
  document.getElementById('contador').textContent = \`\${clics} clic\${clics === 1 ? '' : 's'}\`;
});
`],
    ],
    ejs: [
      ['views/index.ejs', `<!doctype html>
<html lang="es">
<head><meta charset="utf-8" /><title><%= titulo %></title></head>
<body style="font-family: system-ui; padding: 32px">
  <h1><%= titulo %></h1>
  <ul>
    <% for (const tarea of tareas) { %>
      <li><%= tarea.hecha ? '✔' : '○' %> <%= tarea.texto %></li>
    <% } %>
  </ul>
</body>
</html>
`],
      ['views/index.json', `{
  "titulo": "Mis tareas",
  "tareas": [
    { "texto": "Probar la vista previa de EJS", "hecha": true },
    { "texto": "Cambiar los datos en views/index.json", "hecha": false }
  ]
}
`],
    ],
    php: [['php/index.php', `<?php
// Página PHP. Ábrela en la vista previa o ejecútala con F5.
$nombre = $_GET['nombre'] ?? 'mundo';
$hora = date('H:i');
?>
<!doctype html>
<html lang="es">
<head><meta charset="utf-8"><title>PHP</title></head>
<body style="font-family: system-ui; padding: 32px">
  <h1>Hola, <?= htmlspecialchars($nombre) ?></h1>
  <p>Son las <?= $hora ?> en el servidor.</p>
</body>
</html>
`]],
    java: [['java/Main.java', `// Programa Java. Ejecútalo con F5 (la salida aparece en la Consola).
public class Main {
    public static void main(String[] args) {
        int suma = 0;
        for (int i = 1; i <= 10; i++) {
            suma += i;
        }
        System.out.println("Hola desde Java. La suma del 1 al 10 es " + suma);
    }
}
`]],
    sql: [['sql/consultas.sql', `-- Base de datos SQLite del proyecto: sql/database.sqlite
-- Ejecuta este archivo con F5: las tablas de resultados aparecen en la Consola.

CREATE TABLE IF NOT EXISTS lecturas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sensor TEXT NOT NULL,
  valor REAL NOT NULL,
  fecha TEXT DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO lecturas (sensor, valor) VALUES ('temperatura', 23.5), ('humedad', 58);

SELECT sensor, ROUND(AVG(valor), 1) AS promedio, COUNT(*) AS lecturas
FROM lecturas
GROUP BY sensor;
`]],
  };

  const find = (id) => TECHS.find((t) => t.id === id);

  // Tecnologías activas de un proyecto (compatible con proyectos antiguos sin "tech").
  function techsOf(cfg) {
    if (cfg && Array.isArray(cfg.tech) && cfg.tech.length) return cfg.tech.filter((id) => find(id));
    return cfg && cfg.arduino === false ? ['python'] : ['arduino', 'python'];
  }

  function techOfFile(file) {
    const ext = (/\.[^./\\]+$/.exec(file || '') || [''])[0].toLowerCase();
    return TECHS.find((t) => t.ext.includes(ext)) || null;
  }

  // Cómo se ejecuta un archivo: 'python' | 'node' | 'java' | 'php' | 'sql' | 'preview' | null
  function runnerFor(file) {
    const ext = (/\.[^./\\]+$/.exec(file || '') || [''])[0].toLowerCase();
    if (ext === '.py') return 'python';
    if (['.js', '.mjs', '.cjs'].includes(ext)) return /(^|\/)web\//.test(file) ? 'preview' : 'node';
    if (ext === '.java') return 'java';
    if (ext === '.php') return 'php';
    if (ext === '.sql') return 'sql';
    if (['.html', '.htm', '.ejs', '.css'].includes(ext)) return 'preview';
    return null;
  }

  const api = { TECHS, STARTERS, find, techsOf, techOfFile, runnerFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ARPY_TECHS = api;
})(typeof window !== 'undefined' ? window : globalThis);
