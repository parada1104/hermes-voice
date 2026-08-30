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

/* ── Valores por defecto: se prueban por comportamiento, no por número ── */

const { POR_DEFECTO } = require('./vad.js')

test('una pausa de 1.2s para pensar NO cierra la frase', () => {
  // Robert: "muchas veces se me corta, no puedo hablar libremente". Con
  // silencioMs=900 cualquier duda al buscar la palabra cerraba el turno.
  const d = new DetectorVoz()
  const r = correr(d, [...voz(10), ...silencio(12), ...voz(10)])
  assert.strictEqual(r.accion, null, 'una pausa al pensar no es el final del turno')
})

test('una pausa larga de verdad SÍ cierra la frase', () => {
  const d = new DetectorVoz()
  const r = correr(d, [...voz(10), ...silencio(30)])
  assert.strictEqual(r.accion, 'cortar')
})

test('el techo deja dictar bastante más de 30 segundos', () => {
  // Verificado contra el oMLX: whisper-large-v3-turbo procesa long-form
  // (40.32s -> 3 segmentos cubriendo hasta 39.84), así que el techo no tiene
  // que quedarse en la ventana de 30s del modelo.
  assert.ok(POR_DEFECTO.maxMs > 30000, `maxMs ${POR_DEFECTO.maxMs} corta antes de los 30s`)
})

test('el silencio que cierra da margen para dudar, sin volverse latencia absurda', () => {
  assert.ok(POR_DEFECTO.silencioMs >= 1200, 'menos de 1.2s corta al que piensa')
  assert.ok(POR_DEFECTO.silencioMs <= 2000, 'más de 2s es latencia que paga cada turno')
})

/* ── Voz sostenida para barge-in (D4): dispara EN CUANTO hay voz sostenida,
   no espera al silencio como DetectorVoz. Ver design.md D4 y mediciones.md M3. ── */

const { MonitorVozSostenida } = require('./vad.js')

test('un solo frame de voz NO dispara el barge-in (pico aislado de 0.115 medido al arrancar el audio)', () => {
  const m = new MonitorVozSostenida()
  const disparo = m.procesar(0.115, 0)
  assert.strictEqual(disparo, false, 'un pico de una sola muestra no es el usuario hablando')
})

test('voz sostenida por >= minVozMs SÍ dispara el barge-in', () => {
  const m = new MonitorVozSostenida()
  let disparo = false, t = 0
  for (let i = 0; i < 5 && !disparo; i++) { disparo = m.procesar(0.2, t); t += 100 }
  assert.strictEqual(disparo, true, '400ms sostenidos de voz deben disparar el reflejo')
})

test('el disparo no llega si la voz se corta antes de sostenerse', () => {
  const m = new MonitorVozSostenida()
  assert.strictEqual(m.procesar(0.2, 0), false)
  assert.strictEqual(m.procesar(0.2, 100), false)      // 100ms sostenidos: no alcanza minVozMs (300ms)
  assert.strictEqual(m.procesar(0.001, 200), false)    // se corta la racha
  assert.strictEqual(m.procesar(0.2, 300), false)      // vuelve a arrancar de cero, no acumula lo anterior
})

test('el umbral de energía es el mismo que usa el cierre por silencio, salvo que se lo pisen', () => {
  const m = new MonitorVozSostenida()
  assert.strictEqual(m.procesar(0.001, 0), false, 'por debajo del umbral no cuenta como voz')
})
