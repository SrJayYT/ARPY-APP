/* Explorador de archivos del proyecto */
(() => {
  const expanded = new Set(['sketch', 'python']);
  let selectedDir = '';

  async function refresh() {
    let tree = [];
    try { tree = await A.api('fs:tree'); } catch { return; }
    A.app.files = flatten(tree);
    const host = A.$('#tree');
    host.innerHTML = '';
    host.append(...render(tree, 0));
    markActive(A.editor.active);
    A.chat && A.chat.renderCtx(tree);
  }

  function flatten(nodes) {
    return nodes.flatMap((n) => (n.dir ? flatten(n.children) : [n.path]));
  }

  function render(nodes, depth) {
    const out = [];
    for (const n of nodes) {
      const row = A.el('div', { class: 'node' + (n.dir && expanded.has(n.path) ? ' open' : ''), 'data-path': n.path, style: `padding-left:${8 + depth * 14}px` });
      row.innerHTML = `<span class="chev">${n.dir ? A.icon('chev') : ''}</span>${A.fileIcon(n.name, n.dir)}<span>${A.esc(n.name)}</span>`;
      row.addEventListener('click', () => {
        if (n.dir) {
          selectedDir = n.path;
          expanded.has(n.path) ? expanded.delete(n.path) : expanded.add(n.path);
          refresh();
        } else {
          selectedDir = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '';
          A.editor.open(n.path);
        }
      });
      row.addEventListener('contextmenu', (e) => { e.preventDefault(); menuFor(n, e.clientX, e.clientY); });
      out.push(row);
      if (n.dir && expanded.has(n.path)) out.push(...render(n.children, depth + 1));
    }
    return out;
  }

  function markActive(path) {
    A.$$('#tree .node').forEach((n) => n.classList.toggle('active', n.dataset.path === path));
  }

  async function newFile(dir = selectedDir) {
    const name = await A.prompt('Nuevo archivo', '', `En: /${dir}`);
    if (!name) return;
    const rel = (dir ? dir + '/' : '') + name;
    if (await A.api('fs:exists', rel)) return A.toast('Ese archivo ya existe', 'err');
    await A.api('fs:write', rel, '');
    if (dir) expanded.add(dir);
    await refresh();
    A.editor.open(rel);
  }

  async function newFolder(dir = selectedDir) {
    const name = await A.prompt('Nueva carpeta', '', `En: /${dir}`);
    if (!name) return;
    const rel = (dir ? dir + '/' : '') + name;
    await A.api('fs:mkdir', rel);
    expanded.add(rel);
    refresh();
  }

  async function rename(n) {
    const name = await A.prompt('Renombrar', n.name);
    if (!name || name === n.name) return;
    const to = (n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/') + 1) : '') + name;
    try {
      await A.api('fs:rename', n.path, to);
      A.editor.renamed(n.path, to);
      refresh();
    } catch (e) { A.toast(e.message, 'err'); }
  }

  async function remove(n) {
    if (!(await A.confirm('Eliminar', `¿Eliminar "${n.path}"? Esta acción no se puede deshacer.`, 'Eliminar', true))) return;
    await A.api('fs:delete', n.path);
    if (A.editor.isOpen(n.path)) A.editor.close(n.path);
    refresh();
  }

  function menuFor(n, x, y) {
    const dir = n.dir ? n.path : (n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : '');
    const items = [
      { label: 'Nuevo archivo…', action: () => newFile(dir) },
      { label: 'Nueva carpeta…', action: () => newFolder(dir) },
      '-',
    ];
    const kind = !n.dir && window.ARPY_TECHS.runnerFor(n.path);
    if (kind === 'preview') items.push({ label: '👁 Ver en la vista previa', action: () => A.app.openPreview(n.path) });
    else if (kind && kind !== 'python') items.push({ label: '▶ Ejecutar este archivo', action: async () => { await A.editor.open(n.path); A.app.runActive(); } });
    if (!n.dir && n.name.endsWith('.py')) {
      items.push({ label: '▶ Ejecutar este archivo Python', action: () => A.app.runPython(n.path) });
      items.push({ label: 'Usar como programa Python principal', action: async () => { await A.api('project:config', { pythonMain: n.path }); A.toast(`Principal: ${n.path}`, 'ok'); } });
      items.push('-');
    }
    if (!n.dir) items.push({ label: '✨ Preguntar a la IA sobre este archivo', action: () => A.chat.send(`Analiza el archivo ${n.path}: qué hace, problemas que veas y mejoras posibles.`) });
    items.push({ label: 'Renombrar…', action: () => rename(n) });
    items.push({ label: 'Eliminar', danger: true, action: () => remove(n) });
    A.menu(x, y, items);
  }

  A.$('#tree').addEventListener('contextmenu', (e) => {
    if (e.target.closest('.node')) return;
    e.preventDefault();
    A.menu(e.clientX, e.clientY, [
      { label: 'Nuevo archivo…', action: () => newFile('') },
      { label: 'Nueva carpeta…', action: () => newFolder('') },
    ]);
  });

  A.explorer = { refresh, markActive, newFile, newFolder, expand: (d) => expanded.add(d) };
})();
