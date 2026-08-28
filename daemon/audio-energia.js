/**
 * Piso de energía: decide si un audio trae voz de verdad ANTES de creerle al STT.
 *
 * Whisper no avisa cuando alucina. Medido contra el oMLX de este proyecto, un
 * wav de silencio absoluto devuelve " Gracias." (2 s) o " Gracias por ver el
 * video." (4 s), con `no_speech_prob = 7.7e-11` — máxima confianza en que hay
 * habla donde no hay nada. Por eso el filtro no puede apoyarse en lo que el
 * modelo reporta: hay que mirar el audio.
 *
 * Se mide por ventanas de 100 ms, igual que el VAD del browser, y NO con un RMS
 * global: un blob de 25 s con una palabra de 300 ms tiene RMS global ~0.007 y un
 * piso global se comería ese turno real.
 *
 * Es la garantía del lado servidor: cubre push-to-talk, modo continuo y
 * cualquier camino futuro, sin depender de que cada uno de ellos se acuerde de
 * poner su propia compuerta.
 */
'use strict'

const VENTANA_MS = 100

// Umbral y mínimo DELIBERADAMENTE más permisivos que el VAD del browser
// (umbral 0.02, minVozMs 300). El servidor es la última red, no un segundo
// portero: si fuera más estricto descartaría audio que el cliente decidió
// mandar a propósito. Calibrado con medición real del micrófono de Robert:
// sala en silencio pico 0.00392, voz p50 0.05585.
const UMBRAL_VOZ = 0.015
const MIN_VOZ_MS = 200

/**
 * Lee un wav PCM16 mono. Devuelve null si no se puede medir con confianza —
 * el llamador lo trata como "dejalo pasar", nunca como "descartalo".
 */
function leerWavPcm16(buf) {
  if (!buf || buf.length < 44) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null

  // Recorrer los chunks: ffmpeg puede meter LIST/fact antes de `data`, así que
  // el offset fijo 44 no siempre es correcto.
  let pos = 12, fmt = null, datos = null
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4)
    const largo = buf.readUInt32LE(pos + 4)
    const cuerpo = pos + 8
    if (id === 'fmt ' && cuerpo + 16 <= buf.length) {
      fmt = {
        formato: buf.readUInt16LE(cuerpo),
        canales: buf.readUInt16LE(cuerpo + 2),
        sampleRate: buf.readUInt32LE(cuerpo + 4),
        bits: buf.readUInt16LE(cuerpo + 14),
      }
    } else if (id === 'data') {
      datos = buf.subarray(cuerpo, Math.min(cuerpo + largo, buf.length))
      break
    }
    pos = cuerpo + largo + (largo % 2)   // los chunks se alinean a par
  }

  if (!fmt || !datos) return null
  if (fmt.formato !== 1 || fmt.canales !== 1 || fmt.bits !== 16) return null
  if (!fmt.sampleRate) return null
  return { datos, sampleRate: fmt.sampleRate }
}

/**
 * Milisegundos de audio por encima del umbral, contados por ventanas de 100 ms.
 * Devuelve null si el buffer no es medible.
 */
function msDeVoz(buf, { umbral = UMBRAL_VOZ, ventanaMs = VENTANA_MS } = {}) {
  const wav = leerWavPcm16(buf)
  if (!wav) return null

  const porVentana = Math.max(1, Math.round(wav.sampleRate * ventanaMs / 1000))
  const totalMuestras = Math.floor(wav.datos.length / 2)
  let ms = 0

  for (let inicio = 0; inicio < totalMuestras; inicio += porVentana) {
    const fin = Math.min(inicio + porVentana, totalMuestras)
    let suma = 0
    for (let i = inicio; i < fin; i++) {
      const v = wav.datos.readInt16LE(i * 2) / 32768
      suma += v * v
    }
    const rms = Math.sqrt(suma / (fin - inicio))
    if (rms >= umbral) ms += Math.round((fin - inicio) * 1000 / wav.sampleRate)
  }
  return ms
}

/**
 * ¿Vale la pena transcribir esto?
 *
 * Ante la duda dice que sí: un buffer que no sabemos medir se transcribe igual.
 * Comerse un turno real es mucho peor que dejar pasar una alucinación.
 */
function hayVozReal(buf, { umbral = UMBRAL_VOZ, minVozMs = MIN_VOZ_MS } = {}) {
  if (!buf || !buf.length) return false
  const ms = msDeVoz(buf, { umbral })
  if (ms === null) return true          // no medible → se deja pasar
  return ms >= minVozMs
}

module.exports = { hayVozReal, msDeVoz, leerWavPcm16, UMBRAL_VOZ, MIN_VOZ_MS, VENTANA_MS }
