"""Piano — toca el zumbador del Arduino desde el teclado del computador.

Teclas blancas: A S D F G H J K L Ñ   ·   negras: W E T Y U O P
También se puede tocar con el mouse, grabar lo que tocas y repetirlo,
o escuchar una melodía de ejemplo. Cada nota viaja al Arduino como  N:<Hz>
"""
import os
import sys
import time
import tkinter as tk

try:
    import serial  # pip install pyserial
except ImportError:
    serial = None

PORT = os.environ.get("ARPY_PORT", "")
BAUD = int(os.environ.get("ARPY_BAUD", "115200"))
DEMO = os.environ.get("ARPY_DEMO") == "1"

CREMA = "#F6F1E7"
TINTA = "#2A2420"
GRIS = "#8C8075"
MADERA = "#6B4A32"
MADERA_CLARA = "#7E5A3E"
BLANCA = "#FFFDF8"
SOMBRA = "#E3DACB"
NEGRA = "#1E1B18"
PULSADA = "#F1D6C4"
PULSADA_NEGRA = "#5A4636"
ACENTO = "#C8553D"

NOMBRES = ["Do", "Do♯", "Re", "Re♯", "Mi", "Fa", "Fa♯", "Sol", "Sol♯", "La", "La♯", "Si"]
BLANCAS = [0, 2, 4, 5, 7, 9, 11]
TECLAS_B = "asdfghjklñ"      # Do4 … Mi5
TECLAS_N = {"w": 1, "e": 3, "t": 6, "y": 8, "u": 10, "o": 13, "p": 15}  # semitono desde Do4

MELODIAS = {
    "Cumpleaños feliz": [(7, 0.75), (7, 0.25), (9, 1), (7, 1), (12, 1), (11, 2), (7, 0.75), (7, 0.25), (9, 1), (7, 1), (14, 1), (12, 2),
                         (7, 0.75), (7, 0.25), (19, 1), (16, 1), (12, 1), (11, 1), (9, 2)],
    "Himno de la alegría": [(4, 1), (4, 1), (5, 1), (7, 1), (7, 1), (5, 1), (4, 1), (2, 1), (0, 1), (0, 1), (2, 1), (4, 1), (4, 1.5), (2, 0.5), (2, 2)],
    "Estrellita": [(0, 1), (0, 1), (7, 1), (7, 1), (9, 1), (9, 1), (7, 2), (5, 1), (5, 1), (4, 1), (4, 1), (2, 1), (2, 1), (0, 2)],
}


def frecuencia(semitono):
    """Semitono 0 = Do4 (261,63 Hz)."""
    return 261.63 * 2 ** (semitono / 12)


def nombre(semitono):
    return f"{NOMBRES[semitono % 12]}{4 + semitono // 12}"


class Piano(tk.Tk):
    W, H = 940, 540
    TX0, TX1, TY0, TY1 = 40, 900, 150, 410

    def __init__(self):
        super().__init__()
        self.title("Piano")
        self.configure(bg=CREMA)
        self.s = self.winfo_fpixels("1i") / 96.0
        self.geometry(f"{int(self.W * self.s)}x{int(self.H * self.s)}")
        self.minsize(int(self.W * self.s), int(self.H * self.s))
        self.c = tk.Canvas(self, bg=CREMA, highlightthickness=0)
        self.c.pack(fill="both", expand=True)

        self.puerto = None
        self.error = ""
        if not DEMO and serial and PORT:
            try:
                self.puerto = serial.Serial(PORT, BAUD, timeout=0.2)
            except Exception as e:
                self.error = str(e)

        self.pulsadas = []          # semitonos sonando, el último es el que suena
        self.raton = None
        self.grabando = False
        self.grabacion = []         # (tiempo, semitono o None)
        self._t0 = 0.0
        self.tocando = None         # nombre de la melodía en curso
        self._cola = []
        self.zonas = {}
        self._teclas = self._geometria()

        self.c.bind("<Button-1>", self._clic)
        self.c.bind("<B1-Motion>", self._arrastrar)
        self.c.bind("<ButtonRelease-1>", self._soltar_raton)
        self.c.bind("<Motion>", self._mover)
        self.bind("<KeyPress>", self._tecla_abajo)
        self.bind("<KeyRelease>", self._tecla_arriba)
        self.dibujar()

    # ---------- sonido ----------
    def _enviar(self, texto):
        if self.puerto:
            try:
                self.puerto.write((texto + "\n").encode())
            except Exception as e:
                self.error = str(e)

    def pulsar(self, st):
        if st in self.pulsadas:
            return
        self.pulsadas.append(st)
        self._enviar(f"N:{frecuencia(st):.0f}")
        if self.grabando:
            self.grabacion.append((time.time() - self._t0, st))
        self.dibujar()

    def soltar(self, st):
        if st not in self.pulsadas:
            return
        self.pulsadas.remove(st)
        if self.pulsadas:
            self._enviar(f"N:{frecuencia(self.pulsadas[-1]):.0f}")
        else:
            self._enviar("X")
        if self.grabando:
            self.grabacion.append((time.time() - self._t0, -1 - st))
        self.dibujar()

    def silencio(self):
        self.pulsadas = []
        self._enviar("X")

    # ---------- melodías y grabación ----------
    def tocar_melodia(self, nombre_m):
        self.parar()
        self.tocando = nombre_m
        t, pasos = 0.0, []
        negra = 0.42
        for st, beats in MELODIAS[nombre_m]:
            pasos.append((t, st))
            pasos.append((t + beats * negra * 0.86, -1 - st))
            t += beats * negra
        self._reproducir(pasos)

    def _reproducir(self, pasos):
        inicio = time.time()
        self._cola = sorted(pasos)

        def paso():
            if self.tocando is None:
                return
            ahora = time.time() - inicio
            while self._cola and self._cola[0][0] <= ahora:
                _, ev = self._cola.pop(0)
                if ev >= 0:
                    self.pulsar(ev)
                else:
                    self.soltar(-1 - ev)
            if self._cola:
                self.after(8, paso)
            else:
                self.tocando = None
                self.silencio()
                self.dibujar()

        paso()

    def parar(self):
        self.tocando = None
        self._cola = []
        self.silencio()
        self.dibujar()

    def alternar_grabacion(self):
        if self.grabando:
            self.grabando = False
        else:
            self.parar()
            self.grabacion, self._t0, self.grabando = [], time.time(), True
        self.dibujar()

    def repetir(self):
        if not self.grabacion or self.grabando:
            return
        self.parar()
        self.tocando = "tu grabación"
        self._reproducir(list(self.grabacion))

    # ---------- dibujo ----------
    def t(self, x, y, texto, tam=10, color=TINTA, fuente="Segoe UI", estilo="", ancla="w"):
        return self.c.create_text(x, y, text=texto, fill=color, anchor=ancla,
                                  font=(fuente, tam, estilo) if estilo else (fuente, tam))

    def redondo(self, x0, y0, x1, y1, r, **kw):
        pts = [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1, x1 - r, y1,
               x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]
        return self.c.create_polygon(pts, smooth=True, **kw)

    def _geometria(self):
        teclas = []
        n_blancas = 14
        ancho = (self.TX1 - self.TX0) / n_blancas
        for i in range(n_blancas):
            octava, grado = divmod(i, 7)
            st = octava * 12 + BLANCAS[grado]
            x = self.TX0 + i * ancho
            teclas.append(("b", st, x, self.TY0, x + ancho, self.TY1))
        for i in range(n_blancas - 1):
            octava, grado = divmod(i, 7)
            if grado in (2, 6):  # no hay negra entre Mi-Fa ni Si-Do
                continue
            st = octava * 12 + BLANCAS[grado] + 1
            x = self.TX0 + (i + 1) * ancho
            teclas.append(("n", st, x - ancho * 0.3, self.TY0, x + ancho * 0.3, self.TY0 + (self.TY1 - self.TY0) * 0.62))
        return teclas

    def dibujar(self):
        c = self.c
        c.delete("all")
        self._items = {}
        W = self.W

        # tapa de madera con el nombre
        c.create_rectangle(0, 0, W, 120, fill=MADERA, outline="")
        for y in range(8, 120, 9):
            c.create_line(0, y, W, y + 3, fill=MADERA_CLARA)
        self.t(40, 50, "Piano", 26, CREMA, "Georgia")
        self.t(42, 84, "toca con el teclado (A S D F… / W E T…) o con el mouse", 10, "#E9DCCB")
        self.redondo(W - 300, 30, W - 40, 92, 10, fill=TINTA, outline="")
        if self.pulsadas:
            st = self.pulsadas[-1]
            self.t(W - 280, 54, nombre(st), 18, "#F3E3C3", "Cascadia Code")
            self.t(W - 280, 78, f"{frecuencia(st):.1f} Hz", 10, "#B9A88F", "Cascadia Code")
        else:
            self.t(W - 280, 61, self.tocando and f"♪ {self.tocando}" or "—", 13, "#B9A88F", "Cascadia Code")
        c.create_rectangle(0, 120, W, 132, fill="#3A2A1E", outline="")

        # teclas
        letras_b = {i: TECLAS_B[i] for i in range(len(TECLAS_B))}
        idx_blanca = 0
        for tipo, st, x0, y0, x1, y1 in self._teclas:
            if tipo != "b":
                continue
            on = st in self.pulsadas
            c.create_rectangle(x0, y0, x1, y1, fill=PULSADA if on else BLANCA, outline=SOMBRA)
            c.create_rectangle(x0 + 1, y1 - (4 if on else 10), x1 - 1, y1, fill=SOMBRA if not on else "#E8C7B2", outline="")
            if idx_blanca in letras_b:
                self.t((x0 + x1) / 2, y1 - 34, letras_b[idx_blanca].upper(), 10, GRIS, ancla="center")
            if st % 12 == 0:
                self.t((x0 + x1) / 2, y1 - 56, nombre(st), 8, ACENTO, ancla="center")
            idx_blanca += 1
        inv = {v: k for k, v in TECLAS_N.items()}
        for tipo, st, x0, y0, x1, y1 in self._teclas:
            if tipo != "n":
                continue
            on = st in self.pulsadas
            c.create_rectangle(x0, y0, x1, y1, fill=PULSADA_NEGRA if on else NEGRA, outline=NEGRA)
            if not on:
                c.create_rectangle(x0 + 4, y1 - 14, x1 - 4, y1 - 4, fill="#2E2925", outline="")
            if st in inv:
                self.t((x0 + x1) / 2, y1 - 26, inv[st].upper(), 8, "#9C8F82", ancla="center")

        # controles
        y = 462
        self.t(40, y - 4, "Melodías", 10, GRIS)
        x = 112
        for nombre_m in MELODIAS:
            activo = self.tocando == nombre_m
            ancho = 18 + len(nombre_m) * 7.4
            self._items["mel:" + nombre_m] = self.redondo(x, y - 20, x + ancho, y + 12, 15, fill=TINTA if activo else CREMA, outline=TINTA)
            self.t(x + ancho / 2, y - 4, nombre_m, 10, CREMA if activo else TINTA, ancla="center")
            x += ancho + 10

        bx = W - 300
        if self.grabando:
            self._items["rec"] = self.redondo(bx, y - 20, bx + 120, y + 12, 15, fill=ACENTO, outline=ACENTO)
            self.t(bx + 60, y - 4, "■  Parar", 10, "#FFFFFF", estilo="bold", ancla="center")
        else:
            self._items["rec"] = self.redondo(bx, y - 20, bx + 120, y + 12, 15, fill=CREMA, outline=ACENTO)
            self.t(bx + 60, y - 4, "●  Grabar", 10, ACENTO, estilo="bold", ancla="center")
        hay = bool(self.grabacion) and not self.grabando
        self._items["play"] = self.redondo(bx + 130, y - 20, bx + 260, y + 12, 15, fill=CREMA, outline=TINTA if hay else SOMBRA)
        self.t(bx + 195, y - 4, "▶  Repetir", 10, TINTA if hay else "#B9AE9F", estilo="bold", ancla="center")

        estado = f"{PORT} · el zumbador del Arduino toca cada nota" if self.puerto else "Sin placa — las notas solo se ven en pantalla"
        c.create_oval(40, 510, 48, 518, fill="#6E9B5B" if self.puerto else "#D9A441", outline="")
        self.t(56, 514, estado, 9, GRIS)

        if abs(self.s - 1) > 0.01:
            c.scale("all", 0, 0, self.s, self.s)
        self.zonas = {k: c.bbox(i) for k, i in self._items.items()}

    # ---------- entrada ----------
    def _tecla_en(self, e):
        x, y = e.x / self.s, e.y / self.s
        for tipo in ("n", "b"):  # las negras están encima
            for tp, st, x0, y0, x1, y1 in self._teclas:
                if tp == tipo and x0 <= x <= x1 and y0 <= y <= y1:
                    return st
        return None

    def _zona(self, e):
        for k, z in self.zonas.items():
            if z and z[0] <= e.x <= z[2] and z[1] <= e.y <= z[3]:
                return k
        return None

    def _mover(self, e):
        self.c.configure(cursor="hand2" if self._zona(e) or self._tecla_en(e) is not None else "")

    def _clic(self, e):
        z = self._zona(e)
        if z:
            if z.startswith("mel:"):
                if self.tocando == z[4:]:
                    self.parar()
                else:
                    self.tocar_melodia(z[4:])
            elif z == "rec":
                self.alternar_grabacion()
            elif z == "play":
                self.repetir()
            return
        st = self._tecla_en(e)
        if st is not None:
            self.raton = st
            self.pulsar(st)

    def _arrastrar(self, e):
        st = self._tecla_en(e)
        if self.raton is not None and st != self.raton:
            self.soltar(self.raton)
            self.raton = st
            if st is not None:
                self.pulsar(st)

    def _soltar_raton(self, _e):
        if self.raton is not None:
            self.soltar(self.raton)
            self.raton = None

    def _semitono_de(self, e):
        k = (e.char or e.keysym).lower()
        if k in TECLAS_B:
            i = TECLAS_B.index(k)
            octava, grado = divmod(i, 7)
            return octava * 12 + BLANCAS[grado]
        return TECLAS_N.get(k)

    def _tecla_abajo(self, e):
        st = self._semitono_de(e)
        if st is not None:
            self.pulsar(st)  # la repetición automática del teclado se ignora sola

    def _tecla_arriba(self, e):
        st = self._semitono_de(e)
        if st is not None:
            self.soltar(st)


if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    Piano().mainloop()
