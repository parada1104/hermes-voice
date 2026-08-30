/**
 * Detector de voz: decide CUÁNDO cerrar una captura.
 *
 * El modo continuo cortaba a los 3000 ms fijos, sin mirar si Robert seguía
 * hablando. Cualquier frase más larga llegaba partida a mitad de palabra y el
 * STT recibía un fragmento — se veía como "el STT me corta las frases", pero el
 * audio ya llegaba cortado.
 *
 * Aquí se cierra por SILENCIO SOSTENIDO, con un techo de seguridad. Las pausas
 * breves al pensar no parten la frase, y una captura sin voz no se manda al STT.
 */

const POR_DEFECTO = {
  // Umbral validado midiendo el micrófono real: sala en silencio pico 0.00392,
  // voz p50 0.05585 — margen de 21x. No hace falta tocarlo.
  umbral: 0.02,      // energía RMS mínima para considerar que hay voz
  // 900 ms cerraba el turno apenas dudabas buscando la palabra. Cada ms de más
  // acá es latencia que pagan TODOS los turnos antes de que el agente arranque:
  // 1500 es el punto donde se puede pensar sin que la app te apure.
  silencioMs: 1500,  // pausa que se tolera antes de dar la frase por terminada
  // El techo no tiene que respetar la ventana de 30 s de Whisper: verificado
  // contra el oMLX, procesa long-form (40,32 s -> 3 segmentos hasta 39,84).
  maxMs: 45000,      // techo: nadie dicta más de esto de un tirón
  minVozMs: 300,     // menos que esto es un golpe de ruido, no una frase
}

class DetectorVoz {
  constructor(opts = {}) {
    this.cfg = { ...POR_DEFECTO, ...opts }
    this.reiniciar()
  }

  reiniciar() {
    this.inicio = null
    this.hablo = false
    this.vozMs = 0
    this.silencioDesde = null
    this.ultimoMs = null
  }

  procesar(energia, ahoraMs) {
    if (this.inicio === null) this.inicio = ahoraMs
    const paso = this.ultimoMs === null ? 0 : Math.max(0, ahoraMs - this.ultimoMs)
    this.ultimoMs = ahoraMs

    const hayVoz = energia >= this.cfg.umbral
    if (hayVoz) {
      this.hablo = true
      this.vozMs += paso
      this.silencioDesde = null
    } else if (this.silencioDesde === null) {
      this.silencioDesde = ahoraMs
    }

    const estado = hayVoz ? 'hablando' : 'silencio'
    const transcurrido = ahoraMs - this.inicio

    // Techo de seguridad: se corta aunque siga hablando.
    if (transcurrido >= this.cfg.maxMs) {
      return { estado, accion: this.hablo && this.vozMs >= this.cfg.minVozMs ? 'cortar' : 'descartar', transcurrido }
    }

    const silencioSostenido = this.silencioDesde !== null && (ahoraMs - this.silencioDesde) >= this.cfg.silencioMs
    if (!silencioSostenido) return { estado, accion: null, transcurrido }

    // Hubo silencio suficiente: se cierra si de verdad hubo frase; si solo fue
    // ruido o nada, se descarta para no gastar una transcripción.
    const huboFrase = this.hablo && this.vozMs >= this.cfg.minVozMs
    return { estado, accion: huboFrase ? 'cortar' : 'descartar', transcurrido }
  }
}

/**
 * Monitor de voz SOSTENIDA para el barge-in durante la reproducción (D4).
 *
 * DetectorVoz decide CUÁNDO CERRAR una captura: espera silencio sostenido y
 * recién ahí corta. El barge-in necesita lo opuesto — reaccionar EN CUANTO
 * hay voz sostenida, sin esperar a que Robert se calle. Por eso es una clase
 * aparte y no un modo de DetectorVoz: comparten el mismo umbral de energía,
 * pero la semántica de "cuándo actuar" es la contraria.
 *
 * Se midió un pico aislado de 0.115 RMS al arrancar el audio (ver
 * mediciones.md, M3): una sola muestra por encima del umbral NUNCA alcanza
 * para disparar, o el propio arranque del audio se autointerrumpiría. Recién
 * cuenta cuando el mismo tramo de voz se sostiene por `minVozMs` seguidos —
 * igual que `DetectorVoz` exige para no descartar una frase por ruido corto.
 */
class MonitorVozSostenida {
  constructor(opts = {}) {
    this.cfg = { umbral: POR_DEFECTO.umbral, minVozMs: POR_DEFECTO.minVozMs, ...opts }
    this.reiniciar()
  }

  reiniciar() {
    this.vozMs = 0
    this.ultimoMs = null
  }

  // Devuelve true en la muestra donde la voz sostenida cruza minVozMs. Una
  // sola muestra nunca dispara: el primer paso siempre vale 0ms (no hay
  // "antes" con qué medir la duración), así que hace falta más de un frame.
  procesar(energia, ahoraMs) {
    const paso = this.ultimoMs === null ? 0 : Math.max(0, ahoraMs - this.ultimoMs)
    this.ultimoMs = ahoraMs

    if (energia >= this.cfg.umbral) {
      this.vozMs += paso
    } else {
      this.vozMs = 0   // la racha se corta: tiene que ser sostenida, no acumulada entre silencios
    }
    return this.vozMs >= this.cfg.minVozMs
  }
}

// Energía RMS de un bloque de muestras en punto flotante (-1..1).
function energiaRms(muestras) {
  if (!muestras || !muestras.length) return 0
  let suma = 0
  for (let i = 0; i < muestras.length; i++) suma += muestras[i] * muestras[i]
  return Math.sqrt(suma / muestras.length)
}

if (typeof module !== 'undefined' && module.exports) module.exports = { DetectorVoz, MonitorVozSostenida, energiaRms, POR_DEFECTO }
