// Tests del reconocimiento de tool calls y de la mordaza del streaming.
//
// Dos fallos reales de la sesión coach-692jc1:
//  · el TTS habló el tool call crudo, porque el streaming sintetiza `content`
//    ANTES de normalizarlo (la normalización solo protegía lo que se guarda);
//  · el modelo emitió el tool call como texto en una forma que el parser no
//    reconocía, así que no delegó y el turno se perdió con un "No pude
//    interpretar la respuesta".
const test = require('node:test')
const assert = require('node:assert')
const { contieneToolCall, frasesSegurasNuevas } = require('./streaming.js')
const { normalizarToolCall } = require('./connector.js')

/* ── Detección de tool call en texto ── */

const CRUDOS = [
  '{"tool_calls":[{"function":{"name":"delegar_a_orca","arguments":"{}"}}]}',
  '{"name":"delegar_a_orca","arguments":{"pedido":"x"}}',
  '_call:delegate_to_agent{"pedido":"x"}',
  'Claro, señor. {"tool_calls":[{"name":"delegar_a_hermes"}]}',
  '{"function": {"name": "delegar_a_hermes"}}',
]

test('reconoce las formas crudas de tool call que emite el modelo', () => {
  for (const c of CRUDOS) assert.strictEqual(contieneToolCall(c), true, c)
})

test('no marca como tool call una frase normal', () => {
  for (const t of ['Claro, señor. Voy a revisarlo.', 'El equipo tiene 3 Pokémon.', '¿Seguimos?', 'Le paso el resumen: nivel 15, naturaleza ingenua.']) {
    assert.strictEqual(contieneToolCall(t), false, t)
  }
})

/* ── Mordaza del streaming ── */

test('no entrega ninguna frase si el contenido ya trae un tool call', () => {
  const r = frasesSegurasNuevas('{"tool_calls":[{"name":"delegar_a_orca"}]}', 0)
  assert.deepStrictEqual(r.frases, [])
})

test('entrega el preámbulo pero calla en cuanto aparece el tool call', () => {
  const r = frasesSegurasNuevas('Claro, señor. Voy a consultarlo. {"tool_calls":[{"name":"x"}]}', 0)
  assert.deepStrictEqual(r.frases, ['Claro, señor.', 'Voy a consultarlo.'])
})

test('una vez cortado no vuelve a emitir aunque siga llegando texto', () => {
  const primera = frasesSegurasNuevas('Voy a verlo. {"tool_calls":[{"name":"x"}', 0)
  assert.deepStrictEqual(primera.frases, ['Voy a verlo.'])
  const segunda = frasesSegurasNuevas('Voy a verlo. {"tool_calls":[{"name":"x","arguments":"{}"}]} y más texto.', primera.consumido, primera.cortado)
  assert.deepStrictEqual(segunda.frases, [])
})

test('sin tool call se comporta igual que el troceado normal', () => {
  const r = frasesSegurasNuevas('Uno. Dos. Tres', 0)
  assert.deepStrictEqual(r.frases, ['Uno.', 'Dos.'])
})

test('una llave suelta que no es tool call no amordaza', () => {
  const r = frasesSegurasNuevas('El objeto {a:1} es válido. Sigo.', 0)
  assert.deepStrictEqual(r.frases, ['El objeto {a:1} es válido.', 'Sigo.'])
})

/* ── Normalización tolerante ── */

test('sigue reconociendo la forma estructurada nativa', () => {
  const n = normalizarToolCall({ content: 'Claro.', tool_calls: [{ function: { name: 'delegar_a_orca', arguments: '{"pedido":"x"}' } }] })
  assert.strictEqual(n.toolCall.name, 'delegar_a_orca')
  assert.strictEqual(n.preambulo, 'Claro.')
})

test('reconoce el tool call serializado con tool_calls dentro del texto', () => {
  const n = normalizarToolCall({ content: 'Claro, señor. {"tool_calls":[{"function":{"name":"delegar_a_orca","arguments":"{\\"pedido\\":\\"x\\"}"}}]}' })
  assert.strictEqual(n.toolCall.name, 'delegar_a_orca')
  assert.strictEqual(n.preambulo, 'Claro, señor.')
})

test('reconoce un objeto de función suelto, sin envoltorio tool_calls', () => {
  const n = normalizarToolCall({ content: 'Voy a verlo. {"name":"delegar_a_orca","arguments":{"pedido":"lista la caja 1"}}' })
  assert.strictEqual(n.toolCall.name, 'delegar_a_orca')
  assert.strictEqual(n.preambulo, 'Voy a verlo.')
})

test('reconoce el envoltorio function', () => {
  const n = normalizarToolCall({ content: '{"function":{"name":"delegar_a_hermes","arguments":{"pedido":"x"}}}' })
  assert.strictEqual(n.toolCall.name, 'delegar_a_hermes')
})

test('reconoce la forma _call: que el modelo emite como texto', () => {
  const n = normalizarToolCall({ content: 'Claro. _call:delegate_to_agent{"pedido":"lista la caja 1"}' })
  assert.strictEqual(n.toolCall.name, 'delegate_to_agent')
  assert.strictEqual(n.preambulo, 'Claro.')
})

test('los argumentos quedan siempre como string JSON', () => {
  const n = normalizarToolCall({ content: '{"name":"delegar_a_orca","arguments":{"pedido":"x"}}' })
  assert.strictEqual(typeof n.toolCall.arguments, 'string')
  assert.strictEqual(JSON.parse(n.toolCall.arguments).pedido, 'x')
})

test('un texto normal con llaves no se toma por tool call', () => {
  const n = normalizarToolCall({ content: 'El set es {nivel 15, ingenua}.' })
  assert.strictEqual(n.toolCall, null)
  assert.strictEqual(n.preambulo, 'El set es {nivel 15, ingenua}.')
})

test('un nombre de herramienta desconocido no se acepta', () => {
  assert.strictEqual(normalizarToolCall({ content: '{"name":"borrar_todo","arguments":{}}' }).toolCall, null)
})

test('un preámbulo con protocolo dentro se descarta antes de hablarlo', () => {
  // Aunque el tool call se interprete bien, lo que quede delante puede traer
  // restos de protocolo: eso se habla, así que no puede pasar.
  assert.strictEqual(contieneToolCall('Claro. _call:delegate_to_agent{"pedido":"x"}'), true)
  assert.strictEqual(contieneToolCall('Claro, señor. Voy a revisarlo.'), false)
})

/* ── Forma `<call:NAME{…}/>` — capturada literal de la sesión choach-hbkicj ── */
// Ni la mordaza ni el reintento se dispararon: mis patrones exigían `_call:`
// (con guion bajo) y esta viene entre ángulos. Además el JSON NO es válido: la
// clave externa `pedido` va sin comillas, así que JSON.parse falla y hay que
// rescatar el pedido de todos modos.

const CRUDO_ANGULOS = 'Permítame consultarlo con el entrenador, señor. Voy a revisar los registros de su sesión.\n\n<call:delegar_a_orca{pedido:{"pedido":"Revisa el vault y resumí el estado de la partida."}}/>'

test('reconoce la forma entre ángulos como tool call', () => {
  assert.strictEqual(contieneToolCall(CRUDO_ANGULOS), true)
})

test('no habla el protocolo: solo el preámbulo anterior', () => {
  const r = frasesSegurasNuevas(CRUDO_ANGULOS, 0)
  assert.ok(r.cortado, 'debe amordazar')
  assert.ok(r.frases.every(f => !f.includes('call:')), 'ninguna frase lleva protocolo')
  assert.ok(r.frases.some(f => f.includes('Permítame consultarlo')), 'el preámbulo sí se dice')
})

test('interpreta la forma entre ángulos y recupera el pedido', () => {
  const n = normalizarToolCall({ content: CRUDO_ANGULOS })
  assert.strictEqual(n.toolCall.name, 'delegar_a_orca')
  assert.strictEqual(JSON.parse(n.toolCall.arguments).pedido, 'Revisa el vault y resumí el estado de la partida.')
})

test('el preámbulo queda limpio, sin el bloque de protocolo', () => {
  const n = normalizarToolCall({ content: CRUDO_ANGULOS })
  assert.ok(!n.preambulo.includes('call:'))
  assert.ok(n.preambulo.startsWith('Permítame consultarlo'))
})

test('acepta el pedido anidado y también el plano', () => {
  const anidado = normalizarToolCall({ content: '<call:delegar_a_orca{pedido:{"pedido":"X"}}/>' })
  assert.strictEqual(JSON.parse(anidado.toolCall.arguments).pedido, 'X')
  const plano = normalizarToolCall({ content: '<call:delegar_a_orca{"pedido":"Y"}/>' })
  assert.strictEqual(JSON.parse(plano.toolCall.arguments).pedido, 'Y')
})

test('respeta comillas escapadas dentro del pedido', () => {
  const n = normalizarToolCall({ content: '<call:delegar_a_orca{pedido:{"pedido":"decí \\"hola\\" y listo"}}/>' })
  assert.strictEqual(JSON.parse(n.toolCall.arguments).pedido, 'decí "hola" y listo')
})

test('una herramienta desconocida entre ángulos no se ejecuta', () => {
  assert.strictEqual(normalizarToolCall({ content: '<call:borrar_todo{"x":1}/>' }).toolCall, null)
})

test('texto normal con dos puntos no se confunde con un call', () => {
  for (const t of ['Te llamo: mañana.', 'Nota: revisá el vault.', 'La llamada: a las 5.']) {
    assert.strictEqual(contieneToolCall(t), false, t)
  }
})

/* ── El prompt y la herramienta registrada no pueden divergir ── */
// Raíz del problema: el prompt le pedía al modelo `delegate_to_agent` mientras
// la herramienta registrada era `delegar_a_orca`. Al no encontrarla, el modelo
// improvisaba el call como texto. Ahora el nombre se deriva de la definición.

const { VOICE_PROMPT, ORCA_TOOL, TOOLS_CONOCIDAS } = require('./connector.js')

test('el prompt nombra exactamente la herramienta registrada', () => {
  assert.ok(VOICE_PROMPT.includes(ORCA_TOOL.function.name),
    `el prompt debe nombrar ${ORCA_TOOL.function.name}`)
})

test('el prompt no nombra ninguna herramienta inexistente', () => {
  const mencionadas = [...VOICE_PROMPT.matchAll(/\b(delegar_a_\w+|delegate_to_\w+)\b/g)].map(m => m[1])
  for (const nombre of new Set(mencionadas)) {
    assert.strictEqual(nombre, ORCA_TOOL.function.name, `el prompt menciona ${nombre}, que no es la registrada`)
  }
})

test('el normalizador acepta la herramienta registrada', () => {
  assert.ok(TOOLS_CONOCIDAS.includes(ORCA_TOOL.function.name))
})

/* ── Fragmentos de protocolo cortados ── */
// Capturado literal: el preámbulo terminaba en '\n\n<tool'. No matcheaba los
// patrones (que exigían `call:` y `{`) y se sintetizó la frase «<tool».

const CON_FRAGMENTO = 'Lo siento, señor, pero no tengo datos sobre la partida. Permítame consultar sus archivos.\n\n<tool'

test('reconoce un fragmento de etiqueta como protocolo', () => {
  for (const t of ['<tool', '<tool_call>', '<function', '<invoke name="x">', '<call']) {
    assert.strictEqual(contieneToolCall(t), true, t)
  }
})

test('no habla el fragmento: solo las frases anteriores', () => {
  const r = frasesSegurasNuevas(CON_FRAGMENTO, 0)
  assert.ok(r.frases.every(f => !f.includes('<')), 'ninguna frase con etiqueta')
  assert.ok(r.frases.some(f => f.includes('Permítame consultar')), 'el preámbulo sí se dice')
})

test('el preámbulo se limpia del fragmento antes de hablarse', () => {
  const n = normalizarToolCall({ content: CON_FRAGMENTO })
  assert.ok(!n.preambulo.includes('<'), 'no debe quedar la etiqueta')
  assert.ok(n.preambulo.includes('Permítame consultar'))
})

test('un menor-que en habla normal no se toma por protocolo', () => {
  for (const t of ['La temperatura es < 20 grados.', 'Cuesta <5 dólares.']) {
    assert.strictEqual(contieneToolCall(t), false, t)
  }
})

/* ── Forma `{"tool": "functions.NOMBRE"}` — la usa gpt-oss-120b ── */
// Capturada midiendo modelos: gpt-oss-120b delega, pero nombra la herramienta
// con prefijo `functions.` y bajo la clave `tool`. Sin reconocerla, su tasa de
// delegación se medía en 4/8 cuando el problema era el parser, no el modelo.

test('reconoce la clave `tool` con prefijo functions.', () => {
  const n = normalizarToolCall({ content: '{"tool":"functions.delegar_a_orca","parameters":{"pedido":"revisá el vault"}}' })
  assert.strictEqual(n.toolCall.name, 'delegar_a_orca')
  assert.strictEqual(JSON.parse(n.toolCall.arguments).pedido, 'revisá el vault')
})

test('acepta `arguments` además de `parameters`', () => {
  const n = normalizarToolCall({ content: '{"tool":"functions.delegar_a_orca","arguments":{"pedido":"x"}}' })
  assert.strictEqual(JSON.parse(n.toolCall.arguments).pedido, 'x')
})

test('el prefijo functions. también se limpia en `name`', () => {
  const n = normalizarToolCall({ content: '{"name":"functions.delegar_a_orca","arguments":{"pedido":"x"}}' })
  assert.strictEqual(n.toolCall.name, 'delegar_a_orca')
})

test('esa forma cuenta como protocolo y no se habla', () => {
  assert.strictEqual(contieneToolCall('{"tool":"functions.delegar_a_orca","parameters":{}}'), true)
})

test('una herramienta desconocida con ese formato no se ejecuta', () => {
  assert.strictEqual(normalizarToolCall({ content: '{"tool":"functions.borrar_todo","parameters":{}}' }).toolCall, null)
})
