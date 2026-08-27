/**
 * Ventana de conversación que ve la capa conversacional.
 *
 * Era un `slice(-8)` fijo, y eso impedía justo lo que distingue a esta capa de
 * un router: poder ACUMULAR varios turnos y delegar el lote cuando Robert
 * confirma que terminó. Dictar seis Pokémon son doce mensajes; con ocho, los
 * primeros se caían antes de poder delegarlos y la capa "retenía" algo que ya
 * no tenía.
 *
 * Se acota por caracteres —que es lo que de verdad infla el prompt— con un tope
 * de mensajes como red de seguridad para sesiones eternas.
 */

const MAX_MENSAJES = 40
const MAX_CARACTERES = 12000

function ventanaConversacion(thread, { maxMensajes = MAX_MENSAJES, maxCaracteres = MAX_CARACTERES } = {}) {
  const utiles = (thread || []).filter(m => typeof m?.text === 'string' && m.text.trim())
  const recientes = utiles.slice(-maxMensajes)

  // Se recorre de atrás hacia adelante: lo más reciente nunca se descarta.
  const elegidos = []
  let presupuesto = maxCaracteres
  for (let i = recientes.length - 1; i >= 0; i--) {
    const texto = recientes[i].text
    if (presupuesto <= 0) break
    const esElMasReciente = i === recientes.length - 1
    if (texto.length > presupuesto) {
      // Solo el más reciente se recorta: sin él el turno llegaría al modelo sin
      // lo que Robert acaba de decir. Un mensaje viejo a medias es un fragmento
      // engañoso, así que se descarta entero.
      if (!esElMasReciente) break
      elegidos.push({ role: recientes[i].role === 'user' ? 'user' : 'assistant', content: texto.slice(-presupuesto) })
      break
    }
    presupuesto -= texto.length
    elegidos.push({ role: recientes[i].role === 'user' ? 'user' : 'assistant', content: texto })
  }
  return elegidos.reverse()
}

module.exports = { ventanaConversacion, MAX_MENSAJES, MAX_CARACTERES }
