// Tests del detector de voz que decide CUÁNDO cortar la captura.
//
// El modo continuo cortaba a los 3000 ms fijos, sin mirar si Robert seguía
// hablando: cualquier frase de más de tres segundos llegaba partida a mitad de
// palabra. Esto decide por silencio sostenido, no por reloj.
const test = require('node:test')
const assert = require('node:assert')
const { DetectorVoz } = require('./vad.js')

// Alimenta el detector con una secuencia de energías, 100 ms por muestra.
function correr(det, muestras, pasoMs = 100) {
  let t = 0, ultima = null
  for (const e of muestras) { ultima = det.procesar(e, t); t += pasoMs; if (ultima.accion) break }
  return ultima
}
const silencio = (n) => Array(n).fill(0.001)
const voz = (n) => Array(n).fill(0.2)

test('no corta mientras se sigue hablando', () => {
  const d = new DetectorVoz({ silencioMs: 800, maxMs: 30000 })
  const r = correr(d, voz(100))   // 10 segundos hablando
  assert.strictEqual(r.accion, null, 'no debe cortar a los 3s como antes')
})

test('corta tras el silencio sostenido, no antes', () => {
  const d = new DetectorVoz({ silencioMs: 800, maxMs: 30000 })
  const r = correr(d, [...voz(20), ...silencio(5)])   // 2s voz + 500ms silencio
  assert.strictEqual(r.accion, null, '500ms de pausa no cierran una frase')
  const r2 = correr(new DetectorVoz({ silencioMs: 800, maxMs: 30000 }), [...voz(20), ...silencio(10)])
  assert.strictEqual(r2.accion, 'cortar')
})

test('una pausa breve a mitad de frase no la parte', () => {
  const d = new DetectorVoz({ silencioMs: 800, maxMs: 30000 })
  const r = correr(d, [...voz(10), ...silencio(4), ...voz(10), ...silencio(4), ...voz(10)])
  assert.strictEqual(r.accion, null, 'las pausas al pensar no deben cortar')
})

test('descarta una captura sin voz: no se manda silencio al STT', () => {
  const d = new DetectorVoz({ silencioMs: 800, maxMs: 3000 })
  const r = correr(d, silencio(40))
  assert.strictEqual(r.accion, 'descartar')
})

test('descarta un golpe de ruido demasiado corto', () => {
  const d = new DetectorVoz({ silencioMs: 500, maxMs: 30000, minVozMs: 400 })
  const r = correr(d, [...voz(2), ...silencio(8)])   // 200ms de ruido
  assert.strictEqual(r.accion, 'descartar')
})

test('el techo de seguridad corta un monólogo eterno', () => {
  const d = new DetectorVoz({ silencioMs: 5000, maxMs: 2000 })
  const r = correr(d, voz(50))
  assert.strictEqual(r.accion, 'cortar')
})

test('informa si está oyendo voz, para que la UI lo muestre', () => {
  const d = new DetectorVoz({ silencioMs: 800, maxMs: 30000 })
  assert.strictEqual(d.procesar(0.001, 0).estado, 'silencio')
  assert.strictEqual(d.procesar(0.2, 100).estado, 'hablando')
})

test('reiniciar lo deja listo para la próxima captura', () => {
  const d = new DetectorVoz({ silencioMs: 500, maxMs: 30000 })
  correr(d, [...voz(10), ...silencio(8)])
  d.reiniciar()
  assert.strictEqual(d.procesar(0.2, 0).accion, null)
  assert.strictEqual(d.hablo, true)
})

test('el umbral se puede subir para ambientes ruidosos', () => {
  const d = new DetectorVoz({ umbral: 0.5, silencioMs: 500, maxMs: 30000 })
  assert.strictEqual(d.procesar(0.2, 0).estado, 'silencio', '0.2 queda por debajo de 0.5')
})

/* ── Energía RMS ── */

const { energiaRms } = require('./vad.js')

test('el silencio digital da energía cero', () => {
  assert.strictEqual(energiaRms(new Float32Array(128)), 0)
})

test('una señal fuerte da energía alta', () => {
  assert.ok(energiaRms(Float32Array.from({ length: 128 }, (_, i) => Math.sin(i))) > 0.5)
})

test('no revienta con entrada vacía', () => {
  assert.strictEqual(energiaRms(null), 0)
  assert.strictEqual(energiaRms([]), 0)
})
