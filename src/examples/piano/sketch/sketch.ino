// Piano: la app de escritorio manda notas y el zumbador las toca.
// Recibe:  N:440   -> toca 440 Hz hasta nueva orden
//          X       -> silencio
// Zumbador pasivo en D8 (uno activo solo hace "bip", no cambia de nota).

const int PIN_ZUMBADOR = 8;
const int PIN_LED = 13;   // se enciende mientras suena una nota
String comando = "";

void procesar(String c) {
  c.trim();
  if (c == "X") {
    noTone(PIN_ZUMBADOR);
    digitalWrite(PIN_LED, LOW);
  } else if (c.startsWith("N:")) {
    unsigned int f = c.substring(2).toInt();
    if (f >= 31 && f <= 8000) {
      tone(PIN_ZUMBADOR, f);
      digitalWrite(PIN_LED, HIGH);
    }
  }
}

void setup() {
  pinMode(PIN_LED, OUTPUT);
  Serial.begin(115200);
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { procesar(comando); comando = ""; }
    else if (ch != '\r') comando += ch;
  }
}
