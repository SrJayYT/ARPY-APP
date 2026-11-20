/* Carga Monaco (AMD) y arranca la app */
require.config({ paths: { vs: '../../node_modules/monaco-editor/min/vs' } });
require(['vs/editor/editor.main'], () => {
  A.editor.initMonaco(window.monaco);
  A.app.init().catch((e) => {
    console.error(e);
    A.toast('Error al iniciar: ' + e.message, 'err');
  });
});
