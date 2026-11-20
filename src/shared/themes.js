/* 10 temas, cada uno en versión oscura y clara. De cada tema salen los colores de la interfaz
   (variables CSS) y los del editor/terminal (tema de Monaco). */
(function (root) {
  // tint: [tono, saturación] del fondo · accent/accent2: acentos · syntax: colores del código (versión oscura)
  const THEMES = [
    { id: 'arpy', name: 'ARPY', tint: [208, 24], accent: '#00a6ad', accent2: '#8b5cf6',
      syntax: { keyword: '#c792ea', string: '#c3e88d', number: '#f78c6c', type: '#ffcb6b', func: '#82aaff', comment: '#5c6f84', operator: '#89ddff', variable: '#dfe7ef' } },
    { id: 'glaciar', name: 'Glaciar', tint: [216, 28], accent: '#6aa6e8', accent2: '#88c0d0',
      syntax: { keyword: '#81a1c1', string: '#a3be8c', number: '#c9a0dc', type: '#8fbcbb', func: '#88c0d0', comment: '#5f6d84', operator: '#81a1c1', variable: '#dde4ef' } },
    { id: 'bosque', name: 'Bosque', tint: [150, 20], accent: '#5fb37c', accent2: '#d4b86a',
      syntax: { keyword: '#e0a35f', string: '#a9c97a', number: '#e8c46c', type: '#7fc8a9', func: '#8fbbe0', comment: '#5f7a69', operator: '#c9b98f', variable: '#dfe9e2' } },
    { id: 'atardecer', name: 'Atardecer', tint: [345, 22], accent: '#ff7a59', accent2: '#ffb454',
      syntax: { keyword: '#ff6e8a', string: '#ffd479', number: '#ff9e64', type: '#f7a8b8', func: '#7fd1d6', comment: '#7d6573', operator: '#ffb0a0', variable: '#f1e4e8' } },
    { id: 'lavanda', name: 'Lavanda', tint: [262, 26], accent: '#a78bfa', accent2: '#f0abfc',
      syntax: { keyword: '#c4a7ff', string: '#9fe6b3', number: '#fbbf77', type: '#f0abfc', func: '#8ab4ff', comment: '#6f6889', operator: '#d6c6ff', variable: '#e9e4f5' } },
    { id: 'oceano', name: 'Océano', tint: [198, 46], accent: '#22b8cf', accent2: '#4dabf7',
      syntax: { keyword: '#4dabf7', string: '#63e6be', number: '#ffa94d', type: '#66d9e8', func: '#91a7ff', comment: '#4e6e82', operator: '#74c0fc', variable: '#dcecf3' } },
    { id: 'cafe', name: 'Café', tint: [28, 24], accent: '#d4a373', accent2: '#e9c46a',
      syntax: { keyword: '#e76f51', string: '#b5c99a', number: '#e9c46a', type: '#f4a261', func: '#94b8c9', comment: '#7d6c5d', operator: '#d9b99b', variable: '#efe6dc' } },
    { id: 'sakura', name: 'Sakura', tint: [330, 24], accent: '#f472b6', accent2: '#a78bfa',
      syntax: { keyword: '#f472b6', string: '#a7e3b0', number: '#fca5a5', type: '#c4b5fd', func: '#7dd3fc', comment: '#7c6676', operator: '#f9a8d4', variable: '#f4e6ee' } },
    { id: 'grafito', name: 'Grafito', tint: [220, 7], accent: '#a3e635', accent2: '#38bdf8',
      syntax: { keyword: '#a3e635', string: '#fcd34d', number: '#fb923c', type: '#38bdf8', func: '#e5e7eb', comment: '#6b7280', operator: '#9ca3af', variable: '#e5e7eb' } },
    { id: 'desierto', name: 'Desierto', tint: [36, 30], accent: '#e07a5f', accent2: '#81b29a',
      syntax: { keyword: '#e07a5f', string: '#81b29a', number: '#f2cc8f', type: '#d6a37a', func: '#7fa7c9', comment: '#8a7a63', operator: '#d9a98a', variable: '#f1e8db' } },
  ];

  // ---- utilidades de color ----
  function hexToHsl(hex) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s * 100, l * 100];
  }
  function hsl(h, s, l) {
    s /= 100; l /= 100;
    const k = (n) => (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => Math.round(255 * (l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1))));
    return '#' + [f(0), f(8), f(4)].map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  const shade = (hex, l, sMul = 1) => { const [h, s] = hexToHsl(hex); return hsl(h, Math.min(100, s * sMul), l); };
  // Contraste WCAG entre dos colores y ajuste de luminosidad hasta alcanzar un mínimo legible.
  const lum = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0); };
  const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  function ensure(hex, bg, min) {
    let [h, s, l] = hexToHsl(hex);
    const darker = lum(bg) > 0.4;
    let out = hex;
    for (let i = 0; i < 60 && contrast(out, bg) < min; i++) { l += darker ? -1.5 : 1.5; if (l <= 0 || l >= 100) break; out = hsl(h, s, l); }
    return out;
  }
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${n >> 16},${(n >> 8) & 255},${n & 255}`; };

  // Paleta completa de un tema para un modo ('dark' | 'light').
  function palette(id, mode) {
    const t = THEMES.find((x) => x.id === id) || THEMES[0];
    const [h, s] = t.tint;
    const dark = mode !== 'light';
    const [, as, al] = hexToHsl(t.accent);
    const bgRef = dark ? hsl(h, s, 7.5) : hsl(h, s * 0.45, 99);
    const accent = ensure(dark ? t.accent : shade(t.accent, Math.min(al, 42), 1.05), bgRef, 4.2);
    const accent2 = ensure(dark ? t.accent2 : shade(t.accent2, Math.min(hexToHsl(t.accent2)[2], 46), 1.05), bgRef, 4.2);
    const ui = dark ? {
      bg: hsl(h, s, 7.5), bg2: hsl(h, s, 9.8), bg3: hsl(h, s, 12.2), bg4: hsl(h, s * 0.95, 15.2),
      line: hsl(h, s * 0.8, 17.5), line2: hsl(h, s * 0.75, 22),
      text: hsl(h, 14, 89), text2: hsl(h, 11, 67), text3: hsl(h, 9, 48),
    } : {
      bg: hsl(h, s * 0.45, 99), bg2: hsl(h, s * 0.5, 96.6), bg3: hsl(h, s * 0.5, 93.6), bg4: hsl(h, s * 0.5, 90),
      line: hsl(h, s * 0.45, 86.5), line2: hsl(h, s * 0.4, 80),
      text: hsl(h, 22, 15), text2: hsl(h, 14, 35), text3: hsl(h, 10, 51),
    };
    const edBg = dark ? hsl(h, s, 6.5) : hsl(h, s * 0.3, 99.5);
    const syntax = {};
    for (const [k, v] of Object.entries(t.syntax)) {
      let c = v;
      if (!dark) {
        const [sh, ss, sl] = hexToHsl(v);
        c = k === 'variable' ? ui.text : k === 'comment' ? hsl(sh, Math.min(ss, 18), 52) : hsl(sh, Math.min(100, ss * 1.1 + 10), Math.min(sl, 42));
      }
      syntax[k] = ensure(c, edBg, k === 'comment' ? 3.6 : 4.6);
    }
    return {
      id: t.id, name: t.name, mode: dark ? 'dark' : 'light', ...ui, accent, accent2,
      accent3: dark ? shade(accent, Math.min(al + 8, 72), 1) : shade(accent, Math.max(al - 6, 30), 1),
      ai2: dark ? shade(accent2, Math.min(hexToHsl(accent2)[2] + 10, 78)) : accent2,
      syntax,
      editor: {
        bg: edBg,
        line: dark ? hsl(h, s, 9.5) : hsl(h, s * 0.5, 96),
        gutter: dark ? hsl(h, s * 0.7, 32) : hsl(h, s * 0.4, 66),
        selection: dark ? shade(accent, 26, 0.8) : shade(accent, 86, 0.9),
        cursor: accent,
      },
    };
  }

  // Variables CSS de la interfaz.
  function cssVars(p) {
    return {
      '--bg': p.bg, '--bg-2': p.bg2, '--bg-3': p.bg3, '--bg-4': p.bg4, '--line': p.line, '--line-2': p.line2,
      '--text': p.text, '--text-2': p.text2, '--text-3': p.text3,
      '--ino': p.accent, '--ino-2': p.accent3, '--ino-rgb': rgb(p.accent),
      '--ai': p.accent2, '--ai-2': p.ai2, '--ai-rgb': rgb(p.accent2),
    };
  }

  // Variables del editor/terminal (pueden venir de otro tema).
  function editorVars(p) {
    return { '--ed-bg': p.editor.bg, '--ed-fg': p.syntax.variable, '--ed-muted': p.syntax.comment, '--ed-line': p.editor.line };
  }

  // Tema de Monaco a partir de una paleta.
  function monacoTheme(p) {
    const c = (x) => x.replace('#', '');
    const sx = p.syntax;
    return {
      base: p.mode === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: c(sx.comment), fontStyle: 'italic' },
        { token: 'keyword', foreground: c(sx.keyword) },
        { token: 'number', foreground: c(sx.number) },
        { token: 'string', foreground: c(sx.string) },
        { token: 'type', foreground: c(sx.type) },
        { token: 'type.identifier', foreground: c(sx.type) },
        { token: 'identifier', foreground: c(sx.variable) },
        { token: 'delimiter', foreground: c(sx.operator) },
        { token: 'operator', foreground: c(sx.operator) },
        { token: 'tag', foreground: c(sx.keyword) },
        { token: 'attribute.name', foreground: c(sx.type) },
        { token: 'attribute.value', foreground: c(sx.string) },
        { token: 'predefined', foreground: c(sx.func) },
        { token: 'variable', foreground: c(sx.variable) },
        { token: 'metatag', foreground: c(sx.keyword) },
      ],
      colors: {
        'editor.background': p.editor.bg,
        'editor.foreground': sx.variable,
        'editorGutter.background': p.editor.bg,
        'editor.lineHighlightBackground': p.editor.line,
        'editor.lineHighlightBorder': p.editor.line,
        'editorLineNumber.foreground': p.editor.gutter,
        'editorLineNumber.activeForeground': p.accent,
        'editorCursor.foreground': p.editor.cursor,
        'editor.selectionBackground': p.editor.selection,
        'editor.inactiveSelectionBackground': p.editor.selection + '99',
        'editorIndentGuide.background1': p.line,
        'editorWidget.background': p.bg2,
        'editorWidget.border': p.line2,
        'editorSuggestWidget.background': p.bg2,
        'editorSuggestWidget.selectedBackground': p.bg4,
        'editorHoverWidget.background': p.bg2,
        'minimap.background': p.editor.bg,
        'scrollbarSlider.background': p.line2 + '88',
      },
    };
  }

  const api = { contrast, THEMES, palette, cssVars, editorVars, monacoTheme };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ARPY_THEMES = api;
})(typeof window !== 'undefined' ? window : globalThis);
