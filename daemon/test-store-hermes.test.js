/**
 * El store de Hermes como fuente de la respuesta del agente.
 *
 * Reemplaza el raspado del TTY: Hermes escribe cada mensaje del turno en
 * `state.db` (SQLite) ANTES de devolver el prompt, así que el turno se puede
 * leer entero, estructurado y sin fragmentos repintados.
 */
const test = require('node:test')
const assert = require('node:assert')
const os = require('os')
const path = require('path')
const {
  rutaStore, esSesionAgente, turnoCompleto, nombresToolCalls, resumenTurno, informeParcial, crearLectorStore,
} = require('./store-hermes')

const fila = (o) => ({ id: 1, role: 'assistant', content: null, tool_calls: null, tool_name: null, finish_reason: null, ...o })

test('rutaStore: el perfil raíz vive en ~/.hermes, los demás bajo profiles/', () => {
  const raiz = path.join(os.homedir(), '.hermes')
  assert.equal(rutaStore('default'), path.join(raiz, 'state.db'))
  assert.equal(rutaStore(''), path.join(raiz, 'state.db'))
  assert.equal(rutaStore('entrenador'), path.join(raiz, 'profiles', 'entrenador', 'state.db'))
})

test('esSesionAgente: solo el formato real de Hermes; lo demás se rechaza', () => {
  assert.equal(esSesionAgente('20260826_004214_3e1524'), true)
  assert.equal(esSesionAgente(''), false)
  assert.equal(esSesionAgente('no-es-una-sesion'), false)
  // Sin esto la id entraría cruda en el SQL.
  assert.equal(esSesionAgente("20260826_004214_x'; drop table messages; --"), false)
})

// MEDIDO en vivo (sondeo cada 400ms sobre una respuesta que tardó 19s): la fila
// del assistant NUNCA existe a medias. Pasa de no estar a estar completa, con su
// `finish_reason`. Por eso un assistant sin `tool_calls` YA cierra el turno:
// no hay un estado intermedio del que haya que protegerse.
test('turnoCompleto: cierra con un assistant sin tool_calls', () => {
  assert.equal(turnoCompleto([]), false)
  assert.equal(turnoCompleto([fila({ role: 'user', content: 'hola' })]), false)
  // Pidió herramienta: el turno sigue, aunque haya narrado algo.
  assert.equal(turnoCompleto([fila({ content: 'voy a leer', tool_calls: '[{}]', finish_reason: 'tool_calls' })]), false)
  // Devolvió la herramienta: falta la respuesta final.
  assert.equal(turnoCompleto([fila({ role: 'tool', tool_name: 'read_file', content: '{}' })]), false)
  assert.equal(turnoCompleto([fila({ content: 'listo', finish_reason: 'stop' })]), true)
})

// El caso real que colgó a `coach-qi9a1g` 360s: el modelo devolvió NADA. Fila
// 967 del store — assistant, sin tool_calls, sin finish_reason, contenido vacío.
// Exigir `finish_reason` dejaba el turno abierto para siempre. Es un desenlace,
// pobre pero desenlace: el bucle del agente no tiene con qué seguir.
test('turnoCompleto: un assistant vacío y sin finish_reason también cierra', () => {
  assert.equal(turnoCompleto([fila({ content: '', finish_reason: null })]), true)
  assert.equal(turnoCompleto([fila({ content: 'ya casi', finish_reason: null })]), true)
})

test('nombresToolCalls: saca los nombres y tolera basura', () => {
  const tc = '[{"id":"c1","type":"function","function":{"name":"read_file","arguments":"{}"}}]'
  assert.deepEqual(nombresToolCalls(tc), ['read_file'])
  assert.deepEqual(nombresToolCalls(null), [])
  assert.deepEqual(nombresToolCalls('no-json'), [])
  assert.deepEqual(nombresToolCalls('{"function":{"name":"x"}}'), [])
})

test('resumenTurno: texto final, herramientas en orden y avances intermedios', () => {
  const filas = [
    fila({ id: 10, role: 'user', content: 'resume el vault' }),
    fila({ id: 11, tool_calls: '[{"function":{"name":"skill_view"}}]', finish_reason: 'tool_calls' }),
    fila({ id: 12, role: 'tool', tool_name: 'skill_view', content: '{"ok":true}' }),
    fila({ id: 13, content: 'Encontré 5 notas.', tool_calls: '[{"function":{"name":"read_file"}}]', finish_reason: 'tool_calls' }),
    fila({ id: 14, role: 'tool', tool_name: 'read_file', content: '{"content":"..."}' }),
    fila({ id: 15, content: 'Leí las 5 notas: van de semiconductores.', finish_reason: 'stop' }),
  ]
  const r = resumenTurno(filas)
  assert.equal(r.texto, 'Leí las 5 notas: van de semiconductores.')
  // Lo que REALMENTE corrió son las filas `tool`, no lo que el modelo pidió.
  assert.deepEqual(r.herramientas, ['skill_view', 'read_file'])
  // El avance narrado sirve para hablar durante una tool call larga.
  assert.deepEqual(r.avances, ['Encontré 5 notas.'])
  assert.equal(r.ultimoId, 15)
})

test('resumenTurno: sin respuesta final el texto queda vacío, no inventa', () => {
  const r = resumenTurno([fila({ id: 3, role: 'tool', tool_name: 'read_file', content: '{}' })])
  assert.equal(r.texto, '')
  assert.deepEqual(r.herramientas, ['read_file'])
  assert.equal(r.ultimoId, 3)
})

test('resumenTurno: un turno sin herramientas devuelve solo el texto', () => {
  const r = resumenTurno([fila({ id: 8, content: 'Hola Robert.', finish_reason: 'stop' })])
  assert.equal(r.texto, 'Hola Robert.')
  assert.deepEqual(r.herramientas, [])
  assert.deepEqual(r.avances, [])
})

test('lector: ultimoId de una sesión sin mensajes es 0', async () => {
  const lector = crearLectorStore({ consultar: async () => [] })
  assert.equal(await lector.ultimoId('entrenador', '20260826_004214_3e1524'), 0)
})

test('lector: ultimoId devuelve el máximo', async () => {
  const lector = crearLectorStore({ consultar: async () => [{ ultimo: 950 }] })
  assert.equal(await lector.ultimoId('entrenador', '20260826_004214_3e1524'), 950)
})

test('lector: mensajesDesde pide solo lo nuevo y activo', async () => {
  let sqlVisto = ''
  const lector = crearLectorStore({ consultar: async (_ruta, sql) => { sqlVisto = sql; return [{ id: 951 }] } })
  const filas = await lector.mensajesDesde('entrenador', '20260826_004214_3e1524', 950)
  assert.deepEqual(filas, [{ id: 951 }])
  assert.match(sqlVisto, /id\s*>\s*950/)
  assert.match(sqlVisto, /active\s*=\s*1/)
  assert.match(sqlVisto, /order by id/i)
})

test('lector: una sesión con formato inválido no llega al SQL', async () => {
  let llamado = false
  const lector = crearLectorStore({ consultar: async () => { llamado = true; return [] } })
  await assert.rejects(() => lector.mensajesDesde('entrenador', "x'; drop table messages; --", 0), /sesión/i)
  assert.equal(llamado, false)
})

test('lector: un perfil con caracteres raros tampoco llega al SQL', async () => {
  let llamado = false
  const lector = crearLectorStore({ consultar: async () => { llamado = true; return [] } })
  await assert.rejects(() => lector.mensajesDesde('../../etc', '20260826_004214_3e1524', 0), /perfil/i)
  assert.equal(llamado, false)
})

/* ── Descubrir la sesión que abrió el worker ── */
const SES_A = '20260826_010000_aaaaaa'
const SES_B = '20260826_020000_bbbbbb'

// Medido en vivo y es la razón de que esto exista: un REPL recién arrancado NO
// tiene fila en `sessions` hasta que escribe su primer mensaje, así que la
// sesión no se puede conocer antes de enviar el pedido. Y el `Session:` del
// banner tampoco sirve como única fuente: con un banner largo se sale de la
// pantalla y `leerPantalla` devuelve solo el frame visible.

test('descubrirSesion: la identifica por el pedido, no por ser la más reciente', async () => {
  const consultar = async (_ruta, sql) => {
    if (/from sessions/.test(sql)) return [{ id: SES_B, started_at: 200 }, { id: SES_A, started_at: 100 }]
    if (sql.includes(SES_A)) return [{ id: 1, role: 'user', content: 'contá los .md', tool_calls: null, tool_name: null, finish_reason: null }]
    return [{ id: 1, role: 'user', content: 'otra cosa', tool_calls: null, tool_name: null, finish_reason: null }]
  }
  const lector = crearLectorStore({ consultar })
  // B es más nueva, pero la que lleva NUESTRO pedido es A.
  assert.equal(await lector.descubrirSesion('entrenador', 50, 'contá los .md'), SES_A)
})

test('descubrirSesion: sin candidatas devuelve vacío en vez de adivinar', async () => {
  const lector = crearLectorStore({ consultar: async () => [] })
  assert.equal(await lector.descubrirSesion('entrenador', 50, 'contá los .md'), '')
})

test('descubrirSesion: si ninguna candidata lleva el pedido, no elige ninguna', async () => {
  const consultar = async (_ruta, sql) => {
    if (/from sessions/.test(sql)) return [{ id: SES_B, started_at: 200 }]
    return [{ id: 1, role: 'user', content: 'un pedido ajeno', tool_calls: null, tool_name: null, finish_reason: null }]
  }
  assert.equal(await crearLectorStore({ consultar }).descubrirSesion('entrenador', 50, 'lo mío'), '')
})

test('descubrirSesion: el pedido nunca entra al SQL', async () => {
  let sqls = []
  const consultar = async (_ruta, sql) => { sqls.push(sql); return /from sessions/.test(sql) ? [{ id: SES_A, started_at: 200 }] : [] }
  await crearLectorStore({ consultar }).descubrirSesion('entrenador', 50, "'; drop table sessions; --")
  assert.ok(sqls.length >= 1)
  assert.ok(sqls.every(s => !s.includes('drop table')), 'la comparación se hace en JS, no en SQL')
})

test('sesionesDesde: acota por started_at', async () => {
  let sqlVisto = ''
  const lector = crearLectorStore({ consultar: async (_r, sql) => { sqlVisto = sql; return [] } })
  await lector.sesionesDesde('entrenador', 1787722308)
  assert.match(sqlVisto, /started_at\s*>=\s*1787722308/)
})


/* ── Informe de un turno que no llegó a cerrarse ── */
// Medido: un turno dado por perdido a los 360s tenía la respuesta en disco
// (6913 caracteres) y seis búsquedas web ya hechas. Se tiraba todo y Robert
// escuchaba "no devolvió nada". El store sabe lo que pasó; hay que contarlo.

test('informeParcial: enumera las herramientas y dice por qué se cortó', () => {
  const inf = informeParcial({ texto: '', herramientas: ['read_file', 'web_search', 'web_search'], avances: [], motivo: 'timeout' })
  assert.match(inf, /read_file/)
  assert.match(inf, /web_search/)
  assert.match(inf, /timeout/i)
  // Sin respuesta final hay que decirlo, no dejar que se lea como una respuesta.
  assert.match(inf, /no escribió|sin respuesta/i)
})

test('informeParcial: conserva el texto parcial y los avances narrados', () => {
  const inf = informeParcial({ texto: 'Van 17 notas leídas.', herramientas: ['read_file'], avances: ['Encontré 5 notas.'], motivo: 'timeout' })
  assert.match(inf, /Van 17 notas leídas\./)
  assert.match(inf, /Encontré 5 notas\./)
})

test('informeParcial: repite cada herramienta con su cuenta, no una lista kilométrica', () => {
  const inf = informeParcial({ texto: '', herramientas: Array(20).fill('read_file'), avances: [], motivo: 'timeout' })
  assert.match(inf, /read_file/)
  assert.match(inf, /20/)
  assert.ok(inf.split('read_file').length - 1 === 1, 'no debe repetir el nombre 20 veces')
})

test('informeParcial: sin nada que contar devuelve vacío en vez de un informe hueco', () => {
  assert.equal(informeParcial({ texto: '', herramientas: [], avances: [], motivo: 'timeout' }), '')
})
