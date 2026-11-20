// Diagnóstico de placas USB y drivers de chips USB-serie (CH340, CP210x, FTDI) en Windows.
const fs = require('fs');
const os = require('os');
const path = require('path');
const proc = require('./proc');

const CHIPS = {
  '1A86': { chip: 'CH340 / CH341', vendor: 'WCH', auto: true, url: 'https://www.wch-ic.com/downloads/CH341SER_EXE.html' },
  '10C4': { chip: 'CP210x', vendor: 'Silicon Labs', url: 'https://www.silabs.com/developer-tools/usb-to-uart-bridge-vcp-drivers' },
  '0403': { chip: 'FTDI', vendor: 'FTDI', url: 'https://ftdichip.com/drivers/vcp-drivers/' },
  '2341': { chip: 'Arduino (original)', vendor: 'Arduino', builtin: true },
  '2A03': { chip: 'Arduino (original)', vendor: 'Arduino', builtin: true },
  '303A': { chip: 'ESP32 (USB nativo)', vendor: 'Espressif', builtin: true },
  '239A': { chip: 'Adafruit', vendor: 'Adafruit', builtin: true },
};
const CH340_EXE = 'https://www.wch-ic.com/download/file?id=65';

async function diagnose() {
  if (process.platform !== 'win32') return { supported: false, devices: [] };
  const ids = Object.keys(CHIPS).join('|');
  const ps = `Get-PnpDevice -PresentOnly | Where-Object { $_.InstanceId -match 'VID_(${ids})' } | Select-Object Status,Class,FriendlyName,InstanceId | ConvertTo-Json -Compress`;
  let out = '';
  const r = await proc.run('powershell.exe', ['-NoProfile', '-Command', ps], { onData: (d, stream) => { if (stream !== 'stderr') out += d; } }).promise;
  let list = [];
  try { list = JSON.parse(out.trim() || '[]'); } catch {}
  if (!Array.isArray(list)) list = [list];
  // Un mismo aparato aparece varias veces (USB, interfaz, puerto): nos quedamos con uno por VID+PID+serie.
  const seen = new Map();
  for (const d of list) {
    const m = /VID_([0-9A-F]{4})&PID_([0-9A-F]{4})/i.exec(d.InstanceId || '');
    if (!m) continue;
    const vid = m[1].toUpperCase();
    const key = `${vid}:${m[2].toUpperCase()}:${(d.InstanceId || '').split('\\')[2] || ''}`;
    const ok = d.Status === 'OK';
    const prev = seen.get(key);
    const port = /\((COM\d+)\)/.exec(d.FriendlyName || '');
    const item = { vid, pid: m[2].toUpperCase(), name: d.FriendlyName || 'Dispositivo USB', ok: prev ? prev.ok || ok : ok, port: port ? port[1] : (prev && prev.port) || null, ...CHIPS[vid] };
    seen.set(key, item);
  }
  return { supported: true, code: r.code, devices: [...seen.values()] };
}

// Descarga el instalador oficial del CH340 (WCH) y lo abre (Windows pide permiso de administrador).
async function installCH340(onData, openPath) {
  const file = path.join(os.tmpdir(), 'CH341SER.EXE');
  onData('Descargando el driver oficial CH340 de WCH…\n', 'info');
  const res = await fetch(CH340_EXE);
  if (!res.ok) throw new Error(`Descarga fallida (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 100000 || buf[0] !== 0x4d || buf[1] !== 0x5a) throw new Error('El archivo descargado no es un instalador válido.');
  fs.writeFileSync(file, buf);
  onData('Abriendo el instalador: pulsa "INSTALL" y acepta el permiso de Windows.\n', 'info');
  const err = await openPath(file);
  if (err) throw new Error(err);
  return true;
}

module.exports = { diagnose, installCH340 };
