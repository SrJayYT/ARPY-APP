/* Editor Monaco: pestañas, guardado, marcadores de error, acciones de IA */
(() => {
  const tabs = new Map(); // path -> { model, saved, viewState }
  let editor = null;
  let monaco = null;
  let active = null;

  const ARDUINO_API = [
    ['pinMode', 'pinMode(${1:pin}, ${2|OUTPUT,INPUT,INPUT_PULLUP|});', 'Configura un pin como entrada o salida'],
    ['digitalWrite', 'digitalWrite(${1:pin}, ${2|HIGH,LOW|});', 'Escribe HIGH/LOW en un pin digital'],
    ['digitalRead', 'digitalRead(${1:pin})', 'Lee un pin digital'],
    ['analogRead', 'analogRead(${1:A0})', 'Lee un pin analógico'],
    ['analogWrite', 'analogWrite(${1:pin}, ${2:valor});', 'PWM 0-255'],
    ['analogReadResolution', 'analogReadResolution(${1:12});', 'Resolución del ADC (R4, SAMD, ESP32...)'],
    ['delay', 'delay(${1:ms});', 'Pausa en milisegundos'],
    ['delayMicroseconds', 'delayMicroseconds(${1:us});', 'Pausa en microsegundos'],
    ['millis', 'millis()', 'Milisegundos desde el arranque'],
    ['micros', 'micros()', 'Microsegundos desde el arranque'],
    ['map', 'map(${1:valor}, ${2:0}, ${3:1023}, ${4:0}, ${5:255})', 'Re-escala un valor'],
    ['constrain', 'constrain(${1:x}, ${2:min}, ${3:max})', 'Limita un valor'],
    ['tone', 'tone(${1:pin}, ${2:frecuencia});', 'Genera un tono'],
    ['noTone', 'noTone(${1:pin});', 'Detiene el tono'],
    ['pulseIn', 'pulseIn(${1:pin}, ${2:HIGH})', 'Mide un pulso'],
    ['attachInterrupt', 'attachInterrupt(digitalPinToInterrupt(${1:pin}), ${2:isr}, ${3|RISING,FALLING,CHANGE|});', 'Interrupción externa'],
    ['Serial.begin', 'Serial.begin(${1|9600,115200|});', 'Inicia el puerto serie'],
    ['Serial.println', 'Serial.println(${1});', 'Imprime con salto de línea'],
    ['Serial.print', 'Serial.print(${1});', 'Imprime sin salto de línea'],
    ['Serial.available', 'Serial.available()', 'Bytes disponibles para leer'],
    ['Serial.readStringUntil', "Serial.readStringUntil('\\n')", 'Lee hasta un carácter'],
    ['setup', 'void setup() {\n\t$0\n}', 'Función de inicio'],
    ['loop', 'void loop() {\n\t$0\n}', 'Bucle principal'],
    ['sinDelay', 'static unsigned long ${1:ultimo} = 0;\nif (millis() - ${1:ultimo} >= ${2:1000}) {\n\t${1:ultimo} = millis();\n\t$0\n}', 'Temporizador sin bloquear (millis)'],
  ];

  function initMonaco(m) {
    monaco = m;
    monaco.editor.defineTheme('arpy', {
      base: 'vs-dark',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '5c6f84', fontStyle: 'italic' },
        { token: 'keyword', foreground: 'c792ea' },
        { token: 'number', foreground: 'f78c6c' },
        { token: 'string', foreground: 'c3e88d' },
        { token: 'type', foreground: '22d3ee' },
      ],
      colors: {
        'editor.background': '#0b0f14',
        'editor.lineHighlightBackground': '#121a23',
        'editorLineNumber.foreground': '#3a4858',
        'editorLineNumber.activeForeground': '#9aa8b6',
        'editorGutter.background': '#0b0f14',
        'editor.selectionBackground': '#1f4a6a',
        'editorIndentGuide.background1': '#18212b',
        'editorWidget.background': '#151c25',
        'minimap.background': '#0b0f14',
      },
    });

    monaco.editor.defineTheme('arpy-light', {
      base: 'vs',
      inherit: true,
      rules: [
        { token: 'comment', foreground: '6a7a8c', fontStyle: 'italic' },
        { token: 'keyword', foreground: '7c3aed' },
        { token: 'number', foreground: 'c2410c' },
        { token: 'string', foreground: '15803d' },
        { token: 'type', foreground: '0e7490' },
      ],
      colors: { 'editor.background': '#ffffff', 'editor.lineHighlightBackground': '#f3f6fa', 'editorGutter.background': '#ffffff' },
    });

    registerPinHover();
    registerInlineAI();

    monaco.languages.registerCompletionItemProvider('cpp', {
      provideCompletionItems(model, pos) {
        const word = model.getWordUntilPosition(pos);
        const range = { startLineNumber: pos.lineNumber, endLineNumber: pos.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
        return {
          suggestions: ARDUINO_API.map(([label, insert, doc]) => ({
            label, insertText: insert, documentation: doc, detail: 'Arduino',
            kind: monaco.languages.CompletionItemKind.Snippet,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            range,
          })),
        };
      },
    });

    editor = monaco.editor.create(A.$('#editorHost'), {
      theme: 'arpy',
      automaticLayout: true,
      fontFamily: "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
      fontLigatures: false,
      fontSize: 14,
      minimap: { enabled: true, scale: 1, renderCharacters: false },
      smoothScrolling: true,
      cursorSmoothCaretAnimation: 'on',
      cursorBlinking: 'smooth',
      bracketPairColorization: { enabled: true },
      guides: { bracketPairs: true },
      padding: { top: 10 },
      scrollBeyondLastLine: false,
      renderLineHighlight: 'all',
      tabSize: 2,
      glyphMargin: true,
      inlineSuggest: { enabled: true },
      model: null,
    });

    // Puntos de parada para depurar Python: clic en el margen izquierdo.
    editor.onMouseDown((e) => {
      const t = e.target.type;
      const T = monaco.editor.MouseTargetType;
      if ((t === T.GUTTER_GLYPH_MARGIN || t === T.GUTTER_LINE_NUMBERS && e.event.altKey) && active && active.endsWith('.py')) {
        toggleBreakpoint(active, e.target.position.lineNumber);
      }
    });

    editor.onDidChangeModelContent(() => refreshDirty());
    editor.onDidChangeCursorPosition((e) => {
      A.$('#stCursor').textContent = `Ln ${e.position.lineNumber}, Col ${e.position.column}`;
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save(active));

    const aiAction = (id, label, prompt, key) => editor.addAction({
      id, label, keybindings: key ? [key] : [],
      contextMenuGroupId: '0_arpy', contextMenuOrder: 1,
      run: () => {
        const sel = getSelectionText();
        A.chat.send(prompt(sel ? 'el código seleccionado' : `el archivo ${active}`));
      },
    });
    aiAction('arpy.explain', '✨ IA: Explicar', (w) => `Explícame ${w} paso a paso.`);
    aiAction('arpy.fix', '✨ IA: Encontrar y corregir errores', (w) => `Revisa ${w}, encuentra errores o problemas y corrígelos.`);
    aiAction('arpy.improve', '✨ IA: Mejorar / optimizar', (w) => `Mejora y optimiza ${w} sin cambiar su comportamiento.`);
    aiAction('arpy.comment', '✨ IA: Comentar el código', (w) => `Agrega comentarios claros en español a ${w}.`);
    editor.addAction({
      id: 'arpy.ask', label: '✨ IA: Pedir un cambio aquí…', keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK],
      contextMenuGroupId: '0_arpy', contextMenuOrder: 0,
      run: async () => {
        const q = await A.prompt('Pedir a la IA', '', getSelectionText() ? 'Sobre el código seleccionado:' : `Sobre ${active}:`);
        if (q) A.chat.send(q);
      },
    });
  }

  // ---------- puntos de parada ----------
  const bpIds = new Map(); // path -> [decorationIds]

  function toggleBreakpoint(path, line) {
    const t = tabs.get(path);
    if (!t) return;
    const ids = bpIds.get(path) || [];
    const existing = ids.find((id) => t.model.getDecorationRange(id)?.startLineNumber === line);
    let next;
    if (existing) {
      t.model.deltaDecorations([existing], []);
      next = ids.filter((id) => id !== existing);
    } else {
      const [id] = t.model.deltaDecorations([], [{
        range: new monaco.Range(line, 1, line, 1),
        options: { isWholeLine: true, glyphMarginClassName: 'bp-glyph', className: 'bp-line', stickiness: 1, glyphMarginHoverMessage: { value: 'Punto de parada (clic para quitar)' } },
      }]);
      next = [...ids, id];
    }
    bpIds.set(path, next);
  }

  function breakpoints() {
    const out = [];
    for (const [path, ids] of bpIds) {
      const t = tabs.get(path);
      if (!t) continue;
      for (const id of ids) {
        const r = t.model.getDecorationRange(id);
        if (r) out.push({ file: path, line: r.startLineNumber });
      }
    }
    return out;
  }

  // ---------- info de pines al pasar el mouse ----------
  const PINS = {
    uno: { v: '5V', pwm: [3, 5, 6, 9, 10, 11], analog: 6, i2c: 'A4 (SDA), A5 (SCL)', spi: { 10: 'SS', 11: 'MOSI', 12: 'MISO', 13: 'SCK' }, serial: { 0: 'RX (Serial)', 1: 'TX (Serial)' }, irq: [2, 3], led: 13 },
    nano: { v: '5V', pwm: [3, 5, 6, 9, 10, 11], analog: 8, i2c: 'A4 (SDA), A5 (SCL)', spi: { 10: 'SS', 11: 'MOSI', 12: 'MISO', 13: 'SCK' }, serial: { 0: 'RX', 1: 'TX' }, irq: [2, 3], led: 13, note: 'A6 y A7 solo son entradas analógicas.' },
    mega: { v: '5V', pwm: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 44, 45, 46], analog: 16, i2c: '20 (SDA), 21 (SCL)', spi: { 50: 'MISO', 51: 'MOSI', 52: 'SCK', 53: 'SS' }, serial: { 0: 'RX0', 1: 'TX0', 19: 'RX1', 18: 'TX1', 17: 'RX2', 16: 'TX2', 15: 'RX3', 14: 'TX3' }, irq: [2, 3, 18, 19, 20, 21], led: 13 },
    r4: { v: '5V', pwm: [3, 5, 6, 9, 10, 11], analog: 6, i2c: 'A4 (SDA), A5 (SCL)', spi: { 10: 'SS', 11: 'MOSI', 12: 'MISO', 13: 'SCK' }, serial: { 0: 'RX (Serial1)', 1: 'TX (Serial1)' }, irq: [2, 3], led: 13, note: 'A0 tiene DAC real (analogWrite en A0). ADC de hasta 14 bits con analogReadResolution(14). Serial es el USB; los pines 0/1 son Serial1.' },
    v33: { v: '3.3V', note: 'Lógica de 3.3V: NO conectes señales de 5V directamente a los pines (usa divisor o conversor de nivel).' },
  };

  function pinProfile() {
    const fqbn = (A.app.config && A.app.config.board) || '';
    if (/avr:mega/.test(fqbn)) return PINS.mega;
    if (/avr:nano/.test(fqbn)) return PINS.nano;
    if (/avr:/.test(fqbn)) return PINS.uno;
    if (/renesas_uno/.test(fqbn)) return PINS.r4;
    if (/(esp32|samd|mbed|zephyr|sam:)/.test(fqbn)) return PINS.v33;
    return PINS.uno;
  }

  function describePin(token) {
    const p = pinProfile();
    const board = ARPY_BOARDS.findBoard((A.app.config && A.app.config.board) || '').name;
    const lines = [`**${token}** en ${board} — lógica ${p.v}`];
    if (token === 'LED_BUILTIN') lines.push(`LED integrado${p.led ? ` (pin ${p.led})` : ''}.`);
    else if (/^A\d+$/.test(token)) {
      const n = +token.slice(1);
      if (p.analog && n >= p.analog) lines.push(`⚠ Esta placa solo tiene A0–A${p.analog - 1}.`);
      else lines.push('Entrada analógica (analogRead). También sirve como pin digital.');
      if (p.i2c && p.i2c.includes(token)) lines.push(`Comparte función I2C: ${p.i2c}.`);
    } else if (/^\d+$/.test(token)) {
      const n = +token;
      const f = [];
      if (p.pwm) f.push(p.pwm.includes(n) ? 'PWM ✔ (analogWrite)' : 'sin PWM');
      if (p.spi && p.spi[n]) f.push(`SPI ${p.spi[n]}`);
      if (p.serial && p.serial[n]) f.push(`${p.serial[n]} — evítalo si usas el puerto serie`);
      if (p.irq && p.irq.includes(n)) f.push('interrupción externa');
      if (p.led === n) f.push('LED integrado');
      lines.push(f.length ? f.join(' · ') : 'Pin digital.');
    } else if (token === 'SDA' || token === 'SCL') lines.push(p.i2c ? `I2C: ${p.i2c}` : 'Bus I2C.');
    if (p.note) lines.push(p.note);
    return lines.join('\n\n');
  }

  function registerPinHover() {
    monaco.languages.registerHoverProvider('cpp', {
      provideHover(model, pos) {
        const w = model.getWordAtPosition(pos);
        if (!w) return null;
        const token = w.word;
        const line = model.getLineContent(pos.lineNumber);
        const isPinCall = /(pinMode|digitalWrite|digitalRead|analogRead|analogWrite|tone|attachInterrupt|digitalPinToInterrupt|PIN|pin)/i.test(line);
        if (!(/^(A\d+|LED_BUILTIN|SDA|SCL)$/.test(token) || (/^\d+$/.test(token) && isPinCall))) return null;
        return {
          range: new monaco.Range(pos.lineNumber, w.startColumn, pos.lineNumber, w.endColumn),
          contents: [{ value: describePin(token) }],
        };
      },
    });
  }

  // ---------- autocompletado con IA (texto fantasma, Tab para aceptar) ----------
  let aiCompleteOn = false;
  function registerInlineAI() {
    const provider = {
      async provideInlineCompletions(model, pos, _ctx, token) {
        if (!aiCompleteOn || !active) return { items: [] };
        await new Promise((r) => setTimeout(r, 600));
        if (token.isCancellationRequested) return { items: [] };
        const full = model.getValue();
        const offset = model.getOffsetAt(pos);
        const prefix = full.slice(0, offset);
        const suffix = full.slice(offset);
        if (!prefix.trim()) return { items: [] };
        let text = '';
        try { text = await A.api('ai:complete', { path: active, prefix, suffix, lang: model.getLanguageId() }); } catch {}
        if (token.isCancellationRequested || !text || !text.trim()) return { items: [] };
        return { items: [{ insertText: text, range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column) }] };
      },
      freeInlineCompletions() {},
      disposeInlineCompletions() {},
    };
    monaco.languages.registerInlineCompletionsProvider('cpp', provider);
    monaco.languages.registerInlineCompletionsProvider('python', provider);
  }

  // Modo ligero: sin minimapa ni animaciones suaves (menos CPU/RAM en equipos modestos).
  function setLite(on) {
    if (!editor) return;
    editor.updateOptions({
      minimap: { enabled: !on, scale: 1, renderCharacters: false },
      smoothScrolling: !on,
      cursorSmoothCaretAnimation: on ? 'off' : 'on',
      cursorBlinking: on ? 'blink' : 'smooth',
      renderLineHighlight: on ? 'line' : 'all',
      occurrencesHighlight: on ? 'off' : 'singleFile',
      guides: { bracketPairs: !on, indentation: true },
      stickyScroll: { enabled: !on },
    });
  }

  function setTheme(theme) {
    if (monaco) monaco.editor.setTheme(theme === 'light' ? 'arpy-light' : 'arpy');
  }

  function key(path) { return monaco.Uri.parse('arpy:///' + path); }

  function refreshDirty() {
    for (const [p, t] of tabs) {
      const dirty = t.model.getAlternativeVersionId() !== t.saved;
      const tab = A.$(`.tab[data-path="${CSS.escape(p)}"]`);
      if (tab) tab.classList.toggle('dirty', dirty);
    }
  }

  function renderTabs() {
    const bar = A.$('#tabs');
    bar.innerHTML = '';
    for (const [p, t] of tabs) {
      const name = p.split('/').pop();
      const tab = A.el('div', {
        class: 'tab' + (p === active ? ' active' : '') + (t.model.getAlternativeVersionId() !== t.saved ? ' dirty' : ''),
        'data-path': p, title: p,
        onmousedown: (e) => { if (e.button === 1) { e.preventDefault(); close(p); } },
        onclick: () => open(p),
      });
      tab.innerHTML = `${A.fileIcon(name)}<span>${A.esc(name)}</span><span class="close">${A.icon('x')}</span>`;
      tab.querySelector('.close').addEventListener('click', (e) => { e.stopPropagation(); close(p); });
      bar.append(tab);
    }
    A.$('#emptyEditor').classList.toggle('hidden', !!active);
    A.explorer && A.explorer.markActive(active);
    A.chat && A.chat.renderCtx();
  }

  async function open(path, { line } = {}) {
    if (!editor) return;
    if (preview) { A.livediff && A.livediff.dismiss(); endPreview(); }
    if (active && tabs.has(active)) tabs.get(active).viewState = editor.saveViewState();
    if (!tabs.has(path)) {
      let content;
      try { content = await A.api('fs:read', path); } catch (e) { A.toast(e.message, 'err'); return; }
      const existing = monaco.editor.getModel(key(path));
      if (existing) existing.dispose();
      const model = monaco.editor.createModel(content, A.langOf(path), key(path));
      model.updateOptions({ tabSize: path.endsWith('.py') ? 4 : 2 });
      tabs.set(path, { model, saved: model.getAlternativeVersionId(), viewState: null });
    }
    active = path;
    const t = tabs.get(path);
    editor.setModel(t.model);
    if (t.viewState) editor.restoreViewState(t.viewState);
    if (line) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
    }
    editor.focus();
    renderTabs();
  }

  async function close(path) {
    const t = tabs.get(path);
    if (!t) return;
    if (t.model.getAlternativeVersionId() !== t.saved) {
      const ok = await A.confirm('Cambios sin guardar', `¿Guardar los cambios de ${path} antes de cerrar?`, 'Guardar');
      if (ok) await save(path);
    }
    t.model.dispose();
    tabs.delete(path);
    if (active === path) {
      active = [...tabs.keys()].pop() || null;
      if (active) return open(active);
      editor.setModel(null);
    }
    renderTabs();
  }

  function closeAll() {
    for (const t of tabs.values()) t.model.dispose();
    tabs.clear();
    active = null;
    if (editor) editor.setModel(null);
    renderTabs();
  }

  async function save(path) {
    const t = tabs.get(path);
    if (!t) return;
    await A.api('fs:write', path, t.model.getValue());
    t.saved = t.model.getAlternativeVersionId();
    refreshDirty();
  }

  async function saveAll() {
    for (const p of tabs.keys()) {
      const t = tabs.get(p);
      if (t.model.getAlternativeVersionId() !== t.saved) await save(p);
    }
  }

  // ---------- vista en vivo de las ediciones de la IA ----------
  let preview = null; // { path, model, decos, actions }

  function contentOf(path) {
    const t = tabs.get(path);
    return t ? t.model.getValue() : null;
  }

  // marks: [{ line, t: 'add'|'del'|'pend' }]
  function livePreview(path, text, marks, revealLine, info) {
    if (!editor) return;
    if (!preview || preview.path !== path) {
      if (preview) preview.model.dispose();
      else if (active && tabs.has(active)) tabs.get(active).viewState = editor.saveViewState();
      const model = monaco.editor.createModel(text, A.langOf(path), monaco.Uri.parse(`arpy-live:///${Date.now()}/${path}`));
      model.updateOptions({ tabSize: path.endsWith('.py') ? 4 : 2 });
      preview = { path, model, decos: [], actions: null };
      editor.setModel(model);
      editor.updateOptions({ readOnly: true });
      A.$('#emptyEditor').classList.add('hidden');
    } else if (preview.model.getValue() !== text) {
      // reemplazo completo sin perder la posición de desplazamiento
      preview.model.applyEdits([{ range: preview.model.getFullModelRange(), text }]);
    }
    if (editor.getModel() !== preview.model) editor.setModel(preview.model);
    const m = preview.model;
    preview.decos = editor.deltaDecorations(preview.decos, marks.filter((k) => k.line <= m.getLineCount()).map((k) => ({
      range: new monaco.Range(k.line, 1, k.line, m.getLineMaxColumn(k.line)),
      options: { isWholeLine: true, className: 'ld-' + k.t, inlineClassName: 'ld-txt-' + k.t, linesDecorationsClassName: 'ld-g-' + k.t },
    })));
    if (revealLine) editor.revealLineInCenterIfOutsideViewport(revealLine);
    preview.info = info;
    previewBanner(info);
  }

  function previewBanner(info) {
    let b = A.$('#liveBanner');
    if (!b) {
      b = A.el('div', { id: 'liveBanner', class: 'live-banner' });
      A.$('#editorWrap').append(b);
    }
    b.classList.toggle('done', !info.partial);
    b.innerHTML = '';
    b.append(A.el('span', { class: 'lb-dot' }),
      A.el('span', {}, info.partial ? (info.isNew ? 'La IA está creando ' : 'La IA está editando ') : 'Cambios propuestos en '),
      A.el('b', {}, preview.path),
      A.el('span', { class: 'lb-stats' }, A.el('span', { class: 'add' }, `+${info.add}`), ' ', A.el('span', { class: 'rem' }, `−${info.del}`)));
    if (preview.actions) {
      const ok = A.el('button', { class: 'btn sm ino', onclick: async () => { ok.disabled = true; await preview.actions.apply(); } });
      ok.innerHTML = A.icon('check') + 'Aplicar';
      b.append(A.el('span', { class: 'spacer' }), A.el('button', { class: 'btn sm ghost', onclick: () => preview.actions.discard() }, 'Descartar'), ok);
    }
  }

  function previewActions(actions) {
    if (!preview) return;
    preview.actions = actions;
    previewBanner({ ...(preview.info || { add: 0, del: 0 }), partial: false });
  }

  function endPreview() {
    const b = A.$('#liveBanner');
    if (b) b.remove();
    if (!preview) return;
    const p = preview;
    preview = null;
    editor.updateOptions({ readOnly: false });
    if (active && tabs.has(active)) {
      const t = tabs.get(active);
      editor.setModel(t.model);
      if (t.viewState) editor.restoreViewState(t.viewState);
    } else editor.setModel(null);
    p.model.dispose();
    renderTabs();
  }

  // Tras aplicar: resalta en el archivo real lo que se agregó (verde) y dónde se quitó (marca roja).
  async function highlightChanges(path, ops) {
    await open(path);
    const t = tabs.get(path);
    if (!t) return;
    const decos = [];
    let line = 0;
    let first = 0;
    for (const o of ops) {
      if (o.t === 'eq' || o.t === 'add') line++;
      if (o.t === 'add') {
        if (!first) first = line;
        decos.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'ld-add ld-fade', linesDecorationsClassName: 'ld-g-add' } });
      } else if (o.t === 'del') {
        const at = Math.max(1, Math.min(line + 1, t.model.getLineCount()));
        if (!first) first = at;
        decos.push({ range: new monaco.Range(at, 1, at, 1), options: { isWholeLine: true, linesDecorationsClassName: 'ld-g-delmark' } });
      }
    }
    if (first) editor.revealLineInCenterIfOutsideViewport(first);
    const ids = t.model.deltaDecorations([], decos);
    setTimeout(() => { if (!t.model.isDisposed()) t.model.deltaDecorations(ids, []); }, 6000);
  }

  // Aplica contenido nuevo a un archivo (desde la IA) manteniendo Ctrl+Z.
  async function applyContent(path, content) {
    await A.api('fs:write', path, content);
    const t = tabs.get(path);
    if (t) {
      t.model.pushEditOperations([], [{ range: t.model.getFullModelRange(), text: content }], () => null);
      t.saved = t.model.getAlternativeVersionId();
      refreshDirty();
      if (path === active) flash();
    }
  }

  function flash() {
    const lines = editor.getModel()?.getLineCount() || 0;
    const ids = editor.deltaDecorations([], [{ range: new monaco.Range(1, 1, lines, 1), options: { isWholeLine: true, className: 'ai-line-glow' } }]);
    setTimeout(() => editor.deltaDecorations(ids, []), 900);
  }

  // Recarga archivos abiertos cuando cambian en disco (y no tienen cambios sin guardar).
  async function syncFromDisk() {
    for (const [p, t] of tabs) {
      if (t.model.getAlternativeVersionId() !== t.saved) continue;
      let content;
      try { content = await A.api('fs:read', p); } catch {
        t.model.dispose(); tabs.delete(p);
        if (active === p) { active = [...tabs.keys()].pop() || null; active ? open(active) : editor.setModel(null); }
        renderTabs();
        continue;
      }
      if (content !== t.model.getValue()) {
        t.model.pushEditOperations([], [{ range: t.model.getFullModelRange(), text: content }], () => null);
        t.saved = t.model.getAlternativeVersionId();
      }
    }
    refreshDirty();
  }

  function renamed(from, to) {
    for (const p of [...tabs.keys()]) {
      if (p === from || p.startsWith(from + '/')) {
        const np = to + p.slice(from.length);
        const t = tabs.get(p);
        const model = monaco.editor.createModel(t.model.getValue(), A.langOf(np), key(np));
        t.model.dispose();
        tabs.delete(p);
        tabs.set(np, { model, saved: model.getAlternativeVersionId(), viewState: null });
        if (active === p) active = np;
      }
    }
    if (active) editor.setModel(tabs.get(active).model);
    renderTabs();
  }

  function getSelectionText() {
    if (!editor || !editor.getModel()) return '';
    const sel = editor.getSelection();
    return sel && !sel.isEmpty() ? editor.getModel().getValueInRange(sel) : '';
  }

  function liveContext() {
    return {
      activeFile: active,
      cursorLine: editor && editor.getModel() ? editor.getPosition()?.lineNumber : null,
      selection: getSelectionText(),
      openFiles: [...tabs.keys()],
    };
  }

  // problems: [{file, line, col, severity, message}]
  function setMarkers(problems) {
    const byFile = new Map();
    for (const p of problems) {
      if (!byFile.has(p.file)) byFile.set(p.file, []);
      byFile.get(p.file).push({
        startLineNumber: p.line, endLineNumber: p.line, startColumn: p.col || 1, endColumn: p.col ? p.col + 1 : 1000,
        message: p.message,
        severity: p.severity === 'error' ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning,
      });
    }
    for (const [p, t] of tabs) monaco.editor.setModelMarkers(t.model, 'arpy', byFile.get(p) || []);
  }

  function showDiff(path, before, after, onApply) {
    const host = A.el('div', { id: 'diffHost' });
    const foot = A.el('div', { class: 'modal-foot' },
      A.el('button', { class: 'btn ghost', onclick: () => A.modal.close() }, 'Cerrar'),
      onApply ? A.el('button', { class: 'btn ino', onclick: () => { A.modal.close(); onApply(); } }, 'Aplicar cambios') : null);
    A.modal.open(`Cambios propuestos — ${path}`, A.el('div', { style: 'display:flex;flex-direction:column;gap:10px;flex:1;min-height:0' }, host, foot), { wide: true });
    const diff = monaco.editor.createDiffEditor(host, { theme: 'arpy', automaticLayout: true, readOnly: true, renderSideBySide: true, fontSize: 13 });
    const lang = A.langOf(path);
    const m1 = monaco.editor.createModel(before, lang);
    const m2 = monaco.editor.createModel(after, lang);
    diff.setModel({ original: m1, modified: m2 });
    const prev = A.modal.onClose;
    A.modal.onClose = () => { diff.dispose(); m1.dispose(); m2.dispose(); prev && prev(); };
  }

  function setFontSize(n) { editor && editor.updateOptions({ fontSize: n }); }

  A.editor = {
    initMonaco, open, close, closeAll, save, saveAll, applyContent, syncFromDisk, renamed,
    liveContext, setMarkers, showDiff, setFontSize, setTheme, setLite,
    contentOf, livePreview, previewActions, endPreview, highlightChanges, get previewing() { return !!preview; }, breakpoints, toggleBreakpoint,
    setAiComplete: (on) => { aiCompleteOn = !!on; },
    get active() { return active; },
    isOpen: (p) => tabs.has(p),
    colorize: (code, lang) => (monaco ? monaco.editor.colorize(code, lang, {}) : Promise.resolve(A.esc(code))),
  };
})();
