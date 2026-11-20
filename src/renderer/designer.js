/* Diseñador de interfaces Python: arrastra controles y genera una app Tkinter (python/<nombre>.py). */
(() => {
  const G = window.ARPY_UIGEN;
  const SNAP = 8;
  let design = null;
  let selected = null;
  let root = null;
  let saveTimer = 0;

  const PROP_LABELS = {
    text: 'Texto', key: 'Clave que envía el Arduino', unit: 'Unidad', decimals: 'Decimales', min: 'Mínimo', max: 'Máximo',
    threshold: 'Se enciende por encima de', command: 'Comando que se envía', on: 'Comando al encender', off: 'Comando al apagar',
  };
  const PROP_HINTS = {
    key: 'Ej: si el Arduino envía "T:23.5", la clave es T',
    command: 'Texto que recibe el Arduino por serie',
  };

  function blank() {
    const T = A.i18n.t;
    const name = (A.app.config && A.app.config.name) || T('Mi panel');
    return {
      version: 1, file: 'panel', title: name, theme: 'papel', width: 760, height: 480, baud: (A.app.config && A.app.config.baud) || 115200,
      widgets: [
        { id: 'w1', type: 'title', x: 24, y: 20, w: 320, h: 44, props: { text: name } },
        { id: 'w2', type: 'value', x: 24, y: 90, w: 170, h: 84, props: { text: T('Lectura A0'), key: 'A0', unit: '', decimals: 0 } },
        { id: 'w3', type: 'button', x: 24, y: 200, w: 160, h: 40, props: { text: T('Encender LED'), command: 'LED:1' } },
      ],
    };
  }

  async function open() {
    if (!A.app.config) return;
    let list = [];
    try { list = await A.api('ui:list'); } catch {}
    design = list.length ? await A.api('ui:load', list[0]) : blank();
    if (!design || !Array.isArray(design.widgets)) design = blank();
    selected = null;
    build();
  }

  function theme() { return G.THEMES[design.theme] || G.THEMES.papel; }

  function build() {
    root && root.remove();
    root = A.el('div', { id: 'designerView', class: 'wv dz' });
    const gen = A.el('button', { class: 'btn ghost sm', onclick: () => generate(false) }, 'Generar .py');
    const run = A.el('button', { class: 'btn py sm', onclick: () => generate(true) });
    run.innerHTML = A.icon('play') + 'Probar la app';
    const ai = A.el('button', { class: 'btn ai sm', onclick: askAI });
    ai.innerHTML = A.icon('sparkles') + 'Sketch a juego con IA';
    const close = A.el('button', { class: 'icon-btn', title: 'Cerrar (Esc)', onclick: closeView });
    close.innerHTML = A.icon('x');
    const head = A.el('header', { class: 'wv-head' },
      A.el('div', { class: 'wv-title' }, A.el('b', {}, 'Diseñar app'), A.el('span', { class: 'muted' }, ` · python/${design.file}.py`)),
      A.el('div', { class: 'spacer' }), ai, gen, run, close);

    const palette = A.el('aside', { class: 'wv-palette' }, A.el('h5', {}, 'Controles'));
    for (const w of G.WIDGETS) palette.append(A.el('button', { class: 'wv-item', onclick: () => add(w.type) }, A.el('span', {}, w.name)));
    palette.append(A.el('h5', {}, 'Consejo'), A.el('p', { class: 'dz-tip' }, 'Arrastra para mover. La esquina inferior derecha cambia el tamaño. Supr borra el control elegido.'));

    const canvas = A.el('div', { class: 'wv-canvas' });
    const frame = A.el('div', { class: 'dz-window', id: 'dzWindow' },
      A.el('div', { class: 'dz-bar' }, A.el('span', { id: 'dzTitle' }, design.title)),
      A.el('div', { class: 'dz-body', id: 'dzBody' }));
    canvas.append(frame);
    canvas.addEventListener('mousedown', (e) => { if (e.target === canvas || e.target.id === 'dzBody') select(null); });

    root.append(head, A.el('div', { class: 'wv-body' }, palette, canvas, A.el('aside', { class: 'wv-insp', id: 'dzInsp' })));
    document.body.append(root);
    render();
    root.tabIndex = -1;
    root.focus();
    root.addEventListener('keydown', (e) => {
      if (/input|select|textarea/i.test(e.target.tagName)) return;
      if (e.key === 'Escape') closeView();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected) remove(selected);
      const w = design.widgets.find((x) => x.id === selected);
      if (w && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const d = e.shiftKey ? SNAP : 1;
        if (e.key === 'ArrowLeft') w.x -= d;
        if (e.key === 'ArrowRight') w.x += d;
        if (e.key === 'ArrowUp') w.y -= d;
        if (e.key === 'ArrowDown') w.y += d;
        render();
        changed();
      }
    });
  }

  // Vista previa aproximada de cada control con los colores del tema.
  function preview(w) {
    const t = theme();
    const p = w.props || {};
    const card = `background:${t.card};border:1px solid ${t.line};`;
    switch (w.type) {
      case 'title': return `<div style="font:22px ${t.font};color:${t.text}">${A.esc(p.text)}</div>`;
      case 'label': return `<div style="font:13px ${t.font};color:${t.muted}">${A.esc(p.text)}</div>`;
      case 'value': return `<div class="dz-card" style="${card}"><small style="color:${t.muted}">${A.esc(String(p.text).toUpperCase())}</small><div style="font:26px ${t.font};color:${t.text}">23.5${A.esc(p.unit || '')}</div><em style="color:${t.muted}">${A.esc(p.key)}</em></div>`;
      case 'gauge': return `<div class="dz-card" style="${card}"><small style="color:${t.muted}">${A.esc(p.text)}</small><svg viewBox="0 0 100 56" class="dz-gauge"><path d="M8 52 A42 42 0 0 1 92 52" stroke="${t.line}" stroke-width="9" fill="none"/><path d="M8 52 A42 42 0 0 1 62 13" stroke="${t.accent}" stroke-width="9" fill="none"/></svg><em style="color:${t.muted}">${A.esc(p.key)}</em></div>`;
      case 'bar': return `<small style="color:${t.muted}">${A.esc(p.text)}</small><div class="dz-bar-t" style="background:${t.line}"><i style="background:${t.accent}"></i></div><em style="color:${t.muted}">${A.esc(p.key)}</em>`;
      case 'led': return `<div class="dz-row"><i class="dz-led" style="background:${t.accent}"></i><span style="color:${t.text}">${A.esc(p.text)}</span></div>`;
      case 'chart': return `<div class="dz-card" style="${card}"><small style="color:${t.muted}">${A.esc(p.text)}</small><svg viewBox="0 0 100 40" preserveAspectRatio="none" class="dz-chart"><polyline points="0,30 12,26 24,28 36,18 48,22 60,12 72,16 84,8 100,14" stroke="${t.accent}" stroke-width="2" fill="none" vector-effect="non-scaling-stroke"/></svg></div>`;
      case 'button': return `<div class="dz-btn" style="background:${t.accent};font-family:${t.font}">${A.esc(p.text)}</div>`;
      case 'switch': return `<div class="dz-row"><i class="dz-sw" style="background:${t.accent}"></i><span style="color:${t.text}">${A.esc(p.text)}</span></div>`;
      case 'slider': return `<small style="color:${t.muted}">${A.esc(p.text)}</small><div class="dz-slider" style="background:${t.line}"><i style="background:${t.accent}"></i></div>`;
      case 'input': return `<div class="dz-row"><div class="dz-input" style="${card}"></div><div class="dz-btn small" style="background:${t.accent}">Enviar</div></div>`;
      default: return '';
    }
  }

  function render() {
    const t = theme();
    const win = A.$('#dzWindow');
    win.style.width = design.width + 'px';
    win.style.height = design.height + 28 + 'px';
    A.$('#dzTitle').textContent = design.title;
    const body = A.$('#dzBody');
    body.style.background = t.bg;
    body.innerHTML = '';
    for (const w of design.widgets) {
      const el = A.el('div', { class: 'dz-w' + (w.id === selected ? ' sel' : ''), style: `left:${w.x}px;top:${w.y}px;width:${w.w}px;height:${w.h}px` });
      el.innerHTML = preview(w) + '<span class="dz-h"></span>';
      el.addEventListener('mousedown', (e) => drag(e, w, e.target.classList.contains('dz-h')));
      body.append(el);
    }
    inspector();
  }

  function add(type) {
    const def = G.find(type);
    const n = design.widgets.length;
    const w = { id: 'w' + Date.now().toString(36), type, x: 24 + (n % 4) * 24, y: 90 + (n % 6) * 30, w: def.w, h: def.h, props: JSON.parse(JSON.stringify(def.props)) };
    if (w.props.text) w.props.text = A.i18n.t(w.props.text);
    w.x = Math.min(w.x, design.width - w.w);
    design.widgets.push(w);
    selected = w.id;
    render();
    changed();
  }

  function remove(id) {
    design.widgets = design.widgets.filter((w) => w.id !== id);
    selected = null;
    render();
    changed();
  }

  function select(id) { selected = id; render(); }

  function drag(e, w, resize) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (selected !== w.id) { selected = w.id; render(); }
    const sx = e.clientX, sy = e.clientY;
    const o = { x: w.x, y: w.y, w: w.w, h: w.h };
    const snap = (v) => Math.round(v / SNAP) * SNAP;
    const move = (ev) => {
      const dx = ev.clientX - sx, dy = ev.clientY - sy;
      if (resize) {
        w.w = Math.max(40, snap(o.w + dx));
        w.h = Math.max(24, snap(o.h + dy));
      } else {
        w.x = Math.max(0, Math.min(design.width - w.w, snap(o.x + dx)));
        w.y = Math.max(0, Math.min(design.height - w.h, snap(o.y + dy)));
      }
      const el = A.$('#dzBody .dz-w.sel');
      if (el) Object.assign(el.style, { left: w.x + 'px', top: w.y + 'px', width: w.w + 'px', height: w.h + 'px' });
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); inspector(); changed(); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  function field(label, input, hint) {
    return A.el('div', { class: 'field' }, A.el('label', {}, label), input, hint ? A.el('small', {}, hint) : null);
  }

  function inspector() {
    const box = A.$('#dzInsp');
    if (!box) return;
    box.innerHTML = '';
    const w = design.widgets.find((x) => x.id === selected);
    if (!w) {
      const title = A.el('input', { value: design.title });
      title.addEventListener('input', () => { design.title = title.value; A.$('#dzTitle').textContent = title.value; changed(); });
      const file = A.el('input', { value: design.file });
      file.addEventListener('change', () => { design.file = (file.value.trim().replace(/[^\w-]/g, '_') || 'panel'); file.value = design.file; build(); changed(); });
      const th = A.el('select', {}, ...Object.entries(G.THEMES).map(([k, v]) => A.el('option', { value: k }, v.name)));
      th.value = design.theme;
      th.addEventListener('change', () => { design.theme = th.value; render(); changed(); });
      const wi = A.el('input', { type: 'number', value: design.width, min: 320, max: 1600 });
      const he = A.el('input', { type: 'number', value: design.height, min: 240, max: 1000 });
      const size = () => { design.width = +wi.value || 760; design.height = +he.value || 480; render(); changed(); };
      wi.addEventListener('change', size);
      he.addEventListener('change', size);
      box.append(A.el('h4', {}, 'Ventana'), field('Título', title), field('Archivo', file, 'Se guarda como python/<archivo>.py'), field('Estilo', th),
        A.el('div', { class: 'dz-two' }, field('Ancho', wi), field('Alto', he)),
        A.el('h4', {}, 'Cómo funciona'),
        A.el('p', { class: 'muted dz-tip' }, 'Los controles que muestran datos leen líneas del Arduino como "T:23.5;H:60". Los botones, interruptores y deslizadores envían comandos de texto. Sin placa, la app se abre con datos de ejemplo.'));
      const keys = G.keysOf(design);
      if (keys.length) box.append(A.el('p', { class: 'dz-tip' }, A.el('b', {}, 'El Arduino debe enviar: '), keys.map((k) => `${k}:<${A.i18n.t('valor')}>`).join(';')));
      return;
    }
    const def = G.find(w.type);
    box.append(A.el('h4', {}, def.name));
    for (const [k, v] of Object.entries(w.props)) {
      const numeric = typeof G.find(w.type).props[k] === 'number';
      const input = A.el('input', { value: v, type: numeric ? 'number' : 'text' });
      input.addEventListener('input', () => { w.props[k] = numeric ? +input.value : input.value; render(); changed(); input.focus(); });
      box.append(field(PROP_LABELS[k] || k, input, PROP_HINTS[k]));
    }
    const pos = ['x', 'y', 'w', 'h'].map((k) => {
      const i = A.el('input', { type: 'number', value: w[k] });
      i.addEventListener('change', () => { w[k] = +i.value; render(); changed(); });
      return field({ x: 'X', y: 'Y', w: 'Ancho', h: 'Alto' }[k], i);
    });
    box.append(A.el('div', { class: 'dz-two' }, ...pos.slice(0, 2)), A.el('div', { class: 'dz-two' }, ...pos.slice(2)),
      A.el('button', { class: 'btn ghost danger-text', onclick: () => remove(w.id) }, 'Quitar control'));
  }

  function changed() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => A.api('ui:save', design).catch(() => {}), 400);
  }

  async function generate(andRun) {
    await A.api('ui:save', design);
    const rel = `python/${design.file}.py`;
    const exists = await A.api('fs:exists', rel);
    if (exists && !(await A.confirm('Generar la app', `${rel} ya existe. ¿Reemplazarlo con el diseño actual? (Se guarda una copia de seguridad en el historial de la IA.)`, 'Reemplazar'))) return;
    if (exists) { try { await A.api('fs:backup', rel); } catch {} }
    await A.api('fs:write', rel, G.generate(design));
    A.toast(`App generada: ${rel}`, 'ok');
    if (andRun) {
      closeView();
      await A.editor.open(rel);
      A.app.runPython(rel);
    }
  }

  function askAI() {
    const keys = G.keysOf(design);
    const cmds = design.widgets.filter((w) => ['button', 'switch', 'slider', 'input'].includes(w.type))
      .map((w) => w.type === 'switch' ? `${w.props.on} / ${w.props.off}` : w.type === 'slider' ? `${w.props.command}:<${w.props.min}-${w.props.max}>` : w.type === 'input' ? '(texto libre)' : w.props.command);
    closeView();
    A.chat.send(`Hice una app con el diseñador (python/${design.file}.py). Adapta el sketch de Arduino para que funcione con ella:\n- Debe enviar por serie a ${design.baud} baudios líneas como: ${keys.map((k) => `${k}:<valor>`).join(';') || '(ninguna)'}\n- Debe obedecer estos comandos (uno por línea): ${cmds.join(', ') || '(ninguno)'}\nUsa las conexiones del proyecto si las hay.`);
  }

  function closeView() {
    if (!root) return;
    clearTimeout(saveTimer);
    A.api('ui:save', design).catch(() => {});
    root.remove();
    root = null;
  }

  A.designer = { open };
})();
