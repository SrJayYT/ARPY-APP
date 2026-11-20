const { SerialPort } = require('serialport');

// Varias conexiones a la vez: una por puerto (ej. COM3 y COM5).
const ports = new Map();

async function list() {
  const all = await SerialPort.list();
  return all.map((p) => ({
    address: p.path,
    label: p.path,
    manufacturer: p.manufacturer || '',
    vendorId: p.vendorId,
    productId: p.productId,
  }));
}

function open(path, baudRate, onData, onClose) {
  return new Promise((resolve, reject) => {
    close(path).then(() => {
      const p = new SerialPort({ path, baudRate: Number(baudRate) || 9600, autoOpen: false });
      p.open((err) => {
        if (err) return reject(new Error(err.message));
        ports.set(path, p);
        p.on('data', (buf) => onData(path, buf.toString('utf8')));
        p.on('close', () => {
          if (ports.get(path) === p) ports.delete(path);
          onClose(path);
        });
        p.on('error', (e) => onData(path, `\n[error] ${e.message}\n`));
        resolve(true);
      });
    });
  });
}

// Sin argumento cierra todas las conexiones.
function close(path) {
  const targets = path ? [path] : [...ports.keys()];
  return Promise.all(targets.map((k) => new Promise((resolve) => {
    const p = ports.get(k);
    ports.delete(k);
    if (!p || !p.isOpen) return resolve();
    p.close(() => resolve());
  })));
}

function write(path, text) {
  const p = ports.get(path);
  if (p && p.isOpen) p.write(text);
}

function info() {
  return [...ports.values()].filter((p) => p.isOpen).map((p) => ({ path: p.path, baudRate: p.baudRate }));
}

module.exports = { list, open, close, write, info };
