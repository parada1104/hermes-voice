// Parciales STT: lógica pura del envío incremental de transcripción.
// El handler WS de server.js la usa; las dependencias (sttOmlx, sendTo) se
// inyectan para poder testear sin servidor ni oMLX.
'use strict'

// ¿El parcial debe procesarse? Requiere sesión activa y sin turno en curso.
// NO exige buffer previo: en continuo/PTT el parcial es el primer audio de la
// captura. Se ignora sin st, con processing, chunk vacío o webm sin EBML.
function deberiaProcesar(st, msg, chunk) {
  if (msg.parcial !== true) return false
  if (!chunk || !chunk.length) return false
  if (!st) return false
  if (st.processing === true) return false
  const mime = msg.mime || 'audio/webm'
  if (/webm/i.test(mime) && !tieneCabeceraWebm(chunk)) return false
  return true
}

// Procesa un parcial: transcribe y emite 'transcripcion' con parcial:true.
// Devuelve el texto transcrito, o null si no había que procesarlo. Nunca toca
// st.buffer ni st.processing: el turno final los maneja intactos.
async function procesarParcial({ st, msg, chunk, sttOmlx, sendTo }) {
  if (!deberiaProcesar(st, msg, chunk)) return null
  try {
    const texto = await sttOmlx(chunk, msg.mime || 'audio/webm')
    if (typeof texto === 'string' && texto.trim()) {
      sendTo({ type: 'transcripcion', payload: { sesionId: st.sesion, text: texto, parcial: true } })
      return texto
    }
  } catch (e) {
    // Parcial falla (STT caído): se descarta en silencio; el audio-end reporta
    // el fallo real como hoy.
  }
  return null
}

function tieneCabeceraWebm(buf) {
  return buf && buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
}

module.exports = { deberiaProcesar, procesarParcial, tieneCabeceraWebm }