// Tests del piso de energía que protege al STT de transcribir silencio.
//
// Whisper NO avisa cuando alucina: medido contra el oMLX real, un wav de
// silencio absoluto devuelve " Gracias." con `no_speech_prob = 7.7e-11` — o sea
// máxima confianza en que hay habla donde no hay nada. Ni `no_speech_prob` ni
// `avg_logprob` sirven de filtro. Lo único confiable es mirar el audio que
// llegó ANTES de creerle al modelo.
//
// Se mide por ventanas de 100 ms (igual que el VAD del browser) y no con un RMS
// global: un blob largo con una palabra corta tiene RMS global bajísimo y un
// piso global lo descartaría, comiéndose un turno real.
const test = require('node:test')
const assert = require('node:assert')

const { hayVozReal, msDeVoz, UMBRAL_VOZ, MIN_VOZ_MS } = require('./audio-energia.js')

/**
 * Arma un wav PCM16 mono con los tramos pedidos.
 * `tramos` = [{ ms, amplitud }] con amplitud en 0..1.
 */
function wav(tramos, sampleRate = 16000) {
  const total = tramos.reduce((n, t) => n + Math.round(sampleRate * t.ms / 1000), 0)
  const datos = Buffer.alloc(total * 2)
  let i = 0
  for (const tramo of tramos) {
    const n = Math.round(sampleRate * tramo.ms / 1000)
    for (let k = 0; k < n; k++) {
      // Onda cuadrada: su RMS es exactamente la amplitud, así el test dice lo
      // que quiere decir sin depender de la forma de onda.
      const v = Math.round((k % 2 ? tramo.amplitud : -tramo.amplitud) * 32767)
      datos.writeInt16LE(v, i * 2)
      i++
    }
  }
  const cab = Buffer.alloc(44)
  cab.write('RIFF', 0); cab.writeUInt32LE(36 + datos.length, 4); cab.write('WAVE', 8)
  cab.write('fmt ', 12); cab.writeUInt32LE(16, 16); cab.writeUInt16LE(1, 20)
  cab.writeUInt16LE(1, 22)                      // mono
  cab.writeUInt32LE(sampleRate, 24)
  cab.writeUInt32LE(sampleRate * 2, 28)
  cab.writeUInt16LE(2, 32); cab.writeUInt16LE(16, 34)   // PCM16
  cab.write('data', 36); cab.writeUInt32LE(datos.length, 40)
  return Buffer.concat([cab, datos])
}

const VOZ = 0.06        // p50 medido de la voz real de Robert: 0.05585
const AMBIENTE = 0.004  // max medido de su sala en silencio: 0.00392

/* ── msDeVoz ── */

test('cuenta los ms por encima del umbral, no el largo del blob', () => {
  const b = wav([{ ms: 500, amplitud: VOZ }, { ms: 2000, amplitud: 0 }])
  const ms = msDeVoz(b)
  assert.ok(ms >= 400 && ms <= 600, `esperaba ~500 ms de voz, dio ${ms}`)
})

test('el ruido de sala real no cuenta como voz', () => {
  assert.strictEqual(msDeVoz(wav([{ ms: 3000, amplitud: AMBIENTE }])), 0)
})

/* ── hayVozReal ── */

test('silencio absoluto NO tiene voz (es el caso que alucina " Gracias.")', () => {
  assert.strictEqual(hayVozReal(wav([{ ms: 2000, amplitud: 0 }])), false)
})

test('el ruido de sala en silencio NO tiene voz', () => {
  assert.strictEqual(hayVozReal(wav([{ ms: 4000, amplitud: AMBIENTE }])), false)
})

test('una frase normal SÍ tiene voz', () => {
  assert.strictEqual(hayVozReal(wav([{ ms: 1500, amplitud: VOZ }])), true)
})

test('una palabra corta perdida en un blob largo SÍ tiene voz', () => {
  // El caso que mata a un piso de RMS global: 300 ms de voz dentro de 25 s.
  // El RMS global daría ~0.0066 (parece silencio) pero la ventana ve la voz.
  const b = wav([
    { ms: 12000, amplitud: 0 },
    { ms: 300, amplitud: VOZ },
    { ms: 12700, amplitud: 0 },
  ])
  assert.strictEqual(hayVozReal(b), true, 'no se puede comer un turno real por ser largo')
})

test('un golpe suelto más corto que el mínimo NO es una frase', () => {
  assert.strictEqual(hayVozReal(wav([{ ms: 60, amplitud: VOZ }, { ms: 2000, amplitud: 0 }])), false)
})

/* ── fail-open: ante la duda, transcribir ── */

test('un buffer que no es wav se deja pasar (nunca comerse un turno por no poder medirlo)', () => {
  assert.strictEqual(hayVozReal(Buffer.from('no soy un wav para nada')), true)
})

test('un wav que no es PCM16 mono se deja pasar', () => {
  const b = wav([{ ms: 1000, amplitud: VOZ }])
  b.writeUInt16LE(2, 22)   // lo marca como estéreo: ya no sabemos medirlo
  assert.strictEqual(hayVozReal(b), true)
})

test('un buffer vacío no tiene voz', () => {
  assert.strictEqual(hayVozReal(Buffer.alloc(0)), false)
})

/* ── el servidor nunca es más estricto que el cliente ── */

test('el umbral del servidor es más permisivo que el del VAD del browser', () => {
  // El browser corta con umbral 0.02 / minVozMs 300. Si el servidor fuera más
  // estricto descartaría audio que el cliente mandó a propósito.
  assert.ok(UMBRAL_VOZ < 0.02, `umbral ${UMBRAL_VOZ} debe ser menor a 0.02`)
  assert.ok(MIN_VOZ_MS < 300, `minVozMs ${MIN_VOZ_MS} debe ser menor a 300`)
})

test('el umbral deja margen sobre el ruido de sala medido', () => {
  assert.ok(UMBRAL_VOZ > AMBIENTE * 2, `umbral ${UMBRAL_VOZ} muy cerca del ruido ${AMBIENTE}`)
})
