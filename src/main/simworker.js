// Simulador de Arduino Uno/Nano (ATmega328P) en un hilo aparte, usando avr8js.
const { parentPort, workerData } = require('worker_threads');
const {
  CPU, avrInstruction, AVRTimer, timer0Config, timer1Config, timer2Config,
  AVRIOPort, portBConfig, portCConfig, portDConfig, PinState, AVRUSART, usart0Config, AVRADC, adcConfig,
} = require('avr8js');

const FREQ = 16e6;

function loadHex(source, target) {
  for (const line of source.split('\n')) {
    if (line[0] === ':' && line.substr(7, 2) === '00') {
      const bytes = parseInt(line.substr(1, 2), 16);
      const addr = parseInt(line.substr(3, 4), 16);
      for (let i = 0; i < bytes; i++) target[addr + i] = parseInt(line.substr(9 + i * 2, 2), 16);
    }
  }
}

const program = new Uint16Array(0x8000 / 2);
loadHex(workerData.hex, new Uint8Array(program.buffer));
const cpu = new CPU(program);
new AVRTimer(cpu, timer0Config);
new AVRTimer(cpu, timer1Config);
new AVRTimer(cpu, timer2Config);
const ports = { B: new AVRIOPort(cpu, portBConfig), C: new AVRIOPort(cpu, portCConfig), D: new AVRIOPort(cpu, portDConfig) };
const usart = new AVRUSART(cpu, usart0Config, FREQ);
const adc = new AVRADC(cpu, adcConfig);

// Pines Arduino: D0-D7 = PORTD0-7, D8-D13 = PORTB0-5, A0-A5 = PORTC0-5
const PINS = [];
for (let i = 0; i < 8; i++) PINS.push({ name: `D${i}`, port: 'D', bit: i });
for (let i = 0; i < 6; i++) PINS.push({ name: `D${8 + i}`, port: 'B', bit: i });
for (let i = 0; i < 6; i++) PINS.push({ name: `A${i}`, port: 'C', bit: i });

// Para estimar PWM: ciclos en HIGH por ventana
const stat = PINS.map(() => ({ high: false, since: 0, acc: 0 }));
function sample(i) {
  const p = PINS[i];
  return ports[p.port].pinState(p.bit) === PinState.High;
}
for (const port of Object.keys(ports)) {
  ports[port].addListener(() => {
    PINS.forEach((p, i) => {
      if (p.port !== port) return;
      const h = sample(i);
      const s = stat[i];
      if (h !== s.high) {
        if (s.high) s.acc += cpu.cycles - s.since;
        s.high = h;
        s.since = cpu.cycles;
      }
    });
  });
}

// Bytes del puerto serie; se decodifican como UTF-8 (tildes, ñ) al enviarlos a la interfaz.
let serialBytes = [];
const utf8 = new TextDecoder('utf-8');
usart.onByteTransmit = (b) => { serialBytes.push(b); };

const rxQueue = [];
usart.onRxComplete = () => feedRx();
function feedRx() {
  if (rxQueue.length && !usart.rxBusy) usart.writeByte(rxQueue.shift());
}

// Entradas digitales desde los componentes simulados (pulsadores, sensores PIR…).
// external[i]: true/false = el componente fuerza el nivel; undefined = libre.
const external = PINS.map(() => undefined);
const applied = PINS.map(() => null);
// avr8js no aplica la resistencia pull-up interna: la emulamos para pines libres en INPUT_PULLUP.
function syncInputs() {
  PINS.forEach((p, i) => {
    const port = ports[p.port];
    const st = port.pinState(p.bit);
    let want = external[i];
    if (want === undefined) want = st === PinState.InputPullUp;
    if (applied[i] !== want) { applied[i] = want; port.setPin(p.bit, want); }
  });
}

parentPort.on('message', (msg) => {
  if (msg.type === 'digital') {
    const i = PINS.findIndex((p) => p.name === msg.pin || (msg.pin && msg.pin.startsWith('A') && p.name === msg.pin));
    if (i >= 0) { external[i] = msg.value === null ? undefined : !!msg.value; syncInputs(); }
  }
  if (msg.type === 'analog') adc.channelValues[msg.channel] = msg.volts;
  if (msg.type === 'serial') { for (const ch of Buffer.from(msg.text, 'utf8')) rxQueue.push(ch); feedRx(); }
});

// Bucle en tiempo real: ejecuta los ciclos que correspondan al tiempo transcurrido.
let lastReport = cpu.cycles;
const start = Date.now();
function run() {
  const target = Math.min(((Date.now() - start) / 1000) * FREQ, cpu.cycles + FREQ / 20);
  while (cpu.cycles < target) {
    avrInstruction(cpu);
    cpu.tick();
  }
  feedRx();
  syncInputs();
  if (cpu.cycles - lastReport >= FREQ / 30) {
    const span = cpu.cycles - lastReport;
    const pins = PINS.map((p, i) => {
      const s = stat[i];
      let high = s.acc + (s.high ? cpu.cycles - Math.max(s.since, lastReport) : 0);
      s.acc = 0;
      if (s.high) s.since = cpu.cycles;
      return { name: p.name, duty: Math.max(0, Math.min(1, high / span)) };
    });
    lastReport = cpu.cycles;
    const serial = serialBytes.length ? utf8.decode(Uint8Array.from(serialBytes), { stream: true }) : '';
    serialBytes = [];
    parentPort.postMessage({ type: 'state', pins, serial, seconds: cpu.cycles / FREQ });
  }
  setTimeout(run, 5);
}
run();
