/* Simulador de Arduino Uno en el panel inferior */
(() => {
  let running = false;
  const pinEls = new Map();
  let simText = '';

  // Pines digitales D0–D13 y analógicos A0–A5 (también se pueden usar como digitales)
  const pins = A.$('#simPins');
  const PWM = [3, 5, 6, 9, 10, 11];
  for (let i = 0; i <= 19; i++) {
    const name = i < 14 ? `D${i}` : `A${i - 14}`;
    const label = i === 13 ? 'D13 ●' : name + (PWM.includes(i) ? '~' : '');
    const led = A.el('div', { class: 'sim-led', title: `${name}${PWM.includes(i) ? ' (PWM)' : ''}${i === 13 ? ' — LED integrado' : ''}` });
    pins.append(A.el('div', { class: 'sim-pin' }, led, A.el('small', {}, label)));
    pinEls.set(name, led);
  }

  const sliders = []; // deslizadores analógicos A0–A5 para sincronizar con potenciómetros
  const analog = A.$('#simAnalog');
  for (let ch = 0; ch < 6; ch++) {
    const val = A.el('span', { class: 'sim-val' }, '0.00 V · 0');
    const slider = A.el('input', { type: 'range', min: 0, max: 5, step: 0.01, value: 0 });
    slider.addEventListener('input', () => {
      const v = +slider.value;
      val.textContent = `${v.toFixed(2)} V · ${Math.round((v / 5) * 1023)}`;
      A.api('sim:input', { type: 'analog', channel: ch, volts: v });
    });
    analog.append(A.el('label', { class: 'sim-slider' }, A.el('b', {}, `A${ch}`), slider, val));
    sliders[ch] = { slider, val };
  }

  // ---------- componentes del editor de conexiones ----------
  const P = window.ARPY_PARTS;
  let simParts = []; // { part, def, el, update(pins) }

  async function refreshParts() {
    const host = A.$('#simParts');
    host.innerHTML = '';
    simParts = [];
    if (!A.app.config) return;
    let w = null;
    try { w = await A.api('wiring:load'); } catch {}
    for (const part of (w && w.parts) || []) {
      const def = P.find(part.type);
      if (!def || !def.sim) continue;
      const pin = (id) => (part.pins || {})[id];
      const box = A.el('div', { class: 'sp', title: P.describe({ parts: [part] }).slice(2) });
      const name = A.el('div', {}, A.el('b', {}, part.label), A.el('br'), A.el('small', {}, def.pins.filter((p) => !['gnd', 'vcc'].includes(p.kind)).map((p) => pin(p.id)).join(' · ')));
      let update = () => {};
      if (def.sim === 'led' || def.sim === 'relay') {
        const led = A.el('div', { class: 'sp-led', style: `--c:${def.sim === 'relay' ? '#3ccf91' : part.color || '#ff4d4d'}` });
        box.append(led, name);
        const src = pin(def.sim === 'relay' ? 'in' : 'anode');
        update = (d) => led.style.setProperty('--b', (d[src] || 0).toFixed(2));
      } else if (def.sim === 'rgb') {
        const led = A.el('div', { class: 'sp-led' });
        box.append(led, name);
        update = (d) => {
          const c = ['r', 'g', 'b'].map((k) => Math.round((d[pin(k)] || 0) * 255));
          led.style.setProperty('--c', `rgb(${c.join(',')})`);
          led.style.setProperty('--b', Math.max(...c) / 255);
        };
      } else if (def.sim === 'buzzer') {
        const ind = A.el('span', { class: 'muted' }, '🔈');
        box.append(ind, name);
        update = (d) => { const v = d[pin('sig')] || 0; ind.textContent = v > 0.02 && v < 0.98 ? '🔊' : v >= 0.98 ? '🔉' : '🔈'; };
      } else if (def.sim === 'servo') {
        const dial = A.el('div', { class: 'sp-servo' }, A.el('i'));
        const deg = A.el('small', {}, '—');
        box.append(dial, name, deg);
        update = (d) => {
          const duty = d[pin('sig')] || 0;
          if (duty < 0.015 || duty > 0.2) return; // sin pulsos de servo
          const us = duty * 20000; // periodo de 20 ms
          const a = Math.max(0, Math.min(180, ((us - 544) / (2400 - 544)) * 180));
          dial.style.setProperty('--a', a.toFixed(0));
          deg.textContent = `${a.toFixed(0)}°`;
        };
      } else if (def.sim === 'button' || def.sim === 'switch') {
        const p = pin(def.sim === 'button' ? 'sig' : 'out');
        const btn = A.el('button', { class: 'sp-btn' }, def.sim === 'button' ? 'Pulsar' : 'Detectar');
        // Pulsador a GND con INPUT_PULLUP: pulsado = LOW. PIR: activo = HIGH.
        const set = (on) => {
          btn.classList.toggle('on', on);
          A.api('sim:input', { type: 'digital', pin: p, value: def.sim === 'button' ? (on ? false : null) : on });
        };
        if (def.sim === 'button') {
          btn.addEventListener('mousedown', () => set(true));
          btn.addEventListener('mouseup', () => set(false));
          btn.addEventListener('mouseleave', () => btn.classList.contains('on') && set(false));
        } else btn.addEventListener('click', () => set(!btn.classList.contains('on')));
        box.append(btn, name);
      } else if (def.sim === 'analog') {
        const p = pin('sig');
        const ch = /^A(\d)$/.exec(p || '');
        const r = A.el('input', { type: 'range', min: 0, max: 5, step: 0.01, value: 0 });
        r.addEventListener('input', () => {
          if (!ch) return;
          A.api('sim:input', { type: 'analog', channel: +ch[1], volts: +r.value });
          const s2 = sliders[+ch[1]];
          if (s2) { s2.slider.value = r.value; s2.val.textContent = `${(+r.value).toFixed(2)} V · ${Math.round((r.value / 5) * 1023)}`; }
        });
        box.append(name, r);
      }
      host.append(box);
      simParts.push({ update });
    }
  }

  function setRunning(on) {
    running = on;
    const b = A.$('#btnSim');
    b.innerHTML = A.icon(on ? 'stop' : 'play') + (on ? 'Detener' : 'Simular');
    b.classList.toggle('ino', !on);
    A.$('#simDot').classList.toggle('on', on);
    if (!on) pinEls.forEach((el) => el.style.setProperty('--b', 0));
  }

  async function start() {
    if (!A.app.config) return;
    const fqbn = A.app.config.board || '';
    if (!/arduino:avr:(uno|nano)/.test(fqbn)) A.toast('El simulador emula el chip de Arduino Uno y Nano. Si tu sketch usa funciones propias de otra placa, puede no compilar.');
    await refreshParts();
    await A.editor.saveAll();
    const b = A.$('#btnSim');
    b.classList.add('busy'); b.disabled = true;
    A.$('#simLog').innerHTML = '';
    simText = '';
    try {
      const r = await A.api('sim:start');
      if (!r.ok) { A.toast(r.error, 'err'); A.panels.show('output'); }
      else { setRunning(true); A.panels.show('sim'); }
    } catch (e) { A.toast(e.message, 'err'); }
    b.classList.remove('busy'); b.disabled = false;
  }

  async function stop() {
    await A.api('sim:stop');
    setRunning(false);
  }

  window.arpy.on('sim:state', (s) => {
    if (!running) return;
    const duty = {};
    for (const p of s.pins) {
      duty[p.name] = p.duty;
      const el = pinEls.get(p.name);
      if (el) el.style.setProperty('--b', p.duty.toFixed(2));
    }
    for (const sp of simParts) sp.update(duty);
    A.$('#simTime').textContent = `t = ${s.seconds.toFixed(1)} s`;
    if (s.serial) {
      const pre = A.$('#simLog');
      pre.append(document.createTextNode(s.serial));
      while (pre.textContent.length > 100000 && pre.firstChild) pre.firstChild.remove();
      pre.scrollTop = pre.scrollHeight;
      simText = (simText + s.serial).slice(-3000);
      A.panels.feedPlot && A.panels.feedPlot(s.serial);
    }
  });

  A.$('#btnSim').addEventListener('click', () => (running ? stop() : start()));
  A.$('#simInput').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !running) return;
    A.api('sim:input', { type: 'serial', text: e.target.value + '\n' });
    A.$('#simLog').append(A.el('span', { class: 'sent' }, `» ${e.target.value}\n`));
    e.target.value = '';
  });

  A.$('#btnSimWiring').addEventListener('click', () => A.wiring.open());
  A.sim = { start, stop, refreshParts, get running() { return running; }, log: () => simText };
})();
