// Tests del escalonado de timeouts de la delegación.
//
// Hay dos relojes: el del CLI (que produce el error bueno, con `timeout:true`)
// y la guarda externa del orquestador. Si la externa es más corta, dispara
// primero y tapa el diagnóstico. Medido: una consulta real a Trello tarda ~95s
// y su MCP declara connect_timeout 30 + timeout 120, así que 120s se queda
// corto en arranque frío.
const test = require('node:test')
const assert = require('node:assert')
const { guardaExterna, TIMEOUT_DELEGACION_POR_DEFECTO, MARGEN_SINTESIS_MS } = require('./timeouts.js')

test('la guarda externa siempre da más margen que el reloj del CLI', () => {
  for (const cli of [30_000, 120_000, 240_000, 600_000]) {
    assert.ok(guardaExterna(cli) > cli, `cli=${cli}`)
  }
})

test('el margen alcanza para la síntesis posterior al resultado', () => {
  assert.strictEqual(guardaExterna(120_000), 120_000 + MARGEN_SINTESIS_MS)
})

test('el timeout por defecto cubre las tareas largas medidas', () => {
  // Trello en frío ~173s; registrar un lote de seis Pokémon en el vault >240s.
  assert.ok(TIMEOUT_DELEGACION_POR_DEFECTO >= 300_000)
})

test('un valor inválido no deja la guarda por debajo del CLI', () => {
  assert.ok(guardaExterna(0) > 0)
  assert.ok(guardaExterna(NaN) > 0)
  assert.ok(guardaExterna(-5) > 0)
})
