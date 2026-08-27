/**
 * Cliente del CLI de Orca para los workers de la capa conversacional.
 *
 * Solo la parte de terminales: crear, enviar, mirar la pantalla y cerrar. La
 * capa `orchestration` (runs, tasks, DAGs) es para coordinar varios agentes;
 * aquí hace falta lo contrario — un proceso vivo por conversación.
 *
 * La lectura paginada por cursores ya no existe: servía para reconstruir la
 * respuesta desde el flujo acumulado del TTY, y la respuesta ahora sale del
 * store de Hermes. Del terminal solo se necesita saber si está ocupado.
 */

const { promisify } = require('util')
const execFileAsync = promisify(require('child_process').execFile)
const { handleDeRespuesta } = require('./worker')

const ORCA_BIN = process.env.HV_ORCA_BIN || 'orca'

async function orcaJson(args, { timeout = 30000 } = {}) {
  const { stdout } = await execFileAsync(ORCA_BIN, [...args, '--json'], { timeout, maxBuffer: 8 * 1024 * 1024 })
  try { return JSON.parse(stdout) } catch (e) { throw new Error('Orca devolvió una salida no-JSON: ' + stdout.slice(0, 200)) }
}

// Orca marca los handles caducados con `terminal_handle_stale`; el gestor lo usa
// para recrear el worker en vez de fallar.
function marcarStale(e) {
  const texto = `${e?.message || ''} ${e?.stdout || ''} ${e?.stderr || ''}`
  if (/terminal_handle_stale|not found|unknown terminal/i.test(texto)) e.stale = true
  return e
}

function crearClienteOrca({ timeoutCmdMs = 30000 } = {}) {
  return {
    async disponible() {
      try {
        const r = await orcaJson(['status'], { timeout: 8000 })
        const s = r?.result || r
        return s?.runtime?.reachable === true || s?.app?.running === true
      } catch (_) { return false }
    },

    async crearTerminal({ titulo, comando }) {
      const r = await orcaJson(['terminal', 'create', '--title', titulo, '--command', comando], { timeout: timeoutCmdMs })
      return handleDeRespuesta(r)
    },

    async enviar(handle, texto) {
      try {
        await orcaJson(['terminal', 'send', '--terminal', handle, '--text', texto, '--enter'], { timeout: timeoutCmdMs })
        return true
      } catch (e) { throw marcarStale(e) }
    },

    // Lo RENDERIZADO. Es la lectura correcta para un TUI: el modo por defecto
    // devuelve la salida acumulada y un programa que repinta líneas vuelve como
    // fragmentos apilados ("RESUMEN DE PUNTOS PRINCIPALESnombres con el año…").
    // `--screen` no admite `--cursor`: es el frame actual, sin historia.
    async leerPantalla(handle) {
      try {
        const r = await orcaJson(['terminal', 'read', '--terminal', handle, '--screen'], { timeout: timeoutCmdMs })
        const t = r?.result?.terminal || {}
        return { tail: t.tail || [], source: t.source || '', latestCursor: t.latestCursor || '' }
      } catch (e) { throw marcarStale(e) }
    },

    async cerrar(handle) {
      try { await orcaJson(['terminal', 'close', '--terminal', handle], { timeout: timeoutCmdMs }); return true }
      catch (e) { throw marcarStale(e) }
    },
  }
}

module.exports = { crearClienteOrca, ORCA_BIN }
