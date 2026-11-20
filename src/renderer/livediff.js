/* Edición en vivo: mientras la IA escribe un archivo, el editor muestra en rojo lo que quita
   y en verde lo que pone, siguiendo la línea que está escribiendo. Al terminar se aplica o se descarta. */
(() => {
  const HUNK_RE = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n?=======\r?\n([\s\S]*?)\r?\n?>>>>>>> REPLACE/g;
  let cur = null; // { path, before, kind, dismissed }
  let lastFeed = 0;
  let pendingText = null;
  let timer = 0;

  // ---------- diferencias por líneas ----------
  // Devuelve operaciones [{ t: 'eq'|'del'|'add'|'pend', line }]. Con `partial`, las líneas del original
  // que la IA todavía no alcanzó se marcan como 'pend' (pendientes) en vez de borradas.
  function diff(beforeText, afterText, partial) {
    const a = beforeText.replace(/\r\n/g, '\n').split('\n');
    const b = afterText.replace(/\r\n/g, '\n').split('\n');
    if (!partial) return core(a, b);
    // Escribiendo a medias: comparar solo hasta donde llegó la IA. Se busca en el original la última
    // línea "con contenido" que ya escribió; lo que sigue en el original queda como pendiente.
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    // La última línea escrita que también existe en el original marca hasta dónde llegó
    // (las líneas nuevas que vienen después son agregados y no "consumen" el original).
    let cut = p;
    for (let k = b.length - 1; k >= p; k--) {
      if (b[k].trim().length <= 3) continue;
      const idx = a.indexOf(b[k], p);
      if (idx >= 0) { cut = idx + 1; break; }
    }
    cut = Math.max(p, Math.min(a.length, cut));
    return core(a.slice(0, cut), b).concat(a.slice(cut).map((line) => ({ t: 'pend', line })));
  }

  function core(a, b) {
    let p = 0;
    while (p < a.length && p < b.length && a[p] === b[p]) p++;
    let s = 0;
    while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s++;
    const A1 = a.slice(p, a.length - s);
    const B1 = b.slice(p, b.length - s);
    const mid = [];
    const n = A1.length, m = B1.length;
    if (n * m > 4e6) {
      A1.forEach((line) => mid.push({ t: 'del', line }));
      B1.forEach((line) => mid.push({ t: 'add', line }));
    } else {
      // LCS por programación dinámica (desde el final para reconstruir hacia adelante)
      const w = m + 1;
      const dp = new Uint32Array((n + 1) * w);
      for (let i = n - 1; i >= 0; i--) {
        for (let j = m - 1; j >= 0; j--) {
          dp[i * w + j] = A1[i] === B1[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
        }
      }
      let i = 0, j = 0;
      while (i < n && j < m) {
        if (A1[i] === B1[j]) { mid.push({ t: 'eq', line: A1[i] }); i++; j++; }
        else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) mid.push({ t: 'del', line: A1[i++] });
        else mid.push({ t: 'add', line: B1[j++] });
      }
      while (i < n) mid.push({ t: 'del', line: A1[i++] });
      while (j < m) mid.push({ t: 'add', line: B1[j++] });
    }
    return a.slice(0, p).map((line) => ({ t: 'eq', line })).concat(mid, a.slice(a.length - s).map((line) => ({ t: 'eq', line })));
  }

  // ---------- contenido parcial que va escribiendo la IA ----------
  function partialAfter(before, kind, body) {
    body = body.replace(/\r\n/g, '\n');
    if (kind === 'FILE') {
      let c = body.replace(/^\n/, '');
      c = c.replace(/^\s*```[\w+-]*\n/, ''); // a veces abre con ```
      const lastNl = c.lastIndexOf('\n');
      return lastNl >= 0 ? c.slice(0, lastNl) : ''; // solo líneas completas
    }
    // EDIT: bloques buscar/reemplazar completos + el que está a medias
    let out = before;
    let rest = body;
    let h;
    HUNK_RE.lastIndex = 0;
    let consumed = 0;
    const hunks = [];
    while ((h = HUNK_RE.exec(body))) { hunks.push({ search: h[1], replace: h[2] }); consumed = HUNK_RE.lastIndex; }
    rest = body.slice(consumed);
    const open = /<<<<<<< SEARCH\n([\s\S]*?)(?:\n=======\n([\s\S]*))?$/.exec(rest);
    if (open) {
      const search = open[1];
      if (open[2] !== undefined) {
        const rep = open[2].slice(0, Math.max(0, open[2].lastIndexOf('\n')));
        hunks.push({ search, replace: rep, partial: true });
      } else {
        // todavía escribe lo que va a quitar: se muestra en rojo
        const lines = search.split('\n');
        lines.pop();
        if (lines.length) hunks.push({ search: lines.join('\n'), replace: '', partial: true });
      }
    }
    for (const hk of hunks) {
      try { out = A.chat.applyHunks(out, [hk], cur ? cur.path : ''); } catch { /* aún no coincide: se ignora */ }
    }
    return out;
  }

  // ---------- render en el editor ----------
  function show(ops, partial) {
    const lines = [];
    const marks = [];
    let firstChange = 0, lastChange = 0, add = 0, del = 0;
    ops.forEach((o, k) => {
      lines.push(o.line);
      if (o.t !== 'eq') {
        marks.push({ line: k + 1, t: o.t });
        if (o.t !== 'pend') { if (!firstChange) firstChange = k + 1; lastChange = k + 1; }
        if (o.t === 'add') add++;
        if (o.t === 'del') del++;
      }
    });
    A.editor.livePreview(cur.path, lines.join('\n'), marks, partial ? lastChange : firstChange, { add, del, partial, isNew: cur.isNew });
    cur.stats = { add, del };
  }

  async function begin(path, kind) {
    cur = { path, kind, before: null, dismissed: false, ready: null };
    cur.ready = (async () => {
      const open = A.editor.contentOf(path);
      if (open !== null) return open;
      try { return await A.api('fs:read', path); } catch { cur.isNew = true; return ''; }
    })().then((b) => { if (cur && cur.path === path) cur.before = b; });
    await cur.ready;
  }

  // Llamado en cada fragmento que llega del streaming (se limita a ~8 veces por segundo).
  function feed(writing) {
    pendingText = writing;
    const now = Date.now();
    if (now - lastFeed < 120) { clearTimeout(timer); timer = setTimeout(() => feed(pendingText), 130); return; }
    lastFeed = now;
    run(writing);
  }

  async function run(writing) {
    if (!writing) return;
    if (!cur || cur.path !== writing.path) await begin(writing.path, writing.edit ? 'EDIT' : 'FILE');
    if (cur.dismissed || cur.before === null) return;
    const after = partialAfter(cur.before, cur.kind, writing.body || '');
    show(diff(cur.before, after, cur.kind === 'FILE'), true);
  }

  // El bloque terminó (o la respuesta acabó): diff final con el contenido completo.
  function final(path, before, after) {
    if (!cur || cur.path !== path || cur.dismissed) return;
    show(diff(before, after, false), false);
  }

  // Fin de la respuesta: si se aplicó, resaltar en el archivo real; si no, ofrecer aplicar/descartar.
  function done({ path, before, after, applied, onApply }) {
    clearTimeout(timer);
    if (!cur || cur.path !== path) { cur = null; return; }
    if (cur.dismissed) { cur = null; return; }
    if (applied) {
      A.editor.endPreview();
      A.editor.highlightChanges(path, diff(before, after, false));
      cur = null;
      return;
    }
    show(diff(before, after, false), false);
    A.editor.previewActions({
      apply: async () => { await onApply(); },
      discard: () => { A.editor.endPreview(); cur = null; },
    });
  }

  // El usuario cambió de pestaña durante la vista en vivo: no volver a forzarla.
  function dismiss() { if (cur) cur.dismissed = true; }
  function reset() { clearTimeout(timer); cur = null; }

  A.livediff = { feed, final, done, dismiss, reset, diff };
})();
