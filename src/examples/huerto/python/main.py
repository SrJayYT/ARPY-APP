"""Huerto — cuida una planta desde el escritorio.

El Arduino mide la humedad de la tierra y controla una bomba de agua.
Esta app dibuja la planta (se marchita cuando le falta agua), muestra la humedad,
deja regar a mano y ajustar el riego automático.
Sin placa conectada arranca en modo de ejemplo: la tierra se va secando sola.
"""
import datetime as dt
import math
import os
import queue
import random
import sys
import threading
import time
import tkinter as tk

try:
    import serial  # pip install pyserial
except ImportError:
    serial = None

PORT = os.environ.get("ARPY_PORT", "")
BAUD = int(os.environ.get("ARPY_BAUD", "115200"))
DEMO = os.environ.get("ARPY_DEMO") == "1"

FONDO = "#EDF1EA"
TARJETA = "#F7F9F5"
TINTA = "#24382C"
GRIS = "#6B7C70"
LINEA = "#D5DDD0"
HOJA = "#6E9B5B"
HOJA_OSCURA = "#4F7A41"
AGUA = "#4C7DA0"
MACETA = "#B8694A"
MACETA_SOMBRA = "#9C5539"

SECO, MOJADO = 1000, 330  # misma calibración que el sketch


def pct(lectura):
    return max(0.0, min(100.0, (SECO - lectura) * 100.0 / (SECO - MOJADO)))


def mezclar(c1, c2, t):
    a = [int(c1[i:i + 2], 16) for i in (1, 3, 5)]
    b = [int(c2[i:i + 2], 16) for i in (1, 3, 5)]
    return "#" + "".join(f"{int(a[i] + (b[i] - a[i]) * t):02x}" for i in range(3))


class Enlace:
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
        # estado del huerto simulado
        self._suelo, self._bomba, self._umbral, self._inicio, self._fin = 44.0, False, 35, 0.0, -99.0
        threading.Thread(target=self._simular if self.demo else self._leer, daemon=True).start()

    def enviar(self, texto):
        if self.puerto:
            try:
                self.puerto.write((texto + "\n").encode())
            except Exception as e:
                self.error = str(e)
        else:
            if texto == "PUMP:1":
                self._regar(True)
            elif texto == "PUMP:0":
                self._regar(False)
            elif texto == "AUTO:OFF":
                self._umbral = -1
            elif texto.startswith("AUTO:"):
                self._umbral = int(texto[5:])

    def _leer(self):
        while True:
            try:
                linea = self.puerto.readline().decode(errors="ignore").strip()
            except Exception as e:
                self.error = str(e)
                return
            if linea:
                self.cola.put(linea)

    def _regar(self, on):
        if on != self._bomba:
            self._bomba = on
            if on:
                self._inicio = time.time()
            else:
                self._fin = time.time()

    def _simular(self):
        while True:
            ahora = time.time()
            if self._bomba:
                self._suelo = min(100, self._suelo + 4.5)
                if ahora - self._inicio > 8 or (self._umbral >= 0 and self._suelo > self._umbral + 15):
                    self._regar(False)
            else:
                self._suelo = max(0, self._suelo - random.uniform(0.15, 0.45))
                if self._umbral >= 0 and self._suelo < self._umbral and ahora - self._fin > 12:
                    self._regar(True)
            lectura = int(SECO - self._suelo / 100 * (SECO - MOJADO))
            umbral = "OFF" if self._umbral < 0 else self._umbral
            self.cola.put(f"S:{lectura};P:{int(self._bomba)};A:{umbral}")
            time.sleep(1)


class Huerto(tk.Tk):
    W, H = 900, 580

    def __init__(self):
        super().__init__()
        self.title("Huerto")
        self.configure(bg=FONDO)
        self.s = self.winfo_fpixels("1i") / 96.0
        self.geometry(f"{int(self.W * self.s)}x{int(self.H * self.s)}")
        self.minsize(int(self.W * self.s), int(self.H * self.s))
        self.c = tk.Canvas(self, bg=FONDO, highlightthickness=0)
        self.c.pack(fill="both", expand=True)
        self.c.bind("<Button-1>", self._clic)
        self.c.bind("<B1-Motion>", self._arrastrar)
        self.c.bind("<ButtonRelease-1>", self._soltar)
        self.c.bind("<Motion>", self._mover)

        self.enlace = Enlace()
        self.humedad = None
        self.bomba = False
        self.umbral = 35
        self.auto = True
        self.riegos = []           # (inicio, duración, automático)
        self._riego_inicio = None
        self._riego_manual = False
        self._arrastrando = False
        self.gotas = []
        self.zonas = {}
        self.vista = 0.0           # humedad mostrada (animada hacia la real)
        self.after(30, self._bucle)

    # ---------- datos ----------
    def _bucle(self):
        while not self.enlace.cola.empty():
            linea = self.enlace.cola.get()
            d = dict(p.split(":", 1) for p in linea.split(";") if ":" in p)
            try:
                self.humedad = pct(int(d["S"]))
                bomba = d.get("P") == "1"
            except (KeyError, ValueError):
                continue
            if not self._arrastrando and "A" in d:
                if d["A"] == "OFF":
                    self.auto = False
                else:
                    self.auto, self.umbral = True, int(d["A"])
            if bomba and not self.bomba:
                self._riego_inicio = time.time()
            if not bomba and self.bomba and self._riego_inicio:
                self.riegos.insert(0, (self._riego_inicio, time.time() - self._riego_inicio, not self._riego_manual))
                self.riegos = self.riegos[:4]
                self._riego_manual = False
            self.bomba = bomba
        if self.humedad is not None:
            self.vista += (self.humedad - self.vista) * 0.15
        if self.bomba:
            for _ in range(2):
                self.gotas.append([random.uniform(150, 250), random.uniform(120, 160), random.uniform(4, 7)])
        for g in self.gotas:
            g[1] += g[2]
            g[2] += 0.35
        self.gotas = [g for g in self.gotas if g[1] < 372]
        self.dibujar()
        self.after(40 if self.bomba or self.gotas else 200, self._bucle)

    # ---------- dibujo ----------
    def t(self, x, y, texto, tam=10, color=TINTA, fuente="Segoe UI", estilo="", ancla="w"):
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
        self._planta()
        self._panel()
        if abs(self.s - 1) > 0.01:
            c.scale("all", 0, 0, self.s, self.s)
        self.zonas = {k: c.bbox(i) for k, i in self._items.items()}

    def _planta(self):
        c = self.c
        m = (self.vista if self.humedad is not None else 50) / 100
        self.t(48, 54, "Huerto", 26, fuente="Georgia")
        self.t(50, 88, "Albahaca · maceta del balcón", 10, GRIS)
        c.create_oval(60, 150, 340, 430, fill="#E2E9DD", outline="")

        # tallo y hojas: se inclinan hacia abajo cuando la tierra está seca
        caida = (1 - min(1, m / 0.45)) if m < 0.45 else 0
        base_x, base_y = 200, 372
        punta_x, punta_y = 200 + 26 * caida, 196 + 40 * caida
        c.create_line(base_x, base_y, 196, 300, 200 + 14 * caida, 240 + 20 * caida, punta_x, punta_y,
                      smooth=True, fill=HOJA_OSCURA, width=5, capstyle="round")
        verde = mezclar(HOJA, "#A3A86A", caida * 0.8)
        hojas = [(0.25, -1, 70), (0.32, 1, 64), (0.5, -1, 58), (0.58, 1, 54), (0.74, -1, 44), (0.8, 1, 40), (0.95, 0, 32)]
        for t, lado, largo in hojas:
            x = base_x + (punta_x - base_x) * t + (8 * caida if t > 0.5 else 0)
            y = base_y + (punta_y - base_y) * t
            ang = math.radians(-90 + lado * (55 + 45 * caida) if lado else -90 + 40 * caida)
            self._hoja(x, y, ang, largo * (0.9 + 0.1 * m), verde)

        # maceta
        tierra = mezclar("#A88A6A", "#3F2C20", m)
        c.create_polygon(118, 372, 282, 372, 262, 470, 138, 470, fill=MACETA, outline="")
        c.create_polygon(118, 372, 140, 372, 152, 470, 138, 470, fill=MACETA_SOMBRA, outline="")
        c.create_rectangle(108, 356, 292, 380, fill=MACETA, outline="")
        c.create_oval(116, 352, 284, 368, fill=tierra, outline="")
        c.create_oval(130, 470, 270, 482, fill="#D5DDD0", outline="")
        for gx, gy, _ in self.gotas:
            c.create_oval(gx - 2.5, gy - 4, gx + 2.5, gy + 4, fill=AGUA, outline="")

    def _hoja(self, x, y, ang, largo, color):
        ancho = largo * 0.38
        dx, dy = math.cos(ang), math.sin(ang)
        nx, ny = -dy, dx
        pts = [x, y,
               x + dx * largo * 0.3 + nx * ancho * 0.6, y + dy * largo * 0.3 + ny * ancho * 0.6,
               x + dx * largo * 0.7 + nx * ancho * 0.5, y + dy * largo * 0.7 + ny * ancho * 0.5,
               x + dx * largo, y + dy * largo,
               x + dx * largo * 0.7 - nx * ancho * 0.5, y + dy * largo * 0.7 - ny * ancho * 0.5,
               x + dx * largo * 0.3 - nx * ancho * 0.6, y + dy * largo * 0.3 - ny * ancho * 0.6]
        self.c.create_polygon(pts, smooth=True, fill=color, outline="")
        self.c.create_line(x, y, x + dx * largo * 0.85, y + dy * largo * 0.85, fill=HOJA_OSCURA, width=1)

    def _panel(self):
        c = self.c
        x0, x1 = 420, 852
        self.redondo(x0 - 24, 40, x1 + 24, 540, 22, fill=TARJETA, outline="")

        self.t(x0, 80, "HUMEDAD DE LA TIERRA", 9, GRIS, estilo="bold")
        if self.humedad is None:
            self.t(x0, 130, "Esperando datos del sensor…", 14, GRIS, "Georgia", "italic")
        else:
            n = self.t(x0 - 3, 132, f"{self.humedad:.0f}", 48, fuente="Georgia")
            bx0, _, bx1, _ = c.bbox(n)
            self.t(x0 + (bx1 - bx0) / self.s + 2, 118, "%", 18, GRIS, "Georgia")
            self.t(x1, 140, self._frase(), 13, TINTA, "Georgia", "italic", "e")

        # barra con la marca del umbral
        by = 196
        self.redondo(x0, by, x1, by + 12, 6, fill="#E4EAE0", outline="")
        if self.humedad is not None:
            ancho = (x1 - x0) * self.vista / 100
            if ancho > 12:
                self.redondo(x0, by, x0 + ancho, by + 12, 6, fill=AGUA, outline="")
        ux = x0 + (x1 - x0) * self.umbral / 100
        if self.auto:
            c.create_line(ux, by - 6, ux, by + 18, fill=TINTA, width=2)

        # control del umbral
        self.t(x0, 252, "Riego automático", 12)
        self._interruptor(x1 - 44, 242, self.auto)
        color = TINTA if self.auto else GRIS
        self.t(x0, 284, f"Regar cuando baje del {self.umbral} %", 10, color)
        ty = 318
        c.create_line(x0, ty, x1, ty, fill=LINEA, width=4, capstyle="round")
        c.create_line(x0, ty, ux, ty, fill=AGUA if self.auto else GRIS, width=4, capstyle="round")
        perilla = c.create_oval(ux - 9, ty - 9, ux + 9, ty + 9, fill=TARJETA, outline=AGUA if self.auto else GRIS, width=3)
        self._items["perilla"] = perilla
        self._items["pista"] = c.create_rectangle(x0, ty - 12, x1, ty + 12, outline="", fill="")
        self._pista = (x0, x1)

        # botón regar
        if self.bomba:
            boton = self.redondo(x0, 360, x0 + 210, 404, 12, fill=TINTA, outline="")
            self.t(x0 + 105, 382, "Regando…  detener", 11, "#FFFFFF", estilo="bold", ancla="center")
        else:
            boton = self.redondo(x0, 360, x0 + 210, 404, 12, fill=AGUA, outline="")
            self.t(x0 + 105, 382, "Regar ahora", 11, "#FFFFFF", estilo="bold", ancla="center")
        self._items["regar"] = boton
        self.t(x0 + 228, 382, "se detiene solo a los 8 s", 9, GRIS)

        # historial
        self.t(x0, 444, "ÚLTIMOS RIEGOS", 9, GRIS, estilo="bold")
        if not self.riegos:
            self.t(x0, 472, "Todavía ninguno en esta sesión.", 10, GRIS)
        for i, (ini, dur, auto) in enumerate(self.riegos[:3]):
            hora = dt.datetime.fromtimestamp(ini).strftime("%H:%M")
            self.t(x0, 472 + i * 22, f"{hora}", 10, TINTA, "Georgia")
            self.t(x0 + 56, 472 + i * 22, f"{dur:.0f} s · {'automático' if auto else 'a mano'}", 10, GRIS)

        # estado de la conexión
        y = 560
        c.create_oval(48, y - 4, 56, y + 4, fill="#D9A441" if self.enlace.demo else HOJA, outline="")
        self.t(64, y, "Sin placa — huerto de ejemplo (la tierra se seca sola)" if self.enlace.demo else f"{PORT} · {BAUD} baudios", 9, GRIS)

    def _interruptor(self, x, y, on):
        self._items["auto"] = self.redondo(x, y - 2, x + 44, y + 22, 12, fill=HOJA if on else "#C9D2C4", outline="")
        cx = x + (32 if on else 12)
        self.c.create_oval(cx - 9, y + 1, cx + 9, y + 19, fill="#FFFFFF", outline="")

    def _frase(self):
        h = self.humedad
        if self.bomba:
            return "bebiendo agua"
        if h < 20:
            return "necesita agua ya"
        if h < 35:
            return "empieza a secarse"
        if h < 75:
            return "bien regada"
        return "tierra empapada"

    # ---------- interacción ----------
    def _en(self, e, clave):
        z = self.zonas.get(clave)
        if not z:
            return False
        x, y = e.x, e.y
        return z[0] - 4 <= x <= z[2] + 4 and z[1] - 4 <= y <= z[3] + 4

    def _mover(self, e):
        mano = any(self._en(e, k) for k in ("regar", "auto", "pista", "perilla"))
        self.c.configure(cursor="hand2" if mano else "")

    def _clic(self, e):
        if self._en(e, "regar"):
            self._riego_manual = not self.bomba
            self.enlace.enviar("PUMP:0" if self.bomba else "PUMP:1")
        elif self._en(e, "auto"):
            self.auto = not self.auto
            self.enlace.enviar(f"AUTO:{self.umbral}" if self.auto else "AUTO:OFF")
        elif self.auto and (self._en(e, "pista") or self._en(e, "perilla")):
            self._arrastrando = True
            self._arrastrar(e)

    def _arrastrar(self, e):
        if not self._arrastrando:
            return
        x0, x1 = self._pista
        x = e.x / self.s
        self.umbral = int(round(max(5, min(90, (x - x0) / (x1 - x0) * 100))))
        self.dibujar()

    def _soltar(self, _e):
        if self._arrastrando:
            self._arrastrando = False
            self.enlace.enviar(f"AUTO:{self.umbral}")


if __name__ == "__main__":
    if sys.platform == "win32":
        try:
            import ctypes
            ctypes.windll.shcore.SetProcessDpiAwareness(1)
        except Exception:
            pass
    Huerto().mainloop()
