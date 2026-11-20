// Semáforo con botón peatonal.
// El semáforo de autos queda en verde hasta que alguien pulsa el botón;
// entonces pasa a amarillo, rojo, y deja cruzar durante unos segundos.
// Se puede probar sin placa en la pestaña Simulador (pulsa el botón "Pulsar").

const int PIN_ROJO = 10;
const int PIN_AMARILLO = 9;
const int PIN_VERDE = 8;
const int PIN_BOTON = 2;   // a GND, con la resistencia pull-up interna

const unsigned long TIEMPO_AMARILLO = 2000;
const unsigned long TIEMPO_CRUCE = 5000;
const unsigned long VERDE_MINIMO = 4000;  // los autos siempre tienen al menos este verde

enum Estado { VERDE, AMARILLO, ROJO };
Estado estado = VERDE;
unsigned long desde = 0;
bool pedido = false;

void luces(bool r, bool a, bool v) {
  digitalWrite(PIN_ROJO, r);
  digitalWrite(PIN_AMARILLO, a);
  digitalWrite(PIN_VERDE, v);
}

void cambiar(Estado nuevo) {
  estado = nuevo;
  desde = millis();
  if (nuevo == VERDE)    { luces(0, 0, 1); Serial.println("VERDE"); }
  if (nuevo == AMARILLO) { luces(0, 1, 0); Serial.println("AMARILLO"); }
  if (nuevo == ROJO)     { luces(1, 0, 0); Serial.println("ROJO - cruzan peatones"); }
}

void setup() {
  pinMode(PIN_ROJO, OUTPUT);
  pinMode(PIN_AMARILLO, OUTPUT);
  pinMode(PIN_VERDE, OUTPUT);
  pinMode(PIN_BOTON, INPUT_PULLUP);
  Serial.begin(9600);
  cambiar(VERDE);
}

void loop() {
  unsigned long t = millis() - desde;

  if (digitalRead(PIN_BOTON) == LOW && !pedido && estado == VERDE) {
    pedido = true;
    Serial.println("Peatón esperando");
  }

  switch (estado) {
    case VERDE:
      if (pedido && t >= VERDE_MINIMO) cambiar(AMARILLO);
      break;
    case AMARILLO:
      if (t >= TIEMPO_AMARILLO) cambiar(ROJO);
      break;
    case ROJO:
      // los últimos 1,5 s el rojo parpadea para avisar que se acaba el cruce
      if (t > TIEMPO_CRUCE - 1500) digitalWrite(PIN_ROJO, (t / 250) % 2);
      if (t >= TIEMPO_CRUCE) { pedido = false; cambiar(VERDE); }
      break;
  }
}
