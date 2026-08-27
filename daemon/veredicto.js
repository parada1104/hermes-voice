/**
 * Veredicto de la capa conversacional sobre su propia tarea.
 *
 * La capa es un agente, no un altavoz: delega lo pesado por latencia, pero
 * sigue siendo la responsable de confirmar que lo que volvió resuelve lo que
 * Robert pidió. Antes resumía cualquier cosa —incluido un "(sin respuesta)"—
 * y la entregaba como si fuera la respuesta.
 */

// Un canal no puede contradecir al otro: se vio la voz recitando el equipo
// completo mientras la pantalla decía "datos corruptos". Se detecta cuando uno
// reporta fallo y el otro entrega datos como si nada.
const SEÑAL_FALLO = /\b(error|corrupt\w*|no pude|imposible|fall(ó|o|ida)|sin datos|no se pudo)\b/i
const SEÑAL_DATOS = /\d/

function canalesIncoherentes(voz, texto) {
  if (!voz || !texto) return false
  const fallaVoz = SEÑAL_FALLO.test(voz), fallaTexto = SEÑAL_FALLO.test(texto)
  if (fallaVoz === fallaTexto) return false
  // Uno reporta fallo y el otro no. Solo es contradicción si el otro además
  // entrega datos concretos: si solo es breve, puede ser un resumen legítimo.
  const otro = fallaVoz ? texto : voz
  return SEÑAL_DATOS.test(otro)
}

// Marcas de que el texto es salida CRUDA del agente y no una síntesis hablable.
// La pantalla aguanta markdown y tablas; la voz no: leerlas suena a recitar un
// terminal.
const MARCAS_CRUDAS = [
  /\*\*|^#{1,6}\s|\|.*\|/m,        // markdown: negritas, títulos, tablas
  /^\s*[-*•]\s+.*\d/m,               // viñetas con cifras
  /\$\d+[.,]\d+.*\$\d+[.,]\d+/,    // varias cotizaciones seguidas
]
// Más de esto no se puede escuchar de un tirón.
const MAX_VOZ = 800

function esCruda(texto) {
  const t = String(texto || '')
  if (!t.trim()) return false
  if (t.length > MAX_VOZ) return true
  return MARCAS_CRUDAS.some(re => re.test(t))
}

// La capa SIEMPRE sintetiza: copiar el resultado del agente no es responder.
// Se compara por solapamiento de líneas y de texto normalizado; un recorte del
// crudo cuenta como copia igual que el crudo entero.
function normalizarParaComparar(t) {
  return String(t || '').toLowerCase().replace(/\s+/g, ' ').trim()
}

function esCopiaLiteral(salida, crudo) {
  const a = normalizarParaComparar(salida)
  const b = normalizarParaComparar(crudo)
  if (!a || !b || a.length < 40) return false

  // Contención directa: la salida está dentro del crudo, o al revés.
  if (b.includes(a) || a.includes(b)) return true

  // Solapamiento de líneas con contenido: si casi todas las de la salida
  // aparecen tal cual en el crudo, no hubo síntesis.
  const lineas = String(salida).split('\n').map(l => normalizarParaComparar(l)).filter(l => l.length > 15)
  if (!lineas.length) return false
  const repetidas = lineas.filter(l => b.includes(l)).length
  return repetidas / lineas.length >= 0.7
}

const RELLENOS = ['(sin respuesta)', 'sin respuesta', '(vacío)', 'null', 'undefined']

// Resultados que no son respuesta y no merecen gastar una llamada al modelo.
function resultadoVacio(resultado) {
  if (resultado == null) return true
  if (typeof resultado === 'object') return !!resultado.error || Object.keys(resultado).length === 0
  const t = String(resultado).trim().toLowerCase()
  return !t || RELLENOS.includes(t)
}

// El modelo escribe el JSON multilínea con saltos CRUDOS dentro de los strings
// y JSON.parse revienta. Se reparan escapándolos, solo dentro de comillas.
function repararSaltos(bloque) {
  let dentro = false, escape = false, out = ''
  for (const ch of bloque) {
    if (escape) { out += ch; escape = false; continue }
    if (ch === '\\') { out += ch; escape = true; continue }
    if (ch === '"') { dentro = !dentro; out += ch; continue }
    if (dentro && (ch === '\n' || ch === '\r')) { out += ch === '\n' ? '\\n' : '\\r'; continue }
    if (dentro && ch === '\t') { out += '\\t'; continue }
    out += ch
  }
  return out
}

// Quita el envoltorio ``` o ```json que el modelo agrega pese a pedirle JSON pelado.
function quitarCerca(texto) {
  return String(texto || '').replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '')
}

function primerJson(texto) {
  const inicio = texto.indexOf('{')
  if (inicio < 0) return null
  let nivel = 0, cadena = false, escape = false
  for (let i = inicio; i < texto.length; i++) {
    const ch = texto[i]
    if (cadena) { if (escape) escape = false; else if (ch === '\\') escape = true; else if (ch === '"') cadena = false; continue }
    if (ch === '"') { cadena = true; continue }
    if (ch === '{') nivel++
    if (ch === '}' && --nivel === 0) {
      const bloque = texto.slice(inicio, i + 1)
      try { return JSON.parse(bloque) } catch (_) {}
      try { return JSON.parse(repararSaltos(bloque)) } catch (_) { return null }
    }
  }
  return null
}

// `cumplido` solo es true/false si vino como booleano de verdad: un "quizá" es
// desconocido, y desconocido nunca debe leerse como cumplido.
// Dos salidas del MISMO resultado, porque los canales no tienen las mismas
// restricciones: el audio es lineal y no se escanea (2-3 oraciones), la
// pantalla aguanta una tabla. Cuando solo llega una, sirve para ambos.
function interpretarVeredicto(salida) {
  const bruto = quitarCerca(String(salida || '').trim())
  if (!bruto) return { cumplido: null, voz: '', texto: '', respuesta: '', motivo: '' }

  const json = primerJson(bruto)
  if (!json) {
    // Sin JSON utilizable, el texto plano sirve — salvo que SEA el sobre. Leerlo
    // en voz alta fue exactamente lo que pasó: el TTS recitó el JSON.
    const pareceSobre = /"?cumplido"?\s*:|"voz"\s*:|"texto"\s*:/.test(bruto)
    const limpio = pareceSobre ? '' : bruto
    return { cumplido: null, voz: limpio, texto: limpio, respuesta: limpio, motivo: '' }
  }

  const cadena = (v) => (typeof v === 'string' ? v.trim() : '')
  // AUSENTE y VACÍO no son lo mismo: no todo turno necesita los dos canales.
  // Un campo que no viene se respalda con el otro; un campo puesto a "" quiere
  // decir "este canal no va" (solo pantalla, o solo voz) y se respeta.
  const unica = cadena(json.respuesta)
  const vozBruta = cadena(json.voz)
  const textoBruto = cadena(json.texto)
  const voz = 'voz' in json ? vozBruta : (unica || textoBruto)
  const texto = 'texto' in json ? textoBruto : (unica || vozBruta)

  return {
    cumplido: typeof json.cumplido === 'boolean' ? json.cumplido : null,
    voz,
    texto,
    // Compatibilidad con quien todavía lea un solo campo.
    respuesta: voz || texto,
    motivo: cadena(json.motivo),
    incoherente: canalesIncoherentes(voz, texto),
  }
}

module.exports = { resultadoVacio, interpretarVeredicto, esCruda, esCopiaLiteral, MAX_VOZ, RELLENOS }
