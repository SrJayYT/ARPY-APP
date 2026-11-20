/* Editor visual de conexiones: componentes sobre la placa, cables y pines. Se guarda en .arpy/wiring.json */
(() => {
  const P = window.ARPY_PARTS;
  const { findBoard } = window.ARPY_BOARDS;
  const W = 1180, H = 700; // lienzo lógico
  const BOARD = { x: 420, y: 230, w: 360, h: 240 };
  const WIRE_COLORS = ['#22d3ee', '#f2c94c', '#a78bfa', '#3ccf91', '#ff8a65', '#4b8bbe', '#f472b6', '#facc15'];

  let wiring = null;
  let selected = null;
  let root = null;
  let dirty = false;

  // Posición de cada pin del cabezal de la placa (formato Uno).
  const pinPos = (() => {
    const pos = {};
    const top = ['AREF', 'GND2', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8', '_', 'D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'];
    const bottom = ['IOREF', 'RESET', '3.3V', '5V', 'GND', 'GND3', 'VIN', '_', 'A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
    const step = 18;
    top.forEach((n, i) => { if (n !== '_') pos[n] = { x: BOARD.x + 26 + i * step, y: BOARD.y + 16, side: 'top' }; });
    bottom.forEach((n, i) => { if (n !== '_') pos[n] = { x: BOARD.x + 70 + i * step, y: BOARD.y + BOARD.h - 16, side: 'bottom' }; });
    pos.SDA = pos.A4; pos.SCL = pos.A5;
    return { pos, top, bottom };
  })();

  function boardSvg() {
    const b = BOARD;
    const head = (names, y) => names.map((n) => {
      if (n === '_') return '';
      const p = pinPos.pos[n];
      const label = n.replace(/\d$/, (d) => (n.startsWith('GND') ? '' : d)).replace(/^GND\d?$/, 'GND');
      const ly = y < b.y + b.h / 2 ? p.y + 16 : p.y - 10;
      return `<rect class="hp" data-pin="${n}" x="${p.x - 6}" y="${p.y - 6}" width="12" height="12" rx="2"/>`
        + `<text class="hl" x="${p.x}" y="${ly}" transform="rotate(-90 ${p.x} ${ly})" text-anchor="${y < b.y + b.h / 2 ? 'end' : 'start'}">${label}</text>`;
    }).join('');
    return `<g class="board">
      <rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="14" class="pcb"/>
      <rect x="${b.x - 18}" y="${b.y + 40}" width="44" height="52" rx="4" class="usb"/>
      <rect x="${b.x - 12}" y="${b.y + 150}" width="34" height="44" rx="4" class="jack"/>
      <rect x="${b.x + 150}" y="${b.y + 95}" width="110" height="46" rx="4" class="chip"/>
      <text x="${b.x + 205}" y="${b.y + 123}" class="chipl" text-anchor="middle">${esc(boardName())}</text>
      ${head(pinPos.top, b.y + 16)}${head(pinPos.bottom, b.y + b.h - 16)}
    </g>`;
  }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const boardName = () => findBoard((A.app.config && A.app.config.board) || 'arduino:avr:uno').name.replace(/^Arduino /, '');

  function partIcon(type, color) {
    const c = color || '#ff4d4d';
    const icons = {
      led: `<svg viewBox="0 0 24 24"><path d="M7 14V9a5 5 0 0 1 10 0v5z" fill="${c}" opacity=".85"/><path d="M5 14h14M9 14v7M15 14v5" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>`,
      rgb: '<svg viewBox="0 0 24 24"><circle cx="9" cy="10" r="5" fill="#ff4d4d" opacity=".8"/><circle cx="15" cy="10" r="5" fill="#3ccf91" opacity=".8"/><circle cx="12" cy="15" r="5" fill="#4b8bbe" opacity=".8"/></svg>',
      buzzer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2"/></svg>',
      servo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="8" width="18" height="10" rx="2"/><path d="M8 8V5h8"/><circle cx="8" cy="5" r="1.5"/></svg>',
      relay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 15l4-6 4 6"/></svg>',
      lcd: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="2" y="6" width="20" height="12" rx="2"/><rect x="5" y="9" width="14" height="6" fill="#3ccf91" opacity=".35" stroke="none"/></svg>',
      neopixel: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2.5" fill="#ff4d4d"/><circle cx="12" cy="12" r="2.5" fill="#3ccf91"/><circle cx="19" cy="12" r="2.5" fill="#4b8bbe"/></svg>',
      button: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="5" y="5" width="14" height="14" rx="2"/><circle cx="12" cy="12" r="3.5" fill="currentColor" opacity=".5"/></svg>',
      pot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="7"/><path d="M12 12l4-4"/></svg>',
      ldr: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="13" r="6"/><path d="M9 11h6M9 15h6M17 3l-2 3M21 7l-3 1"/></svg>',
      soil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3v12l-2 5M15 3v12l2 5M7 3h10"/></svg>',
      pir: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M5 15a7 7 0 0 1 14 0z"/><path d="M4 19h16"/></svg>',
      dht: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="6" y="3" width="12" height="15" rx="2"/><path d="M9 7h6M9 10h6M9 13h6M9 18v3M12 18v3M15 18v3"/></svg>',
      hcsr04: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="12" r="4"/><circle cx="17" cy="12" r="4"/></svg>',
      hc05: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="m7 7 10 10-5 5V2l5 5L7 17"/></svg>',
    };
    return icons[type] || icons.button;
  }

  async function open() {
    if (!A.app.config) return;
    wiring = (await A.api('wiring:load')) || { version: 1, parts: [] };
    if (!Array.isArray(wiring.parts)) wiring.parts = [];
    selected = null;
    dirty = false;
    build();
  }

  function build() {
    root && root.remove();
    root = A.el('div', { id: 'wiringView', class: 'wv' });
    const save = A.el('button', { class: 'btn ino sm', onclick: () => persist(true) }, 'Guardar');
    const ai = A.el('button', { class: 'btn ai sm', onclick: askAI });
    ai.innerHTML = A.icon('sparkles') + 'Escribir el código con IA';
    const close = A.el('button', { class: 'icon-btn', title: 'Cerrar (Esc)', onclick: tryClose });
    close.innerHTML = A.icon('x');
    const head = A.el('header', { class: 'wv-head' },
      A.el('div', { class: 'wv-title' }, A.el('b', {}, 'Conexiones'), A.el('span', { class: 'muted' }, ` · ${boardName()}`)),
      A.el('div', { id: 'wvWarn', class: 'wv-warn' }), A.el('div', { class: 'spacer' }), ai, save, close);

    const palette = A.el('aside', { class: 'wv-palette' });
    const groups = [...new Set(P.PARTS.map((p) => p.group))];
    for (const g of groups) {
      palette.append(A.el('h5', {}, g));
      for (const def of P.PARTS.filter((p) => p.group === g)) {
        const b = A.el('button', { class: 'wv-item', title: `Añadir ${def.name}`, onclick: () => addPart(def.type) });
        b.innerHTML = `<span class="wi">${partIcon(def.type, def.color)}</span><span>${esc(def.name)}</span>${def.sim ? '' : '<small title="Se puede conectar, pero el simulador no lo emula">sin sim.</small>'}`;
        palette.append(b);
      }
    }

    const canvas = A.el('div', { class: 'wv-canvas', id: 'wvCanvas' });
    const stage = A.el('div', { class: 'wv-stage', id: 'wvStage', style: `width:${W}px;height:${H}px` });
    stage.innerHTML = `<svg class="wv-svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${boardSvg()}<g id="wvWires"></g></svg>`;
    canvas.append(stage);
    canvas.addEventListener('mousedown', (e) => { if (e.target === canvas || e.target.closest('svg') && !e.target.closest('.hp')) select(null); });

    const insp = A.el('aside', { class: 'wv-insp', id: 'wvInsp' });
    root.append(head, A.el('div', { class: 'wv-body' }, palette, canvas, insp));
    document.body.append(root);
    A.hydrateIcons && A.hydrateIcons(root);
    wiring.parts.forEach(renderPart);
    fit();
    redraw();
    inspector();
    root.tabIndex = -1;
    root.focus();
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') tryClose();
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected && !/input|select|textarea/i.test(e.target.tagName)) removePart(selected);
      if (e.ctrlKey && e.key.toLowerCase() === 's') { e.preventDefault(); persist(true); }
    });
  }

  // Escala el lienzo para que quepa en la ventana.
  function fit() {
    const c = A.$('#wvCanvas');
    const s = Math.min(1, (c.clientWidth - 24) / W, (c.clientHeight - 24) / H);
    A.$('#wvStage').style.transform = `scale(${Math.max(0.55, s)})`;
    A.$('#wvStage').dataset.scale = Math.max(0.55, s);
  }
  addEventListener('resize', () => { if (root && root.isConnected) { fit(); redraw(); } });

  function nextPos() {
    const n = wiring.parts.length;
    const slots = [[40, 40], [40, 260], [40, 480], [880, 40], [880, 260], [880, 480], [420, 520], [600, 520], [240, 40], [620, 40]];
    const s = slots[n % slots.length];
    return { x: s[0] + Math.floor(n / slots.length) * 24, y: s[1] + Math.floor(n / slots.length) * 24 };
  }

  function addPart(type) {
    const def = P.find(type);
    const used = new Set(wiring.parts.flatMap((p) => Object.values(p.pins || {})));
    const count = wiring.parts.filter((p) => p.type === type).length + 1;
    const pins = {};
    for (const pin of def.pins) { pins[pin.id] = P.autoPin(pin.kind, used); used.add(pins[pin.id]); }
    const id = `${type}${Date.now().toString(36).slice(-4)}`;
    const part = { id, type, label: count > 1 ? `${def.name} ${count}` : def.name, pins, ...nextPos() };
    if (def.color) part.color = def.color;
    wiring.parts.push(part);
    renderPart(part);
    select(part.id);
    changed();
  }

  function removePart(id) {
    wiring.parts = wiring.parts.filter((p) => p.id !== id);
    const el = A.$(`#wvp-${id}`);
    el && el.remove();
    select(null);
    changed();
  }

  function renderPart(part) {
    const def = P.find(part.type);
    if (!def) return;
    const stage = A.$('#wvStage');
    const el = A.el('div', { class: 'wv-part', id: `wvp-${part.id}`, style: `left:${part.x}px;top:${part.y}px` });
    el.innerHTML = `<div class="wp-head"><span class="wi">${partIcon(part.type, part.color)}</span><b>${esc(part.label)}</b></div>`
      + def.pins.map((p) => `<div class="wp-pin" data-pin="${p.id}"><i class="wp-dot k-${p.kind}"></i><span>${esc(p.label.split(' (')[0])}</span><em>${esc(part.pins[p.id] || '—')}</em></div>`).join('');
    el.addEventListener('mousedown', (e) => startDrag(e, part, el));
    stage.append(el);
  }

  function refreshPart(part) {
    const el = A.$(`#wvp-${part.id}`);
    if (!el) return;
    el.remove();
    renderPart(part);
    A.$(`#wvp-${part.id}`).classList.toggle('sel', selected === part.id);
  }

  function startDrag(e, part, el) {
    if (e.button !== 0) return;
    select(part.id);
    const scale = +A.$('#wvStage').dataset.scale || 1;
    const sx = e.clientX, sy = e.clientY, ox = part.x, oy = part.y;
    let raf = 0;
    const move = (ev) => {
      part.x = Math.max(0, Math.min(W - el.offsetWidth, ox + (ev.clientX - sx) / scale));
      part.y = Math.max(0, Math.min(H - el.offsetHeight, oy + (ev.clientY - sy) / scale));
      el.style.left = part.x + 'px';
      el.style.top = part.y + 'px';
      if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); });
    };
    const up = () => { removeEventListener('mousemove', move); removeEventListener('mouseup', up); if (part.x !== ox || part.y !== oy) changed(); };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  }

  // Cables: curva desde el punto del componente hasta el pin de la placa.
  function redraw() {
    const g = A.$('#wvWires');
    if (!g) return;
    const stage = A.$('#wvStage');
    const scale = +stage.dataset.scale || 1;
    const sr = stage.getBoundingClientRect();
    let html = '';
    const usedPins = new Set();
    wiring.parts.forEach((part, pi) => {
      const def = P.find(part.type);
      const el = A.$(`#wvp-${part.id}`);
      if (!def || !el) return;
      const leftOfBoard = part.x + el.offsetWidth / 2 < BOARD.x + BOARD.w / 2;
      el.classList.toggle('right', !leftOfBoard);
      def.pins.forEach((pin, i) => {
        const to = part.pins[pin.id];
        const bp = pinPos.pos[to] || (to === 'GND' && pinPos.pos.GND);
        if (!bp) return;
        usedPins.add(to === 'SDA' ? 'A4' : to === 'SCL' ? 'A5' : to);
        const dot = el.querySelector(`[data-pin="${pin.id}"] .wp-dot`);
        const r = dot.getBoundingClientRect();
        const x1 = (r.left + r.width / 2 - sr.left) / scale;
        const y1 = (r.top + r.height / 2 - sr.top) / scale;
        const color = pin.kind === 'gnd' ? '#5b6675' : pin.kind === 'vcc' ? '#ef4444' : (part.color && def.type === 'led' ? part.color : WIRE_COLORS[(pi + i) % WIRE_COLORS.length]);
        const dy = bp.side === 'top' ? -70 : 70;
        const dx = leftOfBoard ? 90 : -90;
        html += `<path class="wire${selected === part.id ? ' sel' : ''}" d="M${x1} ${y1} C${x1 + dx} ${y1}, ${bp.x} ${bp.y + dy}, ${bp.x} ${bp.y}" stroke="${color}"/>`
          + `<circle cx="${bp.x}" cy="${bp.y}" r="3.2" fill="${color}"/>`;
      });
    });
    g.innerHTML = html;
    A.$$('#wvStage .hp').forEach((r) => r.classList.toggle('used', usedPins.has(r.dataset.pin.replace(/^GND\d$/, 'GND'))));
    const warn = P.check(wiring);
    const w = A.$('#wvWarn');
    w.textContent = warn.length ? `⚠ ${warn.length} aviso${warn.length > 1 ? 's' : ''}` : (wiring.parts.length ? '✔ Conexiones correctas' : '');
    w.className = 'wv-warn' + (warn.length ? ' bad' : ' ok');
    w.title = warn.join('\n');
  }

  function select(id) {
    selected = id;
    A.$$('.wv-part').forEach((el) => el.classList.toggle('sel', el.id === `wvp-${id}`));
    inspector();
    redraw();
  }

  function inspector() {
    const box = A.$('#wvInsp');
    if (!box) return;
    box.innerHTML = '';
    const part = wiring.parts.find((p) => p.id === selected);
    if (!part) {
      box.append(A.el('h4', {}, 'Cómo se usa'),
        A.el('ol', { class: 'wv-help' },
          A.el('li', {}, 'Elige un componente a la izquierda: se coloca con pines libres.'),
          A.el('li', {}, 'Arrástralo y cambia sus pines aquí a la derecha.'),
          A.el('li', {}, 'Pulsa "Escribir el código con IA" para que programe el sketch con estas conexiones.')),
        A.el('p', { class: 'muted' }, 'Los componentes con simulación aparecen también en la pestaña Simulador.'));
      const warn = P.check(wiring);
      if (warn.length) box.append(A.el('h4', {}, 'Avisos'), A.el('ul', { class: 'wv-warnlist' }, ...warn.map((w) => A.el('li', {}, w))));
      if (wiring.parts.length) box.append(A.el('h4', {}, 'Resumen'), A.el('pre', { class: 'wv-sum' }, P.describe(wiring)));
      return;
    }
    const def = P.find(part.type);
    const name = A.el('input', { value: part.label });
    name.addEventListener('input', () => { part.label = name.value || def.name; refreshPart(part); redraw(); changed(); });
    box.append(A.el('h4', {}, def.name), A.el('div', { class: 'field' }, A.el('label', {}, 'Nombre'), name));
    if (part.type === 'led') {
      const colors = ['#ff4d4d', '#3ccf91', '#4b8bbe', '#f2c94c', '#ffffff', '#ff8a3d'];
      const row = A.el('div', { class: 'wv-colors' });
      colors.forEach((c) => row.append(A.el('button', { class: 'wv-color' + (part.color === c ? ' on' : ''), style: `background:${c}`, title: c, onclick: () => { part.color = c; refreshPart(part); inspector(); redraw(); changed(); } })));
      box.append(A.el('div', { class: 'field' }, A.el('label', {}, 'Color'), row));
    }
    for (const pin of def.pins) {
      const sel = A.el('select', {}, ...P.options(pin.kind).map((o) => A.el('option', { value: o }, o)));
      sel.value = part.pins[pin.id] || '';
      sel.addEventListener('change', () => { part.pins[pin.id] = sel.value; refreshPart(part); redraw(); changed(); });
      box.append(A.el('div', { class: 'field' }, A.el('label', {}, pin.label), sel));
    }
    if (!def.sim) box.append(A.el('p', { class: 'muted' }, 'Este componente no se simula, pero la IA lo tendrá en cuenta al escribir el código.'));
    box.append(A.el('button', { class: 'btn ghost danger-text', onclick: () => removePart(part.id) }, 'Quitar componente'));
  }

  function changed() { dirty = true; }

  async function persist(toast) {
    await A.api('wiring:save', wiring);
    dirty = false;
    if (toast) A.toast('Conexiones guardadas', 'ok');
    A.sim && A.sim.refreshParts && A.sim.refreshParts();
  }

  async function tryClose() {
    if (dirty) await persist(false);
    root.remove();
    root = null;
  }

  async function askAI() {
    if (!wiring.parts.length) return A.toast('Añade algún componente primero', 'err');
    await persist(false);
    const warn = P.check(wiring);
    root.remove();
    root = null;
    A.chat.send(`Escribe (o actualiza) el sketch para estas conexiones del editor visual. Usa exactamente estos pines, define constantes con nombre para cada pin, y explica brevemente qué hace cada parte:\n${P.describe(wiring)}${warn.length ? `\n\nAvisos del editor:\n${warn.map((w) => '- ' + w).join('\n')}` : ''}`);
  }

  A.wiring = { open };
})();
