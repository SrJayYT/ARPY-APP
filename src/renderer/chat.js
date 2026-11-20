/* Chat de IA: conversaciones persistentes por proyecto, imágenes, edición de archivos y modo agente */
(() => {
  let messages = []; // { id, role: 'user'|'model'|'note', text, images, ts, applied, error, model, usage, auto }
  let chats = [];
  let chatId = null;
  let chatTitle = '';
  let busy = false;
  let reqId = 0;
  let streaming = null;
  let fileCount = 0;
  let pendingImages = []; // dataURLs aún no enviados
  let agentRound = 0;
  const AGENT_MAX = 3;

  const BLOCK_RE = new RegExp([
    '<<<FILE path="(?<fpath>[^"]+)">>>\\r?\\n?(?<fcontent>[\\s\\S]*?)\\r?\\n?<<<END FILE>>>',
    '<<<EDIT path="(?<epath>[^"]+)">>>\\r?\\n?(?<ebody>[\\s\\S]*?)<<<END EDIT>>>',
    '<<<DELETE path="(?<del>[^"]+)">>>',
    '<<<LIB name="(?<lib>[^"]+)">>>',
    '<<<PIP name="(?<pip>[^"]+)">>>',
    '<<<BOARD fqbn="(?<board>[^"]+)">>>',
    '<<<MEMORY>>>\\r?\\n?(?<mem>[\\s\\S]*?)\\r?\\n?<<<END MEMORY>>>',
  ].join('|'), 'g');
  const HUNK_RE = /<<<<<<< SEARCH\r?\n([\s\S]*?)\r?\n?=======\r?\n([\s\S]*?)\r?\n?>>>>>>> REPLACE/g;

  marked.setOptions({ gfm: true, breaks: false });

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const fmtK = (n) => (n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n || 0));

  function stripFence(s) {
    const m = s.match(/^\s*```[\w+-]*\r?\n([\s\S]*?)\r?\n```\s*$/);
    return m ? m[1] : s;
  }
  const cleanPath = (p) => p.trim().replace(/\\/g, '/').replace(/^\.?\//, '');

  // ---------- parseo de la respuesta ----------
  function parse(text, partial) {
    const actions = [];
    let md = text.replace(BLOCK_RE, (...args) => {
      const g = args[args.length - 1];
      let a;
      if (g.fpath) a = { type: 'file', path: cleanPath(g.fpath), content: stripFence(g.fcontent) };
      else if (g.epath) {
        const hunks = [];
        let h;
        HUNK_RE.lastIndex = 0;
        while ((h = HUNK_RE.exec(g.ebody))) hunks.push({ search: h[1], replace: h[2] });
        a = { type: 'edit', path: cleanPath(g.epath), hunks };
      } else if (g.del) a = { type: 'delete', path: cleanPath(g.del) };
      else if (g.lib) a = { type: 'lib', name: g.lib.trim() };
      else if (g.pip) a = { type: 'pip', name: g.pip.trim() };
      else if (g.board) a = { type: 'board', fqbn: g.board.trim() };
      else a = { type: 'memory', content: (g.mem || '').trim() };
      actions.push(a);
      return `\n\n<div data-action="${actions.length - 1}"></div>\n\n`;
    });
    let writing = null;
    if (partial) {
      const open = md.match(/<<<(FILE|EDIT) path="([^"]+)">>>([\s\S]*)$/);
      if (open) {
        writing = { path: open[2], lines: open[3].split('\n').length, edit: open[1] === 'EDIT' };
        md = md.slice(0, open.index) + '\n\n<div data-writing="1"></div>\n\n';
      } else if (/<<<MEMORY>>>[\s\S]*$/.test(md)) {
        md = md.replace(/<<<MEMORY>>>[\s\S]*$/, '');
      } else {
        md = md.replace(/<{1,3}[A-Z]*$/, '');
      }
    } else {
      // Respuesta cortada: bloque de archivo sin cerrar.
      const open = md.match(/<<<(FILE|EDIT) path="([^"]+)">>>[\s\S]*$/);
      if (open) {
        actions.push({ type: 'incomplete', path: cleanPath(open[2]) });
        md = md.slice(0, open.index) + `\n\n<div data-action="${actions.length - 1}"></div>\n\n`;
      }
    }
    return { md, actions, writing };
  }

  // Aplica bloques buscar/reemplazar con tolerancia a espacios finales e indentación.
  function applyHunks(text, hunks, file) {
    let out = text.replace(/\r\n/g, '\n');
    for (const h of hunks) {
      const search = h.search.replace(/\r\n/g, '\n');
      const replace = h.replace.replace(/\r\n/g, '\n');
      if (!search.trim()) { out = out + (out.endsWith('\n') ? '' : '\n') + replace + '\n'; continue; }
      const idx = out.indexOf(search);
      if (idx >= 0) { out = out.slice(0, idx) + replace + out.slice(idx + search.length); continue; }
      // búsqueda por líneas ignorando espacios al final / indentación
      const lines = out.split('\n');
      const sl = search.split('\n');
      let found = -1;
      for (const norm of [(s) => s.trimEnd(), (s) => s.trim()]) {
        for (let i = 0; i + sl.length <= lines.length && found < 0; i++) {
          if (sl.every((l, j) => norm(lines[i + j]) === norm(l))) found = i;
        }
        if (found >= 0) break;
      }
      if (found < 0) throw new Error(`No encontré en ${file} el fragmento a reemplazar: "${sl.find((l) => l.trim()) || ''}"`);
      lines.splice(found, sl.length, ...replace.split('\n'));
      out = lines.join('\n');
    }
    return out;
  }

  // Contenido final de una acción de archivo: { before, after, isNew }
  async function resolve(a) {
    let before = null;
    try { before = await A.api('fs:read', a.path); } catch {}
    if (a.type === 'file') return { before: before || '', after: a.content, isNew: before === null };
    if (before === null && a.hunks.every((h) => !h.search.trim())) return { before: '', after: a.hunks.map((h) => h.replace).join('\n'), isNew: true };
    if (before === null) throw new Error(`${a.path} no existe`);
    return { before, after: applyHunks(before, a.hunks, a.path), isNew: false };
  }

  function renderMarkdown(md) {
    return DOMPurify.sanitize(marked.parse(md), { ADD_ATTR: ['data-action', 'data-writing'] });
  }

  // ---------- render ----------
  function renderAll() {
    const host = A.$('#messages');
    host.innerHTML = '';
    if (!messages.length) {
      host.append(A.el('div', { class: 'empty-chat', html: `<div class="ai-orb"></div><h3>ARPY IA</h3><p>Ya conozco todo tu proyecto: el sketch, el código Python, la placa y los errores. Pídeme crear algo desde cero, modificar lo que tienes o arreglar un error.</p><p class="muted">📷 Puedes pegar o arrastrar una foto de tu circuito para que la revise.</p>` }));
    }
    for (const m of messages) host.append(renderMessage(m));
    host.scrollTop = host.scrollHeight;
  }

  function imageStrip(names) {
    const strip = A.el('div', { class: 'img-strip' });
    for (const name of names) {
      const img = A.el('img', { alt: 'imagen adjunta' });
      A.api('ai:image-read', name).then((src) => { img.src = src; }).catch(() => {});
      img.addEventListener('click', () => A.modal.open('Imagen', A.el('img', { src: img.src, style: 'max-width:100%;border-radius:8px' })));
      strip.append(img);
    }
    return strip;
  }

  function renderMessage(m) {
    if (m.role === 'note') {
      return A.el('div', { class: 'msg note ' + (m.kind || ''), 'data-id': m.id }, m.text);
    }
    if (m.role === 'user') {
      const n = A.el('div', { class: 'msg user' + (m.auto ? ' auto' : ''), 'data-id': m.id });
      if (m.images && m.images.length) n.append(imageStrip(m.images));
      if (m.text) n.append(A.el('div', {}, m.text));
      n.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        A.menu(e.clientX, e.clientY, [
          { label: 'Copiar', action: () => navigator.clipboard.writeText(m.text) },
          { label: 'Editar y reenviar desde aquí', action: () => editFrom(m.id) },
        ]);
      });
      return n;
    }
    const n = A.el('div', { class: 'msg model' + (m.error ? ' error' : ''), 'data-id': m.id });
    n.innerHTML = `<div class="who"><span class="ai-orb"></span>ARPY</div><div class="body"></div>`;
    fillModelBody(n.querySelector('.body'), m, false);
    const meta = A.el('div', { class: 'meta' },
      A.el('button', { class: 'icon-btn sm', title: 'Copiar respuesta', html: A.icon('copy'), onclick: () => navigator.clipboard.writeText(m.text) }),
      A.el('button', { class: 'icon-btn sm', title: 'Regenerar', html: A.icon('retry'), onclick: () => regenerate(m.id) }),
      m.model ? A.el('span', { class: 'usage' }, `${m.model}${m.usage ? ` · ${fmtK(m.usage.input)} entrada · ${fmtK(m.usage.output)} salida` : ''}`) : null);
    n.append(meta);
    return n;
  }

  function fillModelBody(body, m, partial) {
    if (m.error) { body.textContent = '⚠ ' + m.error; return; }
    const { md, actions, writing } = parse(m.text, partial);
    body.innerHTML = renderMarkdown(md);
    body.querySelectorAll('[data-action]').forEach((slot) => {
      const i = +slot.dataset.action;
      slot.replaceWith(actionCard(m, actions[i], i, partial));
    });
    const w = body.querySelector('[data-writing]');
    if (w && writing) {
      const card = A.el('div', { class: 'action-card writing' });
      card.innerHTML = `<div class="ac-head">${A.fileIcon(writing.path)}<span class="path">${A.esc(writing.path)}</span><span class="stats">${writing.edit ? 'editando' : 'escribiendo'}… ${writing.lines} líneas</span></div>`;
      w.replaceWith(card);
    }
    if (!partial) {
      body.querySelectorAll('pre > code').forEach((code) => {
        const lang = (code.className.match(/language-(\w+)/) || [])[1];
        const monLang = { arduino: 'cpp', ino: 'cpp', cpp: 'cpp', c: 'cpp', python: 'python', py: 'python', json: 'json', bash: 'shell', sh: 'shell' }[lang] || lang;
        if (monLang) A.editor.colorize(code.textContent, monLang).then((html) => { code.innerHTML = html; });
        const btn = A.el('button', { class: 'icon-btn sm copy', title: 'Copiar', html: A.icon('copy'), onclick: () => { navigator.clipboard.writeText(code.textContent); A.toast('Copiado'); } });
        code.parentElement.append(btn);
      });
      const pending = actions.map((a, i) => ({ a, i })).filter(({ a, i }) => a.type !== 'memory' && a.type !== 'incomplete' && !(m.applied && m.applied[i]));
      if (pending.length > 1) {
        body.append(A.el('div', { class: 'apply-all' }, A.el('button', { class: 'btn sm ino', onclick: () => applyAll(m) }, `Aplicar todo (${pending.length})`)));
      }
    }
  }

  function lineDiff(a, b) {
    const A1 = a.split('\n'), B1 = b.split('\n');
    const ca = new Map();
    A1.forEach((l) => ca.set(l, (ca.get(l) || 0) + 1));
    let common = 0;
    B1.forEach((l) => { const c = ca.get(l); if (c) { common++; ca.set(l, c - 1); } });
    return { add: B1.length - common, rem: A1.length - common };
  }

  function actionCard(m, a, i, partial) {
    const applied = m.applied && m.applied[i];
    const card = A.el('div', { class: 'action-card' + (applied ? ' applied' : '') });
    const head = A.el('div', { class: 'ac-head' });
    const btns = A.el('div', { class: 'ac-btns' });
    card.append(head);
    const btn = (label, cls, fn, icon, title) => A.el('button', { class: `btn sm ${cls}`, onclick: fn, title, html: (icon ? A.icon(icon) : '') + label });

    if (a.type === 'file' || a.type === 'edit') {
      const kindEl = A.el('span', { class: 'kind edit' }, a.type === 'edit' ? `${a.hunks.length} cambio${a.hunks.length === 1 ? '' : 's'}` : 'editar');
      const stats = A.el('span', { class: 'stats' }, '');
      head.innerHTML = A.fileIcon(a.path);
      head.append(A.el('span', { class: 'path', title: a.path }, a.path), kindEl, stats, btns);
      if (!partial) {
        if (!applied) {
          resolve(a).then(({ before, after, isNew }) => {
            if (isNew) { kindEl.className = 'kind new'; kindEl.textContent = 'nuevo'; }
            const { add, rem } = lineDiff(before, after);
            stats.innerHTML = `<span class="add">+${add}</span> <span class="rem">−${rem}</span>`;
          }).catch((e) => {
            kindEl.className = 'kind del'; kindEl.textContent = 'no aplica';
            card.title = e.message;
            stats.textContent = '';
          });
        }
        btns.append(btn('', 'ghost', () => diffFor(m, a, i), 'diff', 'Ver cambios'));
        if (applied) {
          btns.append(btn('Deshacer', 'ghost', () => undo(m, i), 'undo'));
          btns.append(btn('Abrir', 'ghost', () => A.editor.open(a.path)));
        } else {
          btns.append(btn('Aplicar', 'ino', () => apply(m, i), 'check'));
        }
      }
    } else if (a.type === 'delete') {
      head.innerHTML = A.fileIcon(a.path);
      head.append(A.el('span', { class: 'path' }, a.path), A.el('span', { class: 'kind del' }, 'eliminar'), btns);
      if (!partial && !applied) btns.append(btn('Eliminar', '', () => apply(m, i)));
    } else if (a.type === 'lib') {
      head.append(A.el('span', { class: 'kind lib' }, 'librería'), A.el('span', { class: 'path' }, a.name), btns);
      if (!partial) btns.append(btn(applied ? 'Instalada' : 'Instalar', applied ? 'ghost' : 'ino', () => apply(m, i)));
    } else if (a.type === 'pip') {
      head.append(A.el('span', { class: 'kind pip' }, 'pip'), A.el('span', { class: 'path' }, a.name), btns);
      if (!partial) btns.append(btn(applied ? 'Instalado' : 'Instalar', applied ? 'ghost' : 'py', () => apply(m, i)));
    } else if (a.type === 'board') {
      const b = ARPY_BOARDS.findBoard(a.fqbn);
      head.append(A.el('span', { class: 'kind board' }, 'placa'), A.el('span', { class: 'path' }, b.name), btns);
      if (!partial && !applied) btns.append(btn('Cambiar placa', 'ino', () => apply(m, i)));
    } else if (a.type === 'incomplete') {
      card.classList.add('incomplete');
      head.innerHTML = A.fileIcon(a.path);
      head.append(A.el('span', { class: 'path' }, a.path), A.el('span', { class: 'kind del' }, 'respuesta cortada'), btns);
      if (!partial) btns.append(btn('Pedir de nuevo', 'ino', () => send(`Tu respuesta anterior se cortó mientras escribías ${a.path}. Vuelve a enviar ese cambio completo (si es posible usa bloques EDIT pequeños).`), 'retry'));
    } else if (a.type === 'memory') {
      head.append(A.el('span', { class: 'kind mem' }, 'memoria'), A.el('span', { class: 'path muted' }, 'Memoria del proyecto actualizada'), btns);
      if (!partial) btns.append(btn('Ver', 'ghost', () => openMemory()));
    }
    return card;
  }

  async function diffFor(m, a, i) {
    const applied = m.applied && m.applied[i];
    try {
      if (applied && typeof applied === 'string') {
        const now = await A.api('fs:read', a.path).catch(() => '');
        const b = await A.api('fs:backup-read', applied).catch(() => null);
        A.editor.showDiff(a.path, b ? b.content : '', now, null);
        return;
      }
      const { before, after } = await resolve(a);
      A.editor.showDiff(a.path, before, after, applied ? null : () => apply(m, i));
    } catch (e) { A.toast(e.message, 'err'); }
  }

  // ---------- aplicar acciones ----------
  async function apply(m, i, quiet) {
    const { actions } = parse(m.text, false);
    const a = actions[i];
    if (!a) return false;
    m.applied = m.applied || {};
    try {
      if (a.type === 'file' || a.type === 'edit') {
        const { after, isNew } = await resolve(a);
        const id = await A.api('fs:backup', a.path);
        await A.editor.applyContent(a.path, after);
        m.applied[i] = id;
        const dir = a.path.includes('/') ? a.path.slice(0, a.path.lastIndexOf('/')) : '';
        if (dir) A.explorer.expand(dir);
        if (isNew || !A.editor.isOpen(a.path)) A.editor.open(a.path);
      } else if (a.type === 'delete') {
        m.applied[i] = await A.api('fs:backup', a.path);
        await A.api('fs:delete', a.path);
        if (A.editor.isOpen(a.path)) A.editor.close(a.path);
      } else if (a.type === 'lib') {
        A.panels.show('output');
        const r = await A.api('arduino:lib-install', a.name);
        if (r.code !== 0) throw new Error(`No se pudo instalar la librería ${a.name}`);
        m.applied[i] = true;
      } else if (a.type === 'pip') {
        A.panels.show('python');
        const r = await A.api('python:pip', a.name);
        if (r.code !== 0) throw new Error(`pip install ${a.name} falló`);
        m.applied[i] = true;
      } else if (a.type === 'board') {
        await A.app.setBoard(a.fqbn);
        m.applied[i] = true;
      }
      if (!quiet) A.toast(`✔ ${a.path || a.name || a.fqbn}`, 'ok');
    } catch (e) {
      A.toast(e.message, 'err');
      persist();
      rerender(m);
      return e.message;
    }
    persist();
    rerender(m);
    A.explorer.refresh();
    return true;
  }

  // Aplica todo; devuelve { files: [paths], errors: [msg] }
  async function applyAll(m, { installs = false } = {}) {
    const { actions } = parse(m.text, false);
    const res = { files: [], errors: [] };
    for (let i = 0; i < actions.length; i++) {
      const a = actions[i];
      if (a.type === 'memory' || (m.applied && m.applied[i])) continue;
      if (a.type === 'incomplete') { res.errors.push(`La respuesta se cortó mientras escribías ${a.path}; envía ese archivo completo otra vez`); continue; }
      if ((a.type === 'lib' || a.type === 'pip') && !installs) continue;
      const r = await apply(m, i, true);
      if (r === true && (a.type === 'file' || a.type === 'edit')) res.files.push(a.path);
      else if (r !== true) res.errors.push(r);
    }
    if (!installs) A.toast(res.errors.length ? `Aplicado con ${res.errors.length} error(es)` : 'Cambios aplicados', res.errors.length ? 'err' : 'ok');
    return res;
  }

  async function undo(m, i) {
    const id = m.applied && m.applied[i];
    if (typeof id !== 'string') return;
    try {
      const b = await A.api('fs:restore', id);
      if (A.editor.isOpen(b.path)) {
        if (b.existed) await A.editor.applyContent(b.path, b.content); else A.editor.close(b.path);
      }
      delete m.applied[i];
      persist();
      rerender(m);
      A.explorer.refresh();
      A.toast(`Revertido: ${b.path}`);
    } catch (e) { A.toast(e.message, 'err'); }
  }

  function note(text, kind = '') {
    const m = { id: uid(), role: 'note', text, kind, ts: Date.now() };
    messages.push(m);
    A.$('#messages').append(renderMessage(m));
    A.$('#messages').scrollTop = A.$('#messages').scrollHeight;
    persist();
  }

  // Después de cada respuesta: memoria, auto-aplicar y bucle del agente.
  async function afterResponse(m) {
    const { actions } = parse(m.text, false);
    for (const [i, a] of actions.entries()) {
      if (a.type === 'memory') { await A.api('ai:memory', a.content); m.applied = m.applied || {}; m.applied[i] = true; }
    }
    const agent = A.$('#agentMode').checked;
    if (!agent && !A.$('#autoApply').checked) return;
    const hasWork = actions.some((a) => a.type !== 'memory');
    if (!hasWork) return;
    const res = await applyAll(m, { installs: agent });
    if (!agent) return;

    const cfg = A.app.config || {};
    const sketchDir = (cfg.sketch || 'sketch').replace(/^\.$/, '');
    const inoChanged = res.files.some((f) => /\.(ino|cpp|c|h|hpp)$/.test(f) && (!sketchDir || f.startsWith(sketchDir + '/') || sketchDir === '.'));
    const pyChanged = res.files.filter((f) => f.endsWith('.py'));
    const problems = [...res.errors.map((e) => `- No se pudo aplicar un cambio: ${e}`)];

    if (inoChanged) {
      note('🤖 Agente: compilando el sketch…');
      const ok = await A.app.verify();
      if (!ok) problems.push('- La compilación del sketch falló (la salida completa está en el contexto).');
    }
    if (pyChanged.length) {
      const r = await A.api('python:check', pyChanged);
      if (r.code !== 0) {
        problems.push(`- Error de sintaxis en Python:\n${r.output.trim()}`);
        A.panels.line('python', r.output.trim(), 'err');
      }
    }
    if (!problems.length) {
      note(`✅ Agente: cambios aplicados${inoChanged ? ' y el sketch compila' : ''}${pyChanged.length ? ', Python sin errores de sintaxis' : ''}.`, 'ok');
      agentRound = 0;
      return;
    }
    if (agentRound >= AGENT_MAX) {
      note(`⛔ Agente: sigue habiendo errores después de ${AGENT_MAX} intentos. Revísalos o dale más detalles a la IA.`, 'err');
      agentRound = 0;
      return;
    }
    agentRound++;
    note(`🔁 Agente: hay errores, pidiendo corrección (intento ${agentRound}/${AGENT_MAX})…`, 'warn');
    await sendInternal(`[Modo agente — intento ${agentRound}/${AGENT_MAX}] Apliqué tus cambios y aparecieron estos problemas:\n${problems.join('\n')}\nCorrígelos ahora con cambios mínimos.`, [], true);
  }

  function rerender(m) {
    const old = A.$(`.msg[data-id="${m.id}"]`);
    if (old) old.replaceWith(renderMessage(m));
  }

  function autoTitle() {
    if (chatTitle && !/^(Nueva conversación|Conversación principal)$/.test(chatTitle)) return chatTitle;
    const first = messages.find((x) => x.role === 'user' && x.text && !x.auto);
    return first ? first.text.replace(/\s+/g, ' ').slice(0, 42) + (first.text.length > 42 ? '…' : '') : chatTitle;
  }

  const persist = A.debounce(async () => {
    if (!chatId) return;
    const t = autoTitle();
    const changed = t !== chatTitle;
    chatTitle = t;
    await A.api('ai:save-chat', chatId, messages, chatTitle).catch(() => {});
    if (changed) refreshChats();
  }, 300);

  // ---------- enviar ----------
  async function send(text, images = []) {
    text = (text || '').trim();
    if (!text && !images.length) return;
    if (busy) { A.toast('Espera a que termine la respuesta actual (o detenla)'); return; }
    if (!A.app.config) { A.toast('Abre un proyecto primero', 'err'); return; }
    agentRound = 0;
    await sendInternal(text, images, false);
  }

  async function sendInternal(text, images, auto) {
    const names = [];
    for (const d of images) {
      try { names.push(await A.api('ai:image-save', d)); } catch (e) { A.toast(e.message, 'err'); }
    }
    messages.push({ id: uid(), role: 'user', text, images: names, ts: Date.now(), auto });
    persist();
    renderAll();
    await ask();
  }

  async function ask() {
    await A.editor.saveAll();
    busy = true;
    setBusy(true);
    const id = ++reqId;
    const m = { id: uid(), role: 'model', text: '', ts: Date.now() };
    const host = A.$('#messages');
    host.querySelector('.empty-chat')?.remove();
    const n = A.el('div', { class: 'msg model', 'data-id': m.id });
    n.innerHTML = `<div class="who"><span class="ai-orb thinking"></span>ARPY <span class="muted" style="font-weight:400">analizando el proyecto…</span></div><div class="body cursor-blink"></div>`;
    host.append(n);
    host.scrollTop = host.scrollHeight;
    streaming = { id, m, el: n.querySelector('.body') };

    const live = { ...A.editor.liveContext(), ...A.panels.logs(), simLog: A.sim && A.sim.running ? A.sim.log() : '' };
    const history = messages.filter((x) => x.role !== 'note').map(({ role, text, images }) => ({ role, text, images }));
    const res = await A.api('ai:chat', { reqId: id, history, live, model: A.$('#modelSelect').value });
    streaming = null;
    busy = false;
    setBusy(false);
    if (res.aborted) {
      m.text = (m.text ? m.text + '\n\n' : '') + '_(detenido)_';
      agentRound = AGENT_MAX + 1; // no seguir en modo agente
    } else if (!res.ok) {
      m.error = res.error;
    } else {
      m.text = res.text || m.text;
      m.model = res.model;
      m.usage = res.usage;
      if (res.day) renderQuota(res.day);
    }
    messages.push(m);
    persist();
    n.replaceWith(renderMessage(m));
    host.scrollTop = host.scrollHeight;
    A.explorer.refresh();
    if (!m.error && !res.aborted) await afterResponse(m);
    else agentRound = 0;
  }

  let renderPending = false;
  window.arpy.on('ai:chunk', ({ reqId: r, text }) => {
    if (!streaming || r !== streaming.id) return;
    streaming.m.text += text;
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      if (!streaming) return;
      const host = A.$('#messages');
      const stick = host.scrollTop + host.clientHeight >= host.scrollHeight - 60;
      fillModelBody(streaming.el, streaming.m, true);
      streaming.el.parentElement.querySelector('.who .muted')?.remove();
      if (stick) host.scrollTop = host.scrollHeight;
    });
  });

  window.arpy.on('ai:status', ({ reqId: r, text }) => {
    if (!streaming || r !== streaming.id) return;
    const who = streaming.el.parentElement.querySelector('.who');
    let st = who.querySelector('.muted');
    if (!st) { st = A.el('span', { class: 'muted', style: 'font-weight:400' }); who.append(st); }
    st.textContent = text || 'escribiendo…';
  });

  function setBusy(b) {
    const s = A.$('#btnSend');
    s.classList.toggle('stop', b);
    s.innerHTML = A.icon(b ? 'stop' : 'send');
    s.title = b ? 'Detener' : 'Enviar (Enter)';
    A.$('.chat-title .ai-orb').classList.toggle('thinking', b);
  }

  function regenerate(id) {
    if (busy) return;
    const idx = messages.findIndex((x) => x.id === id);
    if (idx < 0) return;
    messages = messages.slice(0, idx);
    while (messages.length && messages[messages.length - 1].role === 'note') messages.pop();
    renderAll();
    ask();
  }

  function editFrom(id) {
    if (busy) return;
    const idx = messages.findIndex((x) => x.id === id);
    const text = messages[idx].text;
    messages = messages.slice(0, idx);
    persist();
    renderAll();
    const input = A.$('#chatInput');
    input.value = text;
    autosize();
    input.focus();
  }

  // ---------- conversaciones ----------
  async function refreshChats() {
    const data = await A.api('ai:load');
    chats = data.chats;
    const sel = A.$('#chatSelect');
    sel.innerHTML = '';
    for (const c of chats) sel.append(A.el('option', { value: c.id }, c.id === chatId ? chatTitle || c.title : c.title));
    sel.value = chatId;
  }

  async function switchChat(id) {
    if (busy) { A.toast('Espera a que termine la respuesta'); A.$('#chatSelect').value = chatId; return; }
    chatId = id;
    const c = chats.find((x) => x.id === id);
    chatTitle = c ? c.title : 'Nueva conversación';
    messages = await A.api('ai:load-chat', id);
    agentRound = 0;
    renderAll();
    try { localStorage.setItem('arpy-chat-' + (A.app.config && A.app.config.name), id); } catch {}
  }

  async function newChat() {
    if (busy) return;
    const id = 'c' + uid();
    await A.api('ai:save-chat', id, [], 'Nueva conversación');
    chatId = id;
    chatTitle = 'Nueva conversación';
    messages = [];
    await refreshChats();
    renderAll();
    A.$('#chatInput').focus();
  }

  async function chatMenu(e) {
    e.preventDefault();
    A.menu(e.clientX, e.clientY, [
      { label: 'Nueva conversación', action: newChat },
      { label: 'Renombrar…', action: async () => { const t = await A.prompt('Renombrar conversación', chatTitle); if (t) { chatTitle = t; await A.api('ai:save-chat', chatId, messages, t); refreshChats(); } } },
      { label: 'Vaciar esta conversación', action: clearCurrent },
      '-',
      { label: 'Eliminar conversación', danger: true, action: deleteCurrent },
    ]);
  }

  async function clearCurrent() {
    if (!(await A.confirm('Vaciar conversación', 'Se borrarán los mensajes de esta conversación. La memoria del proyecto (🧠) se conserva.', 'Vaciar', true))) return;
    messages = [];
    renderAll();
    await A.api('ai:save-chat', chatId, [], chatTitle);
  }

  async function deleteCurrent() {
    if (!(await A.confirm('Eliminar conversación', `¿Eliminar "${chatTitle}"? La memoria del proyecto se conserva.`, 'Eliminar', true))) return;
    await A.api('ai:delete-chat', chatId);
    const data = await A.api('ai:load');
    chats = data.chats;
    await switchChat(chats[0].id);
    refreshChats();
  }

  // ---------- memoria del proyecto ----------
  async function openMemory() {
    const { memory } = await A.api('ai:load');
    const ta = A.el('textarea', {}, memory);
    const body = A.el('div', { class: 'field' },
      A.el('label', {}, 'Lo que la IA recuerda siempre de este proyecto (objetivo, hardware, pines, decisiones). Se comparte entre todas las conversaciones.'),
      ta,
      A.el('small', {}, 'La IA la actualiza sola cuando aprende algo importante. Puedes editarla tú también.'),
      A.el('div', { class: 'modal-foot' }, A.el('button', { class: 'btn ino', onclick: async () => { await A.api('ai:memory', ta.value); A.modal.close(); A.toast('Memoria guardada', 'ok'); } }, 'Guardar')));
    A.modal.open('Memoria del proyecto', body);
  }

  // ---------- barra de contexto y cuota ----------
  function countFiles(tree) {
    let n = 0;
    for (const t of tree) n += t.dir ? countFiles(t.children) : 1;
    return n;
  }

  let quota = null;
  function renderQuota(day) {
    quota = day;
    renderCtx();
  }

  function renderCtx(tree) {
    if (tree) fileCount = countFiles(tree);
    const live = A.editor.liveContext();
    const bar = A.$('#ctxBar');
    const cfg = A.app.config || {};
    const board = cfg.board ? ARPY_BOARDS.findBoard(cfg.board).name : '';
    bar.innerHTML = '';
    bar.append(document.createTextNode('Contexto: '));
    bar.append(A.el('span', { class: 'pill live', title: 'La IA ve todos los archivos del proyecto en cada mensaje' }, `${fileCount} archivos`));
    if (live.activeFile) bar.append(A.el('span', { class: 'pill' }, live.activeFile.split('/').pop()));
    if (board) bar.append(A.el('span', { class: 'pill' }, board));
    if (quota) {
      bar.append(A.el('span', {
        class: 'pill quota' + (quota.fallbacks ? ' warn' : ''),
        title: `Hoy: ${quota.requests} peticiones, ${quota.tokens.toLocaleString()} tokens${quota.fallbacks ? `, ${quota.fallbacks} veces se usó un modelo de respaldo por saturación` : ''}.\nÚltimo modelo: ${quota.lastModel || '—'}`,
      }, `Hoy ${quota.requests} · ${fmtK(quota.tokens)} tk`));
    }
  }

  // ---------- carga por proyecto ----------
  async function load() {
    const data = await A.api('ai:load');
    chats = data.chats;
    let saved = null;
    try { saved = localStorage.getItem('arpy-chat-' + (A.app.config && A.app.config.name)); } catch {}
    const target = chats.find((c) => c.id === saved) || chats[0];
    await switchChat(target.id);
    await refreshChats();
    A.api('ai:usage').then(renderQuota).catch(() => {});
  }

  // ---------- imágenes ----------
  function addImageFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    if (file.size > 15 * 1024 * 1024) return A.toast('Imagen demasiado grande (máx. 15 MB)', 'err');
    const r = new FileReader();
    r.onload = () => downscale(r.result).then((d) => { pendingImages.push(d); renderPendingImages(); });
    r.readAsDataURL(file);
  }

  // Reduce fotos grandes del celular para no gastar cuota innecesaria.
  function downscale(dataUrl, max = 1600) {
    return new Promise((res) => {
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.width, img.height));
        if (s === 1 && dataUrl.length < 2_000_000) return res(dataUrl);
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = () => res(dataUrl);
      img.src = dataUrl;
    });
  }

  function renderPendingImages() {
    const host = A.$('#pendingImages');
    host.innerHTML = '';
    host.classList.toggle('hidden', !pendingImages.length);
    pendingImages.forEach((d, i) => {
      const wrap = A.el('div', { class: 'pimg' }, A.el('img', { src: d }), A.el('button', { title: 'Quitar', html: A.icon('x'), onclick: () => { pendingImages.splice(i, 1); renderPendingImages(); } }));
      host.append(wrap);
    });
  }

  // ---------- entrada ----------
  const input = A.$('#chatInput');
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 200) + 'px'; }
  function submit() {
    const v = input.value;
    if (!v.trim() && !pendingImages.length) return;
    const imgs = pendingImages;
    pendingImages = [];
    renderPendingImages();
    input.value = '';
    autosize();
    send(v || 'Revisa esta imagen de mi circuito en relación con el proyecto.', imgs);
  }
  input.addEventListener('input', autosize);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  });
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) { e.preventDefault(); files.forEach(addImageFile); }
  });
  const composer = A.$('.chat-input');
  composer.addEventListener('dragover', (e) => { e.preventDefault(); composer.classList.add('drop'); });
  composer.addEventListener('dragleave', () => composer.classList.remove('drop'));
  composer.addEventListener('drop', (e) => {
    e.preventDefault();
    composer.classList.remove('drop');
    [...e.dataTransfer.files].forEach(addImageFile);
  });
  A.$('#btnAttach').addEventListener('click', () => A.$('#imageInput').click());
  A.$('#imageInput').addEventListener('change', (e) => { [...e.target.files].forEach(addImageFile); e.target.value = ''; });

  A.$('#btnSend').addEventListener('click', () => {
    if (busy) { agentRound = AGENT_MAX + 1; A.api('ai:stop'); return; }
    submit();
  });
  A.$('#btnClearChat').addEventListener('click', chatMenu);
  A.$('#btnNewChat').addEventListener('click', newChat);
  A.$('#chatSelect').addEventListener('change', (e) => switchChat(e.target.value));
  A.$('#btnMemory').addEventListener('click', openMemory);
  A.$('#agentMode').addEventListener('change', (e) => {
    A.api('settings:set', { agentMode: e.target.checked });
    if (e.target.checked) A.toast('Modo agente: la IA aplicará cambios, compilará y corregirá errores sola (máx. 3 intentos).');
  });

  const CHIPS = [
    ['Explica el proyecto', 'Explícame cómo funciona todo el proyecto: el sketch, el programa Python y cómo se comunican.'],
    ['Revisa errores', 'Revisa todo el proyecto en busca de errores o incompatibilidades entre el Arduino y Python, y corrígelos.'],
    ['Diagrama de conexiones', 'Dame el diagrama de conexiones del proyecto para la placa seleccionada: tabla de cada componente con sus pines y a qué pin de la placa va, resistencias necesarias, alimentación, y un esquema ASCII. Avisa si algo puede dañar la placa.'],
    ['App Python', 'Crea una app de escritorio en Python con interfaz moderna que se conecte al Arduino y muestre/controle lo que hace el sketch.'],
    ['Nuevo sensor', 'Quiero agregar un sensor. Pregúntame cuál si no lo sabes, y luego modifica el sketch y la app Python.'],
  ];
  for (const [label, prompt] of CHIPS) A.$('#chips').append(A.el('button', { onclick: () => send(prompt) }, label));

  A.chat = { send, load, renderCtx, openMemory, newChat, get busy() { return busy; } };
})();
