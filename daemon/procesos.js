/**
 * Registro de procesos de delegación en curso, por sesión.
 *
 * Existe para el barge-in: si Robert vuelve a hablar mientras el agente sigue
 * trabajando, hay que cortar de verdad el proceso hijo — no solo dejar de
 * escuchar su salida, que dejaría un `hermes` colgado consumiendo el turno.
 *
 * Guarda además QUIÉN lo mató. `execFile` mata por timeout con SIGTERM y
 * `killed:true`, igual que nosotros, así que la señal no distingue un timeout
 * de una cancelación deliberada: hay que anotarlo al cancelar. Sin esto, un
 * timeout de 120s se le reporta a Robert como "cancelado por el usuario".
 */

class RegistroProcesos {
  constructor() {
    this.porSesion = new Map()
    // Atado al proceso, no a la sesión: el `catch` de una delegación cancelada
    // puede llegar después de que la siguiente ya se registró, y perdería su
    // marca si dependiera de la clave de sesión.
    this.cancelados = new WeakSet()
  }

  registrar(sesionId, proceso) {
    if (!sesionId || !proceso) return
    this.cancelados.delete(proceso)
    this.porSesion.set(sesionId, { proceso, cancelado: false })
  }

  // Solo libera si el proceso sigue siendo el vigente: el `finally` de una
  // delegación anterior puede llegar después de que ya arrancó la siguiente.
  liberar(sesionId, proceso) {
    const entrada = this.porSesion.get(sesionId)
    if (entrada && entrada.proceso === proceso) this.porSesion.delete(sesionId)
    this.cancelados.delete(proceso)
  }

  cancelar(sesionId) {
    const entrada = this.porSesion.get(sesionId)
    if (!entrada || entrada.cancelado) return false
    entrada.cancelado = true
    this.cancelados.add(entrada.proceso)
    try { entrada.proceso.kill('SIGTERM'); return true } catch (_) { return false }
  }

  fueCancelado(_sesionId, proceso) { return !!proceso && this.cancelados.has(proceso) }

  activo(sesionId) { return this.porSesion.has(sesionId) }
}

module.exports = { RegistroProcesos }
