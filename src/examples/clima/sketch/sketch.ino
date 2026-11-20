// Estación del clima: temperatura y humedad (DHT11) + nivel de luz (LDR).
// Envía una línea cada 2 s:  T:23.4;H:56;L:612
// La app de escritorio está en python/main.py (pulsa "Subir + Ejecutar").

#include <DHT.h>

const int PIN_DHT = 2;
const int PIN_LUZ = A0;   // LDR con resistencia de 10 kΩ a GND

DHT dht(PIN_DHT, DHT11);  // si tienes un DHT22, cambia DHT11 por DHT22

void setup() {
  Serial.begin(115200);
  dht.begin();
}

void loop() {
  float t = dht.readTemperature();
  float h = dht.readHumidity();
  int luz = analogRead(PIN_LUZ);

  if (isnan(t) || isnan(h)) {
    Serial.println("ERR:DHT");  // revisa el cable de datos del sensor
  } else {
    Serial.print("T:");
    Serial.print(t, 1);
    Serial.print(";H:");
    Serial.print(h, 0);
    Serial.print(";L:");
    Serial.println(luz);
  }
  delay(2000);  // el DHT11 no da más de una lectura cada ~1 s
}
