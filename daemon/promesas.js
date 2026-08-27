/**
 * Detector de promesas incumplidas de la capa conversacional.
 *
 * La capa puede y debe ACUMULAR sin delegar: eso es lo que la distingue de un
 * router. Lo que no puede es ANUNCIAR una acción que no ejecuta. Se midió que
 * el prompt no basta: aun con la orden explícita y el pedido explícito de
 * Robert, el modelo respondía «Le paso el equipo completo al entrenador ahora
 * mismo» y decidía `responder`. Esto lo detecta para forzar el reintento.
 *
 * El criterio es la diferencia entre RETENER ("lo tengo anotado, quedo a la
 * espera") y EJECUTAR ("se lo paso ahora mismo"). Solo lo segundo obliga.
 */

// Un verbo de acción en primera persona, en presente o futuro inmediato.
// Verbos con los que la capa anuncia trabajo propio. Se listan las RAÍCES y se
// aceptan sus formas de primera persona —presente y futuro— porque enumerar
// conjugaciones siempre deja una fuera: se coló "Consultaré el vault" con
// `consulto` en la lista pero no `consultaré`.
const RAICES = 'consult|revis|registr|anot|actualiz|deleg|coordin|busc|list|prepar|proces|verific|mir'
const ACCION = new RegExp(
  // futuro simple en 1ª persona: consultaré, revisaré, pasaré, enviaré, pediré…
  `\\b(?:${RAICES})ar[ée](?![a-zá-úñ])` + '|' +
  '\\b(?:pasar[ée]|enviar[ée]|pedir[ée]|har[ée])(?![a-zá-úñ])' + '|' +
  // presente en 1ª persona
  `\\b(?:${RAICES})o\\b` + '|' +
  // perífrasis y gerundios
  '\\b(?:voy a|procedo a|paso a|le paso|se lo paso|lo paso|te paso|le env[íi]o|se lo env[íi]o|lo env[íi]o)\\b' + '|' +
  '\\bestoy\\s+[a-zá-úñ]*ndo[a-zá-úñ]*',
  'i')

// Marcas de inmediatez: sin ellas, "registro" suele ser retención.
const INMEDIATEZ = /\b(ahora mismo|inmediatamente|enseguida|en seguida|de inmediato|ya mismo|en este momento)\b/i

// Condicionales y preguntas: ofrecer no es prometer.
const CONDICIONAL = /\b(si (desea|quiere|gusta|lo prefiere)|puedo|podr[íi]a|quiere que|desea que|cuando (termine|guste|me diga))\b/i

// Retención explícita: el estado correcto mientras acumula.
const RETENCION = /\b(anotado|lo tengo|los tengo|tengo (los|las|el|la)|registrad[oa]s?, se[ñn]or|quedo (a la espera|atento)|sigo (atento|esperando)|a la espera)\b/i

function prometeAccion(texto) {
  const t = String(texto || '')
  if (!t.trim()) return false
  if (!ACCION.test(t)) return false
  // Una oración que ofrece o pregunta no compromete nada.
  if (CONDICIONAL.test(t) || t.includes('¿')) return false
  // Si además dice que lo retiene y espera, está describiendo su estado real.
  if (RETENCION.test(t) && !INMEDIATEZ.test(t)) return false
  return true
}

// Fórmulas que DESCRIBEN la respuesta en lugar de darla.
const ANUNCIO = /\b(he (detallado|preparado|listado|resumido|recopilado)|aqu[íi] (tiene|está|van)|le (detallo|listo|comparto|presento|preparé)|ya tengo (el|la|los|las) (informe|resumen|listado|lista|información|datos)|te (detallo|listo|comparto)|a continuaci[óo]n)\b/i

// Señales de que sí hay contenido: cifras, dos puntos seguidos de algo, o
// viñetas. Se probó aceptar también "X y Z", pero eso matchea prosa cualquiera
// ("naturalezas y sets de movimientos") y dejaba pasar el anuncio vacío.
const HAY_DATOS = /\d|:\s*\S|[-•·]\s+\S/

// Describir la respuesta no es responder. Se detecta cuando la frase anuncia
// contenido y no trae ninguno.
function anunciaSinEntregar(texto) {
  const t = String(texto || '')
  if (!t.trim() || !ANUNCIO.test(t)) return false
  // Se quitan TODAS las fórmulas de anuncio y se mira si queda algún dato.
  // Mirar solo tras el primer anuncio fallaba con dos anuncios encadenados
  // ("ya tengo el informe… He detallado…").
  const sinAnuncios = t.replace(new RegExp(ANUNCIO.source, 'gi'), ' ')
  return !HAY_DATOS.test(sinAnuncios)
}

const MAX_PEDIDO = 4000

// Normaliza el pedido que el modelo escribe en texto plano cuando se niega a
// emitir el tool call. Es la vía de rescate: escribir la petición sí lo hace
// bien; llamar a la herramienta, a veces no.
function limpiarPedido(texto) {
  let t = String(texto || '')
    .replace(/<\s*\/?\s*(tool|call|function|invoke|antml)[\s\S]*$/i, '')
    .trim()
  t = t.replace(/^(pedido|petici[óo]n|request)\s*:\s*/i, '').trim()
  // Comillas envolventes de cualquier tipo.
  const pares = [['"', '"'], ["'", "'"], ['«', '»'], ['“', '”']]
  for (const [a, b] of pares) {
    if (t.startsWith(a) && t.endsWith(b) && t.length > 1) { t = t.slice(1, -1).trim(); break }
  }
  return t.slice(0, MAX_PEDIDO).trim()
}

// Un turno sin contenido ni tool call no es una respuesta: es un turno perdido.
// Pasa con los modelos de razonamiento, que dejan todo en `reasoning`.
const SOLO_PROTOCOLO = /^\s*<\s*\/?\s*(tool|call|function|invoke|antml)[^]*$/i

function turnoVacio(texto, toolCall) {
  if (toolCall) return false
  const t = String(texto || '').trim()
  return !t || SOLO_PROTOCOLO.test(t)
}

module.exports = { prometeAccion, turnoVacio, anunciaSinEntregar, limpiarPedido, MAX_PEDIDO, ANUNCIO, ACCION, INMEDIATEZ, CONDICIONAL, RETENCION }
