/**
 * Guarda de turno para la cola de audio del TTS (`playWav`/`detenerAudio` en
 * index.html).
 *
 * Cada frase llega marcada con el turno que la generó. `playWav` ya
 * descartaba una frase de un turno más VIEJO que el actual (`t < audioTurnoActual`).
 * Lo que faltaba (design.md D4) es que el barge-in AVANCE el turno actual al
 * cortar el audio: sin eso, una frase todavía en vuelo para el turno recién
 * interrumpido seguía pasando el guard — llegaba después del corte pero con
 * el mismo número de turno, nunca "más vieja" — y terminaba sonando igual.
 *
 * Módulo puro (mismo patrón que vad.js/parcial.js): index.html lo carga con
 * `<script src>` y lo usa desde `playWav`/`nextAudio`/`detenerAudio`; los
 * tests lo importan con `require`.
 */
'use strict'

// ¿la frase del turno `turno` todavía tiene derecho a sonar contra el turno
// que está corriendo? Sin número de turno (0/undefined, ej. fallback REST)
// siempre es vigente: nunca hubo barge-in que la pudiera haber invalidado.
function turnoVigente(turno, turnoActual) {
  return !turno || turno >= turnoActual
}

// ¿el turno que llega es más nuevo que el que se venía reproduciendo? Si sí,
// arrancó un turno distinto y hay que vaciar lo que quedaba en cola del
// anterior (no pisarlo, descartarlo).
function esTurnoNuevo(turno, turnoActual) {
  return !!turno && turno > turnoActual
}

// El turno siguiente tras un barge-in. detenerAudio() llama esto para que
// cualquier frase del turno que se estaba reproduciendo — ya en cola o
// llegando después — deje de estar vigente a partir de acá.
function siguienteTurno(turnoActual) {
  return turnoActual + 1
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { turnoVigente, esTurnoNuevo, siguienteTurno }
}
