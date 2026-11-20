"""Estación del clima — panel de escritorio.

Lee del Arduino líneas como  T:23.4;H:56;L:612  y las muestra como una ficha
de almanaque: temperatura con su tendencia, humedad y luz.
Sin placa conectada arranca con datos de ejemplo para que veas cómo luce.
"""
import csv
import datetime as dt
import math
import os
import queue
import random
import sys
import threading
import time
import tkinter as tk
from tkinter import filedialog

try:
    import serial  # pip install pyserial
except ImportError:
    serial = None

PORT = os.environ.get("ARPY_PORT", "")
BAUD = int(os.environ.get("ARPY_BAUD", "115200"))
DEMO = os.environ.get("ARPY_DEMO") == "1"

# Paleta: papel, tinta y un acento terracota
PAPEL = "#F3EEE4"
TINTA = "#2B2A28"
GRIS = "#8A8378"
LINEA = "#D9D0C1"
SUAVE = "#E7DFD0"
ACENTO = "#C8553D"
SOL = "#D9A441"
OK = "#6E9B5B"

DIAS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
         "agosto", "septiembre", "octubre", "noviembre", "diciembre"]


class Enlace:
    """Lee el puerto serie en un hilo. Si no hay placa, inventa datos creíbles."""

    def __init__(self):
        self.cola = queue.Queue()
        self.puerto = None
        self.error = ""
        if not DEMO and serial and PORT:
            try:
                self.puerto = serial.Serial(PORT, BAUD, timeout=0.3)
            except Exception as e:  # puerto ocupado, placa desconectada…
                self.error = str(e)
        self.demo = self.puerto is None
        threading.Thread(target=self._demo if self.demo else self._leer, daemon=True).start()

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
        t, h, luz = 22.8, 58.0, 640.0
        n = 0
        while True:
            n += 1
            t += random.uniform(-0.25, 0.3) + (23.5 - t) * 0.05
            h += random.uniform(-1.2, 1.0) + (55 - h) * 0.05
            luz = max(30, min(1000, luz + random.uniform(-40, 35)))
            self.cola.put(f"T:{t:.1f};H:{h:.0f};L:{luz:.0f}")
            # las primeras lecturas llegan rápido para que el gráfico tenga historia
            time.sleep(0.05 if n < 40 else 2)


def leer_valores(linea):
    datos = {}
    for parte in linea.split(";"):
        if ":" in parte:
            k, v = parte.split(":", 1)
            try:
                datos[k.strip()] = float(v)
            except ValueError:
                pass
    return datos


class Estacion(tk.Tk):
    W, H = 920, 560

    def __init__(self):
        super().__init__()
        self.title("Estación del clima")
        self.configure(bg=PAPEL)
        self.s = self.winfo_fpixels("1i") / 96.0  # escala por DPI
        self.geometry(f"{int(self.W * self.s)}x{int(self.H * self.s)}")
        self.minsize(int(self.W * self.s), int(self.H * self.s))
        self.c = tk.Canvas(self, bg=PAPEL, highlightthickness=0)
        self.c.pack(fill="both", expand=True)
        self.c.bind("<Button-1>", self._clic)
        self.c.bind("<Motion>", self._mover)

        self.enlace = Enlace()
        self.temp = None
        self.hum = None
        self.luz = None
        self.historia = []      # temperaturas recientes
        self.registro = []      # para el CSV
        self.ultima = None
        self.fahrenheit = False
        self.zonas = {}         # áreas clicables (ya escaladas)
        self._items = {}
        self.after(50, self._bucle)

    # ---------- datos ----------
    def _bucle(self):
        while not self.enlace.cola.empty():
            d = leer_valores(self.enlace.cola.get())
            if "T" in d and "H" in d:
                self.temp, self.hum = d["T"], d["H"]
                self.luz = d.get("L", self.luz)
                self.historia = (self.historia + [self.temp])[-90:]
                self.ultima = time.time()
                self.registro.append((dt.datetime.now().isoformat(timespec="seconds"), self.temp, self.hum, self.luz))
        self.dibujar()
        self.after(500, self._bucle)

    # ---------- dibujo ----------
    def t(self, x, y, texto, tam=10, color=TINTA, fuente="Segoe UI", estilo="", ancla="w"):
        return self.c.create_text(x, y, text=texto, fill=color, anchor=ancla,
                                  font=(fuente, tam, estilo) if estilo else (fuente, tam))

    def dibujar(self):
        c = self.c
        c.delete("all")
        self._items = {}
        W, H = self.W, self.H
        ahora = dt.datetime.now()

        # Cabecera
        self.t(40, 46, "Estación del patio", 24, fuente="Georgia")
        self.t(W - 40, 38, ahora.strftime("%H:%M"), 22, fuente="Georgia", ancla="e")
        self.t(W - 40, 64, f"{DIAS[ahora.weekday()]}, {ahora.day} de {MESES[ahora.month - 1]}", 10, GRIS, ancla="e")
        c.create_line(40, 88, W - 40, 88, fill=LINEA)

        if self.temp is None:
            self.t(W / 2, H / 2, "Esperando la primera lectura…", 14, GRIS, "Georgia", "italic", "center")
            self._pie()
            self._escalar()
            return

        # ----- Temperatura -----
        self.t(40, 124, "TEMPERATURA", 9, GRIS, estilo="bold")
        valor = self.temp * 9 / 5 + 32 if self.fahrenheit else self.temp
        num = self.t(36, 196, f"{valor:.1f}", 64, fuente="Georgia")
        x0, _, x1, _ = c.bbox(num)
        x2 = 36 + (x1 - x0) / self.s  # el texto ya viene escalado por DPI
        self.t(x2 + 4, 172, "°F" if self.fahrenheit else "°C", 20, GRIS, "Georgia")
        self.t(40, 266, self._tendencia(), 12, TINTA, "Georgia", "italic")

        # gráfico de la última hora (o lo que haya)
        gx0, gx1, gy0, gy1 = 40, 380, 312, 404
        c.create_line(gx0, gy1, gx1, gy1, fill=LINEA)
        if len(self.historia) > 1:
            lo, hi = min(self.historia), max(self.historia)
            if hi - lo < 1:
                lo, hi = lo - 0.5, hi + 0.5
            pts = []
            n = len(self.historia)
            for i, v in enumerate(self.historia):
                x = gx0 + (gx1 - gx0) * i / max(n - 1, 1)
                y = gy1 - (gy1 - gy0) * (v - lo) / (hi - lo)
                pts += [x, y]
            c.create_polygon(gx0, gy1, *pts, pts[-2], gy1, fill=SUAVE, outline="")
            c.create_line(*pts, fill=TINTA, width=1.6, smooth=True)
            c.create_oval(pts[-2] - 3.5, pts[-1] - 3.5, pts[-2] + 3.5, pts[-1] + 3.5, fill=ACENTO, outline=PAPEL, width=2)
            self.t(gx1, gy0 - 12, f"máx {hi:.1f}°", 9, GRIS, ancla="e")
            self.t(gx1, gy1 + 14, f"mín {lo:.1f}°", 9, GRIS, ancla="e")
        self.t(gx0, gy1 + 14, "últimas lecturas", 9, GRIS)

        c.create_line(420, 116, 420, 450, fill=LINEA)

        # ----- Humedad: medio círculo -----
        self.t(460, 124, "HUMEDAD", 9, GRIS, estilo="bold")
        cx, cy, r = 580, 300, 104
        c.create_arc(cx - r, cy - r, cx + r, cy + r, start=0, extent=180, style="arc", outline=SUAVE, width=16)
        ext = max(0, min(100, self.hum)) / 100 * 180
        c.create_arc(cx - r, cy - r, cx + r, cy + r, start=180, extent=-ext, style="arc", outline=ACENTO, width=16)
        for p in range(0, 101, 10):
            a = math.radians(180 - p * 1.8)
            r1, r2 = r + 14, r + (22 if p % 50 == 0 else 18)
            c.create_line(cx + r1 * math.cos(a), cy - r1 * math.sin(a), cx + r2 * math.cos(a), cy - r2 * math.sin(a), fill=GRIS)
        self.t(cx, cy - 26, f"{self.hum:.0f}%", 34, fuente="Georgia", ancla="center")
        self.t(cx, cy + 6, self._humedad_txt(), 11, GRIS, "Georgia", "italic", "center")
        self.t(cx - r - 8, cy + 22, "0", 8, GRIS, ancla="center")
        self.t(cx + r + 8, cy + 22, "100", 8, GRIS, ancla="center")
        self.t(460, 400, "La comodidad está entre 40 % y 60 %.", 9, GRIS)

        c.create_line(740, 116, 740, 450, fill=LINEA)

        # ----- Luz -----
        self.t(776, 124, "LUZ", 9, GRIS, estilo="bold")
        nivel = 0 if self.luz is None else max(0.0, min(1.0, self.luz / 1023))
        sx, sy = 830, 190
        rad = 14 + 8 * nivel
        if nivel > 0.25:
            for i in range(12):
                a = math.radians(i * 30)
                l1, l2 = rad + 6, rad + 6 + 10 * nivel
                c.create_line(sx + l1 * math.cos(a), sy + l1 * math.sin(a), sx + l2 * math.cos(a), sy + l2 * math.sin(a), fill=SOL, width=2, capstyle="round")
            c.create_oval(sx - rad, sy - rad, sx + rad, sy + rad, fill=SOL, outline="")
        else:  # luna
            c.create_oval(sx - 16, sy - 16, sx + 16, sy + 16, fill=GRIS, outline="")
            c.create_oval(sx - 8, sy - 20, sx + 22, sy + 10, fill=PAPEL, outline="")
        tx0, tx1, ty0, ty1 = 816, 844, 250, 410
        c.create_rectangle(tx0, ty0, tx1, ty1, outline=LINEA, fill=PAPEL)
        c.create_rectangle(tx0 + 4, ty1 - (ty1 - ty0 - 8) * nivel - 4, tx1 - 4, ty1 - 4, outline="", fill=SOL)
        self.t(830, 436, self._luz_txt(nivel), 11, GRIS, "Georgia", "italic", "center")

        self._pie()
        self._escalar()

    def _escalar(self):
        """Dibujamos en un lienzo lógico de 920x560 y lo escalamos según el DPI de la pantalla."""
        if abs(self.s - 1) > 0.01:
            self.c.scale("all", 0, 0, self.s, self.s)
        self.zonas = {k: self.c.bbox(i) for k, i in self._items.items()}

    def _pie(self):
        c, W, H = self.c, self.W, self.H
        c.create_line(40, H - 72, W - 40, H - 72, fill=LINEA)
        y = H - 42
        if self.enlace.demo:
            c.create_oval(40, y - 4, 48, y + 4, fill=SOL, outline="")
            msg = "Sin placa — mostrando datos de ejemplo" + (f" ({self.enlace.error[:40]})" if self.enlace.error else "")
        else:
            c.create_oval(40, y - 4, 48, y + 4, fill=OK, outline="")
            msg = f"{PORT} · {BAUD} baudios"
        self.t(56, y, msg, 9, GRIS)
        if self.ultima:
            seg = int(time.time() - self.ultima)
            self.t(W / 2, y, "actualizado ahora" if seg < 3 else f"actualizado hace {seg} s", 9, GRIS, ancla="center")
        self._enlace_txt(W - 40, y, "Guardar registro", "csv", "e")
        self._enlace_txt(W - 170, y, "Ver en °C" if self.fahrenheit else "Ver en °F", "unidad", "e")

    def _enlace_txt(self, x, y, texto, clave, ancla):
        self._items[clave] = self.t(x, y, texto, 9, ACENTO, estilo="underline", ancla=ancla)

    # ---------- textos ----------
    def _tendencia(self):
        h = self.historia
        if len(h) < 6:
            return "midiendo…"
        d = sum(h[-3:]) / 3 - sum(h[-6:-3]) / 3
        clima = "fresco" if self.temp < 18 else "templado" if self.temp < 26 else "caluroso"
        if d > 0.15:
            return f"{clima}, va subiendo"
        if d < -0.15:
            return f"{clima}, va bajando"
        return f"{clima}, sin cambios"

    def _humedad_txt(self):
        return "aire seco" if self.hum < 35 else "agradable" if self.hum <= 60 else "húmedo" if self.hum < 80 else "muy húmedo"

    def _luz_txt(self, n):
        return "de noche" if n < 0.12 else "penumbra" if n < 0.35 else "nublado" if n < 0.65 else "pleno día"

    # ---------- interacción ----------
    def _zona(self, e):
        x, y = self.c.canvasx(e.x), self.c.canvasy(e.y)
        for k, (x0, y0, x1, y1) in self.zonas.items():
            if x0 - 4 <= x <= x1 + 4 and y0 - 4 <= y <= y1 + 4:
                return k
        return None

    def _mover(self, e):
        self.c.configure(cursor="hand2" if self._zona(e) else "")

    def _clic(self, e):
        z = self._zona(e)
        if z == "unidad":
            self.fahrenheit = not self.fahrenheit
            self.dibujar()
        elif z == "csv":
            self._guardar()

    def _guardar(self):
        if not self.registro:
            return
        ruta = filedialog.asksaveasfilename(defaultextension=".csv", initialfile="clima.csv",
                                            filetypes=[("CSV", "*.csv")])
        if ruta:
            with open(ruta, "w", newline="", encoding="utf-8") as f:
                w = csv.writer(f)
                w.writerow(["fecha", "temperatura_c", "humedad", "luz"])
                w.writerows(self.registro)


if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    Estacion().mainloop()
