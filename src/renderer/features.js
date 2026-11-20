/* Funciones extra: ayuda de drivers, sin conexión, actualizaciones, exportar/importar proyectos */
(() => {
  // ---------- ¿No aparece tu placa? (drivers CH340 / CP210x / FTDI) ----------
  async function openPortHelp() {
    const list = A.el('div', { class: 'drv-list' }, A.el('div', { class: 'muted' }, 'Revisando dispositivos USB…'));
    const tips = A.el('ol', { class: 'drv-tips' },
      A.el('li', {}, 'Usa un cable USB de datos: muchos cables solo sirven para cargar.'),
      A.el('li', {}, 'Prueba otro puerto USB del computador (mejor uno trasero en PC de escritorio).'),
      A.el('li', {}, 'Las placas clon (las más baratas) suelen usar el chip CH340 y necesitan su driver.'),
      A.el('li', {}, 'ESP32, UNO R4 y Nano ESP32: si no aparece, pulsa dos veces el botón RESET.'));
    const again = A.el('button', { class: 'btn ghost', onclick: () => scan() }, 'Volver a revisar');
    const ch340 = A.el('button', { class: 'btn ghost', onclick: () => installCH340() }, 'Instalar driver CH340 igualmente');
    const body = A.el('div', { style: 'display:flex;flex-direction:column;gap:14px' },
      list, A.el('h4', { style: 'margin:4px 0 0' }, 'Si no aparece, revisa esto:'), tips,
      A.el('div', { class: 'modal-foot' }, ch340, again));
    A.modal.open('¿No aparece tu placa?', body);

    async function scan() {
      list.innerHTML = '';
      list.append(A.el('div', { class: 'muted' }, 'Revisando dispositivos USB…'));
      let r;
      try { r = await A.api('drivers:diagnose'); } catch (e) { list.innerHTML = ''; list.append(A.el('div', { class: 'bad' }, e.message)); return; }
      list.innerHTML = '';
      if (!r.supported) { list.append(A.el('div', { class: 'muted' }, 'El diagnóstico de drivers solo está disponible en Windows.')); return; }
      if (!r.devices.length) {
        list.append(A.el('div', { class: 'drv-empty' }, 'No se detecta ninguna placa Arduino ni chip USB-serie conectado. Revisa el cable y el puerto USB.'));
        return;
      }
      for (const d of r.devices) {
        const row = A.el('div', { class: 'drv-row ' + (d.ok ? 'ok' : 'bad') },
          A.el('div', {}, A.el('b', {}, d.name), A.el('small', {}, `${d.chip || 'USB'}${d.vendor ? ' · ' + d.vendor : ''}${d.port ? ' · ' + d.port : ''}`)));
        if (d.ok) row.append(A.el('span', { class: 'drv-ok' }, '✔ Driver instalado'));
        else if (d.auto) row.append(A.el('button', { class: 'btn ino sm', onclick: installCH340 }, 'Instalar driver'));
        else if (d.url) row.append(A.el('button', { class: 'btn ino sm', onclick: () => A.api('open-external', d.url) }, 'Descargar driver oficial'));
        else row.append(A.el('span', { class: 'muted' }, 'Windows debería instalarlo solo'));
        list.append(row);
      }
    }
    scan();
  }

  async function installCH340() {
    A.panels.startBuild('Driver CH340');
    try {
      await A.api('drivers:install-ch340');
      A.toast('Sigue el instalador del driver y luego reconecta la placa.', 'ok');
    } catch (e) { A.toast(e.message, 'err'); }
  }

  // ---------- Sin conexión a internet: el chat se bloquea ----------
  let online = navigator.onLine;
  const probe = () => A.api('app:online').catch(() => navigator.onLine);
  async function checkOnline() {
    const now = await probe();
    if (now !== online) { online = now; applyOnline(); }
  }
  function applyOnline() {
    document.body.classList.toggle('offline', !online);
    const input = A.$('#chatInput');
    if (input) input.disabled = !online;
    A.$('#offlineBanner').classList.toggle('hidden', online);
  }
  addEventListener('online', checkOnline);
  addEventListener('offline', () => { online = false; applyOnline(); });
  setInterval(() => { if (!document.hidden) checkOnline(); }, online ? 30000 : 8000);

  // ---------- Actualizaciones desde GitHub Releases ----------
  async function checkUpdates(manual) {
    let r;
    try { r = await A.api('update:check'); } catch (e) { if (manual) A.toast(e.message, 'err'); return; }
    if (!r || !r.available) { if (manual) A.toast(`Ya tienes la última versión (${r ? r.current : ''})`, 'ok'); return; }
    const bar = A.$('#updateBanner');
    bar.innerHTML = '';
    if (r.private) {
      bar.append(A.el('span', {}, A.el('b', {}, `Nueva versión ${r.latest}`), ' disponible. Pídela a quien te compartió la app.'));
      const x = A.el('button', { class: 'icon-btn sm', onclick: () => bar.classList.add('hidden') });
      x.innerHTML = A.icon('x');
      bar.append(x);
      bar.classList.remove('hidden');
      return;
    }
    const go = A.el('button', { class: 'btn ino sm' }, r.portable ? 'Descargar' : 'Actualizar ahora');
    go.addEventListener('click', async () => {
      go.disabled = true;
      go.textContent = 'Descargando…';
      try {
        await A.api('update:install');
        go.textContent = r.portable ? 'Descargado' : 'Instalando…';
      } catch (e) { A.toast(e.message, 'err'); go.disabled = false; go.textContent = 'Reintentar'; }
    });
    const later = A.el('button', { class: 'icon-btn sm', title: 'Más tarde', onclick: () => bar.classList.add('hidden') });
    later.innerHTML = A.icon('x');
    bar.append(A.el('span', {}, A.el('b', {}, `Nueva versión ${r.latest}`), ` disponible (tienes ${r.current}).`),
      r.notesUrl ? A.el('a', { onclick: () => A.api('open-external', r.notesUrl) }, 'Ver novedades') : null, go, later);
    bar.classList.remove('hidden');
  }

  // ---------- Exportar / importar proyecto (.zip) ----------
  async function exportProject() {
    await A.editor.saveAll();
    const withChats = await A.confirm('Exportar proyecto', '¿Incluir las conversaciones con la IA y la memoria del proyecto en el .zip?', 'Incluir', false);
    try {
      const file = await A.api('project:export', { withChats });
      if (file) A.toast(`Proyecto exportado: ${file}`, 'ok');
    } catch (e) { A.toast(e.message, 'err'); }
  }

  async function importProject() {
    try {
      const res = await A.api('project:import-zip');
      if (res) A.app.openProject(res);
    } catch (e) { A.toast(e.message, 'err'); }
  }

  function init() {
    A.$('#btnPortHelp').addEventListener('click', openPortHelp);
    applyOnline();
    checkOnline();
    setTimeout(() => checkUpdates(false), 6000);
  }

  A.features = { init, openPortHelp, checkUpdates, exportProject, importProject, isOnline: () => online };
})();
