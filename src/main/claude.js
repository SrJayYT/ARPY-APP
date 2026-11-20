// Anthropic (Claude) con el SDK oficial @anthropic-ai/sdk.
const sdk = require('@anthropic-ai/sdk');

const Anthropic = sdk.default || sdk.Anthropic || sdk;
const DEFAULT_MODEL = 'claude-opus-5-5';
// Modelos que aceptan el respaldo del servidor ante un rechazo (refusal): la misma petición
// se reintenta en otro modelo dentro de la misma llamada, en vez de quedarse sin respuesta.
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);

const client = (key) => new Anthropic({ apiKey: key, maxRetries: 2 });

async function listModels(key) {
  const out = [];
  try {
    for await (const m of client(key).models.list()) out.push(m.id);
  } catch (e) {
    const err = new Error(e.message);
    err.status = e.status;
    throw err;
  }
  return out;
}

// Estado de key a partir de un error tipado del SDK (o null si no es un problema de la key).
function keyStatus(e) {
  const msg = String(e && e.message || '').toLowerCase();
  if (e instanceof Anthropic.AuthenticationError) return /expired/.test(msg) ? 'expired' : 'invalid';
  if (e instanceof Anthropic.PermissionDeniedError) return /credit|billing/.test(msg) ? 'no-credit' : 'suspended';
  if (e instanceof Anthropic.BadRequestError && /credit balance|billing/.test(msg)) return 'no-credit';
  return null;
}

// messages: [{ role: 'user'|'assistant', parts: [{ text } | { inlineData: { mimeType, data } }] }]
async function chat(key, model, system, messages, onChunk, signal) {
  model = model || DEFAULT_MODEL;
  const params = {
    model,
    max_tokens: 64000,
    system,
    messages: messages.map((m) => ({
      role: m.role,
      content: m.parts.map((p) => (p.inlineData
        ? { type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } }
        : { type: 'text', text: p.text })),
    })),
  };
  const c = client(key);
  const stream = FALLBACK_MODELS.has(model)
    ? c.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
    : c.messages.stream(params, { signal });
  let full = '';
  stream.on('text', (t) => { full += t; onChunk(t); });
  let final;
  try {
    final = await stream.finalMessage();
  } catch (e) {
    if (e instanceof Anthropic.APIUserAbortError || (signal && signal.aborted)) { const ab = new Error('aborted'); ab.name = 'AbortError'; throw ab; }
    const st = keyStatus(e);
    // el SDK trae el cuerpo del error ya interpretado: se muestra solo su mensaje
    let msg = (e.error && e.error.error && e.error.error.message) || e.message;
    if (e instanceof Anthropic.RateLimitError) msg = 'Límite de peticiones de Anthropic alcanzado. Espera un momento y pulsa "Regenerar".';
    else if (e instanceof Anthropic.APIConnectionError) msg = 'No se pudo conectar con Anthropic. Revisa tu conexión.';
    const err = new Error(`Anthropic (${e.status || 'error'}): ${msg}`);
    err.keyStatus = st;
    throw err;
  }
  if (final.stop_reason === 'refusal') {
    const cat = final.stop_details && final.stop_details.category;
    full += `\n\n_(Claude no respondió a esta petición por sus políticas de seguridad${cat ? `: ${cat}` : ''}. Reformúlala o usa otro proveedor.)_`;
  } else if (final.stop_reason === 'max_tokens') {
    full += '\n\n_(respuesta cortada por longitud — escribe "continúa")_';
  }
  const u = final.usage || {};
  const input = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
  return { text: full, model: final.model || model, usage: { input, output: u.output_tokens || 0, total: input + (u.output_tokens || 0) } };
}

module.exports = { chat, listModels, DEFAULT_MODEL };
