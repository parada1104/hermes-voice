/**
 * Contexto REAL del agente.
 *
 * Ojo con la confusión que arrastraba el daemon: el contexto no es el historial
 * de conversación. Es lo que se le inyecta al agente antes de hablar — su
 * SOUL.md (system prompt), sus skills y su ruta de trabajo. Por eso una sesión
 * sin `agentSessionId` sí tiene contexto, aunque no tenga historial.
 *
 * En Hermes el system prompt vive en SOUL.md (perfil, con fallback al global),
 * no en un AGENTS.md.
 */

const fs = require('fs')
const path = require('path')

function leerSiExiste(file) {
  try { return fs.readFileSync(file, 'utf8') } catch (_) { return null }
}

// Los directorios ocultos del store de skills (.archive, .hub, .curator_backups)
// no son skills: contarlos infla el contexto que se le reporta a JARVIS.
function listarDirectorios(dir) {
  try { return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name) } catch (_) { return [] }
}

// `terminal.cwd` del config del perfil. Acotado al bloque `terminal:` para no
// tomar un `cwd:` de otro bloque (sandbox, hooks…).
function rutaTrabajoDeConfig(configText) {
  let dentro = false
  for (const line of String(configText || '').split('\n')) {
    if (/^terminal:\s*$/.test(line)) { dentro = true; continue }
    if (!dentro) continue
    if (/^\S/.test(line)) break
    const m = line.match(/^\s{2}cwd:\s*(.+?)\s*$/)
    if (m) return m[1].replace(/^["']|["']$/g, '')
  }
  return ''
}

// `description:` de profile.yaml, incluidas las continuaciones indentadas del
// escalar multilínea de YAML.
function descripcionDeProfileYaml(yamlText) {
  const lineas = String(yamlText || '').split('\n')
  const inicio = lineas.findIndex(l => /^description:\s*/.test(l))
  if (inicio < 0) return ''
  const partes = [lineas[inicio].replace(/^description:\s*/, '')]
  for (const line of lineas.slice(inicio + 1)) {
    if (!/^\s+\S/.test(line)) break
    partes.push(line.trim())
  }
  return partes.join(' ').replace(/^["']|["']$/g, '').trim()
}

function contextoPerfilDesde({ dirPerfil, dirGlobal, configText = '' }) {
  const soulPerfil = path.join(dirPerfil, 'SOUL.md')
  const soulGlobal = path.join(dirGlobal, 'SOUL.md')

  let soul = leerSiExiste(soulPerfil)
  let soulScope = soul !== null ? 'perfil' : ''
  let soulPath = soul !== null ? soulPerfil : ''
  if (soul === null) {
    soul = leerSiExiste(soulGlobal)
    if (soul !== null) { soulScope = 'global'; soulPath = soulGlobal }
  }

  const skills = [...new Set([
    ...listarDirectorios(path.join(dirPerfil, 'skills')),
    ...listarDirectorios(path.join(dirGlobal, 'skills')),
  ])].sort()

  return {
    loaded: soul !== null,
    soul: soul || '',
    soulScope,
    soulPath,
    // Ruta donde el perfil escribe por defecto: la que el agente "ve" al arrancar.
    skills,
    cwd: rutaTrabajoDeConfig(configText),
    descripcion: descripcionDeProfileYaml(leerSiExiste(path.join(dirPerfil, 'profile.yaml')) || ''),
  }
}

// Escribe el SOUL.md editado. Siempre en el fichero del perfil: editar el global
// desde una sesión afectaría a todos los perfiles.
function guardarSoulPerfil({ dirPerfil, contenido }) {
  const destino = path.join(dirPerfil, 'SOUL.md')
  fs.mkdirSync(dirPerfil, { recursive: true })
  const previo = leerSiExiste(destino)
  if (previo !== null) fs.writeFileSync(destino + '.bak', previo)
  fs.writeFileSync(destino, String(contenido ?? ''))
  return destino
}

module.exports = { contextoPerfilDesde, rutaTrabajoDeConfig, descripcionDeProfileYaml, guardarSoulPerfil }
