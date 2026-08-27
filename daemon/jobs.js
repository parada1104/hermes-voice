/**
 * Supervisor persistente de delegaciones (DelegationManager).
 *
 * Un job es una delegación asíncrona a un agente (Hermes/Pi/Orca). Vive fuera
 * del turno de voz que lo originó, así que tiene que sobrevivir a un reinicio
 * del daemon: si el proceso muere a mitad de una delegación, al arrancar los
 * jobs que quedaron `queued`/`running` se cierran como `interrupted` en vez de
 * quedar colgados para siempre en la UI.
 */

const fs = require('fs')
const path = require('path')

// `incompleta`: la delegación corrió y volvió, pero la capa juzgó que no
// resolvió el pedido. Es terminal, pero no es un éxito.
const ESTADOS_TERMINALES = ['completed', 'incompleta', 'failed', 'timed_out', 'interrupted', 'cancelled']
const MAX_JOBS_POR_DEFECTO = 200

function esTerminal(job) { return ESTADOS_TERMINALES.includes(job?.estado) }

// Cierra los jobs que quedaron vivos de un proceso anterior. Es idempotente:
// una vez marcados como interrupted ya son terminales y no se vuelven a tocar.
function reconciliarJobs(rows, ahora) {
  return (rows || []).map(job => esTerminal(job) ? job : ({
    ...job,
    estado: 'interrupted',
    error: 'El daemon se reinició durante la delegación',
    finishedAt: ahora,
    updatedAt: ahora,
  }))
}

// Retención: nos quedamos con los más recientes, pero nunca descartamos un job
// vivo — perderlo dejaría una delegación en curso sin registro.
function podarJobs(rows, max = MAX_JOBS_POR_DEFECTO) {
  const lista = rows || []
  if (lista.length <= max) return lista
  const vivos = lista.filter(j => !esTerminal(j))
  const terminales = lista.filter(esTerminal).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  const sobran = lista.length - max
  return [...vivos, ...terminales.slice(Math.max(0, sobran))]
}

class DelegationManager {
  constructor({ file, max = MAX_JOBS_POR_DEFECTO, ahora = () => Date.now() } = {}) {
    this.file = file
    this.max = max
    this.ahora = ahora
    this.suscriptores = new Set()
    this.jobs = new Map()
    this._cargar()
  }

  _cargar() {
    let rows = []
    try { const crudo = JSON.parse(fs.readFileSync(this.file, 'utf8')); if (Array.isArray(crudo)) rows = crudo } catch (_) {}
    const antes = JSON.stringify(rows)
    const reconciliados = podarJobs(reconciliarJobs(rows, this.ahora()), this.max)
    reconciliados.forEach(j => { if (j && j.jobId) this.jobs.set(j.jobId, j) })
    // Persistimos el resultado de la reconciliación para que un segundo arranque
    // no vuelva a mover el finishedAt de un job ya cerrado.
    if (JSON.stringify(reconciliados) !== antes) this._persistir()
  }

  _persistir() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true })
      fs.writeFileSync(this.file, JSON.stringify([...this.jobs.values()], null, 2))
    } catch (_) {}
  }

  _notificar(job) { this.suscriptores.forEach(cb => { try { cb({ ...job }) } catch (_) {} }) }

  onCambio(cb) { this.suscriptores.add(cb); return () => this.suscriptores.delete(cb) }

  crear(datos) {
    const ahora = this.ahora()
    const job = { estado: 'queued', createdAt: ahora, updatedAt: ahora, ...datos }
    this.jobs.set(job.jobId, job)
    const podados = new Set(podarJobs([...this.jobs.values()], this.max).map(j => j.jobId))
    ;[...this.jobs.keys()].forEach(id => { if (!podados.has(id)) this.jobs.delete(id) })
    this._persistir()
    // No se notifica la creación: el que lanza emite `tool.start` primero. Si
    // esto avisara, la UI recibiría el estado de una tarjeta inexistente.
    return { ...job }
  }

  actualizar(jobId, patch) {
    const job = this.jobs.get(jobId)
    if (!job) return null
    Object.assign(job, patch, { updatedAt: this.ahora() })
    this._persistir()
    this._notificar(job)
    return { ...job }
  }

  obtener(jobId) { const j = this.jobs.get(jobId); return j ? { ...j } : null }

  listar(sesionId) {
    return [...this.jobs.values()]
      .filter(j => !sesionId || j.sesionId === sesionId)
      .map(j => ({ ...j }))
  }

  // Jobs sin cerrar: la UI los usa para repintar delegaciones en curso al reconectar.
  vivos(sesionId) { return this.listar(sesionId).filter(j => !esTerminal(j)) }
}

module.exports = { DelegationManager, reconciliarJobs, podarJobs, esTerminal, ESTADOS_TERMINALES, MAX_JOBS_POR_DEFECTO }
