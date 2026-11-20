const { SerialPort } = require('serialport');

let port = null;

async function list() {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    address: p.path,
    label: p.path,
    manufacturer: p.manufacturer || '',
    vendorId: p.vendorId,
    productId: p.productId,
  }));
}

function open(path, baudRate, onData, onClose) {
  return new Promise((resolve, reject) => {
    close().then(() => {
      const p = new SerialPort({ path, baudRate: Number(baudRate) || 9600, autoOpen: false });
      p.open((err) => {
        if (err) return reject(new Error(err.message));
        port = p;
        p.on('data', (buf) => onData(buf.toString('utf8')));
        p.on('close', () => {
          if (port === p) port = null;
          onClose();
        });
        p.on('error', (e) => onData(`\n[error] ${e.message}\n`));
        resolve(true);
      });
    });
  });
}

function close() {
  return new Promise((resolve) => {
    if (!port || !port.isOpen) { port = null; return resolve(); }
    const p = port;
    port = null;
    p.close(() => resolve());
  });
}

function write(text) {
  if (port && port.isOpen) port.write(text);
}

function info() {
  return port && port.isOpen ? { open: true, path: port.path, baudRate: port.baudRate } : { open: false };
}

module.exports = { list, open, close, write, info };
