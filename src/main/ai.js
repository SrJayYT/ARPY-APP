const settings = require('./settings');
const project = require('./project');
const { findBoard } = require('../shared/boards');
const parts = require('../shared/parts');

const API = 'https://generativelanguage.googleapis.com/v1beta';
const MAX_HISTORY = 80; // mensajes previos que se envían en cada petición
const MAX_IMAGES_NOW = 10; // todas las del último mensaje (hasta 10)
const MAX_IMAGES_OLD = 4; // más algunas de mensajes anteriores, para poder compararlas

function tail(text, n) {
  if (!text) return '';
  return text.length > n ? '…' + text.slice(-n) : text;
}

function systemPrompt(root, live) {
  const cfg = project.readConfig(root) || {};
  const board = findBoard(cfg.board || 'arduino:avr:uno');
  const files = project.snapshot(root);
  const memory = project.loadMemory(root).trim();
  const sketch = cfg.sketch || 'sketch';
  const wiring = project.loadWiring(root);
  const wiringText = parts.describe(wiring);
  const wiringWarn = wiring ? parts.check(wiring) : [];

  const fileDump = files
    .map((f) => `===== ARCHIVO: ${f.path} =====\n${f.content}`)
    .join('\n\n');

  return `Eres ARPY, la IA integrada en "ARPY Copiler": un IDE todo-en-uno para programar placas Arduino (C/C++) y aplicaciones Python que se comunican con ellas.

## Tu forma de trabajar
- Estás DENTRO de un proyecto concreto que ya conoces por completo (todo su código está abajo) y de una conversación en curso. Nunca saludes como si fuera un chat nuevo, nunca digas "¿en qué te puedo ayudar?" ni pidas que te pasen el código: ya lo tienes. Continúa exactamente donde va la conversación.
- Si el usuario dice "eso", "lo de antes", "arréglalo", "hazlo", se refiere a lo último que se habló o al archivo/selección activa.
- Analiza a fondo antes de responder: revisa los dos lados (sketch Arduino y programa Python) para que el protocolo serie, la velocidad (baudios), los pines y los formatos de mensaje coincidan.
- Ten en cuenta la placa seleccionada: sus pines, voltaje (3.3V o 5V), memoria, librerías compatibles y capacidades (WiFi, BLE, matriz LED, etc.).
- IMÁGENES: cuando el usuario adjunta una o varias imágenes, analízalas SIEMPRE antes de responder, aunque no diga nada más. Si son varias, recórrelas una por una ("Imagen 1: …", "Imagen 2: …") y luego relaciónalas entre sí y con el proyecto.
  - Foto de un circuito o protoboard: identifica la placa, cada componente, los cables y a qué pin va cada uno (por colores y posición). Compara con el sketch y con las conexiones del proyecto, y señala errores o peligros (cortos, LEDs sin resistencia, 5V en pines de 3.3V, GND sin conectar, cables en la fila equivocada).
  - Captura de pantalla de un error (Arduino IDE, consola, Python): transcribe el error exacto, explica la causa y corrígela en los archivos.
  - Esquema, diagrama, hoja de datos o pinout: extrae los datos útiles (pines, voltajes, direcciones I2C) y úsalos.
  - Boceto o foto de una interfaz: puedes construir esa interfaz en la app Python.
  - Cualquier otra imagen: descríbela con detalle y responde a lo que pide el usuario.
  - Si algo no se distingue bien (cable tapado, foto borrosa), dilo y pide una foto más cercana de esa parte, pero analiza todo lo que sí se ve.
- Responde en el mismo idioma en que te escribe el usuario (español o inglés), claro y directo. Explica brevemente qué cambiaste y por qué.
- Si falta información real que no puedes deducir (ej. qué sensor exacto usa), asume lo más común, dilo, y avanza.

## Cómo editar archivos (IMPORTANTE)
Hay dos formas. Ninguna va dentro de bloques \`\`\`.

1) Cambios PEQUEÑOS en un archivo existente (preferido si cambias menos de ~40% del archivo): bloques buscar/reemplazar. SEARCH debe copiar EXACTAMENTE líneas que existen hoy en el archivo (con su indentación), con suficiente contexto para ser único:

<<<EDIT path="ruta/del/archivo">>>
<<<<<<< SEARCH
líneas exactas actuales
=======
líneas nuevas
>>>>>>> REPLACE
<<<END EDIT>>>

Puedes poner varios pares SEARCH/REPLACE dentro del mismo EDIT. Para insertar, incluye en SEARCH una línea vecina y repítela en el reemplazo.

2) Archivo NUEVO o reescritura grande: el archivo COMPLETO (nunca "...resto igual"):

<<<FILE path="ruta/relativa/al/proyecto.ext">>>
contenido completo del archivo
<<<END FILE>>>

- El sketch principal de Arduino es "${sketch}/${sketch.split('/').pop()}.ino". Archivos .h/.cpp extra van en esa misma carpeta.
- El programa Python principal es "${cfg.pythonMain || 'python/main.py'}". Puedes crear más módulos en "python/".
- Para borrar un archivo: <<<DELETE path="ruta">>>
- Si el sketch necesita una librería de Arduino: <<<LIB name="Nombre exacto de la librería">>>
- Si Python necesita un paquete: <<<PIP name="paquete">>> (y añádelo a python/requirements.txt)
- Para cambiar de placa: <<<BOARD fqbn="arduino:...">>>
- Guarda en la memoria del proyecto los datos importantes y duraderos (objetivo, hardware conectado, pines, protocolo, decisiones). Reescribe la memoria completa cuando cambie:
<<<MEMORY>>>
- punto 1
<<<END MEMORY>>>
- Para mostrar código de ejemplo que NO se debe guardar, usa bloques markdown normales.
- Si te piden un diagrama de conexiones, da una tabla markdown (Componente | Pin del componente | Pin de la placa | Notas) y debajo un esquema ASCII simple.

## Integración Arduino ↔ Python en ARPY
- Al ejecutar Python, ARPY define las variables de entorno ARPY_PORT (puerto serie elegido), ARPY_BAUD (baudios) y ARPY_BOARD. El código Python debe usarlas: os.environ.get("ARPY_PORT").
- Python usa pyserial para hablar con la placa. El monitor serie de ARPY se cierra automáticamente al ejecutar Python o al subir el sketch, porque el puerto no se puede compartir.
- Cada proyecto tiene su propio entorno virtual de Python (.venv); los paquetes de python/requirements.txt se instalan ahí.
- Para GUIs de escritorio usa tkinter o customtkinter salvo que el usuario pida otra cosa.

## Estado actual del IDE
- Proyecto: ${cfg.name || ''}
${cfg.arduino === false ? '- ESTE PROYECTO ES SOLO DE PYTHON (Arduino desactivado): no escribas sketches de Arduino, no hables de la placa ni del puerto serie salvo que el usuario lo pida; si lo pide, sugiérele activar Arduino en Configuración → Proyecto.\n' : ''}- Placa: ${board.name} (FQBN ${board.fqbn}) — capacidades: ${board.features.join(', ') || 'n/d'}
- Puerto: ${cfg.port || 'sin seleccionar'} | Baudios configurados: ${cfg.baud || 9600}
- Archivo activo: ${live.activeFile || 'ninguno'}${live.cursorLine ? ` (cursor en línea ${live.cursorLine})` : ''}
- Pestañas abiertas: ${(live.openFiles || []).join(', ') || 'ninguna'}
${live.selection ? `- Texto seleccionado por el usuario en ${live.activeFile}:\n\`\`\`\n${tail(live.selection, 6000)}\n\`\`\`` : ''}
${live.buildLog ? `\n### Última salida de compilación/subida\n\`\`\`\n${tail(live.buildLog, 6000)}\n\`\`\`` : ''}
${live.pythonLog ? `\n### Última salida del programa Python\n\`\`\`\n${tail(live.pythonLog, 4000)}\n\`\`\`` : ''}
${live.simLog ? `\n### Salida serie del SIMULADOR (Arduino Uno emulado)\n\`\`\`\n${tail(live.simLog, 2500)}\n\`\`\`` : ''}
${live.serialLog ? `\n### Últimos datos del monitor serie\n\`\`\`\n${tail(live.serialLog, 2500)}\n\`\`\`` : ''}
${wiringText ? `
## Conexiones del editor visual (lo que el usuario cableó: respétalo al escribir el sketch)
${wiringText}${wiringWarn.length ? `
Avisos: ${wiringWarn.join(' | ')}` : ''}
` : ''}
## Memoria del proyecto
${memory || '(vacía todavía — créala cuando entiendas el objetivo del proyecto)'}

## Código completo del proyecto (estado actual en disco, siempre actualizado)
${fileDump || '(sin archivos)'}
`;
}

function toContents(root, history) {
  const msgs = history.filter((m) => (m.text || (m.images && m.images.length)) && (m.role === 'user' || m.role === 'model')).slice(-MAX_HISTORY);
  // El último mensaje con imágenes las envía TODAS; de los anteriores, solo las más recientes.
  const send = new Map(); // índice de mensaje -> cuántas imágenes se envían
  let lastWithImages = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].images && msgs[i].images.length) { lastWithImages = i; break; }
  if (lastWithImages >= 0) send.set(lastWithImages, Math.min(MAX_IMAGES_NOW, msgs[lastWithImages].images.length));
  for (let i = lastWithImages - 1, n = 0; i >= 0 && n < MAX_IMAGES_OLD; i--) {
    const k = (msgs[i].images || []).length;
    if (k) { const take = Math.min(k, MAX_IMAGES_OLD - n); send.set(i, take); n += take; }
  }
  const contents = [];
  msgs.forEach((m, i) => {
    const parts = [];
    const imgs = m.images || [];
    const take = send.get(i) || 0;
    if (take) {
      const list = imgs.slice(-take);
      if (list.length > 1) parts.push({ text: `[El usuario adjuntó ${list.length} imágenes. Analiza CADA una por separado, en orden: Imagen 1, Imagen 2…]` });
      list.forEach((name, k) => {
        try {
          const img = project.readImage(root, name);
          if (list.length > 1) parts.push({ text: `Imagen ${k + 1} de ${list.length}:` });
          parts.push({ inlineData: { mimeType: img.mime, data: img.data } });
        } catch {}
      });
      if (imgs.length > take) parts.push({ text: `[${imgs.length - take} imagen(es) más de este mensaje no se reenviaron]` });
    } else if (imgs.length) {
      parts.push({ text: `[en este mensaje el usuario adjuntó ${imgs.length} imagen(es), ya analizadas antes]` });
    }
    if (m.text) parts.push({ text: m.text });
    const last = contents[contents.length - 1];
    if (last && last.role === m.role) last.parts.push(...parts);
    else contents.push({ role: m.role, parts });
  });
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return contents;
}

let controller = null;
// Si un modelo de respaldo funcionó hace poco, se prueba primero (evita esperar reintentos en cada mensaje).
let sticky = { from: '', to: '', until: 0 };
// Modelos de respaldo si el elegido está saturado (Gemini devuelve 503/429 en horas pico).
const FALLBACKS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-flash-lite-latest', 'gemini-3.1-flash-lite'];
const CONNECT_TIMEOUT = 30000; // ms hasta recibir respuesta del servidor
const IDLE_TIMEOUT = 120000; // ms sin recibir datos durante el streaming

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); const e = new Error('aborted'); e.name = 'AbortError'; reject(e); }, { once: true });
  });
}

// Un intento de petición con su propio timeout de conexión.
async function attempt(model, body, key, parent) {
  const ctl = new AbortController();
  const onAbort = () => ctl.abort();
  parent.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => ctl.abort(), CONNECT_TIMEOUT);
  try {
    const res = await fetch(API + '/models/' + encodeURIComponent(model) + ':streamGenerateContent?alt=sse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    clearTimeout(timer);
    return { res, ctl };
  } catch (err) {
    clearTimeout(timer);
    if (parent.aborted) throw err;
    return { timeout: true };
  }
}

// ---- Uso diario (indicador de cuota) ----
function today() { return new Date().toISOString().slice(0, 10); }
function recordUsage(model, u, fellBack) {
  const s = settings.load();
  const cur = s.usage && s.usage.day === today() ? s.usage : { day: today(), requests: 0, tokens: 0, fallbacks: 0 };
  const next = { ...cur, requests: cur.requests + 1, tokens: cur.tokens + (u.total || 0), fallbacks: (cur.fallbacks || 0) + (fellBack ? 1 : 0), lastModel: model };
  settings.save({ usage: next });
  return next;
}
function usage() {
  const s = settings.load();
  return s.usage && s.usage.day === today() ? s.usage : { day: today(), requests: 0, tokens: 0, fallbacks: 0 };
}

async function chat({ root, history, live, model }, onChunk, onStatus = () => {}) {
  const s = settings.load();
  const key = settings.apiKey();
  if (!key) throw new Error('No hay API key de Gemini disponible. Agrega una en Configuración (⚙).');
  stop();
  const main = new AbortController();
  controller = main;
  const body = {
    systemInstruction: { parts: [{ text: systemPrompt(root, live || {}) }] },
    contents: toContents(root, history),
    generationConfig: { temperature: 0.35, maxOutputTokens: 32768 },
  };
  const useModel = model || s.model || 'gemini-flash-latest';
  let plan = [useModel, useModel, ...FALLBACKS.filter((m) => m !== useModel)];
  if (sticky.from === useModel && Date.now() < sticky.until) plan = [sticky.to, ...plan.filter((m) => m !== sticky.to)];

  let res = null;
  let ctl = null;
  let used = useModel;
  let lastErr = '';
  for (let i = 0; i < plan.length && !res; i++) {
    if (i > 0) {
      onStatus('Reintentando con ' + plan[i] + '…');
      await sleep(i === 1 ? 1500 : 500, main.signal);
    }
    const r = await attempt(plan[i], body, key, main.signal);
    if (r.timeout) { lastErr = plan[i] + ': sin respuesta (timeout)'; continue; }
    if (r.res.ok) { res = r.res; ctl = r.ctl; used = plan[i]; break; }
    let msg = await r.res.text();
    try { msg = JSON.parse(msg).error.message; } catch {}
    lastErr = 'Gemini ' + plan[i] + ' (' + r.res.status + '): ' + msg.split('\n')[0];
    if (!(r.res.status === 429 || r.res.status >= 500 || r.res.status === 404)) throw new Error(lastErr);
  }
  if (!res) throw new Error(lastErr + ' — pulsa "Regenerar" para intentarlo de nuevo.');
  if (used !== useModel) sticky = { from: useModel, to: used, until: Date.now() + 10 * 60000 };
  else sticky.until = 0;
  onStatus('');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  let finish = '';
  let meta = {};
  let idle = setTimeout(() => ctl.abort(), IDLE_TIMEOUT);
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      clearTimeout(idle);
      idle = setTimeout(() => ctl.abort(), IDLE_TIMEOUT);
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line.startsWith('data:')) continue;
        let data;
        try { data = JSON.parse(line.slice(5)); } catch { continue; }
        if (data.usageMetadata) meta = data.usageMetadata;
        const cand = data.candidates && data.candidates[0];
        if (!cand) continue;
        if (cand.finishReason) finish = cand.finishReason;
        for (const part of (cand.content && cand.content.parts) || []) {
          if (part.thought || !part.text) continue;
          full += part.text;
          onChunk(part.text);
        }
      }
    }
  } catch (err) {
    if (main.signal.aborted) throw err;
    throw new Error('La conexión con Gemini se cortó. ' + (full ? 'Escribe "continúa".' : 'Pulsa "Regenerar".'));
  } finally {
    clearTimeout(idle);
    if (controller === main) controller = null;
  }
  if (finish === 'MAX_TOKENS') full += '\n\n_(respuesta cortada por longitud — escribe "continúa")_';
  else if (!finish && full) full += '\n\n_(la conexión terminó antes de completar la respuesta)_';
  else if (finish && finish !== 'STOP') full += `\n\n_(Gemini detuvo la respuesta: ${finish})_`;
  const u = { input: meta.promptTokenCount || 0, output: meta.candidatesTokenCount || 0, total: meta.totalTokenCount || 0 };
  const day = recordUsage(used, u, used !== useModel);
  return { text: full, model: used, requested: useModel, usage: u, day };
}

function stop() {
  if (controller) { controller.abort(); controller = null; }
}

// ---- Autocompletado en línea (modelo ligero, respuestas cortas) ----
let completeCtl = null;
async function complete({ path: file, prefix, suffix, lang }) {
  const key = settings.apiKey();
  if (!key) return '';
  if (completeCtl) completeCtl.abort();
  const ctl = new AbortController();
  completeCtl = ctl;
  const timer = setTimeout(() => ctl.abort(), 8000);
  const prompt = `Completa el código en la posición <CURSOR>. Archivo: ${file} (${lang === 'python' ? 'Python' : 'Arduino C++'}).
Devuelve SOLO el texto a insertar en <CURSOR> (sin repetir lo anterior, sin explicaciones, sin \`\`\`). Máximo 6 líneas. Si no hay nada útil que sugerir, devuelve vacío.

${prefix.slice(-3000)}<CURSOR>${suffix.slice(0, 1000)}`;
  try {
    const res = await fetch(`${API}/models/${settings.load().completeModel || 'gemini-flash-lite-latest'}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.2, maxOutputTokens: 200 } }),
      signal: ctl.signal,
    });
    if (!res.ok) return '';
    const data = await res.json();
    let text = (data.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
    text = text.replace(/^```[\w+-]*\n?/, '').replace(/\n?```\s*$/, '');
    return text;
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

async function listModels() {
  const key = settings.apiKey();
  if (!key) return [];
  const res = await fetch(`${API}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''))
    .filter((n) => /^gemini/.test(n) && !/(tts|image|embedding|transcribe|computer-use|robotics|live|audio)/.test(n));
}

module.exports = { chat, stop, listModels, complete, usage };
