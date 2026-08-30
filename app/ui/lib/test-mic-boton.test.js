// Tests de la decisión pura del mousedown del botón de mic.
//
// Bug real que esto pinea: al sacar el guard `if(modo==='cont') return` de
// arriba de bargeIn() (design.md D4, tarea 1.5), el mousedown pasó a entrar
// SIEMPRE al flujo de captura push-to-talk (getUserMedia + MediaRecorder) —
// también en modo continuo, donde ya hay una captura corriendo
// (arrancarContinuo()). mouseup/mouseleave solo liberan esa captura cuando
// modo==='ptt', así que en continuo la segunda captura quedaba viva sin
// ningún release path hasta el timeout duro de 120s.
//
// La corrección: bargeIn() se llama en CUALQUIER modo (por eso el guard
// viejo, que volvía ANTES de bargeIn(), lo dejaba muerto en continuo), pero
// la captura push-to-talk solo arranca cuando el modo es 'ptt'. Esta es la
// pieza pura y testeable de esa decisión; el resto (getUserMedia,
// MediaRecorder) vive en index.html y no es testeable sin DOM.
const test = require('node:test')
const assert = require('node:assert')
const { debeArrancarCapturaPtt } = require('./mic-boton.js')

test('en modo continuo el mousedown NO arranca una captura push-to-talk (ya hay una corriendo)', () => {
  assert.strictEqual(debeArrancarCapturaPtt('cont'), false)
})

test('en modo push-to-talk el mousedown SÍ arranca la captura', () => {
  assert.strictEqual(debeArrancarCapturaPtt('ptt'), true)
})

test('cualquier otro modo desconocido tampoco arranca captura (fail-safe: nunca dos streams vivos)', () => {
  assert.strictEqual(debeArrancarCapturaPtt('texto'), false)
  assert.strictEqual(debeArrancarCapturaPtt(undefined), false)
})
