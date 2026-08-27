/**
 * Identidad de una sesión: id estable vs título editable.
 *
 * Antes el id hacía de las dos cosas, así que el nombre de la conversación era
 * también su clave: renombrarla habría significado perder el hilo, los jobs y
 * el fichero de sesiones. El id se deriva del título la primera vez y ya no
 * cambia; el título se edita libremente.
 */

const MAX_ID = 60

function normalizar(texto) {
  return String(texto || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // acentos fuera
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function idDesdeTitulo(titulo, sufijo) {
  const suf = sufijo || Math.random().toString(36).slice(2, 8)
  const base = normalizar(titulo)
  if (!base) return `sesion-${suf}`
  const recortada = base.slice(0, MAX_ID - suf.length - 1).replace(/-+$/, '')
  return `${recortada}-${suf}`
}

function tituloVisible(sesion) {
  if (!sesion) return ''
  return (sesion.titulo && String(sesion.titulo).trim()) || sesion.id || ''
}

module.exports = { idDesdeTitulo, tituloVisible, normalizar, MAX_ID }
