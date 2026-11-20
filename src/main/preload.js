const { contextBridge, ipcRenderer, webUtils } = require('electron');

const PREFIXES = ['settings:', 'status', 'open-external', 'project:', 'fs:', 'arduino:', 'python:', 'serial:', 'ai:', 'search:', 'git:', 'dialog:', 'sim:', 'drivers:', 'app:', 'wiring:', 'ui:', 'update:', 'examples:', 'run:', 'runtimes:', 'preview:'];
const allowed = (c) => PREFIXES.some((p) => c === p || c.startsWith(p));
const EVENTS = ['log', 'serial:data', 'serial:closed', 'python:exit', 'ai:chunk', 'ai:status', 'fs:changed', 'sim:state', 'app:open-file'];

contextBridge.exposeInMainWorld('arpy', {
  pathOf: (file) => { try { return webUtils.getPathForFile(file); } catch { return null; } },
  invoke: (channel, ...args) => {
    if (!allowed(channel)) throw new Error(`Canal no permitido: ${channel}`);
    return ipcRenderer.invoke(channel, ...args);
  },
  on: (event, cb) => {
    if (!EVENTS.includes(event)) throw new Error(`Evento no permitido: ${event}`);
    ipcRenderer.on(event, (_e, payload) => cb(payload));
  },
});
