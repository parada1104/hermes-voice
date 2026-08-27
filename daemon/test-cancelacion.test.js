// Tests del registro de procesos de delegación (barge-in: cancelar lo que corre).
const test = require('node:test')
const assert = require('node:assert')
const { RegistroProcesos } = require('./procesos.js')

function procesoFalso() {
  const p = { matado: null, killed: false }
  p.kill = (sig) => { p.matado = sig; p.killed = true; return true }
  return p
}

test('cancelar mata el proceso registrado de esa sesión', () => {
  const r = new RegistroProcesos()
  const p = procesoFalso()
  r.registrar('s1', p)
  assert.strictEqual(r.cancelar('s1'), true)
  assert.strictEqual(p.matado, 'SIGTERM')
})

test('cancelar una sesión sin proceso devuelve false', () => {
  assert.strictEqual(new RegistroProcesos().cancelar('s1'), false)
})

test('liberar quita el proceso: cancelar después ya no hace nada', () => {
  const r = new RegistroProcesos()
  const p = procesoFalso()
  r.registrar('s1', p)
  r.liberar('s1', p)
  assert.strictEqual(r.cancelar('s1'), false)
  assert.strictEqual(p.killed, false)
})

test('liberar solo actúa si el proceso sigue siendo el registrado', () => {
  const r = new RegistroProcesos()
  const viejo = procesoFalso(), nuevo = procesoFalso()
  r.registrar('s1', viejo)
  r.registrar('s1', nuevo)
  r.liberar('s1', viejo)              // llega tarde el finally del anterior
  assert.strictEqual(r.cancelar('s1'), true)
  assert.strictEqual(nuevo.matado, 'SIGTERM')
})

test('cada sesión cancela solo lo suyo', () => {
  const r = new RegistroProcesos()
  const a = procesoFalso(), b = procesoFalso()
  r.registrar('s1', a); r.registrar('s2', b)
  r.cancelar('s1')
  assert.strictEqual(a.killed, true)
  assert.strictEqual(b.killed, false)
})

test('un proceso que lanza al matarlo no rompe la cancelación', () => {
  const r = new RegistroProcesos()
  r.registrar('s1', { kill(){ throw new Error('ESRCH') } })
  assert.strictEqual(r.cancelar('s1'), false)
  assert.strictEqual(r.cancelar('s1'), false)
})

/* ── Distinguir un SIGTERM nuestro de un SIGTERM del timeout ── */

test('marca la entrada como cancelada para que el catch lo sepa', () => {
  const r = new RegistroProcesos()
  const p = procesoFalso()
  r.registrar('s1', p)
  r.cancelar('s1')
  assert.strictEqual(r.fueCancelado('s1', p), true)
})

test('un proceso que murió por timeout NO figura como cancelado', () => {
  const r = new RegistroProcesos()
  const p = procesoFalso()
  r.registrar('s1', p)
  assert.strictEqual(r.fueCancelado('s1', p), false)
})

test('fueCancelado exige que sea ese mismo proceso, no solo la sesión', () => {
  const r = new RegistroProcesos()
  const viejo = procesoFalso(), nuevo = procesoFalso()
  r.registrar('s1', viejo)
  r.cancelar('s1')
  r.registrar('s1', nuevo)
  assert.strictEqual(r.fueCancelado('s1', nuevo), false)
  assert.strictEqual(r.fueCancelado('s1', viejo), true)
})

test('liberar borra también el rastro de cancelación', () => {
  const r = new RegistroProcesos()
  const p = procesoFalso()
  r.registrar('s1', p); r.cancelar('s1'); r.liberar('s1', p)
  assert.strictEqual(r.fueCancelado('s1', p), false)
})

test('cancelar sigue impidiendo que otro cancele dos veces el mismo proceso', () => {
  const r = new RegistroProcesos()
  const p = procesoFalso()
  r.registrar('s1', p)
  assert.strictEqual(r.cancelar('s1'), true)
  assert.strictEqual(r.cancelar('s1'), false)
})
