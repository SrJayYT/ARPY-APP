// Huerto inteligente: mide la humedad del suelo y riega con una bomba (relé).
// El riego automático funciona aunque el PC esté apagado.
//
// Envía cada segundo:  S:<0-1023>;P:<0|1>;A:<umbral %|OFF>
// Recibe:  PUMP:1 / PUMP:0   -> regar ahora / parar
//          AUTO:35           -> regar solo cuando baje del 35 %
//          AUTO:OFF          -> desactivar el riego automático

const int PIN_SUELO = A0;
const int PIN_BOMBA = 7;            // relé de la bomba de agua

// Calibración del sensor: lectura en tierra seca y recién regada
const int SECO = 1000;
const int MOJADO = 330;
const unsigned long RIEGO_MAX = 8000;      // nunca regar más de 8 s seguidos
const unsigned long PAUSA_ENTRE = 30000;   // y esperar 30 s antes de volver a regar

int umbral = 35;          // %; -1 = automático apagado
bool bomba = false;
unsigned long inicioRiego = 0, finRiego = 0;
String comando = "";

int porcentaje(int lectura) {
  return constrain(map(lectura, SECO, MOJADO, 0, 100), 0, 100);
}

void regar(bool on) {
  if (on == bomba) return;
  bomba = on;
  if (on) inicioRiego = millis(); else finRiego = millis();
  digitalWrite(PIN_BOMBA, on ? LOW : HIGH);   // la mayoría de relés se activan con LOW
}

void procesar(String c) {
  c.trim();
  if (c == "PUMP:1") regar(true);
  else if (c == "PUMP:0") regar(false);
  else if (c == "AUTO:OFF") umbral = -1;
  else if (c.startsWith("AUTO:")) umbral = constrain(c.substring(5).toInt(), 5, 90);
}

void setup() {
  pinMode(PIN_BOMBA, OUTPUT);
  digitalWrite(PIN_BOMBA, HIGH);
  Serial.begin(115200);
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { procesar(comando); comando = ""; }
    else if (ch != '\r') comando += ch;
  }

  int lectura = analogRead(PIN_SUELO);
  int pct = porcentaje(lectura);
  unsigned long ahora = millis();

  if (bomba && ahora - inicioRiego > RIEGO_MAX) regar(false);
  if (!bomba && umbral >= 0 && pct < umbral && ahora - finRiego > PAUSA_ENTRE) regar(true);
  if (bomba && umbral >= 0 && pct > umbral + 15) regar(false);

  static unsigned long ultimoEnvio = 0;
  if (ahora - ultimoEnvio >= 1000) {
    ultimoEnvio = ahora;
    Serial.print("S:");
    Serial.print(lectura);
    Serial.print(";P:");
    Serial.print(bomba ? 1 : 0);
    Serial.print(";A:");
    if (umbral < 0) Serial.println("OFF"); else Serial.println(umbral);
  }
}
