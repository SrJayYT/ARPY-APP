// Genera build/icon.png (512x512) renderizando el logo con Electron. Uso: npx electron scripts/make-icon.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const html = `<html><body style="margin:0;background:transparent">
<div style="width:512px;height:512px;display:flex;align-items:center;justify-content:center">
<div style="width:440px;height:440px;border-radius:110px;background:conic-gradient(from 210deg,#00a6ad,#4b8bbe,#f2c94c,#8b5cf6,#00a6ad);
display:flex;align-items:center;justify-content:center;box-shadow:inset 0 0 0 10px rgba(255,255,255,.12)">
<div style="width:300px;height:300px;border-radius:80px;background:#0d1117;display:flex;align-items:center;justify-content:center;
font:800 150px 'Segoe UI',sans-serif;color:#fff;letter-spacing:-6px">A<span style="color:#22d3ee">P</span></div></div></div></body></html>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 512, height: 512, show: false, transparent: true, frame: false, useContentSize: true });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 512, height: 512 });
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.writeFileSync(out, img.resize({ width: 512, height: 512 }).toPNG());
  console.log('icono:', out);
  app.quit();
});
