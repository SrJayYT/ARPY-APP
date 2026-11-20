// Luces RGB: la app de escritorio elige el color y el Arduino lo pinta.
// Recibe:  RGB:255,120,40   (cada canal 0-255)
// LED RGB de cátodo común: R en D9, G en D10, B en D11 (con resistencias de 220 Ω).
// Si tu LED es de ÁNODO común, pon ANODO_COMUN en true.

const int PIN_R = 9;
const int PIN_G = 10;
const int PIN_B = 11;
const bool ANODO_COMUN = false;

int actual[3] = {0, 0, 0};
int destino[3] = {0, 0, 0};
String comando = "";

void escribir() {
  const int pines[3] = {PIN_R, PIN_G, PIN_B};
  for (int i = 0; i < 3; i++) analogWrite(pines[i], ANODO_COMUN ? 255 - actual[i] : actual[i]);
}

void procesar(String c) {
  c.trim();
  if (!c.startsWith("RGB:")) return;
  int a = c.indexOf(','), b = c.lastIndexOf(',');
  if (a < 0 || b <= a) return;
  destino[0] = constrain(c.substring(4, a).toInt(), 0, 255);
  destino[1] = constrain(c.substring(a + 1, b).toInt(), 0, 255);
  destino[2] = constrain(c.substring(b + 1).toInt(), 0, 255);
}

void setup() {
  pinMode(PIN_R, OUTPUT);
  pinMode(PIN_G, OUTPUT);
  pinMode(PIN_B, OUTPUT);
  Serial.begin(115200);
  escribir();
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { procesar(comando); comando = ""; }
    else if (ch != '\r') comando += ch;
  }
  // transición suave hacia el color pedido
  static unsigned long t = 0;
  if (millis() - t >= 4) {
    t = millis();
    bool cambio = false;
    for (int i = 0; i < 3; i++) {
      if (actual[i] != destino[i]) { actual[i] += actual[i] < destino[i] ? 1 : -1; cambio = true; }
    }
    if (cambio) escribir();
  }
}
