// Catálogo de placas soportadas (FQBN para arduino-cli).
// El "core" se deriva de las dos primeras partes del FQBN.
const BOARDS = [
  // Clásicas AVR
  { name: 'Arduino Uno R3', fqbn: 'arduino:avr:uno', family: 'Clásicas (AVR)', features: ['USB'] },
  { name: 'Arduino Nano', fqbn: 'arduino:avr:nano', family: 'Clásicas (AVR)', features: ['USB'] },
  { name: 'Arduino Mega 2560', fqbn: 'arduino:avr:mega', family: 'Clásicas (AVR)', features: ['USB', '54 pines'] },
  { name: 'Arduino Leonardo', fqbn: 'arduino:avr:leonardo', family: 'Clásicas (AVR)', features: ['USB HID'] },
  { name: 'Arduino Micro', fqbn: 'arduino:avr:micro', family: 'Clásicas (AVR)', features: ['USB HID'] },
  { name: 'Arduino Nano Every', fqbn: 'arduino:megaavr:nona4809', family: 'Clásicas (AVR)', features: ['USB'] },
  { name: 'Arduino Uno WiFi Rev2', fqbn: 'arduino:megaavr:uno2018', family: 'Clásicas (AVR)', features: ['WiFi', 'IMU'] },

  // UNO R4
  { name: 'Arduino UNO R4 Minima', fqbn: 'arduino:renesas_uno:minima', family: 'UNO R4 (Renesas)', features: ['USB-C', 'DAC', 'CAN'] },
  { name: 'Arduino UNO R4 WiFi', fqbn: 'arduino:renesas_uno:unor4wifi', family: 'UNO R4 (Renesas)', features: ['WiFi', 'Bluetooth LE', 'Matriz LED 12x8', 'USB-C'] },

  // UNO Q (Linux + MCU)
  { name: 'Arduino UNO Q', fqbn: 'arduino:zephyr:unoq', family: 'UNO Q (Linux + MCU)', features: ['WiFi', 'Bluetooth', 'USB-C con video (HDMI vía hub)', 'Linux Debian', 'Python en placa'] },

  // Nano modernas
  { name: 'Arduino Nano ESP32', fqbn: 'arduino:esp32:nano_nora', family: 'Nano modernas', features: ['WiFi', 'Bluetooth LE', 'USB-C'] },
  { name: 'Arduino Nano 33 IoT', fqbn: 'arduino:samd:nano_33_iot', family: 'Nano modernas', features: ['WiFi', 'Bluetooth LE', 'IMU'] },
  { name: 'Arduino Nano 33 BLE', fqbn: 'arduino:mbed_nano:nano33ble', family: 'Nano modernas', features: ['Bluetooth LE', 'IMU'] },
  { name: 'Arduino Nano RP2040 Connect', fqbn: 'arduino:mbed_nano:nanorp2040connect', family: 'Nano modernas', features: ['WiFi', 'Bluetooth', 'IMU', 'Micrófono'] },

  // MKR / SAMD
  { name: 'Arduino MKR WiFi 1010', fqbn: 'arduino:samd:mkrwifi1010', family: 'MKR / SAMD', features: ['WiFi', 'Bluetooth LE'] },
  { name: 'Arduino Zero', fqbn: 'arduino:samd:arduino_zero_native', family: 'MKR / SAMD', features: ['USB nativo'] },
  { name: 'Arduino Due', fqbn: 'arduino:sam:arduino_due_x_dbg', family: 'MKR / SAMD', features: ['ARM 32 bits'] },

  // Pro
  { name: 'Arduino GIGA R1 WiFi', fqbn: 'arduino:mbed_giga:giga', family: 'Pro / Alto rendimiento', features: ['WiFi', 'Bluetooth', 'Doble núcleo', 'USB-A host', 'Conector de cámara/pantalla'] },
  { name: 'Arduino Portenta H7', fqbn: 'arduino:mbed_portenta:envie_m7', family: 'Pro / Alto rendimiento', features: ['WiFi', 'Bluetooth', 'Doble núcleo', 'USB-C con video (DisplayPort/HDMI)'] },
  { name: 'Arduino Nicla Vision', fqbn: 'arduino:mbed_nicla:nicla_vision', family: 'Pro / Alto rendimiento', features: ['Cámara', 'WiFi', 'Bluetooth'] },
  { name: 'Arduino Opta', fqbn: 'arduino:mbed_opta:opta', family: 'Pro / Alto rendimiento', features: ['PLC industrial', 'Ethernet'] },
];

function coreOf(fqbn) {
  return fqbn.split(':').slice(0, 2).join(':');
}

function findBoard(fqbn) {
  return BOARDS.find((b) => b.fqbn === fqbn) || { name: fqbn, fqbn, family: 'Otra', features: [] };
}

if (typeof module !== 'undefined') module.exports = { BOARDS, coreOf, findBoard };
if (typeof window !== 'undefined') window.ARPY_BOARDS = { BOARDS, coreOf, findBoard };
