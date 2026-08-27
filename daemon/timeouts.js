/**
 * Escalonado de los relojes de la delegación.
 *
 * Hay dos: el del CLI de Hermes, que es el que produce el diagnóstico bueno
 * (`timeout:true` → la capa lo explica con voz propia), y la guarda externa del
 * orquestador, que solo existe por si el proceso se cuelga sin devolver nada.
 * La externa DEBE ser mayor: si dispara primero, tapa el diagnóstico.
 *
 * El valor por defecto sale de una medición real: consultar el tablero de
 * Trello desde el perfil raíz tarda ~95s, y ese MCP declara connect_timeout 30
 * + timeout 120. Con 120s se cortaba en arranque frío.
 */

// Medidos: consultar Trello 173s; registrar seis Pokémon en el vault >240s.
// Dos casos reales rozando o pasando el límite anterior, así que se sube con
// margen. Un job largo ya no deja a la UI a ciegas: hay latido cada 5s.
const TIMEOUT_DELEGACION_POR_DEFECTO = 360_000
// Lo que puede tardar la síntesis del veredicto una vez que el agente devolvió.
const MARGEN_SINTESIS_MS = 60_000

function guardaExterna(timeoutCliMs) {
  const cli = Number(timeoutCliMs)
  const base = Number.isFinite(cli) && cli > 0 ? cli : TIMEOUT_DELEGACION_POR_DEFECTO
  return base + MARGEN_SINTESIS_MS
}

module.exports = { TIMEOUT_DELEGACION_POR_DEFECTO, MARGEN_SINTESIS_MS, guardaExterna }
