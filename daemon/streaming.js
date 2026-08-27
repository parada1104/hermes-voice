/**
 * Parseo incremental de la respuesta de la capa conversacional (SSE de
 * Cerebras con stream:true) y troceado en frases.
 *
 * La ganancia no es de throughput: es que la primera frase se puede sintetizar
 * y reproducir mientras el modelo sigue escribiendo, en vez de esperar a la
 * respuesta completa antes de abrir la boca.
 */

// Devuelve los eventos JSON completos que haya en `chunk` (más lo que quedó
// pendiente del anterior) y el resto sin cerrar.
function parsearSSE(chunk, pendiente = '') {
  const texto = pendiente + chunk
  const partes = texto.split('\n\n')
  const resto = partes.pop() ?? ''
  const eventos = []
  for (const bloque of partes) {
    for (const linea of bloque.split('\n')) {
      if (!linea.startsWith('data:')) continue
      const payload = linea.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      try { eventos.push(JSON.parse(payload)) } catch (_) { /* trozo inválido: se ignora */ }
    }
  }
  return { eventos, resto }
}

// Funde un delta sobre lo acumulado. Los tool calls llegan troceados y se
// identifican por `index`, no por posición de llegada.
function acumularDelta(acc, delta) {
  const out = { ...acc }
  if (typeof delta?.content === 'string') out.content = (out.content || '') + delta.content
  if (Array.isArray(delta?.tool_calls)) {
    const calls = [...(out.tool_calls || [])]
    for (const tc of delta.tool_calls) {
      const i = Number(tc.index ?? 0)
      const previo = calls[i] || { index: i, function: { name: '', arguments: '' } }
      calls[i] = {
        index: i,
        id: tc.id || previo.id,
        type: tc.type || previo.type || 'function',
        function: {
          name: tc.function?.name || previo.function.name,
          arguments: (previo.function.arguments || '') + (tc.function?.arguments || ''),
        },
      }
    }
    out.tool_calls = calls
  }
  return out
}

// Lo convierte a la forma no-streaming, que es la que consume normalizarToolCall.
function mensajeDesdeAcumulado(acc) {
  const msg = { role: 'assistant', content: acc?.content || '' }
  const calls = (acc?.tool_calls || []).filter(Boolean)
  if (calls.length) msg.tool_calls = calls.map(c => ({ id: c.id, type: 'function', function: { ...c.function } }))
  return msg
}

// Un punto solo cierra frase si le sigue espacio o fin de texto: así "3.5" no
// se parte en dos.
const FIN_DE_FRASE = /[.!?…](?=\s|$)/g

function frasesNuevas(textoCompleto, consumido = 0) {
  const pendiente = String(textoCompleto || '').slice(consumido)
  const frases = []
  let corte = 0
  FIN_DE_FRASE.lastIndex = 0
  let m
  while ((m = FIN_DE_FRASE.exec(pendiente)) !== null) {
    const frase = pendiente.slice(corte, m.index + 1).trim()
    if (frase) frases.push(frase)
    corte = m.index + 1
  }
  return { frases, consumido: consumido + corte }
}

// Lo que falta por sintetizar tras haber hablado ya el prefijo en streaming.
// Si el texto final no empieza por lo dicho (el modelo reescribió), se prefiere
// repetir a perder contenido.
function restoNoHablado(texto, hablado) {
  const completo = String(texto || '')
  const dicho = String(hablado || '').trim()
  if (!dicho) return completo
  const normal = (x) => x.replace(/\s+/g, ' ').trim()
  if (!normal(completo).startsWith(normal(dicho))) return completo
  let i = 0, j = 0
  while (i < completo.length && j < dicho.length) {
    if (/\s/.test(completo[i]) && /\s/.test(dicho[j])) { while (/\s/.test(completo[i])) i++; while (/\s/.test(dicho[j])) j++; continue }
    i++; j++
  }
  return completo.slice(i).trim()
}

// Señales de que el modelo está escribiendo un tool call como texto en vez de
// usar el canal de tool_calls. Pasa, y si se sintetiza se le lee el JSON a
// Robert en voz alta.
const MARCAS_TOOL_CALL = [
  // `_call:nombre{`, `<call:nombre{`… el modelo alterna las formas. Se exige el
  // `{` de apertura para no confundirlo con un "Nota:" cualquiera.
  /<?\s*_?call\s*:\s*[A-Za-z_][\w-]*\s*\{/,
  // Etiquetas de protocolo, incluso cortadas a medias: se capturó un preámbulo
  // que terminaba en '\n\n<tool' y se sintetizó la frase «<tool». Un `<`
  // pegado a una de estas palabras nunca es habla.
  /<\s*\/?\s*(tool|call|function|invoke|antml)/i,
  /"tool_calls"\s*:/,
  /"tool"\s*:\s*"functions\./,
  /"function"\s*:\s*\{/,
  /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:/,
  /\{\s*"arguments"\s*:\s*.*,\s*"name"\s*:/,
]

function contieneToolCall(texto) {
  const t = String(texto || '')
  return MARCAS_TOOL_CALL.some(re => re.test(t))
}

// Igual que frasesNuevas, pero amordaza en cuanto el contenido acumulado
// muestra un tool call: lo que venga después no es habla, es protocolo. Una vez
// cortado no se reanuda en el turno (`cortado` viaja de vuelta al llamador).
function frasesSegurasNuevas(textoCompleto, consumido = 0, cortado = false) {
  if (cortado) return { frases: [], consumido, cortado: true }
  const texto = String(textoCompleto || '')
  if (!contieneToolCall(texto)) return { ...frasesNuevas(texto, consumido), cortado: false }

  // Solo se dice lo anterior a la marca: ese trozo es el preámbulo real.
  const corte = Math.min(...MARCAS_TOOL_CALL.map(re => { const m = texto.match(re); return m ? m.index : Infinity }))
  const seguro = Number.isFinite(corte) ? texto.slice(0, corte) : texto
  const previo = frasesNuevas(seguro, consumido)
  return { frases: previo.frases, consumido: previo.consumido, cortado: true }
}

// El preámbulo que se ANUNCIA tiene que ser el mismo que ya se HABLÓ. Si el
// propio se perdió (p. ej. en la vía de rescate) pero el streaming ya dijo algo,
// se usa eso: soltar un genérico distinto de lo que Robert acaba de oír deja la
// GUI diciendo una cosa y el altavoz otra.
function preambuloEfectivo(propio, yaHablado, generico) {
  const limpio = (t) => (t && !contieneToolCall(t) ? String(t).trim() : '')
  return limpio(propio) || limpio(yaHablado) || generico
}

module.exports = { preambuloEfectivo, parsearSSE, acumularDelta, mensajeDesdeAcumulado, frasesNuevas, restoNoHablado, contieneToolCall, frasesSegurasNuevas, MARCAS_TOOL_CALL }
