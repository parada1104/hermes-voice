// Tests del ciclo de delegación sobre un worker de Orca, con cliente falso.
const test = require('node:test')
const assert = require('node:assert')
const { GestorWorker } = require('./worker.js')

// Store falso: es de donde sale la RESPUESTA desde que se dejó de raspar el TTY.
// Devuelve el turno cerrado solo cuando el cliente falso ya pasó a 'listo', para
// que el gestor tenga que sondear igual que en vivo.
function storeFalso(orca, { respuesta = 'PONG', herramientas = [] } = {}) {
  return {
    async ultimoId() { return 0 },
    async mensajesDesde() {
      if (orca.estado !== 'listo') return []
      const filas = herramientas.map((n, i) => ({ id: i + 1, role: 'tool', tool_name: n, content: '{}', tool_calls: null, finish_reason: null }))
      filas.push({ id: filas.length + 1, role: 'assistant', content: respuesta, tool_calls: null, tool_name: null, finish_reason: 'stop' })
      return filas
    },
  }
}

// Gestor con el par (Orca falso, store falso) ya enlazado: el store observa el
// estado del terminal, así que tienen que construirse juntos.
function gestorFalso(orca, opciones = {}) {
  const { respuesta, herramientas, ...resto } = opciones
  return new GestorWorker({ orca, store: storeFalso(orca, { respuesta, herramientas }), pollMs: 1, graciaMs: 50, ...resto })
}

// Cliente falso que imita las respuestas reales medidas en el spike.
function orcaFalso({ respuesta = 'PONG', perfil = 'entrenador', fallaCrear = false, handleMuerto = false } = {}) {
  const c = {
    creados: [], enviados: [], cerrados: [], lecturas: 0, disponible: async () => true,
    async crearTerminal({ titulo, comando }) {
      if (fallaCrear) throw new Error('orca no responde')
      const handle = `term_${c.creados.length + 1}`
      c.creados.push({ handle, titulo, comando })
      c.estado = 'banner'
      return handle
    },
    async enviar(handle, texto) {
      if (handleMuerto) { const e = new Error('terminal_handle_stale'); e.stale = true; throw e }
      c.enviados.push({ handle, texto }); c.estado = 'trabajando'
      return true
    },
    async leer(handle) {
      c.lecturas++
      if (c.estado === 'banner') return { tail: ['│ Profile: ' + perfil, '│ Session: 20260825_155132_44ba54', `${perfil} ❯`], latestCursor: '10' }
      // Primera lectura tras enviar: sigue trabajando. Segunda: terminó.
      if (c.estado === 'trabajando') { c.estado = 'listo'; return { tail: ['⚕ ❯ msg=interrupt · /queue'], latestCursor: '20' } }
      return { tail: ['╭─ ⚕ Hermes ───╮', respuesta, '╰──────────────╯', `${perfil} ❯`], latestCursor: '30' }
    },
    async leerPantalla(handle) { return c.leer(handle) },
    async cerrar(handle) { c.cerrados.push(handle); return true },
  }
  return c
}

const sesion = (over = {}) => ({ id: 's1', titulo: 'coach', perfil: 'entrenador', agentSessionId: '', ...over })

test('la primera delegación levanta el worker y devuelve la respuesta limpia', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  assert.strictEqual(await g.delegar(sesion(), 'hola'), 'PONG')
  assert.strictEqual(orca.creados.length, 1)
  assert.ok(orca.creados[0].comando.includes('--profile entrenador'))
})

test('el worker se reutiliza en la segunda delegación de la misma sesión', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.delegar(sesion(), 'uno')
  await g.delegar(sesion(), 'dos')
  assert.strictEqual(orca.creados.length, 1, 'no debe recrear el worker')
  assert.strictEqual(orca.enviados.length, 2)
})

test('cambiar de sesión de voz cierra el worker anterior', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.delegar(sesion({ id: 's1' }), 'uno')
  await g.delegar(sesion({ id: 's2' }), 'dos')
  assert.deepStrictEqual(orca.cerrados, ['term_1'])
  assert.strictEqual(orca.creados.length, 2)
})

test('nunca hay dos workers vivos: la exclusión sale del diseño', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.delegar(sesion({ id: 's1' }), 'uno')
  await g.delegar(sesion({ id: 's2' }), 'dos')
  await g.delegar(sesion({ id: 's3' }), 'tres')
  assert.strictEqual(orca.creados.length - orca.cerrados.length, 1)
})

test('captura el agentSessionId del banner cuando la sesión no traía uno', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  const s = sesion()
  await g.delegar(s, 'hola')
  assert.strictEqual(g.estado().agentSessionId, '20260825_155132_44ba54')
})

test('una sesión con agentSessionId propio retoma con --resume', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.delegar(sesion({ agentSessionId: '20260825_9_z' }), 'hola')
  assert.ok(orca.creados[0].comando.includes('--resume 20260825_9_z'))
})

test('no entrega mientras el agente trabaja: sondea el store hasta que cierra el turno', async () => {
  const orca = orcaFalso()
  let sondeos = 0
  const store = storeFalso(orca)
  const espiado = { ultimoId: store.ultimoId, mensajesDesde: async (...a) => { sondeos++; return store.mensajesDesde(...a) } }
  const g = new GestorWorker({ orca, store: espiado, pollMs: 1, graciaMs: 50 })
  assert.strictEqual(await g.delegar(sesion(), 'hola'), 'PONG')
  assert.ok(sondeos >= 2, 'la primera lectura del store cae con el agente todavía trabajando')
})

test('el turno trae las herramientas que corrió, no solo el texto', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca, { herramientas: ['skill_view', 'read_file'] })
  await g.delegar(sesion(), 'hola')
  assert.deepStrictEqual(g.ultimoTurno.herramientas, ['skill_view', 'read_file'])
})

// Pasó en vivo: con un banner largo el `Session: <id>` se sale del frame
// visible, y `leerPantalla` solo devuelve lo que se ve. Depender del banner
// dejaba la delegación sin saber qué conversación leer.
test('si el banner no muestra la sesión, se descubre por el store', async () => {
  const orca = orcaFalso()
  const conBanner = orca.leer
  orca.leer = async (h) => {
    const r = await conBanner(h)
    return { ...r, tail: r.tail.filter(l => !/Session:/.test(l)) }
  }
  orca.leerPantalla = orca.leer
  const store = storeFalso(orca)
  const g = new GestorWorker({
    orca, pollMs: 1, graciaMs: 50,
    store: { ...store, async descubrirSesion() { return orca.estado === 'listo' ? '20260826_010000_aaaaaa' : '' } },
  })
  assert.strictEqual(await g.delegar(sesion(), 'hola'), 'PONG')
  assert.strictEqual(g.estado().agentSessionId, '20260826_010000_aaaaaa')
})

test('el descubrimiento busca por el pedido enviado', async () => {
  const orca = orcaFalso()
  const conBanner = orca.leer
  orca.leer = async (h) => { const r = await conBanner(h); return { ...r, tail: r.tail.filter(l => !/Session:/.test(l)) } }
  orca.leerPantalla = orca.leer
  const store = storeFalso(orca)
  let pedidoVisto = ''
  const g = new GestorWorker({
    orca, pollMs: 1, graciaMs: 50,
    store: { ...store, async descubrirSesion(_p, _ts, pedido) { pedidoVisto = pedido; return orca.estado === 'listo' ? '20260826_010000_aaaaaa' : '' } },
  })
  await g.delegar(sesion(), 'contá los .md')
  assert.strictEqual(pedidoVisto, 'contá los .md')
})

test('un handle muerto se recrea en vez de fallar', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.delegar(sesion(), 'uno')
  orca.enviar = async (handle, texto) => {
    if (handle === 'term_1') { const e = new Error('terminal_handle_stale'); e.stale = true; throw e }
    orca.enviados.push({ handle, texto }); orca.estado = 'trabajando'; return true
  }
  assert.strictEqual(await g.delegar(sesion(), 'dos'), 'PONG')
  assert.strictEqual(orca.creados.length, 2, 'debe haber recreado el worker')
})

test('si Orca no puede crear el worker, el error se propaga sin dejar estado sucio', async () => {
  const g = gestorFalso(orcaFalso({ fallaCrear: true }))
  await assert.rejects(() => g.delegar(sesion(), 'hola'), /orca no responde/)
  assert.strictEqual(g.estado().handle, '')
})

test('cerrar libera el worker y deja el gestor limpio', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.delegar(sesion(), 'hola')
  await g.cerrar()
  assert.deepStrictEqual(orca.cerrados, ['term_1'])
  assert.strictEqual(g.estado().handle, '')
})

test('el timeout corta la espera en vez de sondear para siempre', async () => {
  const orca = orcaFalso()
  orca.leer = async () => ({ tail: ['⚕ ❯ msg=interrupt · /queue'], latestCursor: '1' })
  const g = gestorFalso(orca, { timeoutMs: 30 })
  await assert.rejects(() => g.delegar(sesion(), 'hola'), e => e.timeout === true)
})

/* ── Precalentado: el worker se levanta al entrar a la sesión ── */
// Si se espera a la primera delegación, Robert paga el arranque en frío justo
// cuando ya pidió algo. Entrar a la conversación es la señal para tenerlo listo.

test('precalentar deja el worker listo sin enviar nada', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.precalentar(sesion())
  assert.strictEqual(orca.creados.length, 1)
  assert.strictEqual(orca.enviados.length, 0, 'precalentar no delega')
  assert.ok(g.estado().handle)
})

test('tras precalentar, la delegación reutiliza el worker', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.precalentar(sesion())
  assert.strictEqual(await g.delegar(sesion(), 'hola'), 'PONG')
  assert.strictEqual(orca.creados.length, 1, 'no debe crear otro')
})

test('precalentar dos veces la misma sesión no duplica workers', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.precalentar(sesion())
  await g.precalentar(sesion())
  assert.strictEqual(orca.creados.length, 1)
})

test('precalentar otra sesión cierra el worker anterior', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.precalentar(sesion({ id: 's1' }))
  await g.precalentar(sesion({ id: 's2' }))
  assert.deepStrictEqual(orca.cerrados, ['term_1'])
})

test('si el precalentado falla no rompe: la delegación lo reintenta', async () => {
  const orca = orcaFalso({ fallaCrear: true })
  const g = gestorFalso(orca)
  assert.strictEqual(await g.precalentar(sesion()), false)
  assert.strictEqual(g.estado().handle, '')
})

/* ── Concurrencia: las operaciones sobre el worker deben serializarse ── */
// Visto en vivo: dos `activate` seguidos (la app entra a una sesión y enseguida
// a otra) se pisaban. Uno creaba el worker y el otro se lo cerraba a mitad,
// dejando al primero esperando un prompt en un terminal muerto hasta el timeout
// de 240s. Con un único worker global, todo acceso tiene que ir en fila.

test('dos precalentados concurrentes no se pisan', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await Promise.all([g.precalentar(sesion({ id: 's1' })), g.precalentar(sesion({ id: 's2' }))])
  assert.strictEqual(orca.creados.length - orca.cerrados.length, 1, 'debe quedar exactamente un worker')
  assert.ok(g.estado().handle)
})

test('una delegación no arranca a mitad de un precalentado', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  const [, texto] = await Promise.all([g.precalentar(sesion()), g.delegar(sesion(), 'hola')])
  assert.strictEqual(texto, 'PONG')
  assert.strictEqual(orca.creados.length, 1, 'no debe crear dos workers para la misma sesión')
})

test('delegaciones concurrentes se resuelven en fila, no en paralelo', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  const rs = await Promise.all([g.delegar(sesion(), 'uno'), g.delegar(sesion(), 'dos'), g.delegar(sesion(), 'tres')])
  assert.deepStrictEqual(rs, ['PONG', 'PONG', 'PONG'])
  assert.strictEqual(orca.creados.length, 1)
  assert.strictEqual(orca.enviados.length, 3)
})

test('un fallo en la fila no bloquea las operaciones siguientes', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca, { timeoutMs: 20 })
  const leerBueno = orca.leer
  // El worker ya existe; lo que se cuelga es el turno.
  await g.precalentar(sesion())
  orca.leer = async () => ({ tail: ['⚕ trabajando…'], latestCursor: '1' })
  await assert.rejects(() => g.delegar(sesion(), 'se cuelga'), e => e.timeout === true)
  orca.leer = leerBueno; orca.estado = 'listo'
  g.timeoutMs = 5000
  assert.strictEqual(await g.delegar(sesion(), 'ahora sí'), 'PONG')
})

/* ── El terminal como cota, no como fuente ── */
// La respuesta sale del store. La pantalla se sigue mirando por una sola razón:
// si un turno muriera sin escribir su fila final, sin esa señal habría que
// esperar el timeout completo —minutos— para enterarse.

test('prompt de vuelta sin turno cerrado: corta pronto y lo marca incompleto', async () => {
  const orca = orcaFalso()
  // El REPL queda libre pero el store nunca cierra el turno.
  const store = { async ultimoId() { return 0 }, async mensajesDesde() { return [{ id: 1, role: 'tool', tool_name: 'read_file', content: '{}', tool_calls: null, finish_reason: null }] } }
  const g = new GestorWorker({ orca, store, pollMs: 1, graciaMs: 20, timeoutMs: 5000 })
  const t0 = Date.now()
  const r = await g.delegar(sesion(), 'hola')
  // Entrega los HECHOS del store, y dice explícitamente que no hubo respuesta:
  // lo que no puede hacer es inventar una ni callarse lo que el agente sí hizo.
  assert.match(r, /read_file/)
  assert.match(r, /no escribió respuesta final/i)
  assert.strictEqual(g.ultimoTurno.incompleto, true)
  assert.strictEqual(g.ultimoTurno.motivo, 'repl-libre')
  assert.deepStrictEqual(g.ultimoTurno.herramientas, ['read_file'])
  assert.ok(Date.now() - t0 < 2000, 'no debe esperar el timeout completo')
})

test('una lectura fallida de la pantalla no aborta la espera del turno', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca)
  await g.precalentar(sesion())
  const original = orca.leerPantalla
  let fallos = 0
  orca.leerPantalla = async (h) => { if (fallos++ < 2) throw new Error('orca ocupada'); return original(h) }
  assert.strictEqual(await g.delegar(sesion(), 'hola'), 'PONG')
})

/* ── Un turno perdido no debe tirar lo que el agente ya hizo ── */
// Medido en vivo: `coach-qi9a1g` dio timeout a los 360s y en el store estaban
// las seis búsquedas web, el archivo leído, el patch escrito y —minutos
// después— 6913 caracteres de respuesta. Robert escuchó "no devolvió nada".

const filaTool = (n, i) => ({ id: i + 1, role: 'tool', tool_name: n, content: '{}', tool_calls: null, finish_reason: null })

test('el timeout entrega lo que el store tiene, no un fallo pelado', async () => {
  const orca = orcaFalso()
  const store = {
    async ultimoId() { return 0 },
    async mensajesDesde() { return ['read_file', 'web_search'].map(filaTool) },   // nunca cierra
  }
  const g = new GestorWorker({ orca, store, pollMs: 1, graciaMs: 999999, timeoutMs: 60 })
  const r = await g.delegar(sesion(), 'hola')
  assert.match(r, /read_file/)
  assert.match(r, /web_search/)
  assert.strictEqual(g.ultimoTurno.incompleto, true)
  assert.strictEqual(g.ultimoTurno.motivo, 'timeout')
})

test('si NO hay nada que contar, el timeout sigue siendo un fallo', async () => {
  const orca = orcaFalso()
  const store = { async ultimoId() { return 0 }, async mensajesDesde() { return [] } }
  const g = new GestorWorker({ orca, store, pollMs: 1, graciaMs: 999999, timeoutMs: 60 })
  await assert.rejects(() => g.delegar(sesion(), 'hola'), e => e.timeout === true)
})

// La fila 967 del caso real: el modelo devolvió vacío. El turno CIERRA, pero
// entregar '' hacía que la capa dijera "volvió sin resultado" ocultando que el
// agente había leído y buscado.
test('un turno que cierra sin texto entrega igual lo que hizo el agente', async () => {
  const orca = orcaFalso()
  const store = {
    async ultimoId() { return 0 },
    async mensajesDesde() {
      if (orca.estado !== 'listo') return []
      return [...['read_file', 'web_search', 'web_search'].map(filaTool),
        { id: 9, role: 'assistant', content: '', tool_calls: null, tool_name: null, finish_reason: null }]
    },
  }
  const g = new GestorWorker({ orca, store, pollMs: 1, graciaMs: 50 })
  const r = await g.delegar(sesion(), 'hola')
  assert.match(r, /web_search \(2 veces\)/)
  assert.match(r, /no escribió respuesta final/i)
})

test('un turno normal sigue devolviendo el texto pelado, sin informe', async () => {
  const orca = orcaFalso()
  const g = gestorFalso(orca, { herramientas: ['read_file'] })
  assert.strictEqual(await g.delegar(sesion(), 'hola'), 'PONG')
})
