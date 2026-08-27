// Tests del contexto REAL del agente: SOUL.md + skills + cwd del perfil.
// El contexto NO es el historial de conversación; es lo que se le inyecta al
// agente. Se lee con directorios inyectados, así que no toca ~/.hermes.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { contextoPerfilDesde, rutaTrabajoDeConfig, descripcionDeProfileYaml } = require('./contexto.js')

function escenario({ soulPerfil, soulGlobal, skillsPerfil = [], skillsGlobal = [], profileYaml } = {}) {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'hv-ctx-'))
  const dirPerfil = path.join(raiz, 'perfil')
  const dirGlobal = path.join(raiz, 'global')
  fs.mkdirSync(path.join(dirPerfil, 'skills'), { recursive: true })
  fs.mkdirSync(path.join(dirGlobal, 'skills'), { recursive: true })
  if (soulPerfil !== undefined) fs.writeFileSync(path.join(dirPerfil, 'SOUL.md'), soulPerfil)
  if (soulGlobal !== undefined) fs.writeFileSync(path.join(dirGlobal, 'SOUL.md'), soulGlobal)
  if (profileYaml !== undefined) fs.writeFileSync(path.join(dirPerfil, 'profile.yaml'), profileYaml)
  skillsPerfil.forEach(s => fs.mkdirSync(path.join(dirPerfil, 'skills', s), { recursive: true }))
  skillsGlobal.forEach(s => fs.mkdirSync(path.join(dirGlobal, 'skills', s), { recursive: true }))
  return { dirPerfil, dirGlobal }
}

/* ── SOUL.md ── */

test('carga el SOUL.md del perfil y marca su origen', () => {
  const { dirPerfil, dirGlobal } = escenario({ soulPerfil: '# Entrenador', soulGlobal: '# Global' })
  const ctx = contextoPerfilDesde({ dirPerfil, dirGlobal })
  assert.strictEqual(ctx.soul, '# Entrenador')
  assert.strictEqual(ctx.soulScope, 'perfil')
  assert.ok(ctx.soulPath.endsWith('SOUL.md'))
})

test('cae al SOUL.md global si el perfil no tiene uno propio', () => {
  const { dirPerfil, dirGlobal } = escenario({ soulGlobal: '# Global' })
  const ctx = contextoPerfilDesde({ dirPerfil, dirGlobal })
  assert.strictEqual(ctx.soul, '# Global')
  assert.strictEqual(ctx.soulScope, 'global')
})

test('sin ningún SOUL.md el contexto no está cargado pero no revienta', () => {
  const { dirPerfil, dirGlobal } = escenario({})
  const ctx = contextoPerfilDesde({ dirPerfil, dirGlobal })
  assert.strictEqual(ctx.soul, '')
  assert.strictEqual(ctx.soulScope, '')
  assert.strictEqual(ctx.loaded, false)
})

test('un SOUL.md presente marca el contexto como cargado', () => {
  const { dirPerfil, dirGlobal } = escenario({ soulPerfil: '# X' })
  assert.strictEqual(contextoPerfilDesde({ dirPerfil, dirGlobal }).loaded, true)
})

/* ── Skills ── */

test('une skills del perfil y globales sin duplicar', () => {
  const { dirPerfil, dirGlobal } = escenario({ soulPerfil: '#', skillsPerfil: ['gaming', 'obsidian'], skillsGlobal: ['gaming', 'devops'] })
  const ctx = contextoPerfilDesde({ dirPerfil, dirGlobal })
  assert.deepStrictEqual(ctx.skills, ['devops', 'gaming', 'obsidian'])
})

test('ignora ficheros sueltos: una skill es un directorio', () => {
  const { dirPerfil, dirGlobal } = escenario({ soulPerfil: '#', skillsPerfil: ['gaming'] })
  fs.writeFileSync(path.join(dirPerfil, 'skills', 'README.md'), 'x')
  assert.deepStrictEqual(contextoPerfilDesde({ dirPerfil, dirGlobal }).skills, ['gaming'])
})

/* ── cwd y descripción ── */

test('extrae la ruta de trabajo de terminal.cwd', () => {
  assert.strictEqual(rutaTrabajoDeConfig('agent:\n  max_turns: 60\nterminal:\n  cwd: /Users/robert/vault\n'), '/Users/robert/vault')
})

test('acepta rutas con espacios sin comillas', () => {
  assert.strictEqual(rutaTrabajoDeConfig('terminal:\n  cwd: /Users/robert/Mobile Documents/hermes-vault\n'), '/Users/robert/Mobile Documents/hermes-vault')
})

test('devuelve cadena vacía si no hay terminal.cwd', () => {
  assert.strictEqual(rutaTrabajoDeConfig('agent:\n  max_turns: 60\n'), '')
})

test('no confunde un cwd anidado en otro bloque', () => {
  assert.strictEqual(rutaTrabajoDeConfig('sandbox:\n  cwd: /malo\nterminal:\n  cwd: /bueno\n'), '/bueno')
})

test('lee la descripción multilínea de profile.yaml', () => {
  const { dirPerfil, dirGlobal } = escenario({ soulPerfil: '#', profileYaml: "description: 'Coach personal de estrategia:\n  no wiki.'\nui_meta:\n  x: y\n" })
  const ctx = contextoPerfilDesde({ dirPerfil, dirGlobal })
  assert.match(ctx.descripcion, /Coach personal/)
  assert.ok(!ctx.descripcion.includes('ui_meta'))
})

test('descripcionDeProfileYaml tolera un yaml sin description', () => {
  assert.strictEqual(descripcionDeProfileYaml('ui_meta:\n  title: X\n'), '')
})

test('no cuenta directorios ocultos como skills', () => {
  const { dirPerfil, dirGlobal } = escenario({ soulPerfil: '#', skillsPerfil: ['gaming', '.archive', '.hub'] })
  assert.deepStrictEqual(contextoPerfilDesde({ dirPerfil, dirGlobal }).skills, ['gaming'])
})
