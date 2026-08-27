// El cuerpo de la petición al proveedor de la capa.
//
// Medido contra nan-builders: `tools: []` devuelve 400 ("Invalid request"),
// mientras que omitir el campo devuelve 200. Como `llmCerebras` mandaba
// `tools: tools || []`, TODA llamada sin herramientas fallaba — y la síntesis
// del veredicto es precisamente una llamada sin herramientas. El fallo caía en
// un catch que entregaba el crudo del agente, así que la capa parecía estar
// copiando al agente cuando en realidad nunca llegaba a sintetizar.
const test = require('node:test')
const assert = require('node:assert')
const { cuerpoChat } = require('./connector')

const HERRAMIENTA = { type: 'function', function: { name: 'delegar_a_orca', description: 'd', parameters: { type: 'object', properties: {} } } }

test('sin herramientas, el campo `tools` NO viaja', () => {
  const c = cuerpoChat({ model: 'gemma4', messages: [], maxTokens: 300 })
  assert.equal('tools' in c, false)
  assert.equal(cuerpoChat({ model: 'gemma4', messages: [], tools: [], maxTokens: 300 }).tools, undefined)
})

test('con herramientas, viajan tal cual', () => {
  const c = cuerpoChat({ model: 'gemma4', messages: [], tools: [HERRAMIENTA], maxTokens: 300 })
  assert.deepEqual(c.tools, [HERRAMIENTA])
})

test('`stream` solo aparece cuando se pide', () => {
  assert.equal('stream' in cuerpoChat({ model: 'g', messages: [], maxTokens: 10 }), false)
  assert.equal(cuerpoChat({ model: 'g', messages: [], maxTokens: 10, stream: true }).stream, true)
})

test('modelo, mensajes y max_tokens siempre viajan', () => {
  const c = cuerpoChat({ model: 'gemma4', messages: [{ role: 'user', content: 'hola' }], maxTokens: 700 })
  assert.equal(c.model, 'gemma4')
  assert.deepEqual(c.messages, [{ role: 'user', content: 'hola' }])
  assert.equal(c.max_tokens, 700)
})

// `qwen3.8-flash` razona siempre salvo que se le mande este campo. Medido: es el
// ÚNICO que lo apaga — `reasoning_effort` (none/minimal/low), `reasoning:
// {enabled:false}`, `thinking:{type:disabled}` y `/no_think` en el prompt NO
// hacen nada. Y NO puede viajar siempre: cerebras devuelve 400
// ("property 'chat_template_kwargs' is unsupported").
test('sin `sinThinking`, el campo `chat_template_kwargs` NO viaja', () => {
  const c = cuerpoChat({ model: 'gpt-oss-120b', messages: [], maxTokens: 300 })
  assert.equal('chat_template_kwargs' in c, false)
  assert.equal('chat_template_kwargs' in cuerpoChat({ model: 'g', messages: [], maxTokens: 300, sinThinking: false }), false)
})

test('con `sinThinking`, viaja el flag que apaga el razonamiento', () => {
  const c = cuerpoChat({ model: 'qwen3.8-flash', messages: [], maxTokens: 300, sinThinking: true })
  assert.deepEqual(c.chat_template_kwargs, { enable_thinking: false })
})

test('el flag convive con herramientas y streaming', () => {
  const c = cuerpoChat({ model: 'qwen3.8-flash', messages: [], tools: [HERRAMIENTA], maxTokens: 300, stream: true, sinThinking: true })
  assert.deepEqual(c.chat_template_kwargs, { enable_thinking: false })
  assert.deepEqual(c.tools, [HERRAMIENTA])
  assert.equal(c.stream, true)
})
