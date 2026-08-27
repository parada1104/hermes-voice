// Tests de resolución del YAML de perfiles Hermes (provider/modelo de delegación).
// Solo funciones puras — sin daemon ni red. Correr: node --test daemon/
const test = require('node:test')
const assert = require('node:assert')
const { resolverProviderDeModelo, resolverModeloDefault, resolverProviderDefault, resolverProviderSesion, construirArgsHermes, ajustarModeloAlPerfil, catalogoModelos, interpretarSeleccion } = require('./connector.js')

// Replica el layout real de ~/.hermes/profiles/entrenador/config.yaml: varios
// bloques de provider en secuencia, cada uno con su propio mapa `models:`.
const CONFIG = `model:
  default: deepseek-v4-flash
  provider: nan-builders
  base_url: https://api.nan.builders/v1
  supports_vision: true
providers:
  llmgateway:
    api_mode: chat_completions
    base_url: https://api.llmgateway.io/v1
    key_env: LLMGATEWAY_API_KEY
    models:
      gpt-5.6-luna:
        context_length: 1050000
      deepseek-v4-flash:
        context_length: 128000
  commandcode:
    api_mode: chat_completions
    base_url: https://api.commandcode.ai/provider/v1
    models:
      gpt-5.6-luna:
        context_length: 1050000
    key_env: COMMANDCODE_API_KEY
  local:
    api_mode: chat_completions
    base_url: http://127.0.0.1:8080/v1
    models:
      gemma4-coding-Q4_K_M:
        context_length: 65536
  nan-builders:
    api_mode: chat_completions
    base_url: https://api.nan.builders/v1
    key_env: NAN_BUILDERS_API_KEY
    models:
      deepseek-v4-flash:
        context_length: 1000000
      gemma4:
        context_length: 128000
agent:
  max_turns: 60
  reasoning_effort: low
auxiliary:
  vision:
    provider: commandcode
    model: gpt-5.6-luna
  compression:
    provider: nan-builders
    model: deepseek-v4-flash
`

// Un mapa inline vacío (`models: {}`) no debe tragarse al provider siguiente.
const CONFIG_INLINE_EMPTY = `model:
  default: gemma-4-31b
  provider: cerebras
providers:
  commandcode:
    api_mode: chat_completions
    models: {}
  groq:
    api_mode: chat_completions
    models:
      llama-3.1-8b-instant:
        context_length: 131072
`

test('resuelve el modelo al bloque de provider que realmente lo declara', () => {
  assert.strictEqual(resolverProviderDeModelo(CONFIG, 'gemma4'), 'nan-builders')
})

test('no arrastra el provider anterior cuando termina un mapa models', () => {
  assert.strictEqual(resolverProviderDeModelo(CONFIG, 'gemma4-coding-Q4_K_M'), 'local')
})

test('devuelve el primer provider declarante si varios comparten el modelo', () => {
  assert.strictEqual(resolverProviderDeModelo(CONFIG, 'gpt-5.6-luna'), 'llmgateway')
})

test('respeta el provider explícito del modelo default del perfil', () => {
  assert.strictEqual(resolverProviderDeModelo(CONFIG, 'deepseek-v4-flash'), 'nan-builders')
})

test('ignora claves provider fuera del bloque providers', () => {
  assert.strictEqual(resolverProviderDeModelo(CONFIG, 'no-existe'), '')
})

test('salta un provider con mapa models inline y vacío', () => {
  assert.strictEqual(resolverProviderDeModelo(CONFIG_INLINE_EMPTY, 'llama-3.1-8b-instant'), 'groq')
})

test('devuelve cadena vacía si falta entrada', () => {
  assert.strictEqual(resolverProviderDeModelo(CONFIG, ''), '')
  assert.strictEqual(resolverProviderDeModelo('', 'gemma4'), '')
})

test('lee modelo y provider default solo del bloque model raíz', () => {
  assert.strictEqual(resolverModeloDefault(CONFIG), 'deepseek-v4-flash')
  assert.strictEqual(resolverProviderDefault(CONFIG), 'nan-builders')
})

/* ── Construcción de argumentos del CLI de Hermes ── */

test('incluye --provider y --model cuando hay modelo elegido', () => {
  const args = construirArgsHermes({ perfil: 'entrenador', provider: 'nan-builders', model: 'gemma4', pedido: 'hola' })
  assert.deepStrictEqual(args, ['--profile', 'entrenador', '--provider', 'nan-builders', '--model', 'gemma4', '-z', 'hola'])
})

test('omite --provider si no se pudo resolver, pero conserva --model', () => {
  const args = construirArgsHermes({ perfil: 'entrenador', provider: '', model: 'gemma4', pedido: 'hola' })
  assert.deepStrictEqual(args, ['--profile', 'entrenador', '--model', 'gemma4', '-z', 'hola'])
})

test('añade --resume y --no-restore-cwd solo si hay sesión remota', () => {
  const con = construirArgsHermes({ perfil: 'voice', provider: 'cerebras', model: 'gemma-4-31b', agentSessionId: '20260825_131746_0b16d3', pedido: 'hola' })
  assert.ok(con.includes('--resume') && con.includes('20260825_131746_0b16d3') && con.includes('--no-restore-cwd'))
  const sin = construirArgsHermes({ perfil: 'voice', provider: 'cerebras', model: 'gemma-4-31b', pedido: 'hola' })
  assert.ok(!sin.includes('--resume') && !sin.includes('--no-restore-cwd'))
})

test('el modelo elegido viaja también cuando NO hay sesión remota adjunta', () => {
  const args = construirArgsHermes({ perfil: 'entrenador', provider: 'nan-builders', model: 'gemma4', pedido: 'hola' })
  assert.strictEqual(args[args.indexOf('--model') + 1], 'gemma4')
})

/* ── Adjuntos: `@ruta` lo parseaba Hermes como COMANDO, no como adjunto ── */

test('un adjunto usa el subcomando chat con --image, nunca @ruta', () => {
  const args = construirArgsHermes({ perfil: 'voice', provider: '', model: '', adjuntoPath: '/tmp/x.png', pedido: 'describí esto' })
  assert.ok(!args.some(a => a.startsWith('@')), 'no debe quedar ningún @ruta: Hermes lo toma como comando')
  assert.deepStrictEqual(args, ['--profile', 'voice', 'chat', '-Q', '--image', '/tmp/x.png', '-q', 'describí esto'])
})

test('sin adjunto se mantiene el oneshot -z', () => {
  const args = construirArgsHermes({ perfil: 'voice', provider: '', model: '', pedido: 'hola' })
  assert.deepStrictEqual(args, ['--profile', 'voice', '-z', 'hola'])
})

test('el adjunto convive con provider, modelo y sesión remota', () => {
  const args = construirArgsHermes({ perfil: 'entrenador', provider: 'nan-builders', model: 'gemma4', agentSessionId: '20260825_1_a', adjuntoPath: '/tmp/x.png', pedido: 'mirá' })
  assert.deepStrictEqual(args, ['--profile', 'entrenador', '--provider', 'nan-builders', '--model', 'gemma4', '--resume', '20260825_1_a', '--no-restore-cwd', 'chat', '-Q', '--image', '/tmp/x.png', '-q', 'mirá'])
})

test('los flags globales van antes del subcomando chat', () => {
  const args = construirArgsHermes({ perfil: 'voice', provider: 'cerebras', model: 'gemma-4-31b', adjuntoPath: '/tmp/x.png', pedido: 'y' })
  assert.ok(args.indexOf('--model') < args.indexOf('chat'), '--model es global, va antes de chat')
})

test('resolverProviderSesion cae al provider default si el modelo no está declarado', () => {
  assert.strictEqual(resolverProviderSesion(CONFIG, 'gemma4'), 'nan-builders')
  assert.strictEqual(resolverProviderSesion(CONFIG, 'desconocido'), 'nan-builders')
  assert.strictEqual(resolverProviderSesion(CONFIG, 'gpt-5.6-luna'), 'llmgateway')
})

/* ── Cambio de perfil: el modelo elegido puede no existir en el nuevo ── */

const CONFIG_VOICE = `model:
  default: gemma-4-31b
  provider: cerebras
providers:
  cerebras:
    models:
      gemma-4-31b:
        context_length: 131072
  nan-builders:
    models:
      gemma4:
        context_length: 131072
`

test('al cambiar de perfil conserva el modelo si el nuevo perfil lo declara', () => {
  assert.deepStrictEqual(ajustarModeloAlPerfil(CONFIG, 'gemma4'), { modelo: 'gemma4', provider: 'nan-builders' })
})

test('si el modelo no existe en el nuevo perfil, cae a su default', () => {
  assert.deepStrictEqual(ajustarModeloAlPerfil(CONFIG_VOICE, 'Qwen3_6-35B-A3B-UD-Q4_K_M'), { modelo: 'gemma-4-31b', provider: 'cerebras' })
})

test('sin modelo previo usa el default del perfil', () => {
  assert.deepStrictEqual(ajustarModeloAlPerfil(CONFIG_VOICE, ''), { modelo: 'gemma-4-31b', provider: 'cerebras' })
})

test('un perfil ilegible no inventa modelo', () => {
  assert.deepStrictEqual(ajustarModeloAlPerfil('', 'gemma4'), { modelo: '', provider: '' })
})

/* ── Catálogo provider-cualificado del agente ── */

test('lista cada modelo con su provider, no solo el nombre', () => {
  const cat = catalogoModelos(CONFIG)
  assert.ok(cat.some(m => m.provider === 'nan-builders' && m.modelo === 'gemma4'))
  assert.ok(cat.some(m => m.provider === 'local' && m.modelo === 'gemma4-coding-Q4_K_M'))
})

test('un modelo declarado por dos providers aparece una vez por provider', () => {
  const luna = catalogoModelos(CONFIG).filter(m => m.modelo === 'gpt-5.6-luna')
  assert.deepStrictEqual(luna.map(m => m.provider).sort(), ['commandcode', 'llmgateway'])
})

test('cada entrada trae un id estable provider/modelo', () => {
  assert.ok(catalogoModelos(CONFIG).some(m => m.id === 'commandcode/gpt-5.6-luna'))
})

test('marca cuál es el default del perfil', () => {
  const def = catalogoModelos(CONFIG).filter(m => m.esDefault)
  assert.deepStrictEqual(def.map(m => m.id), ['nan-builders/deepseek-v4-flash'])
})

test('un perfil vacío devuelve catálogo vacío', () => {
  assert.deepStrictEqual(catalogoModelos(''), [])
})

/* ── Selección por id cualificado ── */

test('un id cualificado elige exactamente ese provider', () => {
  assert.deepStrictEqual(interpretarSeleccion(CONFIG, 'commandcode/gpt-5.6-luna'), { modelo: 'gpt-5.6-luna', provider: 'commandcode' })
})

test('un nombre suelto sigue funcionando y resuelve su provider', () => {
  assert.deepStrictEqual(interpretarSeleccion(CONFIG, 'gemma4'), { modelo: 'gemma4', provider: 'nan-builders' })
})

test('un provider que no declara ese modelo no se acepta a ciegas', () => {
  assert.deepStrictEqual(interpretarSeleccion(CONFIG, 'local/gemma4'), { modelo: 'gemma4', provider: 'nan-builders' })
})

test('un modelo con barra en el nombre no se confunde con un id cualificado', () => {
  const cfg = `model:\n  default: x\n  provider: groq\nproviders:\n  groq:\n    models:\n      qwen/qwen3.6-27b:\n        context_length: 1\n`
  assert.deepStrictEqual(interpretarSeleccion(cfg, 'groq/qwen/qwen3.6-27b'), { modelo: 'qwen/qwen3.6-27b', provider: 'groq' })
})

test('selección vacía limpia el modelo', () => {
  assert.deepStrictEqual(interpretarSeleccion(CONFIG, ''), { modelo: '', provider: '' })
})

/* ── Provider sin bloque `models:` ── */
// Capturado del perfil entrenador real: Robert cambió el default a un provider
// nuevo declarado SOLO con api_mode/base_url/key_env, sin lista de modelos. El
// catálogo miraba únicamente dentro de `models:`, así que el modelo default
// desaparecía del selector y `defaultModel` volvía vacío.

const CONFIG_SIN_MODELS = `model:
  default: gemma-4-31b
  provider: cerebras
  base_url: https://api.cerebras.ai/v1
providers:
  cerebras:
    api_mode: chat_completions
    base_url: https://api.cerebras.ai/v1
    key_env: CEREBRAS_API_KEY
  nan-builders:
    api_mode: chat_completions
    models:
      gemma4:
        context_length: 128000
`

test('el modelo default aparece aunque su provider no declare models', () => {
  const cat = catalogoModelos(CONFIG_SIN_MODELS)
  assert.ok(cat.some(m => m.id === 'cerebras/gemma-4-31b'), 'falta el default: ' + JSON.stringify(cat.map(m => m.id)))
})

test('y queda marcado como default para que el selector lo preseleccione', () => {
  const def = catalogoModelos(CONFIG_SIN_MODELS).filter(m => m.esDefault)
  assert.deepStrictEqual(def.map(m => m.id), ['cerebras/gemma-4-31b'])
})

test('el default va primero: es el que el agente usa si no se elige otro', () => {
  assert.strictEqual(catalogoModelos(CONFIG_SIN_MODELS)[0].id, 'cerebras/gemma-4-31b')
})

test('los demás providers siguen listándose', () => {
  assert.ok(catalogoModelos(CONFIG_SIN_MODELS).some(m => m.id === 'nan-builders/gemma4'))
})

test('no se duplica cuando el provider SÍ declara el default', () => {
  const cat = catalogoModelos(CONFIG)
  const def = cat.filter(m => m.id === 'nan-builders/deepseek-v4-flash')
  assert.strictEqual(def.length, 1)
})

test('seleccionar el default sin bloque models resuelve su provider', () => {
  assert.deepStrictEqual(
    interpretarSeleccion(CONFIG_SIN_MODELS, 'cerebras/gemma-4-31b'),
    { modelo: 'gemma-4-31b', provider: 'cerebras' })
})

test('un config sin bloque model no inventa una entrada', () => {
  assert.deepStrictEqual(catalogoModelos('providers:\n  x:\n    api_mode: chat\n'), [])
})
