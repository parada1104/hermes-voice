// Tests del reflejo de barge-in del lado cliente (design.md D4).
//
// La pieza pura que se testea acá es la guarda de turno de audio
// (turno-audio.js): una vez que el barge-in avanza `audioTurnoActual`,
// ninguna frase del turno interrumpido puede volver a sonar — ni la que ya
// estaba en cola, ni una que llegue DESPUÉS del corte. Antes de este cambio,
// `detenerAudio()` (index.html) vaciaba la cola de audio pero nunca tocaba
// el contador, así que una frase todavía en vuelo para el turno viejo se
// colaba igual (mirra el guard de `playWav`, `index.html:1031`).
//
// El resto del reflejo (AudioContext, MediaStream, MediaRecorder) vive en
// index.html y no es testeable sin DOM; esta guarda es la parte pura que
// sí lo es, mismo patrón que vad.js/parcial.js.
const test = require('node:test')
const assert = require('node:assert')
const { turnoVigente, esTurnoNuevo, siguienteTurno } = require('./turno-audio.js')

test('una frase del turno en curso está vigente', () => {
  assert.strictEqual(turnoVigente(1, 1), true)
})

test('una frase de un turno más nuevo está vigente (adelanta el reloj)', () => {
  assert.strictEqual(turnoVigente(2, 1), true)
})

test('una frase sin número de turno (fallback REST) siempre está vigente', () => {
  assert.strictEqual(turnoVigente(0, 5), true)
})

test('tras el bump del barge-in, la frase del turno interrumpido queda descartada', () => {
  // Turno 1 se estaba reproduciendo cuando el usuario interrumpe.
  let turnoActual = 1
  assert.strictEqual(turnoVigente(1, turnoActual), true, 'antes del barge-in seguía vigente')
  turnoActual = siguienteTurno(turnoActual)   // esto es lo que detenerAudio() hace ahora (tarea 1.4)
  assert.strictEqual(turnoVigente(1, turnoActual), false, 'después del bump el turno viejo ya no puede sonar')
})

test('una frase que llega DESPUÉS del bump para el turno interrumpido también se descarta', () => {
  // Reproduce el bug real: detenerAudio() vaciaba la cola pero nunca avanzaba
  // el contador, así que una frase todavía en vuelo para el turno viejo se
  // reproducía igual una vez que llegaba.
  let turnoActual = 3
  turnoActual = siguienteTurno(turnoActual)   // barge-in a mitad del turno 3
  for (const t of [3, 3, 3]) {
    assert.strictEqual(turnoVigente(t, turnoActual), false, 'ninguna frase tardía del turno interrumpido puede sonar')
  }
})

test('esTurnoNuevo detecta cuándo hay que vaciar la cola del turno anterior', () => {
  assert.strictEqual(esTurnoNuevo(2, 1), true)
  assert.strictEqual(esTurnoNuevo(1, 1), false)
  assert.strictEqual(esTurnoNuevo(0, 1), false)
})
