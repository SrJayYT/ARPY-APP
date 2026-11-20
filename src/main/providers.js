// Proveedores de IA: Google Gemini, Anthropic (Claude), OpenAI y servicios compatibles con su API
// (DeepSeek, Mistral, Groq, OpenRouter). Verificación de keys y chat por streaming.
const claude = require('./claude');

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', kind: 'gemini', keyUrl: 'https://aistudio.google.com/apikey', keyHint: 'AIza…', vision: true },
  { id: 'anthropic', name: 'Anthropic (Claude)', kind: 'anthropic', keyUrl: 'https://platform.claude.com/settings/keys', keyHint: 'sk-ant-…', vision: true, defaultModel: 'claude-opus-5-5' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', base: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', keyHint: 'sk-…', vision: true, streamUsage: true },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', base: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys', keyHint: 'sk-…', vision: false, streamUsage: true, defaultModel: 'deepseek-chat' },
  { id: 'mistral', name: 'Mistral', kind: 'openai', base: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', keyHint: '', vision: true },
  { id: 'groq', name: 'Groq', kind: 'openai', base: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', keyHint: 'gsk_…', vision: false },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', base: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/settings/keys', keyHint: 'sk-or-…', vision: true, streamUsage: true },
];
const find = (id) => PROVIDERS.find((p) => p.id === id);
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

async function timedFetch(url, opts = {}, ms = 12000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { return await fetch(url, { ...opts, signal: ctl.signal }); } finally { clearTimeout(t); }
}

// Traduce la respuesta de error de un proveedor a un estado entendible.
function classify(status, message) {
  const m = String(message || '').toLowerCase();
  if (/suspend|disabled|deactivated|banned|blocked|organization.*(inactive|restricted)/.test(m)) return 'suspended';
  if (/expired|expir/.test(m)) return 'expired';
  if (status === 402 || /insufficient.?(balance|quota|credit|funds)|billing|credit balance|payment/.test(m)) return 'no-credit';
  if (status === 401 || /invalid.*(api.?key|key)|incorrect api key|api key not valid|unauthori[sz]ed|authentication/.test(m)) return 'invalid';
  if (status === 403) return 'suspended';
  if (status === 429) return 'rate-limited';
  return 'error';
}

async function errorMessage(res) {
  let txt = await res.text().catch(() => '');
  try {
    const j = JSON.parse(txt);
    txt = (j.error && (j.error.message || j.error.code)) || j.message || j.detail || txt;
    if (typeof txt !== 'string') txt = JSON.stringify(txt);
  } catch {}
  return String(txt).split('\n')[0].slice(0, 300);
}

// ---- Modelos disponibles (también sirve para verificar la key sin gastar tokens) ----
async function listModels(id, key) {
  const p = find(id);
  if (!p) throw new Error('Proveedor desconocido');
  if (p.kind === 'anthropic') return claude.listModels(key);
  if (p.kind === 'gemini') {
    const res = await timedFetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) { const e = new Error(await errorMessage(res)); e.status = res.status; throw e; }
    const data = await res.json();
    return (data.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''))
      .filter((n) => /^gemini/.test(n) && !/(tts|image|embedding|transcribe|computer-use|robotics|live|audio)/.test(n));
  }
  const res = await timedFetch(`${p.base}/models`, { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) { const e = new Error(await errorMessage(res)); e.status = res.status; throw e; }
  const data = await res.json();
  let ids = (data.data || data.models || []).map((m) => m.id || m.name).filter(Boolean);
  if (id === 'openai') ids = ids.filter((n) => /^(gpt|o\d|chatgpt)/.test(n) && !/(audio|realtime|tts|transcribe|image|embedding|search|moderation|instruct)/.test(n));
  return ids.sort();
}

// Estado de una key: ok | invalid | expired | suspended | no-credit | rate-limited | offline | error
async function verify(id, key) {
  if (!key) return { status: 'missing' };
  try {
    // OpenRouter publica su lista de modelos sin pedir key: se verifica con /key
    if (id === 'openrouter') {
      const res = await timedFetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` } });
      if (!res.ok) { const e = new Error(await errorMessage(res)); e.status = res.status; throw e; }
    }
    const models = await listModels(id, key);
    return { status: 'ok', models: models.length, checked: Date.now() };
  } catch (e) {
    if (e.name === 'AbortError' || /fetch failed|ENOTFOUND|ECONNREFUSED|network/i.test(e.message || '')) return { status: 'offline', message: 'Sin conexión', checked: Date.now() };
    const status = e.status || 0;
    // 429 por límite de velocidad = la key es válida; por cuota agotada = sin saldo
    const st = classify(status, e.message);
    return { status: st, message: e.message, checked: Date.now() };
  }
}

// ---- Chat con APIs compatibles con OpenAI (OpenAI, DeepSeek, Mistral, Groq, OpenRouter) ----
// messages: [{ role: 'user'|'assistant', parts: [{ text } | { inlineData: { mimeType, data } }] }]
async function chatOpenAI(p, key, model, system, messages, onChunk, signal) {
  const body = {
    model,
    stream: true,
    messages: [{ role: 'system', content: system }, ...messages.map((m) => {
      const texts = m.parts.filter((x) => x.text).map((x) => x.text);
      const imgs = m.parts.filter((x) => x.inlineData);
      if (m.role === 'assistant' || !imgs.length) return { role: m.role, content: texts.join('\n') + (imgs.length && !p.vision ? '\n[imágenes omitidas: este modelo no admite imágenes]' : '') };
      if (!p.vision) return { role: m.role, content: texts.join('\n') + '\n[El usuario adjuntó imágenes, pero este modelo no puede verlas. Pídele que las describa o que use otro proveedor.]' };
      return { role: m.role, content: [...texts.map((t) => ({ type: 'text', text: t })), ...imgs.map((x) => ({ type: 'image_url', image_url: { url: `data:${x.inlineData.mimeType};base64,${x.inlineData.data}` } }))] };
    })],
  };
  if (p.streamUsage) body.stream_options = { include_usage: true };
  const res = await fetch(`${p.base}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(p.id === 'openrouter' ? { 'X-Title': 'ARPY Copiler' } : {}) },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const msg = await errorMessage(res);
    const st = classify(res.status, msg);
    const e = new Error(`${p.name} (${res.status}): ${msg}`);
    e.keyStatus = ['invalid', 'expired', 'suspended', 'no-credit'].includes(st) ? st : null;
    throw e;
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '', full = '', finish = '', usage = null, used = model;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let d;
      try { d = JSON.parse(payload); } catch { continue; }
      if (d.model) used = d.model;
      if (d.usage) usage = d.usage;
      const c = d.choices && d.choices[0];
      if (!c) continue;
      if (c.finish_reason) finish = c.finish_reason;
      const t = c.delta && c.delta.content;
      if (t) { full += t; onChunk(t); }
    }
  }
  if (finish === 'length') full += '\n\n_(respuesta cortada por longitud — escribe "continúa")_';
  else if (finish === 'content_filter') full += '\n\n_(el proveedor bloqueó la respuesta por sus filtros de contenido)_';
  const u = usage ? { input: usage.prompt_tokens || 0, output: usage.completion_tokens || 0, total: usage.total_tokens || 0 } : { input: 0, output: 0, total: 0 };
  return { text: full, model: used, usage: u };
}

module.exports = { PROVIDERS, find, verify, listModels, chatOpenAI, classify };
