// Tests del detector de promesas incumplidas de la capa.
//
// Medido: aun con la orden explícita en el prompt ("si Robert dice que terminó,
// DELEGA sin excepción") y con el pedido explícito de Robert ("pasale todo al
// entrenador"), el modelo respondía «Le paso el equipo completo al entrenador
// ahora mismo» y decidía `responder`. El prompt no alcanza: hay que detectar la
// promesa rota en el código y reintentar.
const test = require('node:test')
const assert = require('node:assert')
const { prometeAccion } = require('./promesas.js')

test('detecta que anuncia una acción inmediata', () => {
  for (const t of [
    'Le paso el equipo completo al entrenador ahora mismo.',
    'Voy a registrar los datos de Wingull y actualizar el inventario.',
    'Procedo a consultar sus archivos.',
    'Registro los datos y los añado al seguimiento inmediatamente.',
    'Se lo envío al entrenador enseguida.',
    'Estoy consultándolo con el agente.',
  ]) assert.strictEqual(prometeAccion(t), true, t)
})

test('no marca una confirmación de que retiene el dato', () => {
  for (const t of [
    'Lo tengo anotado, señor. Quedo a la espera de que termine de dictar.',
    'Anotado también, señor. Sigo atento a los siguientes datos.',
    'Tengo los tres Pokémon registrados, señor. Quedo atento por si desea añadir más.',
    'Anotado, señor. Sigo esperando a que termine la lista.',
  ]) assert.strictEqual(prometeAccion(t), false, t)
})

test('no marca un ofrecimiento condicional', () => {
  for (const t of [
    'Si desea, puedo consultar sus archivos ahora mismo.',
    '¿Desea que lo registre con el entrenador?',
    'Puedo pasárselo al entrenador cuando termine.',
    '¿Ha terminado la lista o desea agregar alguno más?',
  ]) assert.strictEqual(prometeAccion(t), false, t)
})

test('no marca una respuesta informativa cualquiera', () => {
  for (const t of [
    'Su equipo tiene 9 Pokémon, señor.',
    'Está en la Ruta 102 camino a la primera medalla.',
    'Soy la capa conversacional, señor.',
  ]) assert.strictEqual(prometeAccion(t), false, t)
})

test('tolera entrada vacía', () => {
  assert.strictEqual(prometeAccion(''), false)
  assert.strictEqual(prometeAccion(null), false)
})

/* ── Rescate: pedir el pedido en texto plano ── */
// Medido en coach-183mm1: el detector disparó el reintento y el modelo TAMPOCO
// llamó a la herramienta (su propio historial afirmaba que ya lo había hecho).
// No se puede depender de que emita el tool call: se le pide el pedido en texto
// plano —que sí sabe escribir— y la delegación la hace el daemon.
const { limpiarPedido } = require('./promesas.js')

test('limpia un pedido devuelto con prefijo', () => {
  assert.strictEqual(limpiarPedido('Pedido: Registrá los seis Pokémon en el vault.'), 'Registrá los seis Pokémon en el vault.')
})

test('quita comillas envolventes', () => {
  assert.strictEqual(limpiarPedido('"Registrá los seis Pokémon."'), 'Registrá los seis Pokémon.')
  assert.strictEqual(limpiarPedido('«Registrá los seis Pokémon.»'), 'Registrá los seis Pokémon.')
})

test('conserva un pedido multilínea con los datos del lote', () => {
  const p = limpiarPedido('Registrá:\n- Wingull nivel 14\n- Grovyle nivel 17')
  assert.ok(p.includes('Wingull nivel 14'))
  assert.ok(p.includes('Grovyle nivel 17'))
})

test('descarta restos de protocolo si se colaran', () => {
  assert.strictEqual(limpiarPedido('Registrá los datos. <tool_call>'), 'Registrá los datos.')
})

test('devuelve vacío si no hay pedido utilizable', () => {
  assert.strictEqual(limpiarPedido(''), '')
  assert.strictEqual(limpiarPedido('   '), '')
  assert.strictEqual(limpiarPedido('Pedido:'), '')
})

test('recorta un pedido desmedido para no reventar la delegación', () => {
  assert.ok(limpiarPedido('x'.repeat(9000)).length <= 4000)
})

/* ── Anunciar contenido sin entregarlo ── */
// Capturado en `entre-k30j3y`: la delegación trajo el informe del equipo y la
// síntesis dijo "He detallado los niveles, naturalezas y sets de movimientos"
// — sin detallar nada. Describir la respuesta no es responder.
const { anunciaSinEntregar } = require('./promesas.js')

test('detecta que describe la respuesta en vez de darla', () => {
  for (const t of [
    'Señor, ya tengo el informe del equipo. He detallado los niveles, naturalezas y sets de movimientos.',
    'Aquí tiene la información solicitada sobre su equipo.',
    'Le he preparado el listado completo de sus Pokémon.',
    'Le detallo a continuación los datos del equipo.',
    'Ya tengo el resumen con toda la información.',
  ]) assert.strictEqual(anunciaSinEntregar(t), true, t)
})

test('no marca una respuesta que SÍ entrega los datos', () => {
  for (const t of [
    'Señor, su equipo tiene 6 Pokémon: Wingull nivel 14, Grovyle nivel 17 y Dustox nivel 15.',
    'Tiene 9 Pokémon capturados, de los cuales solo Treecko, Poochyena y Seedot tienen datos completos.',
    'Está en la Ruta 102 camino a la primera medalla.',
    'Hay 22 tarjetas pendientes, repartidas entre Backlog, Sprint, Doing y Review.',
  ]) assert.strictEqual(anunciaSinEntregar(t), false, t)
})

test('no marca una respuesta corta sin pretensión de listar', () => {
  for (const t of ['Listo, señor.', 'Soy la capa conversacional, señor.', 'No encontré nada al respecto.']) {
    assert.strictEqual(anunciaSinEntregar(t), false, t)
  }
})

test('un anuncio acompañado de los datos reales sí cuenta como entrega', () => {
  assert.strictEqual(anunciaSinEntregar('Le detallo el equipo: Wingull nivel 14, Grovyle nivel 17, Dustox nivel 15.'), false)
})

test('tolera entrada vacía', () => {
  assert.strictEqual(anunciaSinEntregar(''), false)
  assert.strictEqual(anunciaSinEntregar(null), false)
})

/* ── Futuro simple: la forma que más usa ── */
// Capturado en `entr-tahrkc`: "Consultaré el vault para ver qué equipo tenemos
// registrado" → decision=responder. El detector tenía `consulto` (presente)
// pero no `consultaré`. Enumerar conjugaciones es perder siempre: se pasa a una
// regla por terminación.

test('detecta el futuro simple en primera persona', () => {
  for (const t of [
    'Consultaré el vault para ver qué equipo tenemos registrado.',
    'Revisaré sus notas ahora.',
    'Registraré los datos en el inventario.',
    'Se lo pasaré al entrenador.',
    'Buscaré esa información.',
    'Le pediré el desglose al coach.',
    'Delegaré la consulta.',
  ]) assert.strictEqual(prometeAccion(t), true, t)
})

test('el futuro condicionado sigue sin ser promesa', () => {
  for (const t of [
    'Si desea, consultaré el vault.',
    '¿Consultaré el vault o prefiere dictar más datos?',
    'Cuando termine, se lo pasaré al entrenador.',
  ]) assert.strictEqual(prometeAccion(t), false, t)
})

test('no confunde un futuro que no es acción del asistente', () => {
  for (const t of [
    'Su Treecko evolucionará al nivel 16.',
    'El combate será difícil, señor.',
    'Necesitará más nivel para el gimnasio.',
  ]) assert.strictEqual(prometeAccion(t), false, t)
})

test('la retención en futuro tampoco es promesa de acción inmediata', () => {
  assert.strictEqual(prometeAccion('Anotado, señor. Se lo pasaré al agente cuando termine de dictar.'), false)
})

/* ── Turno vacío: ni contenido ni tool call ── */
// gpt-oss-120b es un modelo de razonamiento: cuando decide delegar pero no
// emite la llamada, TODO se va al campo `reasoning` y `content` queda vacío. El
// turno moría en "No entendí, señor." y Robert no veía ninguna tool call.
// El razonamiento es monólogo interno y no se puede hablar, así que la salida
// correcta es rescatar: pedir el pedido en texto plano y delegar.
const { turnoVacio } = require('./promesas.js')

test('detecta un turno sin nada utilizable', () => {
  assert.strictEqual(turnoVacio('', null), true)
  assert.strictEqual(turnoVacio('   ', null), true)
  assert.strictEqual(turnoVacio(null, null), true)
})

test('no marca vacío si hay tool call, aunque no haya texto', () => {
  assert.strictEqual(turnoVacio('', { name: 'delegar_a_orca' }), false)
})

test('no marca vacío si hay respuesta real', () => {
  assert.strictEqual(turnoVacio('Todo marcha bien, señor.', null), false)
})

test('solo protocolo cuenta como vacío: no es una respuesta', () => {
  assert.strictEqual(turnoVacio('<tool_call>', null), true)
})
