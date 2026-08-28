/**
 * Workers de Orca: el REPL de Hermes vivo dentro de un terminal de Orca.
 *
 * Regla acordada, y la razón de que este módulo sea tan corto:
 *
 *   UN worker vivo a la vez — el de la sesión de voz activa.
 *
 * La identidad de la conversación del agente NO vive en el worker: vive en el
 * `agentSessionId`, que persiste y se puede elegir al crear la sesión. El worker
 * es solo un proceso que resulta estar corriendo esa conversación, así que es
 * descartable. Con un único worker la exclusión mutua sale gratis: no hay dos
 * conversaciones vivas que sincronizar, no hace falta registro de dueños.
 *
 * El costo asumido a conciencia: cambiar de sesión de voz vuelve a pagar el
 * arranque en frío. Se optimiza manteniendo N workers tibios SOLO si molesta en
 * uso real; hasta entonces, un handle y su sesión dueña.
 */

const { esPerfilDefault } = require('./perfiles')
const { tareaTerminada } = require('./tty-hermes')
const { crearLectorStore, turnoCompleto, resumenTurno, informeParcial } = require('./store-hermes')
const { TIMEOUT_DELEGACION_POR_DEFECTO } = require('./timeouts')

const RE_HANDLE = /^term_[\w-]+$/
const RE_SESION_AGENTE = /Session:\s*(\d{8}_\d{6}_[a-z0-9]+)/i

function esHandle(v) { return typeof v === 'string' && RE_HANDLE.test(v) }

// El CLI devuelve el handle en varias formas según el subcomando.
function handleDeRespuesta(json) {
  const r = json?.result || json
  if (!r || typeof r !== 'object') return ''
  const candidatos = [
    r.terminal,
    r.terminal?.handle,
    Array.isArray(r.terminals) ? r.terminals[0] : null,
    Array.isArray(r.terminals) ? r.terminals[0]?.handle : null,
    r.handle,
  ]
  return candidatos.find(esHandle) || ''
}

// El banner del REPL imprime `Session: <id>`: de ahí se captura la sesión del
// agente cuando el worker la creó él mismo.
function sesionAgenteDelBanner(tail) {
  for (const linea of (tail || []).map(String)) {
    const m = linea.match(RE_SESION_AGENTE)
    if (m) return m[1]
  }
  return ''
}

function decidirWorker(actual, sesionIdPedida) {
  if (actual?.handle && actual.sesionId === sesionIdPedida) return { accion: 'reusar', cerrar: '' }
  return { accion: 'crear', cerrar: actual?.handle || '' }
}

function comandoWorker({ perfil, agentSessionId }) {
  const partes = ['hermes']
  if (!esPerfilDefault(perfil) && perfil) partes.push('--profile', perfil)
  if (agentSessionId) partes.push('--resume', agentSessionId, '--no-restore-cwd')
  return partes.join(' ')
}

// El título es lo que Robert ve en Orca: tiene que decir de qué conversación es.
function tituloWorker(sesion) {
  const nombre = (sesion?.titulo || sesion?.id || 'sesión').trim()
  return `hv · ${nombre} · ${sesion?.perfil || '—'}`
}

/**
 * Mantiene el único worker vivo y ejecuta el ciclo de delegación sobre él.
 * `orca` se inyecta para poder probar el ciclo sin la app.
 */
class GestorWorker {
  constructor({ orca, store = crearLectorStore(), log = () => {}, pollMs = 1500, timeoutMs = TIMEOUT_DELEGACION_POR_DEFECTO, graciaMs = 10000 } = {}) {
    this.orca = orca
    // De dónde sale la RESPUESTA. El terminal solo dice si el REPL está libre.
    this.store = store
    this.log = log
    this.pollMs = pollMs
    this.timeoutMs = timeoutMs
    // Margen tras ver el prompt de vuelta antes de dar el turno por cerrado sin
    // su fila final: cubre el desfase entre que Hermes repinta y que confirma
    // la escritura en el store.
    this.graciaMs = graciaMs
    this.actual = null   // { handle, sesionId, perfil, agentSessionId }
    // Hay UN worker global: todo acceso va en fila. Sin esto, dos `activate`
    // seguidos se pisan — uno crea el worker y el otro se lo cierra a mitad,
    // dejando al primero esperando un prompt en un terminal ya muerto.
    this.cola = Promise.resolve()
  }

  // Encola la operación y devuelve su resultado. Un fallo no rompe la fila.
  _enFila(operacion) {
    const siguiente = this.cola.then(operacion, operacion)
    this.cola = siguiente.then(() => {}, () => {})
    return siguiente
  }

  estado() { return { handle: this.actual?.handle || '', sesionId: this.actual?.sesionId || '', agentSessionId: this.actual?.agentSessionId || '' } }

  async _crear(sesion) {
    const comando = comandoWorker(sesion)
    const handle = await this.orca.crearTerminal({ titulo: tituloWorker(sesion), comando })
    if (!handle) throw new Error('Orca no devolvió handle del worker')
    this.actual = { handle, sesionId: sesion.id, perfil: sesion.perfil, agentSessionId: sesion.agentSessionId || '' }
    this.log('worker.creado', { sesionId: sesion.id, handle, comando })

    // El banner trae `Session: <id>`: así se conoce la conversación que abrió el
    // worker cuando la sesión de voz no traía una propia.
    const banner = await this._esperarPrompt(handle, sesion.perfil)
    if (!this.actual.agentSessionId) {
      const detectada = sesionAgenteDelBanner(banner.tail)
      if (detectada) { this.actual.agentSessionId = detectada; this.log('worker.sesion-agente', { sesionId: sesion.id, agentSessionId: detectada }) }
    }
    return this.actual
  }

  async _asegurar(sesion) {
    const { accion, cerrar } = decidirWorker(this.actual, sesion.id)
    if (cerrar) {
      // Un worker a la vez: el anterior se cierra antes de abrir el nuevo.
      await this.orca.cerrar(cerrar).catch(() => {})
      this.log('worker.cerrado', { handle: cerrar, motivo: 'cambio de sesión de voz' })
      this.actual = null
    }
    if (accion === 'reusar') return this.actual
    return this._crear(sesion)
  }

  // Sondea hasta que el prompt de ENTRADA vuelve. Solo se usa para saber que el
  // REPL está listo (arranque y liveness): la respuesta NO se lee de aquí.
  // `tui-idle` no sirve: en el spike dio satisfied:true con el agente todavía
  // arrancando, y hay que mirar la PANTALLA actual, no el acumulado — releer
  // desde un cursor viejo devolvía una ventana donde el prompt del banner seguía
  // presente y una tarea de 231s figuraba terminada con el agente aún leyendo.
  async _esperarPrompt(handle, perfil) {
    const inicio = Date.now()
    while (Date.now() - inicio < this.timeoutMs) {
      const pantalla = await this.orca.leerPantalla(handle)
      if (tareaTerminada(pantalla.tail || [], perfil)) return { tail: pantalla.tail || [] }
      await new Promise(res => setTimeout(res, this.pollMs))
    }
    throw Object.assign(new Error(`El worker no terminó en ${Math.round(this.timeoutMs / 1000)}s`), { timeout: true })
  }

  // Espera el turno LEYENDO EL STORE, no la pantalla. El turno cierra cuando
  // Hermes escribe su respuesta final; hasta entonces las filas que van
  // apareciendo son las herramientas que está corriendo.
  //
  // El prompt de vuelta se sigue mirando, pero solo como cota: si el turno
  // muriera sin escribir su cierre, sin esto habría que esperar el timeout
  // completo. Con el margen de gracia se corta en segundos y se devuelve lo que
  // haya, marcado como incompleto, que es más honesto que fingir una respuesta.
  async _esperarTurno(handle, perfil, { agentSessionId, desde, pedido, marca }) {
    const inicio = Date.now()
    let promptDesde = 0
    let ultimas = []
    let sesion = agentSessionId
    let corte = desde
    while (Date.now() - inicio < this.timeoutMs) {
      // Un REPL recién abierto no registra su conversación hasta escribir el
      // primer mensaje, así que la sesión solo se puede conocer DESPUÉS de haber
      // enviado el pedido. Se busca por el pedido, no por la más reciente.
      if (!sesion) {
        sesion = await this.store.descubrirSesion(perfil, marca, pedido)
        if (sesion) {
          corte = 0
          if (this.actual) this.actual.agentSessionId = sesion
          this.log('worker.sesion-agente', { agentSessionId: sesion, via: 'store' })
        }
      }
      ultimas = sesion ? await this.store.mensajesDesde(perfil, sesion, corte) : []
      if (turnoCompleto(ultimas)) return resumenTurno(ultimas)

      const pantalla = await this.orca.leerPantalla(handle).catch(() => null)
      if (pantalla && tareaTerminada(pantalla.tail || [], perfil)) {
        if (!promptDesde) promptDesde = Date.now()
        else if (Date.now() - promptDesde >= this.graciaMs) {
          this.log('worker.turno-incompleto', { perfil, agentSessionId: sesion, motivo: 'repl-libre', filas: ultimas.length })
          return { ...resumenTurno(ultimas), incompleto: true, motivo: 'repl-libre' }
        }
      } else promptDesde = 0

      await new Promise(res => setTimeout(res, this.pollMs))
    }
    // El tiempo se acabó, pero el store guarda lo que el agente SÍ alcanzó a
    // hacer. Tirarlo era el peor desenlace posible: medido en vivo, un turno
    // dado por perdido a los 360s tenía seis búsquedas web hechas y su
    // respuesta llegó a disco poco después. Robert escuchó "no devolvió nada".
    const parcial = resumenTurno(ultimas)
    if (parcial.texto || parcial.herramientas.length || parcial.avances.length) {
      this.log('worker.turno-incompleto', { perfil, agentSessionId: sesion, motivo: 'timeout', filas: ultimas.length })
      return { ...parcial, incompleto: true, motivo: 'timeout' }
    }
    // Sin una sola fila que contar, el fallo es la única verdad disponible.
    throw Object.assign(new Error(`El worker no terminó en ${Math.round(this.timeoutMs / 1000)}s`), { timeout: true })
  }

  // Se llama al entrar a la sesión de voz: deja el REPL arrancado para que la
  // primera delegación no pague el arranque en frío. Nunca lanza: si Orca no
  // está, la delegación lo reintentará por su cuenta.
  async precalentar(sesion) {
    return this._enFila(async () => {
      try {
        // No cerrar el worker existente por un simple cambio de sesión de voz:
        // eso mataba el REPL de Hermes con cada `activate` (close+create en
        // cadena). El switch real ocurre en `_delegar` cuando hay un pedido.
        if (this.actual?.handle) return this.actual.sesionId === sesion.id
        await this._crear(sesion)
        return true
      } catch (e) {
        this.log('worker.precalentado-falló', { sesionId: sesion?.id, error: e.message })
        this.actual = null
        return false
      }
    })
  }

  async delegar(sesion, pedido) {
    return this._enFila(() => this._delegar(sesion, pedido))
  }

  async _delegar(sesion, pedido) {
    let worker = await this._asegurar(sesion)
    // Dos marcas de agua ANTES de enviar, para no confundir el turno nuevo con
    // lo que ya había: el último mensaje si ya conocemos la conversación, y el
    // instante si todavía hay que descubrirla. Los 2s de holgura absorben el
    // desfase entre el reloj de Hermes al sellar `started_at` y el nuestro.
    const desde = worker.agentSessionId ? await this.store.ultimoId(sesion.perfil, worker.agentSessionId) : 0
    const marca = Math.floor(Date.now() / 1000) - 2
    try {
      await this.orca.enviar(worker.handle, pedido)
    } catch (e) {
      // Handle muerto (Orca reiniciado, terminal cerrado a mano): se recrea.
      if (!e.stale && !/stale/i.test(e.message)) throw e
      this.log('worker.handle-muerto', { handle: worker.handle })
      this.actual = null
      worker = await this._crear(sesion)
      await this.orca.enviar(worker.handle, pedido)
    }
    const turno = await this._esperarTurno(worker.handle, sesion.perfil, { agentSessionId: worker.agentSessionId, desde, pedido, marca })
    this.ultimoTurno = turno
    this.log('worker.turno', {
      sesionId: sesion.id,
      agentSessionId: this.actual?.agentSessionId || worker.agentSessionId,
      herramientas: turno.herramientas.length, avances: turno.avances.length,
      chars: turno.texto.length, incompleto: !!turno.incompleto, motivo: turno.motivo || '',
    })
    // Con respuesta, la respuesta. Sin ella —cortado por tiempo, o cerrado con
    // el modelo devolviendo vacío— se entregan los HECHOS del store en vez de
    // una cadena vacía: la capa prefiere sintetizar "leyó el plan y buscó tres
    // veces" antes que decirle a Robert que no pasó nada.
    if (turno.texto && !turno.incompleto) return turno.texto
    return informeParcial(turno) || turno.texto
  }

  async cerrar() {
    return this._enFila(() => this._cerrar())
  }

  async _cerrar() {
    if (!this.actual?.handle) return false
    await this.orca.cerrar(this.actual.handle).catch(() => {})
    this.log('worker.cerrado', { handle: this.actual.handle, motivo: 'cierre explícito' })
    this.actual = null
    return true
  }
}

module.exports = { handleDeRespuesta, sesionAgenteDelBanner, decidirWorker, comandoWorker, tituloWorker, esHandle, GestorWorker }
