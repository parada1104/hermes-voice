// Tests del parseo incremental de la respuesta de Cerebras (stream:true) y del
// troceado en frases para arrancar el TTS antes de que termine el modelo.
const test = require('node:test')
const assert = require('node:assert')
const { parsearSSE, acumularDelta, frasesNuevas, mensajeDesdeAcumulado, restoNoHablado } = require('./streaming.js')

/* ── SSE ── */

test('extrae eventos completos y devuelve el resto parcial', () => {
  const { eventos, resto } = parsearSSE('data: {"a":1}\n\ndata: {"b":2}\n\ndata: {"c"', '')
  assert.deepStrictEqual(eventos, [{ a: 1 }, { b: 2 }])
  assert.strictEqual(resto, 'data: {"c"')
})

test('une un evento partido entre dos chunks', () => {
  const a = parsearSSE('data: {"conte', '')
  assert.deepStrictEqual(a.eventos, [])
  const b = parsearSSE('nt":"hola"}\n\n', a.resto)
  assert.deepStrictEqual(b.eventos, [{ content: 'hola' }])
})

test('ignora [DONE] y líneas que no son data', () => {
  const { eventos } = parsearSSE(': keep-alive\n\ndata: {"a":1}\n\ndata: [DONE]\n\n', '')
  assert.deepStrictEqual(eventos, [{ a: 1 }])
})

test('un data malformado no tumba el parseo del resto', () => {
  const { eventos } = parsearSSE('data: no-json\n\ndata: {"a":1}\n\n', '')
  assert.deepStrictEqual(eventos, [{ a: 1 }])
})

/* ── Acumulación de deltas ── */

test('concatena el contenido de texto en orden', () => {
  let acc = {}
  for (const c of ['Claro', ', ', 'señor']) acc = acumularDelta(acc, { content: c })
  assert.strictEqual(acc.content, 'Claro, señor')
})

test('arma un tool call troceado por índice', () => {
  let acc = {}
  acc = acumularDelta(acc, { tool_calls: [{ index: 0, id: 'c1', function: { name: 'delegar_a_hermes', arguments: '{"pedi' } }] })
  acc = acumularDelta(acc, { tool_calls: [{ index: 0, function: { arguments: 'do":"hola"}' } }] })
  assert.strictEqual(acc.tool_calls[0].id, 'c1')
  assert.strictEqual(acc.tool_calls[0].function.name, 'delegar_a_hermes')
  assert.strictEqual(acc.tool_calls[0].function.arguments, '{"pedido":"hola"}')
})

test('mantiene separados dos tool calls paralelos', () => {
  let acc = {}
  acc = acumularDelta(acc, { tool_calls: [{ index: 0, function: { name: 'a', arguments: '{}' } }, { index: 1, function: { name: 'b', arguments: '{}' } }] })
  assert.deepStrictEqual(acc.tool_calls.map(t => t.function.name), ['a', 'b'])
})

test('un delta vacío no altera lo acumulado', () => {
  const acc = acumularDelta({ content: 'hola' }, {})
  assert.strictEqual(acc.content, 'hola')
})

test('mensajeDesdeAcumulado produce la forma que espera normalizarToolCall', () => {
  const msg = mensajeDesdeAcumulado({ content: 'texto', tool_calls: [{ index: 0, id: 'c1', function: { name: 'x', arguments: '{}' } }] })
  assert.strictEqual(msg.role, 'assistant')
  assert.strictEqual(msg.content, 'texto')
  assert.strictEqual(msg.tool_calls[0].type, 'function')
  assert.strictEqual(msg.tool_calls[0].function.name, 'x')
})

test('sin tool calls el mensaje no lleva el campo', () => {
  assert.strictEqual(mensajeDesdeAcumulado({ content: 'solo texto' }).tool_calls, undefined)
})

/* ── Troceado en frases para TTS anticipado ── */

test('emite solo frases ya cerradas, nunca la cola a medias', () => {
  const r = frasesNuevas('Claro, señor. Voy a revisarlo', 0)
  assert.deepStrictEqual(r.frases, ['Claro, señor.'])
  assert.strictEqual(r.consumido, 'Claro, señor.'.length)
})

test('no re-emite lo ya consumido', () => {
  const primera = frasesNuevas('Uno. Dos. Tres', 0)
  assert.deepStrictEqual(primera.frases, ['Uno.', 'Dos.'])
  const segunda = frasesNuevas('Uno. Dos. Tres.', primera.consumido)
  assert.deepStrictEqual(segunda.frases, ['Tres.'])
})

test('cierra con signos de interrogación y exclamación', () => {
  assert.deepStrictEqual(frasesNuevas('¿Seguimos? ¡Vamos! y', 0).frases, ['¿Seguimos?', '¡Vamos!'])
})

test('sin frase cerrada no emite nada', () => {
  const r = frasesNuevas('estoy pensando', 0)
  assert.deepStrictEqual(r.frases, [])
  assert.strictEqual(r.consumido, 0)
})

test('no corta un decimal como si fuera fin de frase', () => {
  assert.deepStrictEqual(frasesNuevas('Subió 3.5 puntos hoy.', 0).frases, ['Subió 3.5 puntos hoy.'])
})

/* ── Evitar hablar dos veces lo ya sintetizado en streaming ── */

test('devuelve solo lo que falta por decir', () => {
  assert.strictEqual(restoNoHablado('Claro, señor. Voy a revisarlo.', 'Claro, señor.'), 'Voy a revisarlo.')
})

test('si ya se dijo todo, no queda nada', () => {
  assert.strictEqual(restoNoHablado('Claro, señor.', 'Claro, señor.'), '')
})

test('tolera diferencias de espacios entre lo hablado y el texto final', () => {
  assert.strictEqual(restoNoHablado('Uno.  Dos.', 'Uno.'), 'Dos.')
})

test('si el texto final divergió, se dice entero antes que perder contenido', () => {
  assert.strictEqual(restoNoHablado('Otra respuesta distinta.', 'Claro, señor.'), 'Otra respuesta distinta.')
})

test('sin nada hablado devuelve el texto completo', () => {
  assert.strictEqual(restoNoHablado('Hola.', ''), 'Hola.')
})

/* ── El preámbulo hablado y el que se anuncia deben ser el MISMO ── */
// Capturado en vivo: el streaming dijo "Le pasaré la composición completa de su
// equipo al entrenador…", y después `onDelegation` dijo el genérico "Voy a
// revisarlo con el agente adecuado, señor.". Dos frases distintas para el mismo
// momento: la GUI mostraba una y el altavoz decía otra.

const { preambuloEfectivo } = require('./streaming.js')

test('si hay preámbulo propio, ese manda', () => {
  assert.strictEqual(preambuloEfectivo('Le paso el equipo al entrenador.', 'Le paso el equipo al entrenador.', 'generico'), 'Le paso el equipo al entrenador.')
})

test('si el preámbulo se perdió pero ya se habló algo, se usa lo hablado', () => {
  // Repetir un genérico distinto de lo que Robert acaba de oír es peor que nada.
  assert.strictEqual(preambuloEfectivo('', 'Le pasaré la composición completa.', 'generico'), 'Le pasaré la composición completa.')
})

test('si no hay nada, recién ahí el genérico', () => {
  assert.strictEqual(preambuloEfectivo('', '', 'Voy a revisarlo, señor.'), 'Voy a revisarlo, señor.')
})

test('un preámbulo con protocolo no se usa aunque exista', () => {
  assert.strictEqual(preambuloEfectivo('<tool_call>', 'Ya lo consulto.', 'generico'), 'Ya lo consulto.')
})

test('nunca devuelve protocolo', () => {
  assert.strictEqual(preambuloEfectivo('{"tool_calls":[]}', '', 'generico'), 'generico')
})
