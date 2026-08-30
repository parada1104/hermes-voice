// Tests del harness de medición del árbol de decisión (`daemon/bench/arbol.js`).
//
// `capa.js:21-49` mide a mano, con comentarios: N turnos, tantas delegaciones,
// tantas reparaciones, tanto TTFB. Cada remedición fue copiar/pegar/editar un
// comentario. D9 (`design.md`) automatiza eso mismo, con dos modos: `--live`
// pega al proveedor real y graba un `bruto` (los mensajes crudos del modelo en
// cada etapa); `--replay` reproduce la clasificación pura sobre ese `bruto` sin
// red, para que sea determinista en CI. Estos tests SOLO ejercitan el modo
// `--replay` (clasificador puro, fixtures en memoria): correr contra el
// proveedor real no puede ser parte de la suite verde de siempre.
'use strict'

const test = require('node:test')
const assert = require('node:assert')
const {
  clasificarRama, esFormatoValido, necesitaReintento, necesitaRescate,
  clasificarDesdeBruto, resolverMetricas, percentil, compararConBaseline,
} = require('./bench/arbol.js')

/* ── Helpers: arman un mensaje de modelo "crudo" sin pegarle a ningún proveedor ── */

function mensajeTexto(texto) {
  return { role: 'assistant', content: texto }
}
function mensajeToolCall(pedido, nombre = 'delegar_a_orca') {
  return { role: 'assistant', content: '', tool_calls: [{ function: { name: nombre, arguments: JSON.stringify({ pedido }) } }] }
}
function bruto({ inicial, reintento = null, rescate = null }) {
  return { inicial: { message: inicial }, reintento: reintento ? { message: reintento } : null, rescate: rescate ? { message: rescate } : null }
}

/* ── Clasificación de rama a partir de un tool call ya normalizado ── */

test('un tool call a delegar_a_orca clasifica como "delegar"', () => {
  const b = bruto({ inicial: mensajeToolCall('Revisá el tablero de Trello.') })
  const r = clasificarDesdeBruto(b)
  assert.strictEqual(r.rama, 'delegar')
  assert.strictEqual(r.reparaciones, 0)
})

test('texto plano sin tool call clasifica como "responder"', () => {
  const b = bruto({ inicial: mensajeTexto('Son las tres de la tarde, señor.') })
  const r = clasificarDesdeBruto(b)
  assert.strictEqual(r.rama, 'responder')
  assert.strictEqual(r.reparaciones, 0)
})

test('un turno vacío (sin contenido ni tool call) clasifica como "nada"', () => {
  const b = bruto({ inicial: mensajeTexto('') })
  const r = clasificarDesdeBruto(b)
  assert.strictEqual(r.rama, 'nada')
})

// El sistema actual (una sola tool, dos ramas de verdad) NO tiene forma de
// producir 'cancelar': no hay tool de cancelación. Esta ausencia es justamente
// lo que M2 debe dejar registrado como línea de base, no un bug del harness.
test('el árbol actual nunca produce la rama "cancelar" (no existe esa tool todavía)', () => {
  const b = bruto({ inicial: mensajeTexto('Listo, señor, dejo de esperar esa consulta.') })
  const r = clasificarDesdeBruto(b)
  assert.notStrictEqual(r.rama, 'cancelar')
})

/* ── Reparaciones: reintento + rescate, calcadas de connector.js:procesarTurno ── */

// `{"tool_calls":` es JSON incompleto: dispara la marca `contieneToolCall`
// (protocolo asomando como texto) pero `extraerJsonInicial` nunca cierra la
// llave, así que `normalizarToolCall` NO logra recuperar un tool call de ahí
// (a diferencia de un JSON completo, que `funcionDesdeObjeto` sí resuelve en
// el primer intento sin pasar por reintento — ese es otro caso, no este).
test('un tool call escrito como texto incompleto pide reintento; si el reintento sí delega, cuenta 1 reparación', () => {
  const b = bruto({
    inicial: mensajeTexto('{"tool_calls":'),
    reintento: mensajeToolCall('Revisá el vault.'),
  })
  const r = clasificarDesdeBruto(b)
  assert.strictEqual(r.reparaciones, 1)
  assert.strictEqual(r.rama, 'delegar')
})

// Fiel a `procesarTurno`: el chequeo de rescate es independiente del de
// reintento y vuelve a mirar el MISMO preámbulo. Si el reintento no pudo
// reproducirse (sin dato grabado) y la promesa sigue sin cumplirse, el
// rescate se pide TAMBIÉN — dos reparaciones, no una. El replay no puede
// inventar una mejora que no está en el `bruto`.
test('una promesa rota sin reintento disponible sigue pidiendo las DOS reparaciones, sin inventar una mejora', () => {
  const b = bruto({
    inicial: mensajeTexto('Voy a registrarlo ahora mismo en el vault.'),
    // No se grabó ni reintento ni rescate.
  })
  const r = clasificarDesdeBruto(b)
  assert.strictEqual(r.reparaciones, 2)
  assert.strictEqual(r.datosIncompletos, true)
})

test('turno vacío tras el reintento pide rescate; si el rescate trae un pedido, se convierte en delegación', () => {
  const b = bruto({
    inicial: mensajeTexto(''),
    rescate: mensajeTexto('Preguntale al agente si hay tareas nuevas en el tablero.'),
  })
  const r = clasificarDesdeBruto(b)
  assert.strictEqual(r.reparaciones, 1)
  assert.strictEqual(r.rama, 'delegar')
})

test('el rescate puede responder NADA: no había nada que consultar', () => {
  const b = bruto({ inicial: mensajeTexto(''), rescate: mensajeTexto('NADA') })
  const r = clasificarDesdeBruto(b)
  assert.strictEqual(r.reparaciones, 1)
  assert.strictEqual(r.rama, 'nada')
})

test('reintento y rescate pueden encadenarse en el mismo turno: dos reparaciones', () => {
  const b = bruto({
    inicial: mensajeTexto('{"tool_calls":'),
    reintento: mensajeTexto(''),
    rescate: mensajeTexto('Fijate si hay mensajes nuevos.'),
  })
  const r = clasificarDesdeBruto(b)
  assert.strictEqual(r.reparaciones, 2)
  assert.strictEqual(r.rama, 'delegar')
})

/* ── Predicados puros que deciden si hace falta cada reparación ── */

test('necesitaReintento es falso si ya hay tool call', () => {
  assert.strictEqual(necesitaReintento({ toolCall: { name: 'delegar_a_orca' }, preambulo: '' }), false)
})

test('necesitaRescate es falso si el preámbulo tiene contenido real y no promete nada', () => {
  assert.strictEqual(necesitaRescate({ toolCall: null, preambulo: 'Son las tres, señor.' }), false)
})

/* ── Validez de formato del tool call ── */

test('un tool call con "pedido" no vacío es formato válido', () => {
  assert.strictEqual(esFormatoValido({ name: 'delegar_a_orca', arguments: JSON.stringify({ pedido: 'x' }) }), true)
})

test('un tool call sin "pedido" (o con json roto) es formato inválido', () => {
  assert.strictEqual(esFormatoValido({ name: 'delegar_a_orca', arguments: '{}' }), false)
  assert.strictEqual(esFormatoValido({ name: 'delegar_a_orca', arguments: '{ esto no es json' }), false)
})

/* ── Percentiles (TTFB p50/p90) ── */

test('percentil calcula p50/p90 por rango-más-cercano sobre una serie ordenada', () => {
  const valores = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
  assert.strictEqual(percentil(valores, 50), 500)
  assert.strictEqual(percentil(valores, 90), 900)
})

test('percentil no exige que la entrada venga ordenada', () => {
  const valores = [500, 100, 900, 300, 1000, 700, 200, 800, 400, 600]
  assert.strictEqual(percentil(valores, 50), 500)
})

/* ── Métricas agregadas: precisión por rama, reparaciones, formato, TTFB ── */

function turnoFixture(id, rama, brutoTurno, ttfbMs) {
  return { id, rama, bruto: brutoTurno, ttfbMs }
}

test('resolverMetricas calcula precisión por rama sobre el turno set', () => {
  const turnos = [
    turnoFixture('d1', 'delegar', bruto({ inicial: mensajeToolCall('Revisá el vault.') }), 100),
    turnoFixture('d2', 'delegar', bruto({ inicial: mensajeToolCall('Buscá en mis notas.') }), 200),
    turnoFixture('r1', 'responder', bruto({ inicial: mensajeTexto('Son las tres, señor.') }), 300),
    // Este turno espera 'cancelar' pero el sistema actual solo puede responder:
    // la precisión de esa rama debe reflejar la incapacidad real, no ocultarla.
    turnoFixture('c1', 'cancelar', bruto({ inicial: mensajeTexto('No puedo cortar esa tarea, señor.') }), 400),
  ]
  const m = resolverMetricas(turnos)
  assert.strictEqual(m.porRama.delegar.correctos, 2)
  assert.strictEqual(m.porRama.delegar.total, 2)
  assert.strictEqual(m.porRama.delegar.precision, 1)
  assert.strictEqual(m.porRama.responder.precision, 1)
  assert.strictEqual(m.porRama.cancelar.correctos, 0)
  assert.strictEqual(m.porRama.cancelar.total, 1)
  assert.strictEqual(m.porRama.cancelar.precision, 0)
})

test('resolverMetricas suma reparaciones y calcula la tasa de formato válido', () => {
  const turnos = [
    turnoFixture('a', 'delegar', bruto({ inicial: mensajeToolCall('x') }), 100),
    turnoFixture('b', 'delegar', bruto({
      inicial: mensajeTexto('{"tool_calls":'),
      reintento: mensajeToolCall('y'),
    }), 200),
  ]
  const m = resolverMetricas(turnos)
  assert.strictEqual(m.reparaciones, 1)
  assert.strictEqual(m.formatoValidoRatio, 1)
})

test('resolverMetricas reporta TTFB p50/p90 sobre los turnos medidos', () => {
  const turnos = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]
    .map((ms, i) => turnoFixture(`t${i}`, 'responder', bruto({ inicial: mensajeTexto('ok') }), ms))
  const m = resolverMetricas(turnos)
  assert.strictEqual(m.ttfb.p50, 500)
  assert.strictEqual(m.ttfb.p90, 900)
})

/* ── Comparación contra baseline (regresión, D9) ── */

test('compararConBaseline detecta una rama que cayó por debajo de la tolerancia', () => {
  const base = { porRama: { delegar: { precision: 1 }, responder: { precision: 1 } }, reparaciones: 0 }
  const actual = { porRama: { delegar: { precision: 0.5 }, responder: { precision: 1 } }, reparaciones: 0 }
  const cmp = compararConBaseline(actual, base, 0)
  assert.strictEqual(cmp.regresiones.length, 1)
  assert.strictEqual(cmp.regresiones[0].rama, 'delegar')
})

test('compararConBaseline detecta un aumento de reparaciones', () => {
  const base = { porRama: {}, reparaciones: 0 }
  const actual = { porRama: {}, reparaciones: 2 }
  const cmp = compararConBaseline(actual, base, 0)
  assert.strictEqual(cmp.reparacionesAumentaron, true)
})

test('compararConBaseline no marca regresión dentro de la tolerancia', () => {
  const base = { porRama: { delegar: { precision: 0.9 } }, reparaciones: 1 }
  const actual = { porRama: { delegar: { precision: 0.85 } }, reparaciones: 1 }
  const cmp = compararConBaseline(actual, base, 0.1)
  assert.strictEqual(cmp.regresiones.length, 0)
  assert.strictEqual(cmp.reparacionesAumentaron, false)
})
