const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  geminiApiKey: '',
  model: 'gemini-flash-latest',
  pythonPath: '',
  arduinoCliPath: '',
  autoApply: false,
  fontSize: 14,
  recentProjects: [],
  lastProject: '',
  perfMode: 'auto', // auto | lite | full
  intro: true,
};

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

// Key integrada en la app; el usuario puede usar una propia (opcional) desde Configuración.
let builtin = '';
try { builtin = require('./secret')(); } catch {}

let cache = null;

function load() {
  if (cache) return cache;
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(settingsFile(), 'utf8').replace(/^﻿/, '')); // tolera BOM
  } catch {}
  cache = { ...DEFAULTS, ...data };
  if (cache.geminiApiKey === builtin) cache.geminiApiKey = ''; // nunca guardar la integrada
  return cache;
}

function apiKey() {
  return load().geminiApiKey || builtin;
}

function hasBuiltinKey() {
  return !!builtin;
}

function save(patch) {
  cache = { ...load(), ...patch };
  fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
  fs.writeFileSync(settingsFile(), JSON.stringify(cache, null, 2));
  return cache;
}

function addRecent(dir) {
  const s = load();
  const list = [dir, ...s.recentProjects.filter((p) => p !== dir)].slice(0, 10);
  return save({ recentProjects: list, lastProject: dir });
}

module.exports = { load, save, addRecent, apiKey, hasBuiltinKey };
