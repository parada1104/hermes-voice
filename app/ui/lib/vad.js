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
  umbral: 0.02,      // energía RMS mínima para considerar que hay voz
  silencioMs: 900,   // silencio sostenido que cierra la frase
  maxMs: 25000,      // techo: nadie dicta más de esto de un tirón
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

// Energía RMS de un bloque de muestras en punto flotante (-1..1).
function energiaRms(muestras) {
  if (!muestras || !muestras.length) return 0
  let suma = 0
  for (let i = 0; i < muestras.length; i++) suma += muestras[i] * muestras[i]
  return Math.sqrt(suma / muestras.length)
}

if (typeof module !== 'undefined' && module.exports) module.exports = { DetectorVoz, energiaRms, POR_DEFECTO }
