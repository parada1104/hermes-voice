// Tests del perfil default (la raíz ~/.hermes) y de las capacidades por perfil.
//
// Dos agujeros reales: el Hermes por defecto —el único con el MCP de Trello de
// Aurora— no era seleccionable, y la capa conversacional no sabía qué
// herramientas tiene cada perfil, así que delegaba a ciegas un pedido de Trello
// al coach de Pokémon.
const test = require('node:test')
const assert = require('node:assert')
const { esPerfilDefault, serviciosMcp } = require('./perfiles.js')
const { construirArgsHermes } = require('./connector.js')

const CONFIG_RAIZ = `model:
  default: gpt-5.6-luna
  provider: commandcode
mcp_servers:
  samsung-tv:
    args:
      - /home/user/.hermes/scripts/samsung-tv-mcp.py
    command: python3
    timeout: 30
  trello:
    args:
      - -lc
      - set -a; source /home/user/proyectos/example/.env; exec npx
        -y @delorenj/mcp-server-trello
    command: /bin/bash
    timeout: 120
agent:
  max_turns: 60
`

test('reconoce el id reservado del perfil raíz', () => {
  assert.strictEqual(esPerfilDefault('default'), true)
  assert.strictEqual(esPerfilDefault('entrenador'), false)
  assert.strictEqual(esPerfilDefault(''), false)
})

test('el perfil default se invoca SIN --profile: es el Hermes de la raíz', () => {
  const args = construirArgsHermes({ perfil: 'default', pedido: 'hola' })
  assert.ok(!args.includes('--profile'))
  assert.deepStrictEqual(args, ['-z', 'hola'])
})

test('el perfil default admite provider, modelo y sesión remota igual que los demás', () => {
  const args = construirArgsHermes({ perfil: 'default', provider: 'commandcode', model: 'gpt-5.6-luna', agentSessionId: '2026_1_a', pedido: 'hola' })
  assert.deepStrictEqual(args, ['--provider', 'commandcode', '--model', 'gpt-5.6-luna', '--resume', '2026_1_a', '--no-restore-cwd', '-z', 'hola'])
})

test('un perfil normal sigue llevando --profile', () => {
  assert.deepStrictEqual(construirArgsHermes({ perfil: 'entrenador', pedido: 'hola' }), ['--profile', 'entrenador', '-z', 'hola'])
})

test('lista los servidores MCP declarados por el perfil', () => {
  assert.deepStrictEqual(serviciosMcp(CONFIG_RAIZ), ['samsung-tv', 'trello'])
})

test('no confunde los argumentos anidados con nombres de servidor', () => {
  const servicios = serviciosMcp(CONFIG_RAIZ)
  assert.ok(!servicios.some(s => s.includes('npx') || s.includes('source')))
})

test('un perfil sin bloque mcp_servers no declara herramientas', () => {
  assert.deepStrictEqual(serviciosMcp('model:\n  default: x\nagent:\n  max_turns: 60\n'), [])
})

test('el bloque termina en la siguiente clave raíz', () => {
  assert.deepStrictEqual(serviciosMcp(CONFIG_RAIZ).includes('max_turns'), false)
})

test('tolera config vacío o ilegible', () => {
  assert.deepStrictEqual(serviciosMcp(''), [])
  assert.deepStrictEqual(serviciosMcp(null), [])
})

/* ── El perfil pertenece a la sesión y no cambia ── */
// Una conversación es con UN agente. Para hablar con otro perfil se abre otra
// sesión. La capa conversacional no enruta entre perfiles: solo delega al
// agente de su propia sesión.

const { decidirPerfilSesion } = require('./perfiles.js')

test('una sesión sin perfil fijado adopta el primero que llega', () => {
  assert.deepStrictEqual(
    decidirPerfilSesion({ perfil: 'voice', perfilFijado: false }, 'entrenador'),
    { perfil: 'entrenador', fijar: true, ignorado: false })
})

test('una sesión con perfil fijado NO lo cambia', () => {
  assert.deepStrictEqual(
    decidirPerfilSesion({ perfil: 'entrenador', perfilFijado: true }, 'default'),
    { perfil: 'entrenador', fijar: false, ignorado: true })
})

test('recibir el mismo perfil no cuenta como intento de cambio', () => {
  assert.deepStrictEqual(
    decidirPerfilSesion({ perfil: 'entrenador', perfilFijado: true }, 'entrenador'),
    { perfil: 'entrenador', fijar: false, ignorado: false })
})

test('sin perfil entrante se conserva el de la sesión', () => {
  assert.deepStrictEqual(
    decidirPerfilSesion({ perfil: 'entrenador', perfilFijado: true }, ''),
    { perfil: 'entrenador', fijar: false, ignorado: false })
})

test('una sesión sin perfil ninguno adopta el entrante', () => {
  assert.deepStrictEqual(
    decidirPerfilSesion({ perfil: '', perfilFijado: false }, 'default'),
    { perfil: 'default', fijar: true, ignorado: false })
})

/* ── El adjunto del agente: se fija una vez, y puede compartirse ── */
// La sesión conversacional solo puede mutar el MODELO. El agente (perfil +
// sesión remota) queda attachado. Y una misma sesión remota puede estar
// attachada a varias conversaciones, así que nada de exigir unicidad.

const { decidirAdjuntoAgente } = require('./perfiles.js')

test('una sesión sin adjunto adopta el primero que llega', () => {
  assert.deepStrictEqual(decidirAdjuntoAgente({ agentSessionId: '' }, '20260825_1_a'),
    { agentSessionId: '20260825_1_a', fijar: true, ignorado: false })
})

test('un adjunto ya fijado no se reemplaza a mitad de conversación', () => {
  assert.deepStrictEqual(decidirAdjuntoAgente({ agentSessionId: '20260825_1_a' }, '20260825_2_b'),
    { agentSessionId: '20260825_1_a', fijar: false, ignorado: true })
})

test('reenviar el mismo adjunto no es un intento de cambio', () => {
  assert.deepStrictEqual(decidirAdjuntoAgente({ agentSessionId: '20260825_1_a' }, '20260825_1_a'),
    { agentSessionId: '20260825_1_a', fijar: false, ignorado: false })
})

test('sin adjunto entrante se conserva el actual', () => {
  assert.deepStrictEqual(decidirAdjuntoAgente({ agentSessionId: '20260825_1_a' }, ''),
    { agentSessionId: '20260825_1_a', fijar: false, ignorado: false })
})

test('dos conversaciones distintas pueden compartir la misma sesión de agente', () => {
  const a = decidirAdjuntoAgente({ agentSessionId: '' }, '20260825_1_a')
  const b = decidirAdjuntoAgente({ agentSessionId: '' }, '20260825_1_a')
  assert.strictEqual(a.agentSessionId, b.agentSessionId)
  assert.strictEqual(a.fijar && b.fijar, true)
})

test('el perfil de delegación por defecto no puede ser la propia capa de voz', () => {
  // `voice` es la capa conversacional (su SOUL: "no tienes herramientas
  // propias… eres la voz, no las manos"). Delegarle es delegarse a uno mismo.
  const { PERFIL_HERMES_DEFAULT } = require('./connector.js')
  assert.notStrictEqual(PERFIL_HERMES_DEFAULT, 'voice')
  assert.strictEqual(PERFIL_HERMES_DEFAULT, 'default')
})

/* ── `voice` no es un destino de delegación válido ── */

const { PERFILES_OCULTOS, esPerfilDelegable, perfilesDelegables } = require('./perfiles.js')

test('voice queda fuera: delegarle es delegarse a uno mismo', () => {
  assert.ok(PERFILES_OCULTOS.includes('voice'))
  assert.strictEqual(esPerfilDelegable('voice'), false)
})

test('los demás perfiles siguen siendo delegables', () => {
  for (const p of ['default', 'entrenador', 'designer', 'marketing', 'pm_tecnico']) {
    assert.strictEqual(esPerfilDelegable(p), true, p)
  }
})

test('la lista para el selector excluye voice y encabeza con default', () => {
  assert.deepStrictEqual(
    perfilesDelegables(['designer', 'entrenador', 'voice']),
    ['default', 'designer', 'entrenador'])
})

test('si default ya viene del disco no se duplica', () => {
  assert.deepStrictEqual(perfilesDelegables(['default', 'entrenador']), ['default', 'entrenador'])
})

test('una lista vacía deja al menos el perfil raíz', () => {
  assert.deepStrictEqual(perfilesDelegables([]), ['default'])
})

/* ── El perfil debe aplicarse al ENTRAR, no solo al hablar ── */
// Con el precalentado, el worker se levanta en `activate`. Si el perfil solo se
// aplicaba dentro de procesarTurno, el worker arrancaba con el perfil viejo de
// la sesión y recién se corregía en el primer turno — demasiado tarde, el
// proceso ya estaba corriendo el agente equivocado.

const { aplicarPerfilSesion } = require('./connector.js')

test('aplicar el perfil entrante fija una sesión que aún no lo tenía', () => {
  const s = { id: 's1', perfil: 'default', perfilFijado: false, agentModel: '', agentProvider: '', agentContext: {} }
  const cambio = aplicarPerfilSesion(s, 'entrenador')
  assert.strictEqual(cambio, true)
  assert.strictEqual(s.perfil, 'entrenador')
  assert.strictEqual(s.perfilFijado, true)
})

test('no cambia el perfil de una sesión ya fijada', () => {
  const s = { id: 's1', perfil: 'entrenador', perfilFijado: true }
  assert.strictEqual(aplicarPerfilSesion(s, 'default'), false)
  assert.strictEqual(s.perfil, 'entrenador')
})

test('sin perfil entrante no toca nada', () => {
  const s = { id: 's1', perfil: 'entrenador', perfilFijado: true }
  assert.strictEqual(aplicarPerfilSesion(s, ''), false)
  assert.strictEqual(s.perfil, 'entrenador')
})

test('al fijar el perfil se resincroniza el modelo y el provider', () => {
  const s = { id: 's1', perfil: 'default', perfilFijado: false, agentModel: '', agentProvider: '', agentContext: {} }
  aplicarPerfilSesion(s, 'entrenador')
  assert.ok(s.agentModel, 'debe quedar el modelo default del perfil nuevo')
  assert.ok(s.agentProvider, 'y su provider')
})

/* ── Al FIJAR el perfil por primera vez manda su default ── */
// Una sesión nace con el perfil de respaldo y su modelo. Cuando llega el perfil
// real, arrastrar ese modelo no tiene sentido: nunca fue una elección de Robert.
// Se vio en vivo: sesión nueva en `entrenador` corriendo llmgateway/
// deepseek-v4-flash en vez de su default cerebras/gemma-4-31b, solo porque el
// perfil de respaldo usaba ese modelo y el nuevo también lo declara.

// Se comparan contra el default REAL del perfil en vez de contra un valor fijo:
// atarlos a un modelo concreto los rompía cada vez que Robert cambiaba su
// config, que es precisamente lo que el código debe seguir.
const { resolverModeloDefault, resolverProviderDefault } = require('./connector.js')
const fs = require('fs'), os = require('os'), path = require('path')
const configEntrenador = () => {
  try { return fs.readFileSync(path.join(os.homedir(), '.hermes', 'profiles', 'entrenador', 'config.yaml'), 'utf8') } catch (_) { return '' }
}

test('al fijar el perfil se adopta SU default, no el modelo heredado', () => {
  const cfg = configEntrenador()
  if (!cfg) return   // sin el perfil en disco no hay nada que comparar
  const s = { id: 's1', perfil: 'default', perfilFijado: false, agentModel: 'un-modelo-heredado', agentProvider: 'otro', agentContext: {} }
  aplicarPerfilSesion(s, 'entrenador')
  assert.strictEqual(s.agentModel, resolverModeloDefault(cfg))
  assert.strictEqual(s.agentProvider, resolverProviderDefault(cfg))
})

test('una sesión sin modelo heredado también toma el default del perfil', () => {
  const cfg = configEntrenador()
  if (!cfg) return
  const s = { id: 's1', perfil: '', perfilFijado: false, agentModel: '', agentProvider: '', agentContext: {} }
  aplicarPerfilSesion(s, 'entrenador')
  assert.strictEqual(s.agentModel, resolverModeloDefault(cfg))
})
