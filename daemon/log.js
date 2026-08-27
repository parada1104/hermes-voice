/**
 * Log estructurado por turno.
 *
 * Existe porque una sesión sin registro no se puede auditar: hubo un turno que
 * anunció una delegación y no dejó rastro de qué ruta tomó, y no había forma de
 * saberlo después. Una línea por evento, campos `clave=valor`, greppable.
 */

const MAX_VALOR = 120

function valorPlano(v) {
  const texto = String(v).replace(/\s+/g, ' ').trim()
  const recortado = texto.length > MAX_VALOR ? texto.slice(0, MAX_VALOR) + '…' : texto
  return /[\s"]/.test(recortado) ? `"${recortado.replace(/"/g, "'")}"` : recortado
}

function formatearEvento({ ts, evento, ...campos }) {
  const hora = new Date(ts || Date.now()).toISOString().slice(11, 23)
  const partes = [`${hora} ${evento}`]
  for (const [k, v] of Object.entries(campos)) {
    if (v === '' || v === null || v === undefined) continue
    partes.push(`${k}=${valorPlano(v)}`)
  }
  return partes.join(' ')
}

function crearLogger({ escribir = (l) => process.stdout.write(l + '\n'), activo = true } = {}) {
  return function log(evento, campos = {}) {
    if (!activo) return
    try { escribir(formatearEvento({ evento, ...campos })) } catch (_) { /* el log nunca rompe un turno */ }
  }
}

module.exports = { formatearEvento, crearLogger, MAX_VALOR }
