// Tests del extractor de la respuesta del CLI de Hermes.
// El oneshot `-z` devuelve texto limpio, pero el subcomando `chat` (necesario
// para adjuntar imágenes) decora stdout con cajas de razonamiento y un pie de
// sesión, incluso con -Q. Hay que quedarse solo con la respuesta.
const test = require('node:test')
const assert = require('node:assert')
const { extraerRespuestaHermes } = require('./salida-cli.js')

const CON_CAJAS = `
┌─ Reasoning ──────────────────────────────────────────────────────────────────┐
El usuario pide algo breve. Solo cumplo.
└──────────────────────────────────────────────────────────────────────────────┘

╭─ ⚕ Hermes ───────────────────────────────────────────────────────────────────╮
VI LA IMAGEN
╰──────────────────────────────────────────────────────────────────────────────╯

Resume this session with:
  hermes --resume 20260825_143219_ed9c34 -p entrenador

Session:        20260825_143219_ed9c34
Duration:       13s
Messages:       2 (1 user, 0 tool calls)
`

test('extrae solo el contenido de la caja de Hermes', () => {
  assert.strictEqual(extraerRespuestaHermes(CON_CAJAS), 'VI LA IMAGEN')
})

test('descarta el razonamiento y el pie de sesión', () => {
  const out = extraerRespuestaHermes(CON_CAJAS)
  assert.ok(!out.includes('Reasoning'))
  assert.ok(!out.includes('Resume this session'))
  assert.ok(!out.includes('Duration'))
})

test('conserva una respuesta de varias líneas', () => {
  const s = `╭─ ⚕ Hermes ───╮
Primera línea.
Segunda línea.
╰──────────────╯`
  assert.strictEqual(extraerRespuestaHermes(s), 'Primera línea.\nSegunda línea.')
})

test('la salida limpia del oneshot -z pasa intacta', () => {
  assert.strictEqual(extraerRespuestaHermes('Respuesta directa del agente.'), 'Respuesta directa del agente.')
})

test('sin caja de Hermes, quita el razonamiento pero no pierde el resto', () => {
  const s = `┌─ Reasoning ───┐
pensando
└───────────────┘
La respuesta real.`
  assert.strictEqual(extraerRespuestaHermes(s), 'La respuesta real.')
})

test('sin caja de Hermes, quita también el pie de sesión', () => {
  assert.strictEqual(extraerRespuestaHermes('Texto útil.\n\nSession:        20260825_1_a\nDuration:       13s\nMessages:       2 (1 user, 0 tool calls)'), 'Texto útil.')
})

test('una respuesta que menciona "Session:" dentro de la caja no se recorta', () => {
  const s = `╭─ ⚕ Hermes ───╮
Session: revisá el ticket.
╰──────────────╯`
  assert.strictEqual(extraerRespuestaHermes(s), 'Session: revisá el ticket.')
})

test('entrada vacía devuelve cadena vacía', () => {
  assert.strictEqual(extraerRespuestaHermes(''), '')
  assert.strictEqual(extraerRespuestaHermes(null), '')
})

test('varias cajas de razonamiento se eliminan todas', () => {
  const s = '┌─ Reasoning ─┐\na\n└─────────────┘\ntexto\n┌─ Reasoning ─┐\nb\n└─────────────┘\nfinal'
  assert.strictEqual(extraerRespuestaHermes(s), 'texto\nfinal')
})

/* ── Caja de razonamiento SIN cerrar: la deja así `chat --image` con -Q ── */

const REASONING_ABIERTO = `
┌─ Reasoning ──────────────────────────────────────────────────────────────────┐
The user is asking me to respond only "VI LA IMAGEN". This is a simple instruction.

I should comply and only say that. No tool calls needed.

VI LA IMAGEN
`

test('con la caja sin cerrar se queda con el último bloque, que es la respuesta', () => {
  assert.strictEqual(extraerRespuestaHermes(REASONING_ABIERTO), 'VI LA IMAGEN')
})

test('avisa de la fuga para que no pase inadvertida', () => {
  const avisos = []
  extraerRespuestaHermes(REASONING_ABIERTO, { onFuga: m => avisos.push(m) })
  assert.strictEqual(avisos.length, 1)
})

test('no avisa cuando la salida viene limpia', () => {
  const avisos = []
  extraerRespuestaHermes('Respuesta limpia.', { onFuga: m => avisos.push(m) })
  assert.strictEqual(avisos.length, 0)
})

test('nunca devuelve el marco ASCII como si fuera la respuesta', () => {
  const out = extraerRespuestaHermes(REASONING_ABIERTO)
  assert.ok(!out.includes('┌'))
  assert.ok(!out.includes('Reasoning'))
})

test('si tras el razonamiento no queda nada, no inventa respuesta', () => {
  assert.strictEqual(extraerRespuestaHermes('┌─ Reasoning ─┐\nsolo pensamiento'), '')
})
