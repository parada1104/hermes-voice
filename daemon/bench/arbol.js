#!/usr/bin/env node
/**
 * Bench del árbol de decisión de la capa conversacional (D9, design.md).
 *
 * `capa.js:21-49` documenta, a mano y en comentarios, cada remedición del
 * modelo: N turnos, cuántos delegó bien, cuántas reparaciones (reintento +
 * rescate), TTFB p50/p90. Cada vez que cambiaba el prompt o el modelo, alguien
 * tenía que volver a correr los turnos a mano y pegar los números en un
 * comentario. Esto automatiza exactamente eso.
 *
 * Dos modos, porque tienen objetivos distintos y uno solo no alcanza:
 *
 *   --live    pega al proveedor real (vía `daemon/connector.js`), graba el
 *             `bruto` (los mensajes CRUDOS del modelo en cada etapa: llamada
 *             inicial, reintento, rescate) y escribe una línea de base fechada
 *             en `daemon/bench/baseline-<fecha>.json`. Caro y no determinista
 *             (el proveedor puede variar entre corridas): por eso es manual,
 *             en puntos de decisión, nunca en cada `node --test`.
 *
 *   --replay  reproduce el CLASIFICADOR PURO (`clasificarDesdeBruto` y todo lo
 *             que usa) sobre el `bruto` ya grabado de una línea de base, sin
 *             red. Es la guarda de regresión de todos los días: detecta si un
 *             cambio en la LÓGICA de clasificación (no en el modelo) cambia el
 *             resultado que ya se había medido. Ciego al drift del modelo o
 *             del proveedor a propósito — para eso está --live.
 *
 * El bench NUNCA delega de verdad: solo llama a la capa conversacional para
 * ver qué decide, nunca a `delegarAgenente`. Un bench que dispara al agente
 * real en cada corrida sería costoso y, peor, tendría efectos secundarios
 * reales (archivos escritos, tareas disparadas) por el solo hecho de medir.
 */
'use strict'

const path = require('path')
const fs = require('fs')

const {
  VOICE_PROMPT, ORCA_TOOL, TOOL_DELEGAR, llmCerebras, llmCerebrasStream, normalizarToolCall,
} = require('../connector.js')
const { prometeAccion, turnoVacio, limpiarPedido } = require('../promesas.js')
const { contieneToolCall } = require('../streaming.js')

const BENCH_DIR = __dirname
const TURNOS_PATH = path.join(BENCH_DIR, 'turnos.json')

/* ── Ramas conocidas. 'cancelar' no es alcanzable con el árbol de una sola
   tool: documentarla igual es el punto — la ausencia es el dato que M2 debe
   dejar registrado antes de que Slice 4 le agregue una tool de cancelación. */
const RAMAS = ['responder', 'delegar', 'cancelar', 'nada']

/* ── Utilidades puras, sin red ── */

// Calcada de `connector.js:argumentosTool` (no exportada desde allá): decodifica
// los argumentos de un tool call sin romperse si vienen mal formados.
function argumentosTool(toolCall) {
  if (!toolCall?.arguments) return {}
  if (typeof toolCall.arguments === 'object') return toolCall.arguments
  try { return JSON.parse(toolCall.arguments) } catch (_) { return {} }
}

// Mismos alias que `connector.js:TOOLS_CONOCIDAS` (no exportada): el modelo a
// veces insiste con un nombre viejo de la herramienta.
const NOMBRES_HERRAMIENTA = [TOOL_DELEGAR, 'delegar_a_orca', 'delegate_to_agent', 'delegar_a_hermes']

function esFormatoValido(toolCall) {
  if (!toolCall || !NOMBRES_HERRAMIENTA.includes(toolCall.name)) return false
  const args = argumentosTool(toolCall)
  return typeof args.pedido === 'string' && args.pedido.trim().length > 0
}

// La rama efectiva de un turno YA normalizado (post reintento/rescate).
function clasificarRama(normalizada) {
  if (normalizada.toolCall) return 'delegar'
  if (turnoVacio(normalizada.preambulo, null)) return 'nada'
  return 'responder'
}

// Mismas condiciones que `connector.js:procesarTurno` (líneas ~1066 y ~1094)
// para disparar el reintento y el rescate. Puras: no llaman a nada, solo miran
// el resultado ya normalizado. Se usan TANTO en vivo (para decidir si hace
// falta llamar de nuevo al proveedor) como en replay (para saber si el
// `bruto` grabado DEBERÍA traer esa etapa).
function necesitaReintento(normalizada) {
  if (normalizada.toolCall) return false
  return contieneToolCall(normalizada.preambulo) || prometeAccion(normalizada.preambulo)
}
function necesitaRescate(normalizada) {
  if (normalizada.toolCall) return false
  return prometeAccion(normalizada.preambulo) || turnoVacio(normalizada.preambulo, normalizada.toolCall)
}

/**
 * El clasificador puro: a partir del `bruto` (mensajes crudos del modelo en
 * cada etapa), reproduce el árbol de decisión de `procesarTurno` sin red.
 *
 * Si el `bruto` no trae una etapa que la lógica actual pide (por ejemplo,
 * porque la lógica cambió desde que se grabó la línea de base), NO se inventa
 * una mejora: se cuenta la reparación como pedida y se marca
 * `datosIncompletos`, dejando la clasificación tal como estaba antes de esa
 * etapa. Un replay que "arregla" un turno con datos que no tiene es peor que
 * uno que admite que no puede reproducirlo.
 */
function clasificarDesdeBruto(bruto) {
  let reparaciones = 0
  let datosIncompletos = false
  let normalizada = normalizarToolCall(bruto.inicial?.message)

  if (necesitaReintento(normalizada)) {
    reparaciones++
    const promesaRota = prometeAccion(normalizada.preambulo)
    if (bruto.reintento) {
      const reNorm = normalizarToolCall(bruto.reintento.message)
      const mejora = reNorm.toolCall || (!contieneToolCall(reNorm.preambulo) && !(promesaRota && prometeAccion(reNorm.preambulo)))
      if (mejora) normalizada = reNorm
    } else {
      datosIncompletos = true
    }
  }

  if (necesitaRescate(normalizada)) {
    reparaciones++
    const vacio = turnoVacio(normalizada.preambulo, normalizada.toolCall)
    if (bruto.rescate) {
      const pedido = limpiarPedido(bruto.rescate.message?.content || '')
      if (pedido && !/^nada\.?$/i.test(pedido)) {
        normalizada = { toolCall: { name: TOOL_DELEGAR, arguments: JSON.stringify({ pedido }) }, preambulo: normalizada.preambulo }
      }
      // Si el rescate contestó "NADA", no hay mejora: la clasificación sigue
      // el camino normal (turnoVacio -> 'nada' o texto real -> 'responder').
    } else if (!vacio) {
      datosIncompletos = true
    }
  }

  const rama = clasificarRama(normalizada)
  const formatoValido = !normalizada.toolCall || esFormatoValido(normalizada.toolCall)
  return { rama, reparaciones, formatoValido, datosIncompletos, toolCall: normalizada.toolCall, preambulo: normalizada.preambulo }
}

/* ── Percentiles: rango-más-cercano, igual de simple que lo que ya se hacía a
   mano en los comentarios de capa.js. */
function percentil(valores, p) {
  if (!valores.length) return null
  const ordenado = [...valores].sort((a, b) => a - b)
  const rango = Math.min(ordenado.length, Math.max(1, Math.ceil((p / 100) * ordenado.length)))
  return ordenado[rango - 1]
}

/**
 * Agrega resultados por turno en las métricas del bench: precisión por rama,
 * reparaciones totales, tasa de formato válido, TTFB p50/p90.
 *
 * `turnos` es un array de `{ id, rama (esperada), bruto, ttfbMs }`.
 */
function resolverMetricas(turnos) {
  const porRama = {}
  for (const r of RAMAS) porRama[r] = { correctos: 0, total: 0, precision: null }

  let reparaciones = 0
  let formatoTotal = 0
  let formatoValidos = 0
  const ttfbs = []
  const detalle = []

  for (const turno of turnos) {
    const clasificado = clasificarDesdeBruto(turno.bruto)
    const esperada = turno.rama
    if (!porRama[esperada]) porRama[esperada] = { correctos: 0, total: 0, precision: null }
    porRama[esperada].total++
    if (clasificado.rama === esperada) porRama[esperada].correctos++

    reparaciones += clasificado.reparaciones
    if (clasificado.toolCall) { formatoTotal++; if (clasificado.formatoValido) formatoValidos++ }
    if (typeof turno.ttfbMs === 'number') ttfbs.push(turno.ttfbMs)

    detalle.push({ id: turno.id, esperada, obtenida: clasificado.rama, correcto: clasificado.rama === esperada, reparaciones: clasificado.reparaciones, datosIncompletos: clasificado.datosIncompletos })
  }

  for (const r of Object.keys(porRama)) {
    const b = porRama[r]
    b.precision = b.total ? b.correctos / b.total : null
  }

  return {
    totalTurnos: turnos.length,
    porRama,
    reparaciones,
    formatoValidoRatio: formatoTotal ? formatoValidos / formatoTotal : null,
    ttfb: { p50: percentil(ttfbs, 50), p90: percentil(ttfbs, 90) },
    detalle,
  }
}

/**
 * Compara una medición contra una línea de base, con tolerancia (D9): una
 * caída de precisión por rama por debajo de `base - tolerancia`, o CUALQUIER
 * aumento en reparaciones, son regresión. TTFB se reporta pero nunca bloquea.
 */
function compararConBaseline(actual, base, tolerancia = 0) {
  const regresiones = []
  for (const rama of Object.keys(base.porRama || {})) {
    const baseRama = base.porRama[rama]
    const actualRama = actual.porRama[rama]
    if (baseRama?.precision == null || !actualRama) continue
    if (actualRama.precision < baseRama.precision - tolerancia) {
      regresiones.push({ rama, base: baseRama.precision, actual: actualRama.precision })
    }
  }
  const reparacionesAumentaron = (actual.reparaciones || 0) > (base.reparaciones || 0)
  return { regresiones, reparacionesAumentaron, ok: regresiones.length === 0 && !reparacionesAumentaron }
}

/* ── Construcción de mensajes para la API, calcada del ensamble de
   `procesarTurno` (sin los metadatos de sesión: el bench no tiene sesión). ── */
function armarMensajes(turno) {
  const hist = (turno.historial || []).map(h => ({ role: h.role, content: h.content }))
  return [{ role: 'system', content: VOICE_PROMPT }, ...hist, { role: 'user', content: turno.entrada }]
}

const MSG_REINTENTO_FORMATO = 'Tu respuesta anterior venía en formato de llamada a herramienta y no se pudo ejecutar. Rehazla: si hay que delegar, usá la herramienta por su canal; si no, respondé en texto plano, sin JSON.'
function msgReintentoPromesa(preambulo) {
  return `Anunciaste una acción ("${String(preambulo).slice(0, 120)}") pero NO llamaste a la herramienta, así que no se ejecutó nada. Rehaz el turno: si de verdad hay que hacerlo, llamá a ${TOOL_DELEGAR} ahora con todo lo acumulado; si no correspondía, respondé sin prometer ninguna acción.`
}
const MSG_RESCATE_VACIO = 'Tu turno volvió vacío. Si hay que consultar al agente, escribe SOLO el pedido que hay que enviarle, autocontenido y resolviendo del contexto de qué se está hablando. Si NO hacía falta consultar nada, responde con la palabra NADA y ya.'
const MSG_RESCATE_PROMESA = 'Acabas de decir que lo harías, pero no puedes hacerlo tú: lo hace el agente. Escribe SOLO el pedido que hay que enviarle, autocontenido y con TODOS los datos acumulados en esta conversación. Sin JSON, sin herramientas, sin preámbulo: solo el texto del pedido.'

/**
 * Corre UN turno contra el proveedor real (modo --live). Nunca delega de
 * verdad: solo clasifica la decisión, con las mismas reparaciones que usaría
 * `procesarTurno`. Graba el `bruto` de cada etapa para que --replay pueda
 * reproducir esto mismo sin red.
 */
async function decidirTurnoLive(turno) {
  const apiMessages = armarMensajes(turno)
  const t0 = Date.now()
  let ttfbMs = null
  const respInicial = await llmCerebrasStream(apiMessages, [ORCA_TOOL], async () => {
    if (ttfbMs == null) ttfbMs = Date.now() - t0
  })
  const totalInicialMs = Date.now() - t0
  const bruto = { inicial: { message: respInicial.choices?.[0]?.message }, reintento: null, rescate: null }

  let normalizada = normalizarToolCall(bruto.inicial.message)
  if (necesitaReintento(normalizada)) {
    const promesaRota = prometeAccion(normalizada.preambulo)
    const reintento = await llmCerebras([
      ...apiMessages,
      { role: 'assistant', content: String(normalizada.preambulo).slice(0, 1500) },
      { role: 'user', content: promesaRota ? msgReintentoPromesa(normalizada.preambulo) : MSG_REINTENTO_FORMATO },
    ], [ORCA_TOOL])
    bruto.reintento = { message: reintento.choices?.[0]?.message }
    const reNorm = normalizarToolCall(bruto.reintento.message)
    const mejora = reNorm.toolCall || (!contieneToolCall(reNorm.preambulo) && !(promesaRota && prometeAccion(reNorm.preambulo)))
    if (mejora) normalizada = reNorm
  }

  if (necesitaRescate(normalizada)) {
    const vacio = turnoVacio(normalizada.preambulo, normalizada.toolCall)
    const rescate = await llmCerebras([
      ...apiMessages,
      { role: 'assistant', content: String(normalizada.preambulo).slice(0, 500) },
      { role: 'user', content: vacio ? MSG_RESCATE_VACIO : MSG_RESCATE_PROMESA },
    ])
    bruto.rescate = { message: rescate.choices?.[0]?.message }
  }

  const clasificado = clasificarDesdeBruto(bruto)
  return { ...clasificado, bruto, ttfbMs: ttfbMs ?? totalInicialMs, totalMs: Date.now() - t0 }
}

function cargarTurnos(rutaTurnos = TURNOS_PATH) {
  return JSON.parse(fs.readFileSync(rutaTurnos, 'utf8'))
}

function ultimaBaseline() {
  const candidatos = fs.readdirSync(BENCH_DIR)
    .filter(f => /^baseline-\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort()
  return candidatos.length ? path.join(BENCH_DIR, candidatos[candidatos.length - 1]) : null
}

function cargarBaseline(rutaBaseline) {
  const ruta = rutaBaseline || ultimaBaseline()
  if (!ruta) throw new Error('No hay ninguna línea de base (daemon/bench/baseline-*.json) para --replay.')
  return { ruta, datos: JSON.parse(fs.readFileSync(ruta, 'utf8')) }
}

function fechaHoy() {
  return new Date().toISOString().slice(0, 10)
}

async function ejecutarLive({ rutaTurnos = TURNOS_PATH, rutaSalida } = {}) {
  const turnos = cargarTurnos(rutaTurnos)
  const medidos = []
  for (const turno of turnos) {
    const r = await decidirTurnoLive(turno)
    medidos.push({ id: turno.id, rama: turno.rama, bruto: r.bruto, ttfbMs: r.ttfbMs, totalMs: r.totalMs })
  }
  const metricas = resolverMetricas(medidos)
  const salida = {
    fecha: fechaHoy(),
    provider: require('../capa.js').resolverCapa().provider,
    modelo: require('../capa.js').resolverCapa().modelo,
    turnos: medidos,
    metricas,
  }
  const ruta = rutaSalida || path.join(BENCH_DIR, `baseline-${salida.fecha}.json`)
  fs.writeFileSync(ruta, JSON.stringify(salida, null, 2))
  return { ruta, salida }
}

function ejecutarReplay({ rutaBaseline } = {}) {
  const { ruta, datos } = cargarBaseline(rutaBaseline)
  const metricas = resolverMetricas(datos.turnos)
  const comparacion = compararConBaseline(metricas, datos.metricas, 0)
  return { ruta, metricas, comparacion }
}

function imprimirMetricas(metricas) {
  console.log(`Turnos: ${metricas.totalTurnos} · reparaciones: ${metricas.reparaciones} · formato válido: ${metricas.formatoValidoRatio == null ? 'n/a' : (metricas.formatoValidoRatio * 100).toFixed(0) + '%'}`)
  console.log(`TTFB p50: ${metricas.ttfb.p50 ?? 'n/a'}ms · p90: ${metricas.ttfb.p90 ?? 'n/a'}ms`)
  for (const rama of RAMAS) {
    const b = metricas.porRama[rama]
    if (!b || !b.total) continue
    console.log(`  ${rama}: ${b.correctos}/${b.total} (${(b.precision * 100).toFixed(0)}%)`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  if (args.includes('--live')) {
    console.log('Corriendo --live contra el proveedor real (esto pega llamadas reales y tiene costo)...')
    const { ruta, salida } = await ejecutarLive()
    imprimirMetricas(salida.metricas)
    console.log(`Línea de base escrita en ${ruta}`)
    return
  }
  if (args.includes('--replay')) {
    const { ruta, metricas, comparacion } = ejecutarReplay()
    console.log(`Replay sobre ${ruta} (sin red, clasificador puro)`)
    imprimirMetricas(metricas)
    if (!comparacion.ok) {
      console.error('REGRESIÓN detectada:', JSON.stringify(comparacion, null, 2))
      process.exitCode = 1
    } else {
      console.log('Sin regresión frente a la línea de base grabada.')
    }
    return
  }
  console.error('Uso: node daemon/bench/arbol.js --live | --replay')
  process.exitCode = 1
}

if (require.main === module) {
  main().catch(e => { console.error(e); process.exitCode = 1 })
}

module.exports = {
  RAMAS,
  argumentosTool, esFormatoValido, clasificarRama,
  necesitaReintento, necesitaRescate, clasificarDesdeBruto,
  percentil, resolverMetricas, compararConBaseline,
  armarMensajes, decidirTurnoLive, cargarTurnos, cargarBaseline,
  ejecutarLive, ejecutarReplay,
}
