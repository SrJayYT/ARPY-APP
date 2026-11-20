"""Luces — elige el color de un LED RGB con una rueda de color.

Arrastra sobre el anillo para cambiar el tono, ajusta brillo y saturación,
o usa una escena. Cada cambio se envía al Arduino como  RGB:r,g,b
Sin placa conectada funciona igual (el color se ve en pantalla).
"""
import colorsys
import math
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

FONDO = "#17161A"
PANEL = "#201F24"
CHIP = "#27262C"
TEXTO = "#EDEAE4"
GRIS = "#8D8893"
LINEA = "#34323A"

ESCENAS = [
    ("Atardecer", 0.055, 0.85, 0.95),
    ("Lectura", 0.10, 0.32, 0.90),
    ("Bosque", 0.36, 0.70, 0.70),
    ("Océano", 0.56, 0.80, 0.85),
    ("Velada", 0.76, 0.60, 0.45),
    ("Fiesta", None, 1.0, 1.0),  # el tono va girando solo
]


def hex_de(rgb):
    return "#%02x%02x%02x" % rgb


class Luces(tk.Tk):
    W, H = 880, 560
    CX, CY, R_EXT, R_INT = 250, 296, 196, 150

    def __init__(self):
        super().__init__()
        self.title("Luces")
        self.configure(bg=FONDO)
        self.s = self.winfo_fpixels("1i") / 96.0
        self.geometry(f"{int(self.W * self.s)}x{int(self.H * self.s)}")
        self.minsize(int(self.W * self.s), int(self.H * self.s))
        self.c = tk.Canvas(self, bg=FONDO, highlightthickness=0)
        self.c.pack(fill="both", expand=True)
        self.c.bind("<Button-1>", self._clic)
        self.c.bind("<B1-Motion>", self._arrastrar)
        self.c.bind("<ButtonRelease-1>", lambda e: setattr(self, "_drag", None))
        self.c.bind("<Motion>", self._mover)

        self.puerto = None
        self.error = ""
        if not DEMO and serial and PORT:
            try:
                self.puerto = serial.Serial(PORT, BAUD, timeout=0.2)
            except Exception as e:
                self.error = str(e)

        self.tono, self.sat, self.brillo = 0.055, 0.85, 0.95
        self.encendido = True
        self.escena = "Atardecer"
        self._drag = None
        self._ultimo_envio = ""
        self._t_envio = 0.0
        self.zonas = {}
        self._anillo = self._precalcular_anillo()
        self.after(20, self._bucle)

    def _precalcular_anillo(self):
        segs = []
        n = 120
        for i in range(n):
            h = i / n
            segs.append((i * 360 / n, hex_de(tuple(int(v * 255) for v in colorsys.hsv_to_rgb(h, 1, 1)))))
        return segs

    # ---------- color ----------
    def rgb(self):
        if not self.encendido:
            return (0, 0, 0)
        r, g, b = colorsys.hsv_to_rgb(self.tono % 1, self.sat, self.brillo)
        return (int(r * 255), int(g * 255), int(b * 255))

    def _enviar(self, forzar=False):
        msg = "RGB:%d,%d,%d" % self.rgb()
        ahora = time.time()
        if msg == self._ultimo_envio or (not forzar and ahora - self._t_envio < 0.05):
            return
        self._ultimo_envio, self._t_envio = msg, ahora
        if self.puerto:
            try:
                self.puerto.write((msg + "\n").encode())
            except Exception as e:
                self.error = str(e)

    def _bucle(self):
        if self.escena == "Fiesta" and self.encendido:
            self.tono = (self.tono + 0.004) % 1
        self._enviar()
        self.dibujar()
        self.after(40 if self.escena == "Fiesta" else 120, self._bucle)

    # ---------- dibujo ----------
    def t(self, x, y, texto, tam=10, color=TEXTO, fuente="Segoe UI", estilo="", ancla="w"):
        return self.c.create_text(x, y, text=texto, fill=color, anchor=ancla,
                                  font=(fuente, tam, estilo) if estilo else (fuente, tam))

    def redondo(self, x0, y0, x1, y1, r, **kw):
        pts = [x0 + r, y0, x1 - r, y0, x1, y0, x1, y0 + r, x1, y1 - r, x1, y1, x1 - r, y1,
               x0 + r, y1, x0, y1, x0, y1 - r, x0, y0 + r, x0, y0]
        return self.c.create_polygon(pts, smooth=True, **kw)

    def dibujar(self):
        c = self.c
        c.delete("all")
        self._items = {}
        cx, cy, re, ri = self.CX, self.CY, self.R_EXT, self.R_INT
        color = hex_de(self.rgb())

        # halo de luz detrás de la rueda
        if self.encendido:
            for i, k in enumerate((0.07, 0.04)):
                rr = re + 20 + i * 22
                halo = hex_de(tuple(int(v * k + 0x17 * (1 - k)) for v in self.rgb()))
                c.create_oval(cx - rr, cy - rr, cx + rr, cy + rr, fill=halo, outline="")
        # anillo de tonos: segmentos trapezoidales (los arcos gruesos de Tk dejan marcas en los extremos)
        mid = (re + ri) / 2
        paso = 360 / len(self._anillo)
        for ang, col in self._anillo:
            a1, a2 = math.radians(90 - ang + 0.5), math.radians(90 - ang - paso - 0.5)
            pts = [cx + re * math.cos(a1), cy - re * math.sin(a1), cx + re * math.cos(a2), cy - re * math.sin(a2),
                   cx + ri * math.cos(a2), cy - ri * math.sin(a2), cx + ri * math.cos(a1), cy - ri * math.sin(a1)]
            c.create_polygon(pts, fill=col, outline="")
        self._items["anillo"] = c.create_oval(cx - re, cy - re, cx + re, cy + re, outline="", fill="")
        # centro con el color actual
        c.create_oval(cx - ri + 10, cy - ri + 10, cx + ri - 10, cy + ri - 10, fill=color if self.encendido else "#0F0E11", outline=FONDO, width=3 * self.s)
        claro = sum(self.rgb()) > 380
        self.t(cx, cy - 8, color.upper() if self.encendido else "apagado", 15, "#1A1A1A" if claro else TEXTO, "Cascadia Code", ancla="center")
        self.t(cx, cy + 18, self.escena or "color libre", 10, "#3A3A3A" if claro else GRIS, ancla="center")
        # perilla en el anillo
        a = math.radians(90 - self.tono * 360)
        kx, ky = cx + mid * math.cos(a), cy - mid * math.sin(a)
        c.create_oval(kx - 15, ky - 15, kx + 15, ky + 15, fill="", outline=TEXTO, width=3 * self.s)
        c.create_oval(kx - 11, ky - 11, kx + 11, ky + 11, fill=hex_de(tuple(int(v * 255) for v in colorsys.hsv_to_rgb(self.tono % 1, 1, 1))), outline="")

        self._panel()
        if abs(self.s - 1) > 0.01:
            c.scale("all", 0, 0, self.s, self.s)
        self.zonas = {k: c.bbox(i) for k, i in self._items.items()}

    def _panel(self):
        c = self.c
        x0, x1 = 520, 840
        self.t(x0, 58, "Luces", 26, fuente="Georgia")
        self.t(x0 + 2, 92, "LED RGB · sala", 10, GRIS)

        self.t(x0, 140, "ESCENAS", 9, GRIS, estilo="bold")
        for i, (nombre, h, s, v) in enumerate(ESCENAS):
            col, fila = i % 2, i // 2
            bx, by = x0 + col * 164, 158 + fila * 46
            activo = self.escena == nombre
            self._items["esc:" + nombre] = self.redondo(bx, by, bx + 154, by + 36, 10, fill=CHIP, outline=TEXTO if activo else "", width=1.5 * self.s)
            if h is None:
                for j, hh in enumerate((0.0, 0.33, 0.66)):
                    c.create_oval(bx + 12 + j * 7, by + 12, bx + 24 + j * 7, by + 24, fill=hex_de(tuple(int(q * 255) for q in colorsys.hsv_to_rgb(hh, 1, 1))), outline=CHIP)
                tx = bx + 44
            else:
                c.create_oval(bx + 12, by + 11, bx + 26, by + 25, fill=hex_de(tuple(int(q * 255) for q in colorsys.hsv_to_rgb(h, s, v))), outline="")
                tx = bx + 36
            self.t(tx, by + 18, nombre, 10, TEXTO if activo else "#CFCBD3")

        self._deslizador("brillo", "Brillo", self.brillo, 334, x0, x1)
        self._deslizador("sat", "Color", self.sat, 400, x0, x1, izquierda="blanco", derecha="intenso")

        # encender / apagar
        by = 452
        if self.encendido:
            self._items["power"] = self.redondo(x0, by, x1, by + 44, 12, fill=CHIP, outline=LINEA)
            self.t((x0 + x1) / 2, by + 22, "Apagar", 11, TEXTO, estilo="bold", ancla="center")
        else:
            self._items["power"] = self.redondo(x0, by, x1, by + 44, 12, fill=TEXTO, outline="")
            self.t((x0 + x1) / 2, by + 22, "Encender", 11, FONDO, estilo="bold", ancla="center")

        y = 530
        c.create_oval(x0, y - 4, x0 + 8, y + 4, fill="#D9A441" if not self.puerto else "#6EC18B", outline="")
        estado = f"{PORT} · enviando {self._ultimo_envio}" if self.puerto else "Sin placa — el color solo se ve aquí"
        self.t(x0 + 16, y, estado, 9, GRIS)

    def _deslizador(self, clave, titulo, valor, y, x0, x1, izquierda=None, derecha=None):
        c = self.c
        self.t(x0, y - 22, titulo, 10, TEXTO)
        self.t(x1, y - 22, f"{valor * 100:.0f} %", 10, GRIS, ancla="e")
        c.create_line(x0, y, x1, y, fill=LINEA, width=6 * self.s, capstyle="round")
        xv = x0 + (x1 - x0) * valor
        c.create_line(x0, y, xv, y, fill=hex_de(self.rgb()) if self.encendido else GRIS, width=6 * self.s, capstyle="round")
        c.create_oval(xv - 9, y - 9, xv + 9, y + 9, fill=TEXTO, outline="")
        self._items["sl:" + clave] = c.create_rectangle(x0 - 6, y - 14, x1 + 6, y + 14, outline="", fill="")
        self._pista = (x0, x1)
        if izquierda:
            self.t(x0, y + 18, izquierda, 8, GRIS)
            self.t(x1, y + 18, derecha, 8, GRIS, ancla="e")

    # ---------- interacción ----------
    def _zona(self, e):
        for k, z in self.zonas.items():
            if z and z[0] <= e.x <= z[2] and z[1] <= e.y <= z[3]:
                if k == "anillo":
                    d = math.hypot(e.x / self.s - self.CX, e.y / self.s - self.CY)
                    if not (self.R_INT - 6 <= d <= self.R_EXT + 8):
                        continue
                return k
        return None

    def _mover(self, e):
        self.c.configure(cursor="hand2" if self._zona(e) else "")

    def _clic(self, e):
        z = self._zona(e)
        if not z:
            return
        if z.startswith("esc:"):
            nombre = z[4:]
            for n, h, s, v in ESCENAS:
                if n == nombre:
                    self.escena = n
                    if h is not None:
                        self.tono = h
                    self.sat, self.brillo, self.encendido = s, v, True
            self._enviar(True)
        elif z == "power":
            self.encendido = not self.encendido
            self._enviar(True)
        else:
            self._drag = z
            self._arrastrar(e)

    def _arrastrar(self, e):
        z = self._drag
        if not z:
            return
        if z == "anillo":
            ang = math.degrees(math.atan2(-(e.y / self.s - self.CY), e.x / self.s - self.CX))
            self.tono = ((90 - ang) / 360) % 1
            self.escena = None
        else:
            x0, x1 = self._pista
            v = max(0.0, min(1.0, (e.x / self.s - x0) / (x1 - x0)))
            if z == "sl:brillo":
                self.brillo = max(0.03, v)
            else:
                self.sat = v
            if self.escena == "Fiesta":
                pass
            else:
                self.escena = None
        self.encendido = True
        self.dibujar()


if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    Luces().mainloop()
