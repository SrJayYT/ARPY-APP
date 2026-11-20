/* Diseñador de interfaces: catálogo de controles, temas y generador de código Tkinter. */
(function (root) {
  const THEMES = {
    papel: { name: 'Papel', bg: '#F3EEE4', card: '#FBF8F2', text: '#2B2A28', muted: '#8A8378', line: '#DDD4C5', accent: '#C8553D', font: 'Georgia' },
    noche: { name: 'Noche', bg: '#17161A', card: '#201F24', text: '#EDEAE4', muted: '#8D8893', line: '#34323A', accent: '#E0A458', font: 'Segoe UI' },
    menta: { name: 'Menta', bg: '#EDF1EA', card: '#F7F9F5', text: '#24382C', muted: '#6B7C70', line: '#D5DDD0', accent: '#4C7DA0', font: 'Segoe UI' },
    taller: { name: 'Taller', bg: '#1E2329', card: '#262C33', text: '#E6E1D6', muted: '#8E959C', line: '#38414A', accent: '#F2C94C', font: 'Bahnschrift' },
  };

  const WIDGETS = [
    { type: 'title', name: 'Título', w: 280, h: 44, props: { text: 'Mi panel' } },
    { type: 'label', name: 'Texto', w: 200, h: 28, props: { text: 'Texto' } },
    { type: 'value', name: 'Valor en vivo', w: 170, h: 84, props: { text: 'Temperatura', key: 'T', unit: '°C', decimals: 1 } },
    { type: 'gauge', name: 'Medidor', w: 200, h: 140, props: { text: 'Humedad', key: 'H', min: 0, max: 100, unit: '%' } },
    { type: 'bar', name: 'Barra', w: 240, h: 54, props: { text: 'Nivel', key: 'A0', min: 0, max: 1023 } },
    { type: 'led', name: 'Indicador', w: 150, h: 36, props: { text: 'Movimiento', key: 'PIR', threshold: 0.5 } },
    { type: 'chart', name: 'Gráfica', w: 360, h: 160, props: { text: 'A0 en el tiempo', key: 'A0', min: 0, max: 1023 } },
    { type: 'button', name: 'Botón', w: 150, h: 40, props: { text: 'Encender LED', command: 'LED:1' } },
    { type: 'switch', name: 'Interruptor', w: 170, h: 36, props: { text: 'Bomba', on: 'PUMP:1', off: 'PUMP:0' } },
    { type: 'slider', name: 'Deslizador', w: 260, h: 56, props: { text: 'Brillo', command: 'PWM', min: 0, max: 255 } },
    { type: 'input', name: 'Enviar texto', w: 280, h: 36, props: { text: 'Comando' } },
  ];
  const find = (t) => WIDGETS.find((w) => w.type === t);

  // Claves que la app lee del Arduino (para el modo demo y para la IA).
  const keysOf = (d) => [...new Set(d.widgets.filter((w) => w.props.key).map((w) => w.props.key))];

  const py = (s) => JSON.stringify(String(s == null ? '' : s)); // literal de cadena válido en Python
  const num = (v, def) => (Number.isFinite(+v) ? +v : def);
  const ident = (s, i) => (String(s || '').normalize('NFD').replace(/[^\w]/g, '_').replace(/^(\d)/, '_$1').toLowerCase() || 'w') + '_' + i;

  function generate(design) {
    const th = THEMES[design.theme] || THEMES.papel;
    const W = num(design.width, 760), H = num(design.height, 480);
    const keys = keysOf(design);
    const lines = [];
    const out = (s = '') => lines.push(s);

    out(`"""${(design.title || 'Panel').replace(/"""/g, '')} — creado con el diseñador de ARPY Copiler.`);
    out('');
    out('Lee del Arduino líneas como  T:23.5;H:60  y envía comandos al pulsar los controles.');
    out('Sin placa conectada arranca en modo demostración con datos de ejemplo.');
    out('"""');
    out('import os');
    out('import queue');
    out('import random');
    out('import sys');
    out('import threading');
    out('import time');
    out('import tkinter as tk');
    out('');
    out('try:');
    out('    import serial  # pip install pyserial');
    out('except ImportError:');
    out('    serial = None');
    out('');
    out('PORT = os.environ.get("ARPY_PORT", "")');
    out(`BAUD = int(os.environ.get("ARPY_BAUD", "${num(design.baud, 115200)}"))`);
    out('DEMO = os.environ.get("ARPY_DEMO") == "1"');
    out('');
    out(`FONDO, TARJETA, TEXTO, GRIS, LINEA, ACENTO = ${py(th.bg)}, ${py(th.card)}, ${py(th.text)}, ${py(th.muted)}, ${py(th.line)}, ${py(th.accent)}`);
    out(`FUENTE = ${py(th.font)}`);
    out(`CLAVES = ${JSON.stringify(keys)}`);
    out('');
    out('');
    out(`class Enlace:
    """Conexión serie en un hilo. Sin placa, inventa valores para las claves del panel."""

    def __init__(self):
        self.cola = queue.Queue()
        self.puerto = None
        self.error = ""
        if not DEMO and serial and PORT:
            try:
                self.puerto = serial.Serial(PORT, BAUD, timeout=0.3)
            except Exception as e:
                self.error = str(e)
        self.demo = self.puerto is None
        threading.Thread(target=self._demo if self.demo else self._leer, daemon=True).start()

    def enviar(self, texto):
        if self.puerto:
            try:
                self.puerto.write((texto + "\\n").encode())
            except Exception as e:
                self.error = str(e)
        print("→", texto)

    def _leer(self):
        while True:
            try:
                linea = self.puerto.readline().decode(errors="ignore").strip()
            except Exception as e:
                self.error = str(e)
                return
            if linea:
                self.cola.put(linea)

    def _demo(self):
        valores = {k: random.uniform(20, 60) for k in CLAVES}
        while True:
            for k in valores:
                valores[k] = max(0, valores[k] + random.uniform(-3, 3))
            self.cola.put(";".join(f"{k}:{v:.1f}" for k, v in valores.items()))
            time.sleep(0.5)


def leer_valores(linea):
    """Acepta  CLAVE:valor  o  CLAVE=valor  separados por ; , o espacios."""
    datos = {}
    for parte in linea.replace(",", ";").replace(" ", ";").split(";"):
        for sep in (":", "="):
            if sep in parte:
                k, v = parte.split(sep, 1)
                try:
                    datos[k.strip()] = float(v)
                except ValueError:
                    pass
                break
    return datos


class Medidor(tk.Canvas):
    def __init__(self, padre, s, minimo, maximo, unidad, **kw):
        kw.setdefault("bg", TARJETA)
        super().__init__(padre, highlightthickness=0, **kw)
        self.s, self.min, self.max, self.unidad, self.valor = s, minimo, maximo, unidad, None
        self.bind("<Configure>", lambda e: self.dibujar())

    def poner(self, v):
        self.valor = v
        self.dibujar()

    def dibujar(self):
        self.delete("all")
        w, h = self.winfo_width(), self.winfo_height()
        r = min(w / 2, h) - 14 * self.s
        cx, cy = w / 2, h - 8 * self.s
        grosor = 12 * self.s
        self.create_arc(cx - r, cy - r, cx + r, cy + r, start=0, extent=180, style="arc", outline=LINEA, width=grosor)
        if self.valor is not None:
            p = max(0, min(1, (self.valor - self.min) / ((self.max - self.min) or 1)))
            self.create_arc(cx - r, cy - r, cx + r, cy + r, start=180, extent=-180 * p, style="arc", outline=ACENTO, width=grosor)
            self.create_text(cx, cy - r * 0.35, text=f"{self.valor:.0f}{self.unidad}", fill=TEXTO, font=(FUENTE, 18))


class Grafica(tk.Canvas):
    def __init__(self, padre, s, minimo, maximo, **kw):
        kw.setdefault("bg", TARJETA)
        super().__init__(padre, highlightthickness=0, **kw)
        self.s, self.min, self.max, self.datos = s, minimo, maximo, []
        self.bind("<Configure>", lambda e: self.dibujar())

    def poner(self, v):
        self.datos = (self.datos + [v])[-120:]
        self.dibujar()

    def dibujar(self):
        self.delete("all")
        w, h = self.winfo_width(), self.winfo_height()
        m = 6 * self.s
        self.create_line(m, h - m, w - m, h - m, fill=LINEA)
        if len(self.datos) < 2:
            return
        rango = (self.max - self.min) or 1
        pts = []
        for i, v in enumerate(self.datos):
            pts += [m + (w - 2 * m) * i / 119, h - m - (h - 2 * m) * max(0, min(1, (v - self.min) / rango))]
        self.create_line(*pts, fill=ACENTO, width=2 * self.s, smooth=True)


class Interruptor(tk.Canvas):
    def __init__(self, padre, s, al_cambiar, **kw):
        kw.setdefault("bg", TARJETA)
        super().__init__(padre, highlightthickness=0, cursor="hand2", **kw)
        self.s, self.on, self.al_cambiar = s, False, al_cambiar
        self.bind("<Button-1>", lambda e: self.cambiar())
        self.bind("<Configure>", lambda e: self.dibujar())

    def cambiar(self):
        self.on = not self.on
        self.dibujar()
        self.al_cambiar(self.on)

    def dibujar(self):
        self.delete("all")
        h = self.winfo_height()
        a, b = 44 * self.s, 24 * self.s
        y0 = (h - b) / 2
        color = ACENTO if self.on else LINEA
        self.create_oval(0, y0, b, y0 + b, fill=color, outline="")
        self.create_oval(a - b, y0, a, y0 + b, fill=color, outline="")
        self.create_rectangle(b / 2, y0, a - b / 2, y0 + b, fill=color, outline="")
        x = a - b / 2 if self.on else b / 2
        r = b / 2 - 3 * self.s
        self.create_oval(x - r, y0 + b / 2 - r, x + r, y0 + b / 2 + r, fill="#FFFFFF", outline="")


class Panel(tk.Tk):
    W, H = ${W}, ${H}

    def __init__(self):
        super().__init__()
        self.title(${py(design.title || 'Panel')})
        self.configure(bg=FONDO)
        self.s = self.winfo_fpixels("1i") / 96.0
        self.geometry(f"{int(self.W * self.s)}x{int(self.H * self.s)}")
        self.minsize(int(self.W * self.s), int(self.H * self.s))
        self.enlace = Enlace()
        self.lectores = {}  # clave -> funciones que reciben el valor
        self.construir()
        estado = "Sin placa — datos de ejemplo" if self.enlace.demo else f"{PORT} · {BAUD} baudios"
        tk.Label(self, text=estado, bg=FONDO, fg=GRIS, font=(FUENTE, 9)).place(x=12 * self.s, y=(self.H - 24) * self.s)
        self.after(50, self.bucle)

    def en(self, x, y, w, h):
        """Posición y tamaño del diseño, escalados por el DPI de la pantalla."""
        return dict(x=x * self.s, y=y * self.s, width=w * self.s, height=h * self.s)

    def leer(self, clave, funcion):
        self.lectores.setdefault(clave, []).append(funcion)

    def bucle(self):
        while not self.enlace.cola.empty():
            for k, v in leer_valores(self.enlace.cola.get()).items():
                for f in self.lectores.get(k, []):
                    f(v)
        self.after(50, self.bucle)
`.split('\n').forEach((l) => lines.push(l)));

    out('    def construir(self):');
    if (!design.widgets.length) out('        pass');
    design.widgets.forEach((wd, i) => {
      const p = wd.props || {};
      const v = ident(p.text || wd.type, i);
      const at = `**self.en(${Math.round(wd.x)}, ${Math.round(wd.y)}, ${Math.round(wd.w)}, ${Math.round(wd.h)})`;
      out(`        # ${find(wd.type) ? find(wd.type).name : wd.type}: ${String(p.text || '').replace(/\n/g, ' ')}`);
      switch (wd.type) {
        case 'title':
          out(`        tk.Label(self, text=${py(p.text)}, bg=FONDO, fg=TEXTO, font=(FUENTE, 22), anchor="w").place(${at})`);
          break;
        case 'label':
          out(`        tk.Label(self, text=${py(p.text)}, bg=FONDO, fg=GRIS, font=(FUENTE, 11), anchor="w", justify="left").place(${at})`);
          break;
        case 'value':
          out(`        marco = tk.Frame(self, bg=TARJETA, highlightbackground=LINEA, highlightthickness=1)`);
          out(`        marco.place(${at})`);
          out(`        tk.Label(marco, text=${py(String(p.text || '').toUpperCase())}, bg=TARJETA, fg=GRIS, font=(FUENTE, 8, "bold")).pack(anchor="w", padx=12, pady=(10, 0))`);
          out(`        ${v} = tk.Label(marco, text="—", bg=TARJETA, fg=TEXTO, font=(FUENTE, 24))`);
          out(`        ${v}.pack(anchor="w", padx=10)`);
          out(`        self.leer(${py(p.key)}, lambda x, l=${v}: l.config(text=f"{x:.${Math.max(0, Math.min(4, num(p.decimals, 1)))}f}" + ${py(p.unit)}))`);
          break;
        case 'gauge':
          out(`        marco = tk.Frame(self, bg=TARJETA, highlightbackground=LINEA, highlightthickness=1)`);
          out(`        marco.place(${at})`);
          out(`        tk.Label(marco, text=${py(p.text)}, bg=TARJETA, fg=GRIS, font=(FUENTE, 9)).pack(anchor="w", padx=10, pady=(6, 0))`);
          out(`        ${v} = Medidor(marco, self.s, ${num(p.min, 0)}, ${num(p.max, 100)}, ${py(p.unit)})`);
          out(`        ${v}.pack(fill="both", expand=True, padx=6, pady=(0, 6))`);
          out(`        self.leer(${py(p.key)}, ${v}.poner)`);
          break;
        case 'bar':
          out(`        marco = tk.Frame(self, bg=FONDO)`);
          out(`        marco.place(${at})`);
          out(`        tk.Label(marco, text=${py(p.text)}, bg=FONDO, fg=GRIS, font=(FUENTE, 9)).pack(anchor="w")`);
          out(`        ${v} = tk.Canvas(marco, bg=LINEA, highlightthickness=0, height=int(10 * self.s))`);
          out(`        ${v}.pack(fill="x", pady=(6, 0))`);
          out(`        self.leer(${py(p.key)}, lambda x, c=${v}: (c.delete("all"), c.create_rectangle(0, 0, c.winfo_width() * max(0, min(1, (x - ${num(p.min, 0)}) / ${(num(p.max, 1023) - num(p.min, 0)) || 1})), c.winfo_height(), fill=ACENTO, outline="")))`);
          break;
        case 'led':
          out(`        marco = tk.Frame(self, bg=FONDO)`);
          out(`        marco.place(${at})`);
          out(`        ${v} = tk.Canvas(marco, bg=FONDO, highlightthickness=0, width=int(18 * self.s), height=int(18 * self.s))`);
          out(`        ${v}.pack(side="left")`);
          out(`        ${v}.create_oval(2, 2, int(16 * self.s), int(16 * self.s), fill=LINEA, outline="", tags="luz")`);
          out(`        tk.Label(marco, text=${py(p.text)}, bg=FONDO, fg=TEXTO, font=(FUENTE, 11)).pack(side="left", padx=8)`);
          out(`        self.leer(${py(p.key)}, lambda x, c=${v}: c.itemconfig("luz", fill=ACENTO if x > ${num(p.threshold, 0.5)} else LINEA))`);
          break;
        case 'chart':
          out(`        marco = tk.Frame(self, bg=TARJETA, highlightbackground=LINEA, highlightthickness=1)`);
          out(`        marco.place(${at})`);
          out(`        tk.Label(marco, text=${py(p.text)}, bg=TARJETA, fg=GRIS, font=(FUENTE, 9)).pack(anchor="w", padx=10, pady=(6, 0))`);
          out(`        ${v} = Grafica(marco, self.s, ${num(p.min, 0)}, ${num(p.max, 1023)})`);
          out(`        ${v}.pack(fill="both", expand=True, padx=4, pady=4)`);
          out(`        self.leer(${py(p.key)}, ${v}.poner)`);
          break;
        case 'button':
          out(`        tk.Button(self, text=${py(p.text)}, bg=ACENTO, fg="#FFFFFF", activebackground=TEXTO, activeforeground=FONDO, relief="flat", bd=0, cursor="hand2", font=(FUENTE, 10, "bold"),`);
          out(`                  command=lambda: self.enlace.enviar(${py(p.command)})).place(${at})`);
          break;
        case 'switch':
          out(`        marco = tk.Frame(self, bg=FONDO)`);
          out(`        marco.place(${at})`);
          out(`        Interruptor(marco, self.s, lambda on: self.enlace.enviar(${py(p.on)} if on else ${py(p.off)}), width=int(46 * self.s), height=int(28 * self.s), bg=FONDO).pack(side="left")`);
          out(`        tk.Label(marco, text=${py(p.text)}, bg=FONDO, fg=TEXTO, font=(FUENTE, 11)).pack(side="left", padx=8)`);
          break;
        case 'slider':
          out(`        marco = tk.Frame(self, bg=FONDO)`);
          out(`        marco.place(${at})`);
          out(`        tk.Label(marco, text=${py(p.text)}, bg=FONDO, fg=GRIS, font=(FUENTE, 9)).pack(anchor="w")`);
          out(`        tk.Scale(marco, from_=${num(p.min, 0)}, to=${num(p.max, 255)}, orient="horizontal", showvalue=False, bg=ACENTO, troughcolor=LINEA, width=int(8 * self.s), sliderlength=int(20 * self.s),`);
          out(`                 activebackground=TEXTO, highlightthickness=0, bd=0, sliderrelief="flat",`);
          out(`                 command=lambda v: self.enlace.enviar(f"${String(p.command || 'VAL').replace(/["{}\\]/g, '')}:{int(float(v))}")).pack(fill="x")`);
          break;
        case 'input':
          out(`        marco = tk.Frame(self, bg=FONDO)`);
          out(`        marco.place(${at})`);
          out(`        ${v} = tk.Entry(marco, bg=TARJETA, fg=TEXTO, insertbackground=TEXTO, relief="flat", font=(FUENTE, 10), highlightthickness=1, highlightbackground=LINEA, highlightcolor=ACENTO)`);
          out(`        ${v}.pack(side="left", fill="both", expand=True)`);
          out(`        ${v}.insert(0, ${py(p.text)})`);
          out(`        enviar = lambda e=None, c=${v}: (self.enlace.enviar(c.get()), c.delete(0, "end"))`);
          out(`        ${v}.bind("<Return>", enviar)`);
          out(`        tk.Button(marco, text="Enviar", command=enviar, bg=ACENTO, fg="#FFFFFF", relief="flat", bd=0, cursor="hand2", font=(FUENTE, 9, "bold")).pack(side="left", padx=(6, 0), ipadx=10)`);
          break;
        default:
          out('        pass');
      }
      out('');
    });
    out('');
    out('if __name__ == "__main__":');
    out('    if sys.platform == "win32":');
    out('        try:');
    out('            import ctypes');
    out('            ctypes.windll.shcore.SetProcessDpiAwareness(1)');
    out('        except Exception:');
    out('            pass');
    out('    Panel().mainloop()');
    return lines.join('\n') + '\n';
  }

  const api = { THEMES, WIDGETS, find, keysOf, generate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ARPY_UIGEN = api;
})(typeof window !== 'undefined' ? window : globalThis);
