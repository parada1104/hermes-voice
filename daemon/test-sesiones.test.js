// Tests de la identidad de sesión: el id es estable e interno, el título es
// editable y es lo que se muestra. Antes eran la misma cosa, así que renombrar
// una conversación era imposible sin perder la sesión.
const test = require('node:test')
const assert = require('node:assert')
const { idDesdeTitulo, tituloVisible } = require('./sesiones.js')

test('deriva un id legible a partir del título', () => {
  assert.match(idDesdeTitulo('Coach Pokémon'), /^coach-pokemon-[a-z0-9]+$/)
})

test('dos sesiones con el mismo título no colisionan', () => {
  assert.notStrictEqual(idDesdeTitulo('Coach', 'aaa'), idDesdeTitulo('Coach', 'bbb'))
})

test('quita acentos y signos, y colapsa separadores', () => {
  assert.ok(idDesdeTitulo('¿Qué  hacemos —  hoy?', 'x').startsWith('que-hacemos-hoy-'))
})

test('un título vacío sigue produciendo un id usable', () => {
  assert.match(idDesdeTitulo('', 'x'), /^sesion-x$/)
})

test('recorta títulos larguísimos para que el id no sea absurdo', () => {
  const id = idDesdeTitulo('palabra '.repeat(40), 'x')
  assert.ok(id.length <= 60)
})

test('el título visible cae al id en sesiones viejas sin título', () => {
  assert.strictEqual(tituloVisible({ id: 'choach' }), 'choach')
  assert.strictEqual(tituloVisible({ id: 'choach', titulo: '' }), 'choach')
  assert.strictEqual(tituloVisible({ id: 'choach', titulo: 'Coach Pokémon' }), 'Coach Pokémon')
})

test('el título visible no se rompe con una sesión indefinida', () => {
  assert.strictEqual(tituloVisible(null), '')
})
