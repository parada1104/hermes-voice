/**
 * El perfil "default" y las capacidades declaradas por perfil.
 *
 * Hermes tiene un perfil raíz (`~/.hermes`, el que corre cuando NO se pasa
 * `--profile`) que no vive bajo `profiles/`. Es justo el que tiene el MCP de
 * Trello de Aurora, y no aparecía en el selector: no había forma de delegarle
 * nada desde la app.
 *
 * Y como la capa conversacional no sabía qué herramientas tiene cada perfil,
 * aceptaba delegar un pedido de Trello al coach de Pokémon, que no lo tiene.
 */

const PERFIL_DEFAULT = 'default'

// `voice` es esta misma capa conversacional, no un agente: su SOUL dice "no
// tienes herramientas propias… eres la voz, no las manos". Delegarle es doble
// delegación y devuelve la misma respuesta con otro nombre. No se borra de
// Hermes (es config del usuario); simplemente la app no lo ofrece.
const PERFILES_OCULTOS = ['voice']

function esPerfilDelegable(perfil) { return !!perfil && !PERFILES_OCULTOS.includes(perfil) }

function perfilesDelegables(enDisco) {
  const utiles = (enDisco || []).filter(esPerfilDelegable)
  return utiles.includes(PERFIL_DEFAULT) ? utiles : [PERFIL_DEFAULT, ...utiles]
}

function esPerfilDefault(perfil) { return perfil === PERFIL_DEFAULT }

// Nombres de los servidores MCP del perfil. Son la capacidad real del agente
// más allá de sus skills: sin trello aquí, no hay tablero que consultar.
function serviciosMcp(configText) {
  const texto = String(configText || '')
  const nombres = []
  let dentro = false
  for (const line of texto.split('\n')) {
    if (/^mcp_servers:\s*$/.test(line)) { dentro = true; continue }
    if (!dentro) continue
    if (/^\S/.test(line)) break                      // otra clave raíz cierra el bloque
    const m = line.match(/^\s{2}([^:\s]+):\s*$/)     // solo el primer nivel: los args van más adentro
    if (m) nombres.push(m[1])
  }
  return nombres
}

// El perfil es de la SESIÓN, no del mensaje. Se fija una vez —al crearla, o con
// el primer perfil explícito si nació del fallback— y a partir de ahí manda.
// Un perfil entrante distinto no reenruta la conversación: se ignora y se
// registra. Para hablar con otro agente se abre otra sesión.
function decidirPerfilSesion(sesion, perfilEntrante) {
  const actual = sesion?.perfil || ''
  const entrante = String(perfilEntrante || '').trim()
  if (!entrante || entrante === actual) return { perfil: actual, fijar: false, ignorado: false }
  if (sesion?.perfilFijado) return { perfil: actual, fijar: false, ignorado: true }
  return { perfil: entrante, fijar: true, ignorado: false }
}

// Misma regla para la sesión remota de Hermes: se adjunta una vez y queda
// attachada. Ojo: NO es única — una misma sesión de agente puede estar
// attachada a varias conversaciones, así que aquí no se comprueba nada global.
function decidirAdjuntoAgente(sesion, entranteRaw) {
  const actual = sesion?.agentSessionId || ''
  const entrante = String(entranteRaw || '').trim()
  if (!entrante || entrante === actual) return { agentSessionId: actual, fijar: false, ignorado: false }
  if (actual) return { agentSessionId: actual, fijar: false, ignorado: true }
  return { agentSessionId: entrante, fijar: true, ignorado: false }
}

module.exports = { PERFIL_DEFAULT, PERFILES_OCULTOS, esPerfilDefault, esPerfilDelegable, perfilesDelegables, serviciosMcp, decidirPerfilSesion, decidirAdjuntoAgente }
