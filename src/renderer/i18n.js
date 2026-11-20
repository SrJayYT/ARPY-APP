/* Idioma de la interfaz. Los textos del código están en español; con el inglés activo (por defecto),
   un observador traduce los textos que aparecen en pantalla usando el diccionario de src/shared/i18n-en.js.
   No toca el código del editor, los nombres de archivos ni lo que escribe la IA. */
(() => {
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const lang = get('arpy.lang') || 'en';
  document.documentElement.lang = lang;
  const SKIP = '.monaco-editor, .msg .body, .msg.user, #tree, .tab, .path, .wv-sum, .dz-w, code, pre:not(.log), textarea, [contenteditable], .no-i18n';
  const ATTRS = ['placeholder', 'title', 'aria-label', 'data-empty'];
  let dict = null;

  function load() {
    if (dict) return dict;
    const d = window.ARPY_I18N_EN || { exact: {}, patterns: [] };
    dict = { exact: new Map(Object.entries(d.exact)), patterns: d.patterns };
    return dict;
  }

  // Traduce un texto (exacto, sin símbolos iniciales, o por patrón). Los grupos del patrón también se traducen.
  function tr(text, depth = 0) {
    if (lang !== 'en' || !text || depth > 2) return text;
    const D = load();
    if (D.exact.has(text)) return D.exact.get(text);
    const m = /^([^\p{L}\p{N}¿¡"'(]*)([\s\S]*?)([\s.:…]*)$/u.exec(text);
    const lead = m ? m[1] : '';
    const core = m ? m[2] : text;
    const tail = m ? m[3] : '';
    if (core !== text) {
      if (D.exact.has(core)) return lead + D.exact.get(core) + tail;
      if (D.exact.has(core + tail.trim())) return lead + D.exact.get(core + tail.trim());
    }
    // patrones: primero con el texto completo (algunos empiezan con ⬆ ▶ …), luego sin símbolos iniciales
    for (const [src, pre, post] of [[text, '', ''], [core, lead, tail]]) {
      for (const [re, rep] of D.patterns) {
        const mm = re.exec(src);
        if (!mm) continue;
        return pre + rep.replace(/\$(\d)/g, (_, i) => tr(mm[+i] || '', depth + 1)) + post;
      }
    }
    return text;
  }

  // Textos de varias líneas (logs, mensajes para la IA): línea por línea.
  function t(text) {
    if (lang !== 'en' || !text) return text;
    if (!text.includes('\n')) return translateKeepSpace(text);
    return text.split('\n').map(translateKeepSpace).join('\n');
  }

  function translateKeepSpace(s) {
    const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
    if (!m[2]) return s;
    const out = tr(m[2]);
    return out === m[2] ? s : m[1] + out + m[3];
  }

  // Dentro de los mensajes del chat solo se traducen los controles (tarjetas de acciones, botones), no el texto.
  const UI_IN_MSG = '.action-card, .apply-all, .msg-meta, .who, button';
  function skip(el) {
    if (!el || !el.closest) return false;
    if (el.closest('.action-card .path:not(.muted), .monaco-editor, #tree, .tab')) return true;
    if (el.closest(UI_IN_MSG)) return false;
    return !!el.closest(SKIP);
  }

  function translateNode(node) {
    if (node.nodeType === 3) {
      const parent = node.parentElement;
      if (!parent || skip(parent)) return;
      const v = node.nodeValue;
      if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]/.test(v)) return;
      if (parent.closest('pre.log')) {
        // registros: solo las líneas que generó la app (no la salida de arduino-cli o Python)
        if (!/[áéíóúñ¿¡]|^[\s\n]*[▶⬆⏬📚🧪📦🐞■✔✖⚠—💡⏳🤖✅⛔🔁]/m.test(v)) return;
        const out = t(v);
        if (out !== v) node.nodeValue = out;
        return;
      }
      const out = t(v);
      if (out !== v) node.nodeValue = out;
      return;
    }
    if (node.nodeType !== 1) return;
    // los atributos (placeholder, title…) se traducen también en campos de texto
    if (!(node.closest && node.closest('.monaco-editor'))) for (const a of ATTRS) {
      const v = node.getAttribute && node.getAttribute(a);
      if (v) { const out = t(v); if (out !== v) node.setAttribute(a, out); }
    }
    if (node.tagName === 'INPUT' && (node.type === 'button' || node.type === 'submit') && node.value) node.value = t(node.value);
    if (skip(node) && !node.querySelector(UI_IN_MSG)) return;
    for (const c of node.childNodes) translateNode(c);
  }

  function start() {
    if (lang !== 'en') return;
    translateNode(document.body);
    new MutationObserver((list) => {
      for (const r of list) {
        if (r.type === 'characterData') translateNode(r.target);
        else if (r.type === 'attributes') translateNode(r.target);
        else r.addedNodes.forEach(translateNode);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  if (document.body) start();
  else document.addEventListener('DOMContentLoaded', start);

  // Cambiar idioma: se guarda y se recarga la ventana (el proyecto abierto se vuelve a abrir).
  async function reload() {
    try {
      const s = await window.arpy.invoke('settings:get');
      localStorage.setItem('arpy.lang', s.lang || 'en');
      if (window.A && A.app && A.app.root) sessionStorage.setItem('arpy.reopen', A.app.root);
    } catch {}
    location.reload();
  }

  window.ARPY_I18N = { lang, t, tr, reload };
})();
