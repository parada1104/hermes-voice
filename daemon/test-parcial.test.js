// Tests del envío de transcripción parcial (STT incremental).
const test = require('node:test')
const assert = require('node:assert')

const { deberiaProcesar, procesarParcial, tieneCabeceraWebm } = require('./parcial.js')

const webmConCabecera = () => Buffer.concat([Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), Buffer.from('datos')])
// Sesión activa real del path continuo/PTT: st existe, processing=false, buffer
// aún vacío (el parcial es el primer audio de la captura).
const stActiva = (extra = {}) => ({ sesion: 's1', buffer: [], processing: false, ...extra })

/* ── deberiaProcesar ── */

test('un audio NO parcial nunca se procesa como parcial', () => {
  assert.strictEqual(deberiaProcesar(stActiva(), { type: 'audio', data: 'x' }, Buffer.from('x')), false)
})

test('parcial con sesión activa y buffer vacío se procesa', () => {
  assert.strictEqual(
    deberiaProcesar(stActiva(), { type: 'audio', parcial: true, mime: 'audio/webm' }, webmConCabecera()),
    true,
  )
})

test('parcial sin sesión (st null) se ignora', () => {
  assert.strictEqual(deberiaProcesar(null, { type: 'audio', parcial: true }, webmConCabecera()), false)
})

test('parcial con turno en curso (processing=true) se ignora', () => {
  const st = stActiva({ processing: true, buffer: [Buffer.from('a')] })
  assert.strictEqual(deberiaProcesar(st, { type: 'audio', parcial: true }, webmConCabecera()), false)
})

test('parcial con blob vacío se ignora', () => {
  assert.strictEqual(deberiaProcesar(stActiva(), { type: 'audio', parcial: true }, Buffer.alloc(0)), false)
})

test('parcial webm sin cabecera EBML se descarta', () => {
  const chunk = Buffer.from('webm sin cabecera')
  assert.strictEqual(deberiaProcesar(stActiva(), { type: 'audio', parcial: true, mime: 'audio/webm' }, chunk), false)
})

test('parcial webm con cabecera válida se procesa', () => {
  assert.strictEqual(deberiaProcesar(stActiva(), { type: 'audio', parcial: true, mime: 'audio/webm' }, webmConCabecera()), true)
})

test('parcial no-webm (mp4/wav) sin cabecera webm sí se procesa', () => {
  const chunk = Buffer.from('datos mp4')
  assert.strictEqual(deberiaProcesar(stActiva(), { type: 'audio', parcial: true, mime: 'audio/mp4' }, chunk), true)
})

/* ── procesarParcial ── */

test('transcribe y emite transcripcion parcial cuando corresponde', async () => {
  const enviados = []
  const st = stActiva()
  const texto = await procesarParcial({
    st,
    msg: { type: 'audio', parcial: true, mime: 'audio/webm' },
    chunk: webmConCabecera(),
    sttOmlx: async () => 'hola señor',
    sendTo: (m) => enviados.push(m),
  })
  assert.strictEqual(texto, 'hola señor')
  assert.strictEqual(enviados.length, 1)
  assert.strictEqual(enviados[0].type, 'transcripcion')
  assert.deepStrictEqual(enviados[0].payload, { sesionId: 's1', text: 'hola señor', parcial: true })
  // NO toca buffer ni processing: el turno final los maneja intactos.
  assert.strictEqual(st.buffer.length, 0)
  assert.strictEqual(st.processing, false)
})

test('no emite nada cuando el turno está en curso', async () => {
  const sent = await procesarParcial({
    st: stActiva({ processing: true }),
    msg: { type: 'audio', parcial: true, mime: 'audio/webm' },
    chunk: webmConCabecera(),
    sttOmlx: async () => 'x',
    sendTo: () => { throw new Error('no debería enviar') },
  })
  assert.strictEqual(sent, null)
})

test('un fallo del STT durante el parcial se descarta silenciosamente', async () => {
  const enviados = []
  const texto = await procesarParcial({
    st: stActiva(),
    msg: { type: 'audio', parcial: true, mime: 'audio/webm' },
    chunk: webmConCabecera(),
    sttOmlx: async () => { throw new Error('oMLX caído') },
    sendTo: (m) => enviados.push(m),
  })
  assert.strictEqual(texto, null)
  assert.strictEqual(enviados.length, 0)
})

test('un texto vacío del STT no emite parcial', async () => {
  const enviados = []
  const texto = await procesarParcial({
    st: stActiva(),
    msg: { type: 'audio', parcial: true, mime: 'audio/webm' },
    chunk: webmConCabecera(),
    sttOmlx: async () => '  ',
    sendTo: (m) => enviados.push(m),
  })
  assert.strictEqual(texto, null)
  assert.strictEqual(enviados.length, 0)
})

/* ── tieneCabeceraWebm ── */

test('detecta la cabecera EBML de un webm', () => {
  assert.strictEqual(tieneCabeceraWebm(webmConCabecera()), true)
  assert.strictEqual(tieneCabeceraWebm(Buffer.from('nada')), false)
  assert.strictEqual(tieneCabeceraWebm(Buffer.alloc(0)), false)
})
