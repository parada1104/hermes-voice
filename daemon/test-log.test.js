// Tests del log estructurado por turno. Sin esto la sesión no se puede auditar
// a posteriori: fue exactamente el agujero del turno sin job.
const test = require('node:test')
const assert = require('node:assert')
const { formatearEvento, crearLogger } = require('./log.js')

test('incluye timestamp, evento y campos en una sola línea', () => {
  const linea = formatearEvento({ ts: 1787681298178, evento: 'turno.inicio', sesionId: 'choach', turnId: 6, modo: 'voz' })
  assert.ok(linea.includes('turno.inicio'))
  assert.ok(linea.includes('sesionId=choach'))
  assert.ok(linea.includes('turnId=6'))
  assert.ok(linea.includes('modo=voz'))
  assert.strictEqual(linea.includes('\n'), false)
})

test('entrecomilla los valores con espacios para que la línea siga siendo parseable', () => {
  const linea = formatearEvento({ evento: 'x', pedido: 'lista los Pokemon' })
  assert.ok(linea.includes('pedido="lista los Pokemon"'))
})

test('recorta los valores largos para que un pedido no inunde el log', () => {
  const linea = formatearEvento({ evento: 'x', pedido: 'a'.repeat(500) })
  assert.ok(linea.length < 400)
  assert.ok(linea.includes('…'))
})

test('omite los campos vacíos pero conserva el cero y el false', () => {
  const linea = formatearEvento({ evento: 'x', vacio: '', nulo: null, indefinido: undefined, cero: 0, falso: false })
  assert.ok(!linea.includes('vacio'))
  assert.ok(!linea.includes('nulo'))
  assert.ok(!linea.includes('indefinido'))
  assert.ok(linea.includes('cero=0'))
  assert.ok(linea.includes('falso=false'))
})

test('aplana el salto de línea de un mensaje de error', () => {
  const linea = formatearEvento({ evento: 'x', error: 'fallo\nen dos líneas' })
  assert.strictEqual(linea.includes('\n'), false)
  assert.ok(linea.includes('en dos líneas') || linea.includes('en dos l'))
})

test('el logger escribe por la salida inyectada', () => {
  const salida = []
  const log = crearLogger({ escribir: l => salida.push(l) })
  log('turno.inicio', { sesionId: 's1', turnId: 1 })
  assert.strictEqual(salida.length, 1)
  assert.ok(salida[0].includes('turno.inicio'))
})

test('un fallo de la salida no rompe el turno', () => {
  const log = crearLogger({ escribir: () => { throw new Error('EPIPE') } })
  assert.doesNotThrow(() => log('turno.inicio', { sesionId: 's1' }))
})

test('el logger silenciado no escribe nada', () => {
  const salida = []
  const log = crearLogger({ escribir: l => salida.push(l), activo: false })
  log('turno.inicio', { sesionId: 's1' })
  assert.strictEqual(salida.length, 0)
})
