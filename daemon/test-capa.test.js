// Tests del endpoint de la capa conversacional.
//
// `HV_CAPA_PROVIDER` solo cambiaba la etiqueta: la URL y la key estaban clavadas
// a Cerebras, así que era imposible probar la capa con otro proveedor. Para
// medir si los fallos de tool call son del modelo hay que poder cambiarlo.
const test = require('node:test')
const assert = require('node:assert')
const { resolverCapa, PROVEEDORES_CAPA } = require('./capa.js')

test('el proveedor y el modelo por defecto son los que midieron mejor', () => {
  // 7/7 delegaciones, 4/4 no-delegaciones, 3/3 continuidad, cero reparaciones.
  // Ver la tabla en capa.js.
  const c = resolverCapa({})
  assert.strictEqual(c.provider, 'nan-builders')
  assert.strictEqual(c.modelo, 'qwen3.8-flash')
  assert.strictEqual(c.keyEnv, 'NAN_BUILDERS_API_KEY')
})

// qwen3.8-flash razona SIEMPRE por defecto: ~60-140 tokens de `reasoning_content`
// hasta para "17 por 3". Eso empuja el TTFB de 2566ms a 3579ms (p90: de 3189ms a
// 5580ms), y para una capa de VOZ el primer token es cuándo arranca a hablar.
test('nan-builders viaja con el thinking apagado', () => {
  assert.strictEqual(resolverCapa({}).sinThinking, true)
})

// Medido: cerebras responde 400 "property 'chat_template_kwargs' is unsupported".
// Mandar el flag a ciegas rompería la capa entera con ese proveedor, igual que
// `tools: []` la rompía contra nan-builders.
test('cerebras NO recibe el flag: lo rechaza con 400', () => {
  assert.strictEqual(resolverCapa({ HV_CAPA_PROVIDER: 'cerebras' }).sinThinking, false)
  assert.strictEqual(resolverCapa({ HV_CAPA_PROVIDER: 'llmgateway' }).sinThinking, false)
  assert.strictEqual(resolverCapa({ HV_CAPA_PROVIDER: 'groq' }).sinThinking, false)
})

test('el thinking se puede forzar desde el entorno, en los dos sentidos', () => {
  assert.strictEqual(resolverCapa({ HV_CAPA_SIN_THINKING: '0' }).sinThinking, false)
  assert.strictEqual(resolverCapa({ HV_CAPA_SIN_THINKING: 'false' }).sinThinking, false)
  assert.strictEqual(resolverCapa({ HV_CAPA_PROVIDER: 'cerebras', HV_CAPA_SIN_THINKING: '1' }).sinThinking, true)
})

test('cerebras sigue disponible como alternativa', () => {
  const c = resolverCapa({ HV_CAPA_PROVIDER: 'cerebras' })
  assert.ok(c.url.includes('api.cerebras.ai'))
  assert.strictEqual(c.keyEnv, 'CEREBRAS_API_KEY')
})

test('se puede apuntar a otro proveedor', () => {
  const c = resolverCapa({ HV_CAPA_PROVIDER: 'llmgateway' })
  assert.ok(c.url.includes('api.llmgateway.io'), c.url)
  assert.strictEqual(c.keyEnv, 'LLMGATEWAY_API_KEY')
})

test('el modelo se elige aparte del proveedor', () => {
  assert.strictEqual(resolverCapa({ HV_CAPA_PROVIDER: 'nan-builders', HV_CAPA_MODELO: 'qwen3.6' }).modelo, 'qwen3.6')
})

test('la URL siempre apunta al endpoint de chat', () => {
  for (const p of Object.keys(PROVEEDORES_CAPA)) {
    assert.ok(resolverCapa({ HV_CAPA_PROVIDER: p }).url.endsWith('/chat/completions'), p)
  }
})

test('toma la key del entorno del proveedor elegido', () => {
  const c = resolverCapa({ HV_CAPA_PROVIDER: 'nan-builders', NAN_BUILDERS_API_KEY: 'abc123' })
  assert.strictEqual(c.key, 'abc123')
})

test('un proveedor desconocido cae al por defecto en vez de romper', () => {
  const { POR_DEFECTO } = require('./capa.js')
  assert.strictEqual(resolverCapa({ HV_CAPA_PROVIDER: 'inventado' }).provider, POR_DEFECTO)
})

test('una URL explícita gana sobre el catálogo', () => {
  const c = resolverCapa({ HV_CAPA_URL: 'https://propio.local/v1/chat/completions', HV_CAPA_KEY_ENV: 'MI_KEY', MI_KEY: 'k' })
  assert.strictEqual(c.url, 'https://propio.local/v1/chat/completions')
  assert.strictEqual(c.key, 'k')
})

test('cada proveedor trae su modelo por defecto', () => {
  assert.ok(resolverCapa({ HV_CAPA_PROVIDER: 'nan-builders' }).modelo, 'debe haber un modelo por defecto')
})
