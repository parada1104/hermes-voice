/**
 * Lectura del turno del agente desde el store de Hermes.
 *
 * Sustituye al raspado del TTY (`tty-hermes.js`). El worker de Orca se queda
 * como está: es lo que mantiene el REPL vivo, evita el arranque en frío y le da
 * visibilidad a Robert. Lo único que cambia es de dónde sale la respuesta.
 *
 * Por qué el store y no el TTY: Hermes persiste cada mensaje del turno en
 * `state.db` ANTES de devolver el prompt — el mensaje del usuario, cada petición
 * de herramienta, cada resultado y la respuesta final, cada uno en su fila. El
 * TTY, en cambio, es un TUI que repinta: la respuesta llegaba con fragmentos
 * apilados, cortada por scroll o mezclada con el banner, y todo `tty-hermes.js`
 * existía para compensar eso.
 *
 * Por qué SQLite y no la API HTTP del backend: la API lee este mismo store, así
 * que exige un `hermes serve` vivo, un puerto y un token de sesión para llegar a
 * los mismos datos. Leyendo el archivo no hace falta ninguna de las tres cosas.
 *
 * Se lee SIEMPRE en solo lectura (`mode=ro`): el dueño del store es Hermes.
 */

const os = require('os')
const path = require('path')
const { promisify } = require('util')
const execFileAsync = promisify(require('child_process').execFile)

const SQLITE_BIN = process.env.HV_SQLITE_BIN || 'sqlite3'
// El formato real que emite Hermes: `AAAAMMDD_HHMMSS_hex`.
const RE_SESION_AGENTE = /^\d{8}_\d{6}_[a-z0-9]+$/
const RE_PERFIL = /^[A-Za-z0-9_-]+$/

// El CLI de sqlite3 no acepta parámetros ligados en esta forma de invocación, así
// que los dos únicos valores que entran al SQL se validan contra su formato real
// y el resto se rechaza. Un `desde` se fuerza a entero.
function esSesionAgente(v) { return typeof v === 'string' && RE_SESION_AGENTE.test(v) }
function esPerfilValido(v) { return v === '' || (typeof v === 'string' && RE_PERFIL.test(v)) }

const { esPerfilDefault } = require('./perfiles')

// Cada perfil tiene su propio store; el perfil raíz vive directamente en ~/.hermes.
function rutaStore(perfil) {
  const raiz = path.join(os.homedir(), '.hermes')
  return esPerfilDefault(perfil) || !perfil
    ? path.join(raiz, 'state.db')
    : path.join(raiz, 'profiles', perfil, 'state.db')
}

/**
 * Un turno cierra cuando el agente responde sin pedir nada más.
 *
 * NO se exige `finish_reason`, y eso está medido: sondeando el store cada 400ms
 * sobre una respuesta que tardó 19s, la fila del assistant nunca aparece a
 * medias — pasa de no existir a existir completa. No hay estado intermedio del
 * que protegerse, así que exigirlo solo servía para no cerrar nunca los turnos
 * en los que el modelo devuelve vacío (visto en vivo: 360s colgado por una fila
 * assistant sin contenido y sin `finish_reason`). Eso es un desenlace pobre,
 * pero desenlace: sin tool_calls el bucle del agente no tiene con qué seguir.
 *
 * Lo que sí importa es `tool_calls`: un assistant que pide herramienta puede
 * traer texto narrado ("voy a leer las notas") sin que el turno haya terminado.
 */
function turnoCompleto(filas) {
  const ultima = filas[filas.length - 1]
  if (!ultima || ultima.role !== 'assistant') return false
  return !ultima.tool_calls
}

function nombresToolCalls(json) {
  if (!json) return []
  let parsed
  try { parsed = JSON.parse(json) } catch (_) { return [] }
  if (!Array.isArray(parsed)) return []
  return parsed.map(c => c?.function?.name).filter(n => typeof n === 'string' && n)
}

/**
 * Compacta el turno en lo que la capa conversacional necesita:
 *  · `texto`        — la respuesta final del agente, para sintetizar.
 *  · `herramientas` — lo que REALMENTE corrió, en orden. Se toma de las filas
 *                     `tool` y no del `tool_calls` del assistant: eso último es
 *                     lo que el modelo pidió, que no siempre es lo que se ejecutó.
 *  · `avances`      — el texto que el agente narró mientras seguía trabajando.
 *                     Es lo que permite hablar durante una tool call larga.
 */
function resumenTurno(filas) {
  const lista = Array.isArray(filas) ? filas : []
  const herramientas = []
  const avances = []
  let texto = ''
  for (const f of lista) {
    if (f.role === 'tool' && f.tool_name) herramientas.push(f.tool_name)
    if (f.role !== 'assistant') continue
    const contenido = String(f.content || '').trim()
    if (f.tool_calls) { if (contenido) avances.push(contenido) }
    else if (contenido) texto = contenido
  }
  const ultimoId = lista.length ? Number(lista[lista.length - 1].id) || 0 : 0
  return { texto, herramientas, avances, ultimoId }
}

/**
 * Qué contarle a la capa cuando el turno NO dejó respuesta: se cortó por tiempo,
 * o cerró con el modelo devolviendo vacío.
 *
 * Existe por una medición incómoda: un turno dado por perdido a los 360s tenía
 * la respuesta en disco —6913 caracteres— y seis búsquedas web ya hechas. Se
 * tiraba entero y Robert escuchaba "no devolvió nada". El store sabe lo que el
 * agente alcanzó a hacer; esto lo pone en palabras para que la capa lo sintetice
 * con honestidad en vez de inventarse una respuesta o callarse.
 *
 * Son HECHOS, no prosa: la redacción para Robert la hace la capa, no el worker.
 */
function informeParcial({ texto = '', herramientas = [], avances = [], motivo = '' } = {}) {
  if (!texto && !herramientas.length && !avances.length) return ''
  const lineas = [`[TURNO SIN RESPUESTA FINAL — motivo: ${motivo || 'desconocido'}]`]
  if (herramientas.length) {
    // Agrupado: un agente que lee 20 archivos generaría una lista ilegible, y lo
    // que importa es qué hizo y cuánto, no el orden exacto de cada repetición.
    const cuenta = new Map()
    for (const h of herramientas) cuenta.set(h, (cuenta.get(h) || 0) + 1)
    const detalle = [...cuenta].map(([n, c]) => (c > 1 ? `${n} (${c} veces)` : n)).join(', ')
    lineas.push(`Herramientas que el agente alcanzó a ejecutar: ${detalle}`)
  }
  for (const a of avances) lineas.push(`El agente narró: ${a}`)
  lineas.push(texto ? `Texto parcial: ${texto}` : 'El agente no escribió respuesta final.')
  return lineas.join('\n')
}

// `consultar` se inyecta para poder probar el ciclo sin tocar un store real.
async function consultarSqlite(ruta, sql) {
  // `mode=ro` es la garantía de que nunca escribimos en el store de Hermes.
  const uri = `file:${ruta}?mode=ro`
  const { stdout } = await execFileAsync(SQLITE_BIN, ['-json', uri, sql], { timeout: 15000, maxBuffer: 64 * 1024 * 1024 })
  const texto = String(stdout || '').trim()
  if (!texto) return []   // sqlite3 -json no imprime nada cuando no hay filas
  try { return JSON.parse(texto) } catch (_) { return [] }
}

function crearLectorStore({ consultar = consultarSqlite } = {}) {
  function validar(perfil, sesion) {
    if (!esPerfilValido(perfil)) throw new Error(`Perfil inválido para el store: ${perfil}`)
    if (!esSesionAgente(sesion)) throw new Error(`Sesión de agente inválida: ${sesion}`)
  }

  return {
    // Marca de agua ANTES de enviar el pedido: todo lo que aparezca después es
    // el turno nuevo. Sin ella habría que adivinar dónde empieza.
    async ultimoId(perfil, sesion) {
      validar(perfil, sesion)
      const filas = await consultar(rutaStore(perfil), `select max(id) as ultimo from messages where session_id='${sesion}';`)
      return Number(filas?.[0]?.ultimo) || 0
    },

    // Las conversaciones abiertas a partir de `desdeTs`. Una candidata no
    // aparece hasta que escribe su primer mensaje: un REPL recién arrancado
    // todavía no existe aquí.
    async sesionesDesde(perfil, desdeTs) {
      if (!esPerfilValido(perfil)) throw new Error(`Perfil inválido para el store: ${perfil}`)
      const corte = Number(desdeTs) || 0
      return consultar(rutaStore(perfil), `select id, started_at from sessions where started_at >= ${corte} order by started_at desc limit 20;`)
    },

    /**
     * Qué conversación abrió el worker. Hace falta porque el REPL no la registra
     * hasta escribir el primer mensaje, así que no se puede saber antes de
     * enviar el pedido; y el `Session:` del banner tampoco alcanza: con un banner
     * largo se sale del frame visible.
     *
     * Se identifica por el PEDIDO, no por ser la más reciente: si Robert tiene
     * otro Hermes abierto en el mismo perfil, la más nueva podría ser la suya.
     * La comparación va en JS a propósito — así el texto del pedido nunca entra
     * al SQL.
     */
    async descubrirSesion(perfil, desdeTs, pedido) {
      const buscado = String(pedido || '').trim()
      if (!buscado) return ''
      for (const c of await this.sesionesDesde(perfil, desdeTs)) {
        if (!esSesionAgente(c.id)) continue
        const filas = await this.mensajesDesde(perfil, c.id, 0)
        const primero = filas.find(f => f.role === 'user')
        if (primero && String(primero.content || '').trim() === buscado) return c.id
      }
      return ''
    },

    async mensajesDesde(perfil, sesion, desde) {
      validar(perfil, sesion)
      const corte = Math.max(0, Math.floor(Number(desde) || 0))
      const sql = `select id, role, content, tool_calls, tool_name, finish_reason from messages`
        + ` where session_id='${sesion}' and id > ${corte} and active = 1 order by id;`
      return consultar(rutaStore(perfil), sql)
    },
  }
}

module.exports = { rutaStore, esSesionAgente, esPerfilValido, turnoCompleto, nombresToolCalls, resumenTurno, informeParcial, crearLectorStore, consultarSqlite, SQLITE_BIN }
