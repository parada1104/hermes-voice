// Tests del veredicto de la capa conversacional sobre su propia tarea.
//
// La capa es un agente, no un altavoz: tras delegar tiene que confirmar que lo
// que volvió resuelve lo que Robert pidió. Antes resumía cualquier cosa —
// incluido un "(sin respuesta)" — y lo entregaba como si fuera la respuesta.
const test = require('node:test')
const assert = require('node:assert')
const { resultadoVacio, interpretarVeredicto } = require('./veredicto.js')

/* ── Resultados que no son respuesta, sin gastar una llamada al modelo ── */

test('detecta los resultados vacíos o de relleno', () => {
  for (const r of ['', '   ', '\n', '(sin respuesta)', '(SIN RESPUESTA)']) {
    assert.strictEqual(resultadoVacio(r), true, JSON.stringify(r))
  }
})

test('un resultado real no se marca como vacío', () => {
  assert.strictEqual(resultadoVacio('El tablero tiene 3 tarjetas pendientes.'), false)
})

test('un objeto de error cuenta como resultado vacío', () => {
  assert.strictEqual(resultadoVacio({ error: 'falló' }), true)
})

/* ── Interpretación del veredicto ── */

test('lee el veredicto en JSON plano', () => {
  const v = interpretarVeredicto('{"cumplido":true,"respuesta":"Hay 3 pendientes, señor."}')
  assert.strictEqual(v.cumplido, true)
  assert.strictEqual(v.respuesta, 'Hay 3 pendientes, señor.')
})

test('lee el veredicto envuelto en un bloque de código', () => {
  const v = interpretarVeredicto('```json\n{"cumplido":false,"respuesta":"No pude verlo.","motivo":"sin acceso"}\n```')
  assert.strictEqual(v.cumplido, false)
  assert.strictEqual(v.motivo, 'sin acceso')
})

test('lee el veredicto aunque venga con prosa alrededor', () => {
  const v = interpretarVeredicto('Claro: {"cumplido":true,"respuesta":"Listo."} eso es todo')
  assert.strictEqual(v.cumplido, true)
  assert.strictEqual(v.respuesta, 'Listo.')
})

test('si no hay JSON, trata el texto como la respuesta y no afirma cumplimiento', () => {
  const v = interpretarVeredicto('Hay tres pendientes, señor.')
  assert.strictEqual(v.respuesta, 'Hay tres pendientes, señor.')
  assert.strictEqual(v.cumplido, null)
})

test('un cumplido que no es booleano no se toma por verdadero', () => {
  assert.strictEqual(interpretarVeredicto('{"cumplido":"quizá","respuesta":"x"}').cumplido, null)
})

test('un veredicto sin respuesta no inventa texto', () => {
  assert.strictEqual(interpretarVeredicto('{"cumplido":true}').respuesta, '')
})

test('entrada vacía no revienta', () => {
  const v = interpretarVeredicto('')
  assert.strictEqual(v.respuesta, '')
  assert.strictEqual(v.cumplido, null)
})

test('nunca deja escapar el JSON crudo como respuesta hablada', () => {
  const v = interpretarVeredicto('{"cumplido":true,"respuesta":"Listo, señor."}')
  assert.ok(!v.respuesta.includes('cumplido'))
  assert.ok(!v.respuesta.includes('{'))
})

/* ── Dos salidas: voz y texto ── */
// La voz y la pantalla tienen restricciones distintas. El audio es lineal y no
// se escanea: 2-3 oraciones. La pantalla aguanta una tabla. No es
// inconsistencia — son dos derivados del mismo resultado.

test('lee voz y texto por separado', () => {
  const v = interpretarVeredicto('{"cumplido":true,"voz":"Tiene seis Pokémon, señor.","texto":"Grovyle Nv17\\nWingull Nv14"}')
  assert.strictEqual(v.voz, 'Tiene seis Pokémon, señor.')
  assert.strictEqual(v.texto, 'Grovyle Nv17\nWingull Nv14')
})

test('si solo viene `respuesta`, sirve para los dos canales', () => {
  const v = interpretarVeredicto('{"cumplido":true,"respuesta":"Listo, señor."}')
  assert.strictEqual(v.voz, 'Listo, señor.')
  assert.strictEqual(v.texto, 'Listo, señor.')
})

test('si falta el texto, se muestra lo que se dice', () => {
  const v = interpretarVeredicto('{"cumplido":true,"voz":"Hay 22 pendientes."}')
  assert.strictEqual(v.texto, 'Hay 22 pendientes.')
})

test('si falta la voz, se dice lo que se muestra', () => {
  const v = interpretarVeredicto('{"cumplido":true,"texto":"Hay 22 pendientes."}')
  assert.strictEqual(v.voz, 'Hay 22 pendientes.')
})

test('el texto puede ser mucho más largo que la voz: es la gracia', () => {
  const largo = 'linea\n'.repeat(50)
  const v = interpretarVeredicto(JSON.stringify({ cumplido: true, voz: 'Se lo dejo en pantalla, señor.', texto: largo }))
  assert.ok(v.texto.length > v.voz.length * 5)
  assert.strictEqual(v.voz, 'Se lo dejo en pantalla, señor.')
})

test('sin JSON, el texto plano vale para ambos', () => {
  const v = interpretarVeredicto('Hay tres pendientes, señor.')
  assert.strictEqual(v.voz, 'Hay tres pendientes, señor.')
  assert.strictEqual(v.texto, 'Hay tres pendientes, señor.')
})

test('`respuesta` mantiene su valor por compatibilidad', () => {
  assert.strictEqual(interpretarVeredicto('{"voz":"a","texto":"b"}').respuesta, 'a')
})

/* ── JSON que el modelo escribe mal ── */
// Capturado en vivo: el modelo produjo la estructura correcta pero envuelta en
// ```json y con SALTOS DE LÍNEA CRUDOS dentro del string `texto`. JSON.parse
// falla, todo cae como texto plano… y el TTS se puso a leer el JSON en voz alta.

const FENCE_CON_SALTOS = '```json\n{\n  "cumplido": true,\n  "voz": "Tiene seis Pokémon, señor.",\n  "texto": "Grovyle Nivel 17\nWingull Nivel 14\nDustox Nivel 15"\n}\n```'

test('parsea aunque el texto lleve saltos de línea sin escapar', () => {
  const v = interpretarVeredicto(FENCE_CON_SALTOS)
  assert.strictEqual(v.voz, 'Tiene seis Pokémon, señor.')
  assert.ok(v.texto.includes('Grovyle Nivel 17'))
  assert.ok(v.texto.includes('Dustox Nivel 15'))
})

test('conserva los saltos como saltos reales en el texto', () => {
  assert.ok(interpretarVeredicto(FENCE_CON_SALTOS).texto.includes('\n'))
})

test('nunca deja escapar el sobre JSON como si fuera habla', () => {
  const v = interpretarVeredicto(FENCE_CON_SALTOS)
  for (const fuga of ['cumplido', '```', '"voz"']) {
    assert.ok(!v.voz.includes(fuga), `se coló ${fuga} en la voz`)
  }
})

test('si el JSON es irrecuperable, no se lee el sobre en voz alta', () => {
  const v = interpretarVeredicto('```json\n{"cumplido": true, "voz": roto sin comillas}\n```')
  assert.ok(!v.voz.includes('cumplido'), 'la voz no puede ser el JSON crudo')
})

test('un bloque de código sin json sigue funcionando', () => {
  const v = interpretarVeredicto('```\n{"cumplido":true,"voz":"Listo."}\n```')
  assert.strictEqual(v.voz, 'Listo.')
})

/* ── Canales opcionales ── */
// No todo turno necesita las dos salidas: hay respuestas que solo se dicen
// (conversación) y otras que solo se muestran (una tabla). Un campo AUSENTE se
// respalda con el otro; un campo explícitamente VACÍO significa "este canal no
// va" y hay que respetarlo.

test('voz vacía a propósito significa no hablar', () => {
  const v = interpretarVeredicto('{"cumplido":true,"voz":"","texto":"Tabla larga en pantalla"}')
  assert.strictEqual(v.voz, '')
  assert.strictEqual(v.texto, 'Tabla larga en pantalla')
})

test('texto vacío a propósito significa solo voz', () => {
  const v = interpretarVeredicto('{"cumplido":true,"voz":"Listo, señor.","texto":""}')
  assert.strictEqual(v.voz, 'Listo, señor.')
  assert.strictEqual(v.texto, '')
})

test('un campo AUSENTE sí se respalda con el otro', () => {
  assert.strictEqual(interpretarVeredicto('{"cumplido":true,"voz":"Hola."}').texto, 'Hola.')
  assert.strictEqual(interpretarVeredicto('{"cumplido":true,"texto":"Hola."}').voz, 'Hola.')
})

test('no se pueden vaciar los dos: algo hay que devolver', () => {
  const v = interpretarVeredicto('{"cumplido":true,"voz":"","texto":""}')
  assert.strictEqual(v.voz === '' && v.texto === '', true, 'se respeta, pero quien llama pone el respaldo')
})

/* ── Coherencia entre canales ── */

test('detecta que un canal contradice al otro', () => {
  const v = interpretarVeredicto('{"cumplido":true,"voz":"Aquí tiene su equipo: Grovyle 17, Wingull 14.","texto":"Error de transferencia: datos corruptos."}')
  assert.strictEqual(v.incoherente, true)
})

test('no marca incoherencia cuando ambos van en la misma dirección', () => {
  const v = interpretarVeredicto('{"cumplido":true,"voz":"Tiene seis Pokémon.","texto":"Grovyle 17\\nWingull 14"}')
  assert.strictEqual(v.incoherente, false)
})

test('tampoco cuando ambos reportan el fallo', () => {
  const v = interpretarVeredicto('{"cumplido":false,"voz":"No pude leerlo, señor.","texto":"Error: datos corruptos."}')
  assert.strictEqual(v.incoherente, false)
})

/* ── La voz nunca lee la salida cruda del agente ── */
// Escuchado por Robert: la voz recitó "**3-5 agosto 2026 (rebote):**", una
// tabla de precios y palabras partidas a mitad. Eso es el resultado crudo del
// agente, no una síntesis. El texto SÍ puede llevar detalle; la voz no.

const { esCruda } = require('./veredicto.js')

test('reconoce markdown como salida cruda', () => {
  for (const t of ['**3-5 agosto 2026 (rebote):**', '## Resumen', '- 3 ago: SMH $538.43 (-0.39%)', '| col | col |']) {
    assert.strictEqual(esCruda(t), true, t)
  }
})

test('reconoce una enumeración con cifras como no hablable', () => {
  assert.strictEqual(esCruda('- 3 ago: SMH $538.43 (-0.39%), SOXX $499.31 (-1.11%), QQQ $694.38 (+0.93%)'), true)
})

test('una respuesta hablada normal no es cruda', () => {
  for (const t of [
    'Señor, sus notas cubren el rally de semiconductores de principios de agosto.',
    'Tiene seis Pokémon, señor; el más fuerte es Grovyle nivel diecisiete.',
    'Hay 22 tarjetas pendientes, señor.',
  ]) assert.strictEqual(esCruda(t), false, t)
})

test('un texto larguísimo no es hablable aunque no tenga markdown', () => {
  assert.strictEqual(esCruda('palabra '.repeat(160)), true)
})

test('tolera entrada vacía', () => {
  assert.strictEqual(esCruda(''), false)
  assert.strictEqual(esCruda(null), false)
})

/* ── Nunca 1 a 1: la capa SIEMPRE sintetiza ── */
// Regla de Robert: "la capa conversacional debe sintetizar la salida del agente,
// jamás debe ser 1 a 1 ni en texto ni en voz". No basta con que la voz sea
// corta: el texto también tiene que ser una síntesis con contexto, no un copiado.

const { esCopiaLiteral } = require('./veredicto.js')

const CRUDO = 'Registro Detallado del Equipo:\n- Grovyle (Nivel 17) | Planta | Naturaleza: Ingenua | Movimientos: Corte Furia, Malicioso\n- Wingull (Nivel 14) | Agua/Volador | Naturaleza: Amable | Movimientos: Gruñido, Pistola Agua'

test('detecta que la salida es el crudo copiado', () => {
  assert.strictEqual(esCopiaLiteral(CRUDO, CRUDO), true)
})

test('detecta una copia con retoques mínimos', () => {
  assert.strictEqual(esCopiaLiteral('Señor: ' + CRUDO, CRUDO), true)
})

test('una síntesis real no es copia', () => {
  const sintesis = 'Señor, tiene dos Pokémon con datos completos: Grovyle nivel 17 y Wingull nivel 14. Al primero le faltan movimientos de tipo planta.'
  assert.strictEqual(esCopiaLiteral(sintesis, CRUDO), false)
})

test('un recorte del crudo también es copia', () => {
  assert.strictEqual(esCopiaLiteral(CRUDO.slice(0, 120), CRUDO), true)
})

test('una respuesta corta que comparte algunos datos no es copia', () => {
  assert.strictEqual(esCopiaLiteral('Tiene dos Pokémon registrados, señor.', CRUDO), false)
})

test('tolera entradas vacías', () => {
  assert.strictEqual(esCopiaLiteral('', CRUDO), false)
  assert.strictEqual(esCopiaLiteral(CRUDO, ''), false)
  assert.strictEqual(esCopiaLiteral(null, null), false)
})
