/**
 * Extractor de la respuesta del CLI de Hermes.
 *
 * El oneshot `-z` devuelve texto limpio, pero el subcomando `chat` —obligatorio
 * para adjuntar imágenes— decora stdout con cajas de razonamiento y un pie de
 * sesión aun con `-Q`. Sin esto, la delegación con adjunto devolvía el marco
 * ASCII entero como si fuera la respuesta del agente.
 */

const CAJA_HERMES = /╭─[^\n]*Hermes[^\n]*╮\n([\s\S]*?)\n╰[─╯][^\n]*/
const CAJA_RAZONAMIENTO = /┌─[^\n]*\n[\s\S]*?\n└[─┘][^\n]*\n?/g
const PIE_SESION = /\n\s*(Resume this session with:|Session:\s{2,}|Duration:\s{2,}|Messages:\s{2,})[\s\S]*$/

function limpiarBorde(linea) {
  return linea.replace(/^[│|]\s?/, '').replace(/\s*[│|]$/, '')
}

const CABECERA_RAZONAMIENTO = /^┌─[^\n]*Reasoning[^\n]*┐$/m

function extraerRespuestaHermes(stdout, { onFuga } = {}) {
  const texto = String(stdout || '')
  if (!texto.trim()) return ''

  // La caja de Hermes es la respuesta: si está, nada de fuera cuenta.
  const caja = texto.match(CAJA_HERMES)
  if (caja) return caja[1].split('\n').map(limpiarBorde).join('\n').trim()

  const sinCajas = texto.replace(CAJA_RAZONAMIENTO, '').replace(PIE_SESION, '').trim()

  // `chat --image` con -Q abre la caja de razonamiento y NO la cierra, así que
  // el bloque no se puede delimitar por sus bordes. Es un defecto del CLI de
  // Hermes y además intermitente: a veces la salida llega limpia. Cuando pasa,
  // la respuesta es el último bloque; se avisa para que la fuga se vea.
  if (CABECERA_RAZONAMIENTO.test(sinCajas)) {
    if (onFuga) onFuga('El CLI filtró la caja de razonamiento sin cerrar; se tomó el último bloque como respuesta')
    const bloques = sinCajas.split(/\n\s*\n/).map(b => b.trim()).filter(Boolean)
    const ultimo = bloques.at(-1) || ''
    return CABECERA_RAZONAMIENTO.test(ultimo) || ultimo.includes('┌') ? '' : ultimo
  }

  return sinCajas
}

module.exports = { extraerRespuestaHermes, CAJA_HERMES }
