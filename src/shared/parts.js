/* Catálogo de componentes para el editor visual de conexiones y el simulador.
   Tipos de pin: digital, pwm, analog, gnd, vcc, sda, scl, rx, tx */
(function (root) {
  const PARTS = [
    { type: 'led', name: 'LED', group: 'Salidas', color: '#ff4d4d', sim: 'led',
      pins: [{ id: 'anode', label: '+ ánodo (con resistencia 220Ω)', kind: 'pwm' }, { id: 'cathode', label: '− cátodo', kind: 'gnd' }] },
    { type: 'rgb', name: 'LED RGB', group: 'Salidas', sim: 'rgb',
      pins: [{ id: 'r', label: 'Rojo', kind: 'pwm' }, { id: 'g', label: 'Verde', kind: 'pwm' }, { id: 'b', label: 'Azul', kind: 'pwm' }, { id: 'gnd', label: 'GND (cátodo común)', kind: 'gnd' }] },
    { type: 'buzzer', name: 'Zumbador', group: 'Salidas', sim: 'buzzer',
      pins: [{ id: 'sig', label: '+ señal', kind: 'digital' }, { id: 'gnd', label: '− GND', kind: 'gnd' }] },
    { type: 'servo', name: 'Servo', group: 'Salidas', sim: 'servo',
      pins: [{ id: 'sig', label: 'Señal (naranja)', kind: 'pwm' }, { id: 'vcc', label: '5V (rojo)', kind: 'vcc' }, { id: 'gnd', label: 'GND (marrón)', kind: 'gnd' }] },
    { type: 'relay', name: 'Relé', group: 'Salidas', sim: 'relay',
      pins: [{ id: 'in', label: 'IN', kind: 'digital' }, { id: 'vcc', label: 'VCC', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'lcd', name: 'Pantalla LCD I2C', group: 'Salidas', sim: null,
      pins: [{ id: 'sda', label: 'SDA', kind: 'sda' }, { id: 'scl', label: 'SCL', kind: 'scl' }, { id: 'vcc', label: 'VCC', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'neopixel', name: 'Tira NeoPixel', group: 'Salidas', sim: null,
      pins: [{ id: 'din', label: 'DIN', kind: 'digital' }, { id: 'vcc', label: '5V', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'button', name: 'Pulsador', group: 'Entradas', sim: 'button',
      pins: [{ id: 'sig', label: 'Señal (INPUT_PULLUP)', kind: 'digital' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'pot', name: 'Potenciómetro', group: 'Entradas', sim: 'analog',
      pins: [{ id: 'sig', label: 'Cursor (centro)', kind: 'analog' }, { id: 'vcc', label: '5V', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'ldr', name: 'Sensor de luz (LDR)', group: 'Entradas', sim: 'analog',
      pins: [{ id: 'sig', label: 'Señal (divisor con 10kΩ)', kind: 'analog' }, { id: 'vcc', label: '5V', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'soil', name: 'Humedad de suelo', group: 'Sensores', sim: 'analog',
      pins: [{ id: 'sig', label: 'AO', kind: 'analog' }, { id: 'vcc', label: 'VCC', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'pir', name: 'Sensor de movimiento PIR', group: 'Sensores', sim: 'switch',
      pins: [{ id: 'out', label: 'OUT', kind: 'digital' }, { id: 'vcc', label: '5V', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'dht', name: 'Temperatura y humedad DHT11/22', group: 'Sensores', sim: null,
      pins: [{ id: 'data', label: 'DATA', kind: 'digital' }, { id: 'vcc', label: 'VCC', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'hcsr04', name: 'Ultrasonido HC-SR04', group: 'Sensores', sim: null,
      pins: [{ id: 'trig', label: 'TRIG', kind: 'digital' }, { id: 'echo', label: 'ECHO', kind: 'digital' }, { id: 'vcc', label: 'VCC', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
    { type: 'hc05', name: 'Bluetooth HC-05', group: 'Comunicación', sim: null,
      pins: [{ id: 'tx', label: 'TXD → pin RX', kind: 'rx' }, { id: 'rx', label: 'RXD ← pin TX (divisor 1k/2k)', kind: 'tx' }, { id: 'vcc', label: '5V', kind: 'vcc' }, { id: 'gnd', label: 'GND', kind: 'gnd' }] },
  ];

  // Pines del formato Uno (UNO R3/R4, Leonardo, y Nano con los mismos nombres).
  const DIGITAL = Array.from({ length: 14 }, (_, i) => `D${i}`);
  const ANALOG = Array.from({ length: 6 }, (_, i) => `A${i}`);
  const POWER = ['5V', '3.3V', 'GND', 'VIN'];
  const PWM = ['D3', 'D5', 'D6', 'D9', 'D10', 'D11'];

  function options(kind) {
    switch (kind) {
      case 'gnd': return ['GND'];
      case 'vcc': return ['5V', '3.3V', 'VIN'];
      case 'analog': return [...ANALOG];
      case 'sda': return ['A4', 'SDA'];
      case 'scl': return ['A5', 'SCL'];
      case 'pwm': return [...PWM, ...DIGITAL.filter((d) => !PWM.includes(d)), ...ANALOG];
      default: return [...DIGITAL.slice(2), ...ANALOG, 'D0', 'D1'];
    }
  }

  // Elige un pin libre razonable para un tipo de pin.
  function autoPin(kind, used) {
    const free = (list) => list.find((p) => !used.has(p));
    switch (kind) {
      case 'gnd': return 'GND';
      case 'vcc': return '5V';
      case 'sda': return 'A4';
      case 'scl': return 'A5';
      case 'analog': return free(ANALOG) || 'A0';
      case 'pwm': return free(['D9', 'D10', 'D11', 'D6', 'D5', 'D3']) || free(DIGITAL.slice(2)) || 'D9';
      case 'rx': return free(['D10', 'D8']) || 'D10';
      case 'tx': return free(['D11', 'D9']) || 'D11';
      default: return free(['D2', 'D4', 'D7', 'D8', 'D12', 'D13', 'D3', 'D5', 'D6', 'D9', 'D10', 'D11']) || 'D2';
    }
  }

  const find = (type) => PARTS.find((p) => p.type === type);
  const shared = (pin) => ['GND', '5V', '3.3V', 'VIN'].includes(pin);

  // Avisos de conexiones dudosas (dos componentes en el mismo pin de señal, PWM en pin sin PWM…).
  function check(wiring) {
    const out = [];
    const byPin = new Map();
    for (const part of (wiring && wiring.parts) || []) {
      const def = find(part.type);
      if (!def) continue;
      for (const pin of def.pins) {
        const to = part.pins && part.pins[pin.id];
        if (!to) { out.push(`${part.label}: falta conectar ${pin.label}`); continue; }
        if (!shared(to)) {
          if (!byPin.has(to)) byPin.set(to, []);
          byPin.get(to).push(part.label);
        }
        if (pin.kind === 'pwm' && def.sim !== 'led' && /^D\d+$/.test(to) && !PWM.includes(to)) out.push(`${part.label}: ${to} no tiene PWM (usa D3, D5, D6, D9, D10 o D11)`);
        if (pin.kind === 'analog' && !/^A\d$/.test(to)) out.push(`${part.label}: la señal analógica debe ir a A0–A5`);
      }
    }
    for (const [pin, names] of byPin) if (names.length > 1) out.push(`${pin} está usado por ${names.join(' y ')}`);
    return out;
  }

  // Texto para la IA y para el usuario.
  function describe(wiring) {
    if (!wiring || !wiring.parts || !wiring.parts.length) return '';
    return wiring.parts.map((part) => {
      const def = find(part.type) || { name: part.type, pins: [] };
      const pins = def.pins.map((p) => `${p.label} → ${(part.pins && part.pins[p.id]) || '(sin conectar)'}`).join('; ');
      return `- ${part.label} (${def.name}): ${pins}`;
    }).join('\n');
  }

  const api = { PARTS, DIGITAL, ANALOG, POWER, PWM, options, autoPin, find, check, describe };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ARPY_PARTS = api;
})(typeof window !== 'undefined' ? window : globalThis);
