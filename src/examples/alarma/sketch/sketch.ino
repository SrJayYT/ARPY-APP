// Alarma con sensor de movimiento PIR.
// Comandos por el monitor serie: ARMAR, DESARMAR, ESTADO.
// En el simulador: pulsa "Detectar" en el sensor PIR para simular movimiento.

const int PIN_PIR = 2;
const int PIN_ZUMBADOR = 8;
const int PIN_LED = 13;

const unsigned long DURACION_ALARMA = 8000;

bool armada = true;
bool sonando = false;
unsigned long inicioAlarma = 0;
String comando = "";

void setup() {
  pinMode(PIN_PIR, INPUT);
  pinMode(PIN_ZUMBADOR, OUTPUT);
  pinMode(PIN_LED, OUTPUT);
  Serial.begin(9600);
  Serial.println("Alarma lista (ARMADA). Comandos: ARMAR, DESARMAR, ESTADO");
}

void procesar(String c) {
  c.trim();
  c.toUpperCase();
  if (c == "ARMAR") { armada = true; Serial.println("ARMADA"); }
  else if (c == "DESARMAR") { armada = false; sonando = false; noTone(PIN_ZUMBADOR); Serial.println("DESARMADA"); }
  else if (c == "ESTADO") Serial.println(armada ? "ARMADA" : "DESARMADA");
}

void loop() {
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') { procesar(comando); comando = ""; }
    else if (ch != '\r') comando += ch;
  }

  if (armada && !sonando && digitalRead(PIN_PIR) == HIGH) {
    sonando = true;
    inicioAlarma = millis();
    Serial.println("MOVIMIENTO DETECTADO");
  }

  if (sonando) {
    unsigned long t = millis() - inicioAlarma;
    // sirena de dos tonos y LED parpadeando
    tone(PIN_ZUMBADOR, (t / 400) % 2 ? 880 : 660);
    digitalWrite(PIN_LED, (t / 200) % 2);
    if (t > DURACION_ALARMA) {
      sonando = false;
      noTone(PIN_ZUMBADOR);
      digitalWrite(PIN_LED, LOW);
      Serial.println("Alarma en espera");
    }
  } else {
    // armada: un destello corto cada 2 s
    digitalWrite(PIN_LED, armada && (millis() % 2000) < 60);
  }
}
