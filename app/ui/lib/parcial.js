/**
 * Envío de transcripción parcial desde el browser (STT incremental).
 *
 * Mientras se graba, la UI manda cada ~2s el blob acumulado marcado
 * `parcial:true`. El daemon lo transcribe y devuelve `transcripcion parcial`,
 * que la UI muestra reemplazando la burbuja. Es feedback visual: el turno final
 * (audio-end) sigue mandando el blob completo e intacto.
 *
 * Módulo puro (patrón de vad.js): `index.html` lo carga con `<script src>` y lo
 * usa desde el timer de captura; los tests lo importan con require.
 */
'use strict'

const UMBRAL_MIN_BYTES = 1024

// ¿Hay que mandar un parcial ahora? Se exige WS abierto y blob con volumen
// (chunks acumulados que concatenados superen el umbral — ruido no, voz sí).
function debeEnviarParcial(ws, chunks) {
  if (!ws || ws.readyState !== 1 || !chunks || !chunks.length) return false
  const total = chunks.reduce((n, c) => n + (c && c.size ? c.size : 0), 0)
  return total >= UMBRAL_MIN_BYTES
}

// Arma el mensaje WS de audio parcial, o null si no corresponde enviarlo.
async function construirParcial({ ws, chunks, mime, sessionId, agent, profile, agentSessionId, agentModel }) {
  if (!debeEnviarParcial(ws, chunks)) return null
  const blob = new Blob(chunks, { type: mime || 'audio/webm' })
  const ab = new Uint8Array(await blob.arrayBuffer())
  if (ab.length < UMBRAL_MIN_BYTES) return null
  return JSON.stringify({
    type: 'audio',
    data: b64(ab),
    mime: mime || 'audio/webm',
    parcial: true,
    sessionId, agent, profile, agentSessionId, agentModel,
  })
}

// Conversión base64 segura para buffers grandes (la misma que usa la UI:
// spread corrompe chunks grandes → EBML inválido).
function b64(u8) {
  let bin = ''
  const CHUNK = 0x8000
  for (let i = 0; i < u8.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK))
  }
  return btoa(bin)
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { debeEnviarParcial, construirParcial, UMBRAL_MIN_BYTES }
}