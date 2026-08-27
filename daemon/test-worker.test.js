// Tests del manager de workers de Orca.
//
// Regla acordada: UN worker vivo a la vez, el de la sesión de voz activa. La
// identidad de la conversación NO vive en el worker —vive en el agentSessionId,
// que persiste— así que el worker es descartable. Con un solo worker la
// exclusión mutua sale gratis: no puede haber dos conversaciones que sincronizar.
const test = require('node:test')
const assert = require('node:assert')
const { handleDeRespuesta, sesionAgenteDelBanner, decidirWorker, comandoWorker, tituloWorker } = require('./worker.js')

/* ── Lectura de las respuestas del CLI de Orca ── */

test('extrae el handle de un terminal create', () => {
  assert.strictEqual(
    handleDeRespuesta({ ok: true, result: { terminal: { handle: 'term_abc', status: 'running' } } }),
    'term_abc')
})

test('acepta el handle como cadena suelta', () => {
  assert.strictEqual(handleDeRespuesta({ result: { terminal: 'term_abc' } }), 'term_abc')
})

test('acepta la forma de lista', () => {
  assert.strictEqual(handleDeRespuesta({ result: { terminals: [{ handle: 'term_abc' }] } }), 'term_abc')
})

test('devuelve vacío si no hay handle, sin inventarlo', () => {
  for (const r of [{}, { ok: false }, { result: {} }, null, { result: { terminal: { handle: 'otra-cosa' } } }]) {
    assert.strictEqual(handleDeRespuesta(r), '')
  }
})

/* ── El banner del REPL trae la sesión del agente ── */

test('captura el agentSessionId del banner', () => {
  const tail = ['│  Profile: entrenador', '│  Session: 20260825_155132_44ba54', '│  21 tools · 4 skills']
  assert.strictEqual(sesionAgenteDelBanner(tail), '20260825_155132_44ba54')
})

test('si el banner no trae sesión devuelve vacío', () => {
  assert.strictEqual(sesionAgenteDelBanner(['│ Profile: entrenador', 'Welcome']), '')
})

test('se queda con la primera sesión del banner, no con una mención posterior', () => {
  const tail = ['Session: 20260825_111111_aaa', 'texto', 'Session: 20260825_222222_bbb']
  assert.strictEqual(sesionAgenteDelBanner(tail), '20260825_111111_aaa')
})

/* ── Decisión de ciclo de vida: un worker a la vez ── */

test('sin worker vivo hay que crear uno', () => {
  assert.deepStrictEqual(decidirWorker(null, 's1'), { accion: 'crear', cerrar: '' })
})

test('el worker de la sesión activa se reutiliza', () => {
  assert.deepStrictEqual(decidirWorker({ handle: 'term_a', sesionId: 's1' }, 's1'), { accion: 'reusar', cerrar: '' })
})

test('cambiar de sesión de voz cierra el anterior y crea el nuevo', () => {
  assert.deepStrictEqual(decidirWorker({ handle: 'term_a', sesionId: 's1' }, 's2'), { accion: 'crear', cerrar: 'term_a' })
})

test('un worker sin handle no se reutiliza aunque la sesión coincida', () => {
  assert.deepStrictEqual(decidirWorker({ handle: '', sesionId: 's1' }, 's1'), { accion: 'crear', cerrar: '' })
})

/* ── Comando del worker ── */

test('el worker arranca el REPL del perfil', () => {
  assert.strictEqual(comandoWorker({ perfil: 'entrenador' }), 'hermes --profile entrenador')
})

test('con sesión previa se retoma con --resume: ahí vive la continuidad', () => {
  assert.strictEqual(
    comandoWorker({ perfil: 'entrenador', agentSessionId: '20260825_1_a' }),
    'hermes --profile entrenador --resume 20260825_1_a --no-restore-cwd')
})

test('el perfil raíz corre sin --profile', () => {
  assert.strictEqual(comandoWorker({ perfil: 'default' }), 'hermes')
  assert.strictEqual(comandoWorker({ perfil: 'default', agentSessionId: 'x_1' }), 'hermes --resume x_1 --no-restore-cwd')
})

test('el título deja ver de qué conversación es el worker', () => {
  const t = tituloWorker({ id: 'coach-abc', titulo: 'coach', perfil: 'entrenador' })
  assert.ok(t.includes('coach'))
  assert.ok(t.includes('entrenador'))
})
