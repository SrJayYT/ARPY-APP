/* Animación de apertura. Se carga antes que todo (en <head>) para que aparezca al instante
   mientras el editor Monaco se carga por detrás. */
(() => {
  const get = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
  const root = document.documentElement;
  const theme = get('arpy.theme');
  if (theme) root.dataset.theme = theme;
  // Modo ligero: lo decide la app (según RAM/CPU o Configuración) y lo recuerda para el próximo arranque.
  const perf = get('arpy.perf');
  const lite = perf ? perf === 'lite' : (navigator.hardwareConcurrency || 4) <= 4;
  if (lite) root.dataset.perf = 'lite';
  const reduced = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const skip = get('arpy.intro') === '0' || reduced;
  if (skip) root.classList.add('no-intro');

  const t0 = performance.now();
  const minMs = skip ? 0 : lite ? 1200 : 2100;
  let finished = false;

  function done() {
    if (finished) return;
    finished = true;
    const wait = Math.max(0, minMs - (performance.now() - t0));
    setTimeout(() => {
      document.body.classList.add('entered');
      const el = document.getElementById('intro');
      if (!el) return;
      el.classList.add('out');
      setTimeout(() => el.remove(), 650);
    }, wait);
  }

  window.ARPY_INTRO = {
    status(text) { const e = document.getElementById('introStatus'); if (e) e.textContent = text; },
    done,
  };
  // Por si algo falla al cargar, nunca dejar la pantalla tapada.
  setTimeout(done, 12000);
})();
