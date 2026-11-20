// Control por Bluetooth (HC-05) desde el celular.
// Usa cualquier app de "terminal Bluetooth serie" (ej. Serial Bluetooth Terminal en Android).
// Empareja el HC-05 (clave 1234 o 0000) y envía:
//   LUZ ON / LUZ OFF   -> relé (lámpara, ventilador…)
//   LED ON / LED OFF   -> LED de la placa
//   ESTADO             -> responde cómo está todo
// También acepta los mismos comandos por el monitor serie del PC.

#include <SoftwareSerial.h>

const int PIN_BT_RX = 10;  // conectado al TXD del HC-05
const int PIN_BT_TX = 11;  // al RXD del HC-05 (con divisor 1k/2k: el HC-05 es de 3.3V)
const int PIN_RELE = 7;
const int PIN_LED = 13;

SoftwareSerial bt(PIN_BT_RX, PIN_BT_TX);
String bufBt = "", bufPc = "";
bool luz = false, led = false;

void responder(const String &texto) {
  bt.println(texto);
  Serial.println(texto);
}

void procesar(String c) {
  c.trim();
  c.toUpperCase();
  if (c == "LUZ ON")       { luz = true;  responder("Luz encendida"); }
  else if (c == "LUZ OFF") { luz = false; responder("Luz apagada"); }
  else if (c == "LED ON")  { led = true;  responder("LED encendido"); }
  else if (c == "LED OFF") { led = false; responder("LED apagado"); }
  else if (c == "ESTADO")  responder(String("Luz: ") + (luz ? "ON" : "OFF") + " | LED: " + (led ? "ON" : "OFF"));
  else if (c.length())     responder("No entiendo: " + c);
  // muchos módulos de relé se activan con LOW
  digitalWrite(PIN_RELE, luz ? LOW : HIGH);
  digitalWrite(PIN_LED, led);
}

void leer(Stream &s, String &buf) {
  while (s.available()) {
    char ch = s.read();
    if (ch == '\n' || ch == '\r') { if (buf.length()) procesar(buf); buf = ""; }
    else buf += ch;
  }
}

void setup() {
  pinMode(PIN_RELE, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_RELE, HIGH);
  Serial.begin(9600);
  bt.begin(9600);
  responder("Listo. Comandos: LUZ ON/OFF, LED ON/OFF, ESTADO");
}

void loop() {
  leer(bt, bufBt);
  leer(Serial, bufPc);
}
