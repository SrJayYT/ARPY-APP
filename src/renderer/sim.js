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
    if (!/arduino:avr:(uno|nano)/.test(fqbn)) A.toast('El simulador emula un Arduino Uno. Si tu sketch usa funciones propias de otra placa, puede no compilar.');
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
    for (const p of s.pins) {
      const el = pinEls.get(p.name);
      if (el) el.style.setProperty('--b', p.duty.toFixed(2));
    }
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

  A.sim = { start, stop, get running() { return running; }, log: () => simText };
})();
