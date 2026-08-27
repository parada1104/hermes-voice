// Tests del aviso hablado durante una espera larga.
//
// Idea de Robert: no todo turno genera voz, pero cuando una delegación tarda
// mucho sí conviene que diga algo — el latido visual no sirve si no estás
// mirando la pantalla. Y no puede repetirse cada cinco segundos.
const test = require('node:test')
const assert = require('node:assert')
const { avisoDeEspera, FRASES_ESPERA } = require('./espera.js')

test('no dice nada al principio: la espera corta no se anuncia', () => {
  for (const s of [0, 5, 15, 29]) assert.strictEqual(avisoDeEspera(s, 0), null, `${s}s`)
})

test('avisa al pasar el primer umbral', () => {
  const a = avisoDeEspera(30, 0)
  assert.ok(a && a.frase, 'debe avisar a los 30s')
  assert.strictEqual(a.desde, 30)
})

test('no repite hasta el siguiente umbral', () => {
  assert.strictEqual(avisoDeEspera(45, 30), null)
  assert.strictEqual(avisoDeEspera(59, 30), null)
})

test('vuelve a avisar al siguiente umbral, sin repetir la frase', () => {
  const a = avisoDeEspera(30, 0)
  const b = avisoDeEspera(90, 30)
  assert.ok(b)
  assert.notStrictEqual(b.frase, a.frase, 'no puede decir siempre lo mismo')
})

test('las frases mencionan el tiempo cuando la espera ya es larga', () => {
  const c = avisoDeEspera(300, 180)
  assert.ok(c && /minuto/i.test(c.frase), 'a los 5 minutos debe reconocerlo: ' + (c && c.frase))
})

test('hay frases suficientes para una espera muy larga', () => {
  assert.ok(FRASES_ESPERA.length >= 3)
})

test('no revienta con entradas raras', () => {
  assert.strictEqual(avisoDeEspera(-5, 0), null)
  assert.strictEqual(avisoDeEspera(null, null), null)
})
