// Radar ultrasónico: un servo gira el sensor HC-SR04 de 15° a 165° y mide distancias.
// Envía "A:<ángulo>;D:<cm>" por serie: ábrelo en la pestaña Gráfica para verlo en vivo.

#include <Servo.h>

const int PIN_SERVO = 9;
const int PIN_TRIG = 7;
const int PIN_ECHO = 6;
const int PASO = 3;           // grados por medición
const int DIST_MAX = 200;     // cm

Servo servo;

int medirCm() {
  digitalWrite(PIN_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIG, LOW);
  // espera como máximo lo que tarda el eco a DIST_MAX
  unsigned long us = pulseIn(PIN_ECHO, HIGH, DIST_MAX * 58UL);
  if (us == 0) return DIST_MAX;
  return us / 58;
}

void barrer(int desde, int hasta) {
  int paso = desde < hasta ? PASO : -PASO;
  for (int a = desde; paso > 0 ? a <= hasta : a >= hasta; a += paso) {
    servo.write(a);
    delay(30);  // deja que el servo llegue
    Serial.print("A:");
    Serial.print(a);
    Serial.print(";D:");
    Serial.println(medirCm());
  }
}

void setup() {
  pinMode(PIN_TRIG, OUTPUT);
  pinMode(PIN_ECHO, INPUT);
  servo.attach(PIN_SERVO);
  Serial.begin(115200);
}

void loop() {
  barrer(15, 165);
  barrer(165, 15);
}
