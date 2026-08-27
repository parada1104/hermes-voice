// Tests del envío de transcripción parcial desde la UI (STT incremental).
// La lógica vive en lib/parcial.js (módulo puro, mismo patrón que vad.js) para
// poder testearla con node:test; el timer y el span de vida los ata index.html.
const test = require('node:test')
const assert = require('node:assert')

// Módulo aún no implementado: el test falla en RED (TDD estricto).
const { construirParcial, debeEnviarParcial } = require('./parcial.js')

const ctx = {
  chunks: [new Blob([new Uint8Array(2048)]), new Blob([new Uint8Array(2048)])],
  mime: 'audio/webm',
  sessionId: 's1', agent: 'hermes', profile: 'coach',
  agentSessionId: 'as1', agentModel: 'qwen',
}

function wsAbierto() { return { readyState: 1 } }
function wsCerrado() { return { readyState: 3 } }

/* ── debeEnviarParcial ── */

test('no hay parcial si el WS no está abierto', () => {
  assert.strictEqual(debeEnviarParcial(wsCerrado(), ctx.chunks), false)
})

test('no hay parcial sin chunks acumulados', () => {
  assert.strictEqual(debeEnviarParcial(wsAbierto(), []), false)
})

test('no hay parcial si el blob total es muy pequeño (ruido, no voz)', () => {
  const chico = [new Blob(['ab'])]  // < umbral de 1024 bytes
  assert.strictEqual(debeEnviarParcial(wsAbierto(), chico), false)
})

test('hay parcial con WS abierto y chunks con volumen', () => {
  assert.strictEqual(debeEnviarParcial(wsAbierto(), ctx.chunks), true)
})

/* ── construirParcial ── */

test('arma el mensaje de audio parcial con el blob completo y parcial:true', async () => {
  const msg = await construirParcial({ ...ctx, ws: wsAbierto() })
  const parsed = JSON.parse(msg)
  assert.strictEqual(parsed.type, 'audio')
  assert.strictEqual(parsed.parcial, true)
  assert.strictEqual(parsed.mime, 'audio/webm')
  assert.strictEqual(parsed.sessionId, 's1')
  assert.strictEqual(parsed.agent, 'hermes')
  assert.strictEqual(parsed.profile, 'coach')
  assert.strictEqual(parsed.agentSessionId, 'as1')
  // data es base64 del blob concatenado (debe decodificar a los bytes)
  const bytes = Buffer.from(parsed.data, 'base64')
  assert.ok(bytes.length >= 1024, 'el blob parcial tiene contenido')
})

test('devuelve null si no debe enviar parcial', async () => {
  const r = await construirParcial({ ...ctx, ws: wsCerrado() })
  assert.strictEqual(r, null)
})