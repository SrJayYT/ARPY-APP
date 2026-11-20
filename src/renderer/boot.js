/* Carga Monaco (AMD) y arranca la app */
const intro = window.ARPY_INTRO || { status() {}, done() {} };
require.config({ paths: { vs: '../../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  intro.status('Preparando el espacio de trabajo…');
  A.editor.initMonaco(window.monaco);
  A.app.init()
    .catch((e) => {
      console.error(e);
      A.toast('Error al iniciar: ' + e.message, 'err');
    })
    .finally(() => intro.done());
}, (err) => {
  console.error(err);
  intro.done();
});
