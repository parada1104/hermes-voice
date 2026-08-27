// Tests de la ventana de conversación que ve la capa.
//
// La capa debe poder ACUMULAR y delegar el lote cuando Robert confirma que
// terminó — eso es lo que la diferencia de un router que delega siempre. Con
// una ventana fija de 8 mensajes eso era imposible: dictar 6 Pokémon son 12
// mensajes, y los primeros se caían antes de poder delegarlos.
const test = require('node:test')
const assert = require('node:assert')
const { ventanaConversacion } = require('./ventana.js')

const hilo = (n, texto = 'x') => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `${texto}${i}` }))

test('un dictado largo entra entero en la ventana', () => {
  const v = ventanaConversacion(hilo(14))
  assert.strictEqual(v.length, 14, 'los 14 mensajes deben sobrevivir')
  assert.strictEqual(v[0].content, 'x0', 'incluido el primero del lote')
})

test('respeta el presupuesto de caracteres descartando lo más viejo', () => {
  const largo = [{ role: 'user', text: 'A'.repeat(5000) }, { role: 'user', text: 'B'.repeat(5000) }, { role: 'user', text: 'C' }]
  const v = ventanaConversacion(largo, { maxCaracteres: 5200 })
  assert.ok(v.length < 3, 'algo se descarta')
  assert.strictEqual(v.at(-1).content, 'C', 'lo más reciente nunca se pierde')
})

test('mantiene el orden cronológico', () => {
  const v = ventanaConversacion(hilo(6))
  assert.deepStrictEqual(v.map(m => m.content), ['x0', 'x1', 'x2', 'x3', 'x4', 'x5'])
})

test('traduce los roles al formato del modelo', () => {
  const v = ventanaConversacion([{ role: 'user', text: 'a' }, { role: 'assistant', text: 'b' }, { role: 'otro', text: 'c' }])
  assert.deepStrictEqual(v.map(m => m.role), ['user', 'assistant', 'assistant'])
})

test('el tope de mensajes evita que una sesión eterna infle el prompt', () => {
  assert.ok(ventanaConversacion(hilo(500)).length <= 40)
})

test('descarta mensajes sin texto', () => {
  const v = ventanaConversacion([{ role: 'user', text: '' }, { role: 'user', text: null }, { role: 'user', text: 'ok' }])
  assert.deepStrictEqual(v.map(m => m.content), ['ok'])
})

test('un hilo vacío no revienta', () => {
  assert.deepStrictEqual(ventanaConversacion([]), [])
  assert.deepStrictEqual(ventanaConversacion(null), [])
})

test('un único mensaje enorme se conserva recortado, no se pierde el turno', () => {
  const v = ventanaConversacion([{ role: 'user', text: 'Z'.repeat(20000) }], { maxCaracteres: 1000 })
  assert.strictEqual(v.length, 1)
  assert.ok(v[0].content.length <= 1000)
})
