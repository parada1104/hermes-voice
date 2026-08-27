/**
 * Hermes Voice — Daemon conector (portable) · multi-sesión
 *
 * Servicio local que conecta la UI (app) con un harness (Hermes voice)
 * mediante:
 *  1. Un PTY que corre el harness con TUI (Hermes voice) — los "tabs" del
 *     proyecto son terminales reales por debajo (modelo Orca).
 *  2. Un THREAD propio por SESIÓN (mensajes), poseído aquí, no en sesiones
 *     de Hermes. Cada sesión = {id, agente, thread, estado}.
 *  3. La capa de voz: STT (oMLX), capa conversacional (Cerebras), TTS (oMLX)
 *     y la decisión "responder vs delegar" en CÓDIGO (no en el prompt).
 *  4. Una API local (WebSocket/HTTP) para que la app hable con él.
 *
 * Portable: puede apuntar a otros harness (Claude Code, Pi) con la misma capa.
 *
 * R2 (sesiones): mapa `sesiones` por id, cada una con su thread y agente.
 * R3 (agente): el agente se elige por sesión (`sesion.agente`), no global.
 * Live: `bus` (EventEmitter) emite fases/transcripción para el WS del server.
 */

const { spawn } = require('child_process')
const { EventEmitter } = require('events')
const { promisify } = require('util')
const execFileAsync = promisify(require('child_process').execFile)
const { RegistroProcesos } = require('./procesos')
const { crearClienteOrca } = require('./orca')
const { GestorWorker } = require('./worker')
// Delegaciones en curso, por sesión: permite el barge-in (cortar el proceso
// hijo cuando Robert vuelve a hablar).
const procesosDelegacion = new RegistroProcesos()
function cancelarDelegacion(sesionId) { return procesosDelegacion.cancelar(sesionId) }
const { TIMEOUT_DELEGACION_POR_DEFECTO } = require('./timeouts')
const TIMEOUT_DELEGACION_MS = Number(process.env.HV_TIMEOUT_DELEGACION_MS || TIMEOUT_DELEGACION_POR_DEFECTO)

// Un solo gestor para todo el daemon: la regla es UN worker vivo, el de la
// sesión de voz activa. Con `HV_ORCA=0` se vuelve a la ruta headless.
const clienteOrca = crearClienteOrca()
const gestorWorker = new GestorWorker({ orca: clienteOrca, log: (e, d) => log(e, d), timeoutMs: TIMEOUT_DELEGACION_MS })
const ORCA_ACTIVO = process.env.HV_ORCA !== '0'
async function cerrarWorker() { return gestorWorker.cerrar() }

// Entrar a una sesión de voz es la señal para tener el agente listo: se levanta
// su worker sin esperar a la primera delegación. No bloquea ni lanza.
async function precalentarWorker(sesionId, perfilEntrante = '') {
  if (!ORCA_ACTIVO) return false
  const sesion = getSesion(sesionId)
  aplicarPerfilSesion(sesion, perfilEntrante)
  if (sesion.agente !== 'hermes' || !sesion.perfil) return false
  if (!(await clienteOrca.disponible())) { log('worker.sin-orca', { sesionId, motivo: 'precalentado' }); return false }
  return gestorWorker.precalentar(sesion)
}

/* ── Config ── */
const HERMES_CLI = process.env.HV_HERMES_CLI || 'hermes'
const SESSION_STORE = require('path').join(require('os').homedir(), '.hermes', 'voice', 'sessions.json')
const fsStore = require('fs')
const { contextoPerfilDesde, guardarSoulPerfil } = require('./contexto')
const { parsearSSE, acumularDelta, mensajeDesdeAcumulado, frasesSegurasNuevas, contieneToolCall, preambuloEfectivo } = require('./streaming')
const { crearLogger } = require('./log')
const { ventanaConversacion } = require('./ventana')
const { prometeAccion, anunciaSinEntregar, turnoVacio, limpiarPedido } = require('./promesas')
const { extraerRespuestaHermes } = require('./salida-cli')
const { resultadoVacio, interpretarVeredicto, esCruda, esCopiaLiteral } = require('./veredicto')
const { idDesdeTitulo, tituloVisible } = require('./sesiones')
const { PERFIL_DEFAULT, esPerfilDefault, serviciosMcp, decidirPerfilSesion, decidirAdjuntoAgente, perfilesDelegables } = require('./perfiles')
const log = crearLogger({ activo: process.env.HV_LOG !== '0' })

function perfilHermesConfig(perfil) {
  const fs = require('fs')
  const path = require('path')
  const raiz = path.join(require('os').homedir(), '.hermes')
  const file = esPerfilDefault(perfil) ? path.join(raiz, 'config.yaml') : path.join(raiz, 'profiles', perfil, 'config.yaml')
  try { return fs.readFileSync(file, 'utf8') } catch (e) { return '' }
}
// Devuelve las líneas de un bloque de nivel raíz del YAML (`model:`, `providers:`).
// Se corta en la siguiente clave raíz, así una clave homónima anidada en otro
// bloque (p. ej. `auxiliary.vision.provider`) nunca contamina la lectura.
function bloqueRaizYaml(text, clave) {
  const lineas = []
  let dentro = false
  for (const line of String(text || '').split('\n')) {
    if (line === clave + ':' || new RegExp('^' + clave + ':\\s*$').test(line)) { dentro = true; continue }
    if (!dentro) continue
    if (/^\S/.test(line)) break
    lineas.push(line)
  }
  return lineas
}
function resolverModeloDefault(text) {
  const m = bloqueRaizYaml(text, 'model').join('\n').match(/^\s{2}default:\s*([^\s#]+)/m)
  return m ? m[1] : ''
}
function resolverProviderDefault(text) {
  const m = bloqueRaizYaml(text, 'model').join('\n').match(/^\s{2}provider:\s*([^\s#]+)/m)
  return m ? m[1] : ''
}
function providerDefaultHermes(perfil) {
  return resolverProviderDefault(perfilHermesConfig(perfil))
}
function modeloDefaultHermes(perfil) {
  return resolverModeloDefault(perfilHermesConfig(perfil))
}
// El perfil de delegación por defecto es el Hermes raíz (jefe de gabinete): es
// el que tiene herramientas y MCP. NO puede ser `voice`: ese perfil ES esta
// misma capa conversacional ("no tienes herramientas propias… eres la voz, no
// las manos"), así que delegarle era delegarse a uno mismo y devolvía la misma
// respuesta con otro nombre.
const PERFIL_HERMES_DEFAULT = process.env.HV_HERMES_PROFILE || PERFIL_DEFAULT
const MODELO_HERMES_DEFAULT = modeloDefaultHermes(PERFIL_HERMES_DEFAULT)

const OMLX_BASE = 'http://127.0.0.1:8000'
const OMLX_STT_MODEL = process.env.HV_STT_MODEL || 'whisper-large-v3-turbo'
const OMLX_TTS_MODEL = process.env.HV_TTS_MODEL || 'mlx-community--Qwen3-TTS-12Hz-1.7B-Base-8bit'
const { resolverCapa } = require('./capa')
// El proveedor, el modelo y la key de la capa son configurables: sin eso no se
// puede medir si los fallos de tool call son del modelo o del diseño.
const CAPA = resolverCapa()
const CEREBRAS_URL = CAPA.url
const CEREBRAS_KEY = CAPA.key
const CEREBRAS_MODEL = CAPA.modelo
const CAPA_SIN_THINKING = CAPA.sinThinking
// La capa conversacional es una capa APARTE del agente delegado: su modelo no
// tiene nada que ver con el que se elige en el selector de la sesión. Mantener
// la distinción explícita evita que JARVIS confunda su propio modelo con el del
// agente al que delega.
const CAPA_CONVERSACIONAL = {
  rol: 'capa conversacional (voz)',
  provider: CAPA.provider,
  modelo: CEREBRAS_MODEL,
}

// Voz de referencia (clone) — Jarvis/robert. oMLX/Qwen TTS usa un WAV de
// referencia; sin él, `voice:'jarvis'` genera timbre DISTINTO por llamada.
const TTS_VERSE_REF = process.env.HV_TTS_REF || require('os').homedir() + '/.hermes/voice/refs/jarvis.wav'
let ttsRefBase64 = null
let ttsRefText = ''
try {
  const fs = require('fs')
  ttsRefBase64 = fs.readFileSync(TTS_VERSE_REF).toString('base64')
  ttsRefText = fs.readFileSync(TTS_VERSE_REF.replace(/\.wav$/i, '.txt'), 'utf8').trim()
} catch (e) { ttsRefBase64 = null; ttsRefText = '' }

// El nombre de la herramienta se define UNA vez y el prompt lo interpola. Antes
// el prompt pedía `delegate_to_agent` y la registrada era `delegar_a_orca`: el
// modelo no la encontraba y escribía el call como texto, que terminaba hablado.
const TOOL_DELEGAR = 'delegar_a_orca'

const VOICE_PROMPT = `Eres la interfaz de voz de Robert (JARVIS). Respuestas de 1-3 oraciones, en español. Trata a Robert de USTED y llámalo "señor" SIEMPRE: nunca lo tutees. Sin markdown.
REGLAS DE DELEGACIÓN (crítico):
- RESPONDE TÚ MISMO (sin delegar) todo lo conversacional y todo lo que puedas resolver con tu contexto actual, incluido el CONTEXTO HEREDADO de una sesión de agente.
- Si el contexto heredado contiene la respuesta suficiente, úsalo y no delegues.
- ACUMULA cuando Robert está dictando o enumerando datos: confírmale que los TIENES ANOTADOS y quedate esperando. No delegues dato por dato. Cuando él diga que terminó (o pida el resultado), delega TODO el lote junto en un solo pedido.
- NUNCA anuncies una acción que no estás ejecutando en este mismo turno. Si no delegas, no digas "voy a registrar", "procedo a", "lo añado ahora mismo" ni "inmediatamente": di que lo tienes anotado y que lo pasarás al agente cuando termine. Si dices que vas a hacer algo, delega en este turno.
- DELEGA (herramienta ${TOOL_DELEGAR}) SIEMPRE que la respuesta dependa de algo que no esté YA en esta conversación. Ante la duda, DELEGA: es peor inventar o repreguntar que consultar.
- Nunca respondas "no tengo esa información" ni "¿desea que lo consulte?" cuando puedes consultarlo: consúltalo y ya. Preguntar para confirmar algo que Robert ya pidió es hacerle perder un turno.
- Si Robert dice "consultá", "revisá", "preguntale al agente" o similar SIN decir el tema, el tema es LO ÚLTIMO que se estuvo hablando: resuélvelo del contexto y delega. No repreguntes.
- DELEGA cuando hace falta información o acción EXTERNA que no esté en el contexto. LEER: revisar tableros/proyectos, leer archivos, consultar sistemas, operar pantalla, buscar datos actuales. ESCRIBIR: registrar, guardar, anotar en el vault, actualizar notas o inventarios, crear o modificar archivos, generar contenido. Persistir algo SIEMPRE es delegar: tú no escribes nada, solo el agente puede.
- Si Robert dice que terminó de dictar, o pide que le pases/registres/confirmes lo acumulado, DELEGA en ese turno sin excepción, con todo el lote en un único pedido. Quedarte esperando ahí es un error.
- Si decides delegar, devuelve también un breve preámbulo conversacional en el campo de contenido junto a la tool call. Debe responder primero a lo que Robert acaba de decir, aprovechar el contexto heredado y explicar naturalmente qué vas a consultar. No uses siempre la misma frase.
- NUNCA delegues una pregunta de identidad o presentación. Si te preguntan "quién eres", responde tú directamente describiendo tu rol de capa conversacional.
Para delegar usa la herramienta ${TOOL_DELEGAR} por su canal de tool call, NUNCA escribiéndola como texto. Pasa el pedido exacto en el campo 'pedido'. El contenido previo debe ser una respuesta natural y contextual; no repitas una fórmula fija.`

/* ── Eventos en vivo (para WS) ── */
const bus = new EventEmitter()
function emitir(tipo, payload) {
  bus.emit(tipo, payload)
  bus.emit('*', { tipo, payload })
}

/* ── Estado: SESIONES (R1 multi-sesión) ── */
const AGENTES_DISPONIBLES = ['hermes', 'pi'] // Orca es infraestructura/workers, no agente conversacional.

function nuevaSesion(id, agente = process.env.HV_AGENTE_SELECCIONADO || 'hermes', perfil = '', agentModel = '', workingDir = '') {
  if (!id) id = `s-${Date.now()}`
  const agenteReal = AGENTES_DISPONIBLES.includes(agente) ? agente : 'hermes'
  const perfilReal = agenteReal === 'hermes' ? (perfil || PERFIL_HERMES_DEFAULT) : ''
  const modeloReal = agenteReal === 'hermes' ? (agentModel || modeloDefaultHermes(perfilReal)) : ''
  return {
    id,
    // El título es lo que se muestra y se edita; el id no cambia nunca.
    titulo: '',
    // El perfil se fija al crear la sesión; después es inmutable.
    perfilFijado: agenteReal === 'hermes' && !!perfil,
    agente: agenteReal,
    perfil: perfilReal,
    agentSessionId: '',
    agentProvider: agenteReal === 'hermes' ? resolverProviderSesion(perfilHermesConfig(perfilReal), modeloReal) : '',
    agentModel: modeloReal,
    workingDir: agenteReal === 'pi' ? (workingDir || process.env.HOME || '') : '',
    agentContext: { loaded: false, messages: [], loadedAt: null },
    thread: [],            // {role, text, ts}
    estado: 'idle',        // idle | escuchando | transcribiendo | hablando | daemon-off
    creada: Date.now(),
    ultimoTurno: null,
  }
}

const sesiones = new Map()
function persistirSesiones() {
  try {
    fsStore.mkdirSync(require('path').dirname(SESSION_STORE), { recursive: true })
    fsStore.writeFileSync(SESSION_STORE, JSON.stringify([...sesiones.values()], null, 2))
  } catch (_) {}
}
function cargarSesionesPersistidas() {
  try {
    const rows = JSON.parse(fsStore.readFileSync(SESSION_STORE, 'utf8'))
    if (Array.isArray(rows)) rows.forEach(row => { if (row && row.id) sesiones.set(row.id, { ...nuevaSesion(row.id, row.agente, row.perfil, row.agentModel, row.workingDir), ...row }) })
  } catch (_) {}
  if (!sesiones.has('default')) sesiones.set('default', nuevaSesion('default'))
}
cargarSesionesPersistidas()

function getSesion(id) {
  if (!id) id = 'default'
  if (!sesiones.has(id)) { sesiones.set(id, nuevaSesion(id)); persistirSesiones() }
  return sesiones.get(id)
} 
function guardarSesion(sesion) { persistirSesiones(); return sesion }

function crearSesion(id, agente, perfil = '', agentSessionId = '', agentModel = '', workingDir = '', titulo = '') {
  const s = nuevaSesion(id || idDesdeTitulo(titulo), agente, perfil, agentModel, workingDir)
  s.titulo = String(titulo || '').trim()
  if (perfil) s.perfilFijado = true
  s.agentSessionId = agentSessionId || ''
  if (agentModel) {
    s.agentModel = agentModel
    s.agentProvider = s.perfil ? resolverProviderSesion(perfilHermesConfig(s.perfil), agentModel) : ''
  }
  sesiones.set(s.id, s)
  persistirSesiones()
  return s
}

function setEstado(sesion, estado) {
  sesion.estado = estado
  emitir('sesion.estado', { sesionId: sesion.id, estado })
}

function listaSesiones() {
  return [...sesiones.values()].map(s => ({
    id: s.id, titulo: tituloVisible(s), agente: s.agente, perfil: s.perfil, perfilFijado: !!s.perfilFijado, agentSessionId: s.agentSessionId, agentProvider: s.agentProvider, agentModel: s.agentModel, workingDir: s.workingDir, agentContext: resumenContextoAgente(s), estado: s.estado,
    mensajes: s.thread.length, creada: s.creada,
  }))
}

function fijarModeloDelegacion(sessionId, model) {
  const sesion = getSesion(sessionId)
  // Acepta `provider/modelo`: sin el provider no se puede elegir entre dos
  // providers que declaran el mismo nombre.
  const { modelo, provider } = sesion.perfil
    ? interpretarSeleccion(perfilHermesConfig(sesion.perfil), model)
    : { modelo: String(model || '').trim(), provider: '' }
  sesion.agentModel = modelo
  sesion.agentProvider = provider
  log('sesion.modelo', { sesionId: sesion.id, modelo, provider })
  persistirSesiones()
  return sesion
}

// Extracto del SOUL.md real: quién es el agente al que se delega. Acotado para
// no inflar el prompt de la capa conversacional.
function identidadAgente(sesion) {
  const soul = sesion.agentContext?.perfil?.soul || ''
  if (!soul) return ''
  return `\nIDENTIDAD REAL DEL AGENTE DELEGADO (extracto de su SOUL.md; es su system prompt, no tuyo):\n${soul.slice(0, 1500)}\nFIN DEL EXTRACTO\n`
}

function contextoHeredadoTexto(sesion) {
  const msgs = sesion.agentContext?.messages || []
  if (!msgs.length) return ''
  const contenido = msgs.slice(-12).map(m => `${m.role === 'user' ? 'Robert' : 'Agente'}: ${m.text}`).join('\\n')
  return `\\nCONTEXTO HEREDADO DE LA SESIÓN DEL AGENTE (solo úsalo como contexto; no lo presentes como memoria propia):\\n${contenido.slice(-9000)}\\nFIN DEL CONTEXTO HEREDADO\\n`
}

// Directorios reales del perfil (SOUL.md, skills). El contexto del agente sale
// de aquí, no del historial: por eso una sesión sin `agentSessionId` sí lo tiene.
function dirsPerfilHermes(perfil) {
  const os = require('os'); const path = require('path')
  const raiz = path.join(os.homedir(), '.hermes')
  // Para el perfil raíz, "perfil" y "global" son el mismo directorio.
  return { dirPerfil: esPerfilDefault(perfil) ? raiz : path.join(raiz, 'profiles', perfil), dirGlobal: raiz }
}

function contextoPerfilHermes(perfil) {
  if (!perfil) return { loaded: false, soul: '', soulScope: '', soulPath: '', skills: [], cwd: '', descripcion: '' }
  const { dirPerfil, dirGlobal } = dirsPerfilHermes(perfil)
  return contextoPerfilDesde({ dirPerfil, dirGlobal, configText: perfilHermesConfig(perfil) })
}

function guardarContextoPerfil(perfil, contenido) {
  if (!perfil) throw new Error('Falta perfil Hermes')
  const { dirPerfil } = dirsPerfilHermes(perfil)
  const destino = guardarSoulPerfil({ dirPerfil, contenido })
  // Invalidar el contexto cacheado de las sesiones de ese perfil.
  for (const s of sesiones.values()) if (s.perfil === perfil) s.agentContext = { ...(s.agentContext || {}), perfilCargadoEn: null }
  persistirSesiones()
  return destino
}

async function cargarContextoAgente(sesion) {
  const perfil = contextoPerfilHermes(sesion.perfil)
  const previo = sesion.agentContext || {}
  // El historial es opcional y caro (export del CLI): solo si hay sesión remota
  // y aún no lo trajimos.
  let messages = previo.messages || []
  let historialCargado = !!previo.historialCargado
  let error = previo.error
  if (sesion.agentSessionId && sesion.perfil && !historialCargado) {
    try {
      messages = (await historialSesionHermes(sesion.perfil, sesion.agentSessionId)).slice(-24)
      historialCargado = true
      error = undefined
    } catch (e) { messages = []; historialCargado = false; error = e.message }
  }
  sesion.agentContext = {
    loaded: perfil.loaded,
    perfil,
    messages,
    historialCargado,
    loadedAt: Date.now(),
    ...(error ? { error } : {}),
  }
  persistirSesiones()
  return sesion.agentContext
}

function resumenContextoAgente(sesion) {
  const ctx = sesion.agentContext || {}
  const perfil = ctx.perfil || {}
  return {
    loaded: !!ctx.loaded,
    messages: (ctx.messages || []).length,
    historialCargado: !!ctx.historialCargado,
    soulScope: perfil.soulScope || '',
    soulBytes: (perfil.soul || '').length,
    skills: (perfil.skills || []).length,
    cwd: perfil.cwd || '',
    loadedAt: ctx.loadedAt || null,
  }
}

async function listarModelosHermes(perfil) {
  if (!perfil) throw new Error('Falta perfil Hermes')
  const text = perfilHermesConfig(perfil)
  if (!text) throw new Error('Perfil Hermes no encontrado: ' + perfil)
  return catalogoModelos(text)
}

function renombrarSesion(sessionId, titulo) {
  const sesion = getSesion(sessionId)
  sesion.titulo = String(titulo || '').trim()
  log('sesion.titulo', { sesionId: sesion.id, titulo: sesion.titulo })
  persistirSesiones()
  return sesion
}

function borrarSesion(id) {
  if (!id) return false
  const ok = sesiones.delete(id)
  persistirSesiones()
  // si era la sesión que el thread default referencia, limpiar su thread
  if (threadDefault().id === id) threadDefault().thread = []
  return ok
}

// Backwards compat: el módulo exportaba `thread` como array global.
function threadDefault() { return getSesion('default').thread }

/* ── Capa de voz (STT / Cerebras / TTS) ── */

async function sttOmlx(audioBytes, mime) {
  // oMLX/Whisper NO acepta webm/opus (500 "ffprobe failed"). Transcodificar a wav con ffmpeg.
  let bytes = audioBytes
  if (mime && /webm|mp4|m4a|opus/i.test(mime)) {
    try {
      const { execFile } = require('child_process')
      const { promisify } = require('util')
      const execFileP = promisify(execFile)
      const os = require('os'); const fs = require('fs'); const path = require('path')
      const tmp = path.join(os.tmpdir(), `hv_${Date.now()}_in` + (mime.includes('mp4') ? '.m4a' : '.webm'))
      const tmpWav = path.join(os.tmpdir(), `hv_${Date.now()}.wav`)
      fs.writeFileSync(tmp, audioBytes)
      await execFileP('ffmpeg', ['-y', '-i', tmp, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', tmpWav], { timeout: 20000 })
      bytes = fs.readFileSync(tmpWav)
      fs.unlinkSync(tmp); fs.unlinkSync(tmpWav)
    } catch (e) { throw new Error('STT transcod ' + e.message) }
  }
  const fd = new FormData()
  fd.append('file', new Blob([bytes], { type: 'audio/wav' }), 'voice.wav')
  fd.append('model', OMLX_STT_MODEL)
  fd.append('language', 'es')
  const r = await fetch(`${OMLX_BASE}/v1/audio/transcriptions`, { method: 'POST', body: fd })
  if (!r.ok) throw new Error('STT ' + r.status)
  return (await r.json()).text || ''
}

async function ttsOmlx(text) {
  const body = {
    model: OMLX_TTS_MODEL, input: text, language: 'es', response_format: 'wav', stream: true,
    temperature: 0.15, top_k: 20, top_p: 0.7, repetition_penalty: 1.05,
  }
  if (ttsRefBase64 && ttsRefText) {
    body.ref_audio = ttsRefBase64
    body.ref_text = ttsRefText
  } else body.voice = 'jarvis'
  const r = await fetch(`${OMLX_BASE}/v1/audio/speech`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) throw new Error('TTS ' + r.status)
  const buf = await r.arrayBuffer()
  return Buffer.from(buf)
}

/** TTS en fragmentos (real-time): divide el texto en oraciones y llama ttsOmlx
 *  frase por frase, emitiendo cada chunk de audio por `onFrase(frase, wav)` en
 *  cuanto está lista, para que la app hable mientras se sigue sintetizando. */
async function ttsOmlxStreaming(text, onFrase) {
  // Divide respetando signos finales de oración; mantiene párrafos cortos.
  const frases = text
    .split(/(?<=[.!?¡¿])\s+|\n+/)
    .map(s => s.trim())
    .filter(Boolean)
  for (const frase of frases) {
    const wav = await ttsOmlx(frase)
    onFrase(frase, wav)
  }
}

/**
 * Cuerpo de la petición al proveedor de la capa.
 *
 * `tools` se OMITE cuando está vacío, y eso no es cosmética: medido contra
 * nan-builders, `tools: []` devuelve 400 ("Invalid request") mientras que
 * omitir el campo devuelve 200. Como todas las llamadas mandaban
 * `tools: tools || []`, cualquier llamada sin herramientas fallaba — y la
 * síntesis del veredicto es exactamente eso. El 400 caía en un catch que
 * entregaba el crudo del agente, así que la capa parecía copiar al agente
 * cuando en realidad nunca llegaba a sintetizar.
 */
function cuerpoChat({ model, messages, tools, maxTokens, stream, sinThinking }) {
  const cuerpo = { model, messages, max_tokens: maxTokens }
  if (Array.isArray(tools) && tools.length) cuerpo.tools = tools
  if (stream) cuerpo.stream = true
  // `qwen3.8-flash` razona SIEMPRE si no se le manda esto, y en una capa de VOZ
  // el razonamiento es latencia pura antes de la primera palabra. Medido: este
  // es el único campo que lo apaga — `reasoning_effort` (none/minimal/low),
  // `reasoning:{enabled:false}`, `thinking:{type:disabled}` y `/no_think` en el
  // prompt no hacen nada. Viaja solo si el proveedor lo acepta (ver capa.js).
  if (sinThinking) cuerpo.chat_template_kwargs = { enable_thinking: false }
  return cuerpo
}

// Igual que llmCerebras pero con stream:true. `onFrase` se dispara con cada
// frase cerrada, así el TTS arranca mientras el modelo sigue escribiendo. Las
// frases emitidas son el preámbulo real cuando después llega un tool call, así
// que se emiten en ambas ramas; quien llama recibe en `hablado` lo ya dicho
// para no repetirlo.
async function llmCerebrasStream(messages, tools, onFrase) {
  const r = await fetch(CEREBRAS_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CEREBRAS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoChat({ model: CEREBRAS_MODEL, messages, tools, maxTokens: 300, stream: true, sinThinking: CAPA_SIN_THINKING })),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) throw new Error('Cerebras ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 300))

  let acc = {}, pendiente = '', consumido = 0, cortado = false
  for await (const chunk of r.body) {
    const { eventos, resto } = parsearSSE(Buffer.from(chunk).toString('utf8'), pendiente)
    pendiente = resto
    for (const ev of eventos) {
      const delta = ev.choices?.[0]?.delta
      if (delta) acc = acumularDelta(acc, delta)
    }
    if (onFrase && acc.content && !cortado) {
      // Amordazado: si el modelo empieza a escribir el tool call como texto, lo
      // que sigue es protocolo, no habla. Sin esto se le lee el JSON a Robert.
      const nuevas = frasesSegurasNuevas(acc.content, consumido, cortado)
      consumido = nuevas.consumido
      if (nuevas.cortado && !cortado) { cortado = true; log('capa.tool-call-en-texto', { frases: nuevas.frases.length }) }
      for (const frase of nuevas.frases) { try { await onFrase(frase) } catch (_) {} }
    }
  }
  return { choices: [{ message: mensajeDesdeAcumulado(acc) }], hablado: (acc.content || '').slice(0, consumido) }
}

async function llmCerebras(messages, tools) {
  const r = await fetch(CEREBRAS_URL, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${CEREBRAS_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cuerpoChat({ model: CEREBRAS_MODEL, messages, tools, maxTokens: 300, sinThinking: CAPA_SIN_THINKING })),
    signal: AbortSignal.timeout(45000),
  })
  if (!r.ok) throw new Error('Cerebras ' + r.status + ': ' + (await r.text().catch(() => '')).slice(0, 300))
  return r.json()
}

/* ── 3. Única tool del asistente: delegar a un agente ── */

const { execFile } = require('child_process')
const execFileP = promisify(execFile)

async function orcaCmd(...args) {
  const { stdout } = await execFileP('orca', args, { timeout: 60000 })
  return stdout.trim()
}

let orcaServeProc = null
async function asegurarOrca(tiempoMaxMs = 25000) {
  const runtimeArriba = (s) => {
    const r = s?.result || s
    if (r.runtimeState === 'running') return true
    if (r.app?.running === true) return true
    if (r.runtime?.running === true) return true
    return false
  }
  try {
    const st = await orcaCmd('status', '--json')
    const s = JSON.parse(st)
    if (runtimeArriba(s)) return true
  } catch (e) { /* sigue a iniciar */ }

  if (!orcaServeProc) {
    orcaServeProc = spawn('orca', ['serve', '--no-pairing', '--json'], {
      detached: true, stdio: 'ignore',
    })
    orcaServeProc.unref()
  }

  const inicio = Date.now()
  while (Date.now() - inicio < tiempoMaxMs) {
    await new Promise(r => setTimeout(r, 500))
    try {
      const st = await orcaCmd('status', '--json')
      const s = JSON.parse(st)
      if (runtimeArriba(s)) return true
    } catch (e) { /* reintenta */ }
  }
  throw new Error('Orca runtime no arrancó a tiempo')
}

let daemonTerminalHandle = null

async function crearTerminalDaemon(titulo = 'hermes-voice-daemon') {
  try {
    const out = await orcaCmd('terminal', 'create', '--title', titulo, '--json')
    const t = JSON.parse(out)
    const r = t.result || t
    const term = (r.terminal && (typeof r.terminal === 'string' ? r.terminal : r.terminal.handle)) ||
        (Array.isArray(r.terminals) && r.terminals[0]?.handle) ||
        (Array.isArray(t.terminals) && t.terminals[0]?.handle)
    daemonTerminalHandle = term && term.startsWith('term_') ? term : null
    if (!daemonTerminalHandle) {
      const list = JSON.parse(await orcaCmd('terminal', 'list', '--json'))
      const lr = list.result || list
      const first = Array.isArray(lr) ? lr[0] : (Array.isArray(lr.terminals) ? lr.terminals[0] : null)
      daemonTerminalHandle = first?.handle || null
    }
  } catch (e) {
    daemonTerminalHandle = null
  }
  return daemonTerminalHandle
}

async function orcaCmdFrom(...args) {
  if (!daemonTerminalHandle) await crearTerminalDaemon()
  const full = daemonTerminalHandle
    ? [...args.slice(0, -1), '--from', daemonTerminalHandle, args[args.length - 1]]
    : args
  return orcaCmd(...full)
}

const ORCA_TOOL = {
  type: 'function',
  function: {
    name: TOOL_DELEGAR,
    description: 'Lanza un agente/worker en Orca con un pedido y devuelve el resultado. Es la unica forma de delegar: crea un orchestration run y una task (worker) que lo resuelve. Usa para ver/operar pantalla, archivos, sistemas, proyectos, o cualquier tarea que no sea conversacional.',
    parameters: {
      type: 'object',
      properties: {
        pedido: { type: 'string', description: 'El trabajo a delegar, en español, autocontenido' },
      },
      required: ['pedido'],
    },
  },
}

function orcaId(resp, tipo) {
  const r = resp?.result || resp
  const node = r?.[tipo] || (Array.isArray(r?.[tipo + 's']) && r[tipo + 's'][0]) || null
  const id = (typeof node === 'string' ? node : node?.id) || (tipo === 'dispatch' && r?.dispatch_id) || null
  return id
}

/* ── Delegación (R3: agente seleccionable por sesión) ── */

async function delegarAgenente(agente, pedido, sesionId, adjunto = null, meta = {}) {
  if (!meta.skipStartEvent) emitir('delegacion.inicio', { sesionId, agente, pedido, ...meta })
  let resultado
  try {
    if (agente === 'hermes') {
      const sesion = getSesion(sesionId)
      // Ruta principal: worker de Orca con el REPL vivo. Evita el arranque en
      // frío por delegación, conserva el hilo del agente y lo deja visible.
      // Un adjunto necesita `chat --image`, que es un one-shot: por ahí sigue
      // el CLI headless.
      const porOrca = ORCA_ACTIVO && sesion.perfil && !adjunto && await clienteOrca.disponible()
      if (porOrca) {
        resultado = await gestorWorker.delegar(sesion, pedido)
        // El worker puede haber abierto una conversación nueva: se adopta para
        // que la sesión de voz la retome en el próximo arranque.
        const detectada = gestorWorker.estado().agentSessionId
        if (detectada && !sesion.agentSessionId) { sesion.agentSessionId = detectada; persistirSesiones() }
      } else if (sesion.perfil) {
        if (ORCA_ACTIVO && !adjunto) log('worker.sin-orca', { sesionId, motivo: 'runtime no disponible' })
        resultado = await delegarHermesCli(pedido, sesion.perfil, sesion.agentSessionId, sesion.agentModel, adjunto, sesionId)
      } else {
        resultado = await delegarHermesApi(pedido)
      }
    }
    else if (agente === 'pi') {
      const sesion = getSesion(sesionId)
      resultado = await delegarPi(pedido, sesion.workingDir, adjunto)
    }
    else if (agente === 'orca') resultado = await delegarOrca(pedido)
    else throw new Error('Agente no soportado: ' + agente)
    emitir('delegacion.ok', {
      sesionId, agente, ...meta,
      resultado: typeof resultado === 'string' ? resultado : JSON.stringify(resultado),
    })
    return resultado
  } catch (e) {
    emitir('delegacion.error', { sesionId, agente, ...meta, error: e.message })
    throw e
  }
}

// Cierra el lazo: el resultado de la delegación —salga bien o mal— vuelve a la
// capa conversacional para que sea ELLA quien le hable a Robert. Antes un fallo
// nunca llegaba aquí: el server soltaba una cadena enlatada y la capa se
// quedaba sin saber que la consulta que había anunciado murió.
async function ejecutarDelegacionDiferida(sesionId, agente, pedido, meta = {}, adjunto = null) {
  const sesion = getSesion(sesionId)
  const t0 = Date.now()
  try {
    const resultado = await delegarAgenente(agente, pedido, sesionId, adjunto, { ...meta, skipStartEvent: true })
    const veredicto = await sintetizarRespuesta(sesion, pedido, resultado, agente)
    const texto = veredicto.texto || 'La consulta terminó, señor.'
    // En el hilo queda el TEXTO: es lo que Robert va a releer. La voz es otra
    // salida del mismo resultado, más corta, porque el audio no se escanea.
    const voz = veredicto.voz || texto
    sesion.thread.push({ role: 'assistant', text: texto, ts: Date.now() })
    persistirSesiones()
    // `cumplido:false` = la delegación corrió pero NO resolvió el pedido. Es un
    // desenlace distinto de un fallo, y Robert tiene que poder distinguirlo.
    const estado = veredicto.cumplido === false ? 'incompleta' : 'completed'
    log('delegacion.fin', { sesionId, jobId: meta.jobId, estado, cumplido: veredicto.cumplido, motivo: veredicto.motivo, ms: Date.now() - t0 })
    return { text: texto, voz, delegation: resultado, sesionId, agente, ok: true, estado, cumplido: veredicto.cumplido, motivo: veredicto.motivo }
  } catch (e) {
    // El barge-in se calla: Robert ya está hablando, responderle sería pisarlo.
    if (e.cancelada) { log('delegacion.fin', { sesionId, jobId: meta.jobId, estado: 'cancelled', ms: Date.now() - t0 }); throw e }
    const estado = e.timeout ? 'timed_out' : 'failed'
    const texto = await sintetizarFallo(sesion, pedido, e, agente)
    sesion.thread.push({ role: 'assistant', text: texto, ts: Date.now() })
    persistirSesiones()
    log('delegacion.fin', { sesionId, jobId: meta.jobId, estado, ms: Date.now() - t0, error: e.message })
    return { text: texto, delegation: { error: e.message }, sesionId, agente, ok: false, estado, error: e.message }
  }
}

// Resuelve a qué provider pertenece un modelo recorriendo SOLO el bloque
// `providers:`. Un mapa `models:` termina cuando aparece cualquier clave de
// indentación menor o igual; esa línea debe volver a evaluarse como cabecera de
// provider, si no el modelo queda atribuido al provider anterior (delegación
// enrutada al endpoint equivocado y timeout).
function resolverProviderDeModelo(text, model) {
  if (!model || !text) return ''
  // Si es el modelo default del perfil, respetar su provider explícito.
  if (resolverModeloDefault(text) === model) return resolverProviderDefault(text)

  let provider = ''
  let dentroProviders = false
  let dentroModels = false
  for (const line of text.split('\n')) {
    if (/^providers:\s*$/.test(line)) { dentroProviders = true; provider = ''; dentroModels = false; continue }
    if (!dentroProviders) continue
    if (/^\S/.test(line)) break                                   // otra clave raíz cierra `providers:`

    const cabecera = line.match(/^\s{2}([^:\s]+):\s*$/)
    if (cabecera) { provider = cabecera[1]; dentroModels = false; continue }

    if (/^\s{4}models:\s*$/.test(line)) { dentroModels = true; continue }
    if (/^\s{4}\S/.test(line)) { dentroModels = false; continue } // api_mode, key_env, `models: {}`…

    if (dentroModels) {
      const m = line.match(/^\s{6}([^:\s]+):/)
      if (m && m[1] === model) return provider
    }
  }
  return ''
}

// Provider efectivo para mostrar y para pasar al CLI: el que declara el modelo
// y, si el modelo no está declarado en el perfil, el default (que es el que
// Hermes usará al omitir --provider).
function resolverProviderSesion(text, model) {
  return resolverProviderDeModelo(text, model) || resolverProviderDefault(text)
}

// Argumentos del CLI de Hermes. `--model` se respeta también con `--resume`
// (verificado contra el CLI real), así que el modelo del selector viaja tanto
// en sesiones adjuntas como en delegaciones sueltas.
//
// Con adjunto hay que ir por el subcomando `chat`: el oneshot `-z` no acepta
// `--image`, y pasar `@ruta` suelto NO adjunta nada — Hermes lo parsea como
// nombre de comando y aborta ("invalid choice: '@/tmp/…'"). `-Q` deja en stdout
// solo la respuesta final, sin banner ni cajas de razonamiento.
function construirArgsHermes({ perfil, provider, model, agentSessionId, adjuntoPath, pedido }) {
  // El perfil raíz de Hermes es "no pasar --profile": es un perfil más para la
  // app, pero para el CLI es la ausencia del flag.
  const args = esPerfilDefault(perfil) ? [] : ['--profile', perfil]
  if (model) {
    if (provider) args.push('--provider', provider)
    args.push('--model', model)
  }
  if (agentSessionId) args.push('--resume', agentSessionId, '--no-restore-cwd')
  if (adjuntoPath) args.push('chat', '-Q', '--image', adjuntoPath, '-q', pedido)
  else args.push('-z', pedido)
  return args
}

// Al cambiar de perfil el modelo elegido puede no existir en el nuevo: en ese
// caso se cae a su default en vez de arrastrar un modelo que el perfil no
// declara (y que terminaría en un 401 del provider equivocado).
// Catálogo del AGENTE delegado: cada modelo con el provider que lo declara.
// Un nombre suelto no basta — `gemma4` es un MoE de 26B en nan-builders y no
// tiene nada que ver con el `gemma-4-31b` de cerebras, y hay modelos que dos
// providers declaran a la vez (elegir "el primero" hacía inalcanzable al otro).
// Ojo: esto NO es el modelo de la capa conversacional, que es otra capa.
function catalogoModelos(configText) {
  if (!configText) return []
  const modeloDefault = resolverModeloDefault(configText)
  const providerDefault = resolverProviderDefault(configText)
  const entradas = []
  let provider = '', dentroProviders = false, dentroModels = false
  for (const line of configText.split('\n')) {
    if (/^providers:\s*$/.test(line)) { dentroProviders = true; provider = ''; dentroModels = false; continue }
    if (!dentroProviders) continue
    if (/^\S/.test(line)) break
    const cabecera = line.match(/^\s{2}([^:\s]+):\s*$/)
    if (cabecera) { provider = cabecera[1]; dentroModels = false; continue }
    if (/^\s{4}models:\s*$/.test(line)) { dentroModels = true; continue }
    if (/^\s{4}\S/.test(line)) { dentroModels = false; continue }
    if (!dentroModels) continue
    const m = line.match(/^\s{6}([^:\s]+):/)
    if (!m) continue
    const modelo = m[1]
    entradas.push({
      id: `${provider}/${modelo}`,
      provider,
      modelo,
      esDefault: modelo === modeloDefault && provider === providerDefault,
    })
  }

  // Un provider puede declararse SIN bloque `models:` (solo api_mode/base_url/
  // key_env): es válido y Hermes lo acepta. Si el default del perfil vive ahí,
  // recorrer únicamente `models:` lo hacía desaparecer del selector y dejaba
  // `defaultModel` vacío. El default siempre existe: se antepone.
  if (modeloDefault && providerDefault && !entradas.some(m => m.esDefault)) {
    entradas.unshift({ id: `${providerDefault}/${modeloDefault}`, provider: providerDefault, modelo: modeloDefault, esDefault: true })
  }
  return entradas
}

// Acepta el id cualificado `provider/modelo` y también un nombre suelto (la
// forma vieja). Si el provider pedido no declara ese modelo, se ignora y se
// resuelve por nombre: mejor un provider correcto que uno inventado.
function interpretarSeleccion(configText, seleccion) {
  const valor = String(seleccion || '').trim()
  if (!valor) return { modelo: '', provider: '' }
  const catalogo = catalogoModelos(configText)
  const exacto = catalogo.find(m => m.id === valor)
  if (exacto) return { modelo: exacto.modelo, provider: exacto.provider }
  const modelo = valor.includes('/') && catalogo.some(m => m.modelo === valor.slice(valor.indexOf('/') + 1))
    ? valor.slice(valor.indexOf('/') + 1)
    : valor
  return { modelo, provider: resolverProviderSesion(configText, modelo) }
}

function ajustarModeloAlPerfil(configText, modeloActual) {
  if (!configText) return { modelo: '', provider: '' }
  const provider = modeloActual ? resolverProviderDeModelo(configText, modeloActual) : ''
  if (modeloActual && provider) return { modelo: modeloActual, provider }
  return { modelo: resolverModeloDefault(configText), provider: resolverProviderDefault(configText) }
}

function providerParaModelo(perfil, model) {
  return resolverProviderDeModelo(perfilHermesConfig(perfil), model)
}

async function delegarHermesCli(pedido, perfil, agentSessionId = '', agentModel = '', adjunto = null, sesionId = '') {
  if (!perfil) throw new Error('Falta perfil Hermes para delegar')
  const provider = agentModel ? providerParaModelo(perfil, agentModel) : ''
  const args = construirArgsHermes({ perfil, provider, model: agentModel, agentSessionId, adjuntoPath: adjunto?.path, pedido })
  log('agente.invocacion', { sesionId, perfil, provider: provider || '(default del perfil)', modelo: agentModel || '(default del perfil)', remota: agentSessionId || '(sin adjuntar)', adjunto: adjunto?.path })
  const ejecucion = execFileAsync(HERMES_CLI, args, { timeout: TIMEOUT_DELEGACION_MS, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, HERMES_NON_INTERACTIVE: '1' } })
  if (sesionId) procesosDelegacion.registrar(sesionId, ejecucion.child)
  try {
    const { stdout } = await ejecucion
    return extraerRespuestaHermes(stdout, { onFuga: m => log('agente.salida-sucia', { sesionId, motivo: m }) }) || '(sin respuesta)'
  } catch (e) {
    // `execFile` mata por timeout con el mismo SIGTERM que usamos nosotros, así
    // que la señal no distingue: hay que preguntarle al registro quién lo mató.
    if (procesosDelegacion.fueCancelado(sesionId, ejecucion.child)) {
      throw Object.assign(new Error('Delegación cancelada'), { cancelada: true })
    }
    if (e.killed && e.signal === 'SIGTERM') {
      throw Object.assign(new Error(`La delegación superó el límite de ${Math.round(TIMEOUT_DELEGACION_MS / 1000)}s`), { timeout: true })
    }
    throw new Error('Hermes CLI falló: '+(e.stderr||e.stdout||e.message).trim().slice(-800))
  } finally {
    if (sesionId) procesosDelegacion.liberar(sesionId, ejecucion.child)
    if (adjunto?.path) { try { require('fs').unlinkSync(adjunto.path) } catch (_) {} }
  }
}

// Compat: la ruta con sesión remota adjunta exige perfil + sesión.
async function delegarHermesSesion(pedido, perfil, agentSessionId, agentModel = '', adjunto = null) {
  if (!perfil || !agentSessionId) throw new Error('Attach Hermes incompleto')
  return delegarHermesCli(pedido, perfil, agentSessionId, agentModel, adjunto)
}

async function listarSesionesHermes(perfil) {
  if (!perfil) throw new Error('Falta perfil Hermes')
  const { stdout } = await execFileAsync(HERMES_CLI, ['--profile', perfil, 'sessions', 'list', '--limit', '50'], { timeout: 15000, maxBuffer: 1024 * 1024, env: { ...process.env, HERMES_NON_INTERACTIVE: '1' } })
  return stdout.split('\n').map(line => {
    const m=line.match(/(\d{8}_\d{6}_[a-z0-9]+)/i)
    return m ? { title:line.slice(0,30).trim(), workspace:line.slice(30,50).trim(), lastActive:line.slice(50,66).trim(), id:m[1] } : null
  }).filter(Boolean)
}

async function historialSesionHermes(perfil, agentSessionId) {
  if (!perfil || !agentSessionId) throw new Error('Falta perfil o sesión Hermes')
  const os = require('os'); const path = require('path'); const fs = require('fs')
  const out = path.join(os.tmpdir(), `hv_export_${process.pid}_${Date.now()}.jsonl`)
  try {
    await execFileAsync(HERMES_CLI, ['--profile', perfil, 'sessions', 'export', '--format', 'jsonl', '--session-id', agentSessionId, '--redact', '--yes', out], { timeout: 60000, maxBuffer: 1024 * 1024, env: { ...process.env, HERMES_NON_INTERACTIVE: '1' } })
    const rows = fs.readFileSync(out, 'utf8').split(/\r?\n/).filter(Boolean)
    const session = rows.map(line => { try { return JSON.parse(line) } catch (_) { return null } }).find(x => x && x.id === agentSessionId)
    if (!session) throw new Error('Sesión Hermes no encontrada: ' + agentSessionId)
    return (session.messages || []).filter(m => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim()).map(m => ({ role: m.role, text: m.content }))
  } finally { try { fs.unlinkSync(out) } catch (_) {} }
}

async function delegarHermesApi(pedido, perfil = '') {
  const HERMES_KEY = process.env.API_SERVER_KEY
  if (!HERMES_KEY) throw new Error('Falta API_SERVER_KEY para delegar a Hermes')
  // Delegación async: POST /v1/runs → run_id, luego GET /v1/runs/:id hasta completed (output real)
  const profilePath = perfil ? `/p/${encodeURIComponent(perfil)}` : ''
  const r = await fetch(`http://localhost:8642${profilePath}/v1/runs`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${HERMES_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: pedido }),
    signal: AbortSignal.timeout(30000),
  })
  if (!r.ok) throw new Error('Hermes run-create ' + r.status)
  const { run_id } = await r.json()
  if (!run_id) throw new Error('Hermes /v1/runs sin run_id')
  // poll hasta completed (max ~120s)
  const inicio = Date.now()
  while (Date.now() - inicio < 120000) {
    await new Promise(res => setTimeout(res, 1500))
    const g = await fetch(`http://localhost:8642${profilePath}/v1/runs/${run_id}`, {
      headers: { 'Authorization': `Bearer ${HERMES_KEY}` },
      signal: AbortSignal.timeout(15000),
    })
    if (!g.ok) throw new Error('Hermes run status ' + g.status)
    const st = await g.json()
    if (st.status === 'completed') return st.output || '(sin respuesta)'
    if (st.status === 'failed' || st.status === 'cancelled' || st.status === 'error') {
      throw new Error('Hermes run ' + st.status + ': ' + (st.error || st.last_event || ''))
    }
  }
  throw new Error('Hermes run timeout')
}

async function delegarPi(pedido, workingDir, adjunto = null) {
  const fs = require('fs')
  const cwd = workingDir && fs.existsSync(workingDir) ? workingDir : (process.env.HOME || process.cwd())
  try {
    const args = ['--print', '--mode', 'text']
    if (adjunto?.path) args.push('@' + adjunto.path)
    args.push(pedido)
    try {
      const { stdout } = await execFileAsync('pi', args, { cwd, timeout: 120000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env } })
      return stdout.trim() || '(sin respuesta)'
    } finally { if (adjunto?.path) { try { fs.unlinkSync(adjunto.path) } catch (_) {} } }
  } catch (e) {
    throw new Error('Pi falló: ' + (e.stderr || e.stdout || e.message).trim().slice(-800))
  }
}

async function delegarOrca(pedido) {
  await asegurarOrca()
  if (!daemonTerminalHandle) await crearTerminalDaemon()
  const from = daemonTerminalHandle ? ['--from', daemonTerminalHandle] : []

  const runOut = await orcaCmd('orchestration', 'run-create', '--objective', pedido, ...from, '--json')
  const run = JSON.parse(runOut)
  const runId = orcaId(run, 'run')
  if (!runId) throw new Error('Orca run-create sin run_id: ' + runOut)

  const taskOut = await orcaCmd('orchestration', 'task-create', '--spec', pedido, '--task-title', 'voz-delegacion', '--run', String(runId), ...from, '--json')
  const task = JSON.parse(taskOut)
  const taskId = orcaId(task, 'task')
  if (!taskId) throw new Error('Orca task-create sin task_id: ' + taskOut)

  const wStart = await orcaCmd('orchestration', 'worker-start', '--task', String(taskId), '--run', String(runId), ...from, '--json')
  const worker = JSON.parse(wStart)
  const dispatchId = orcaId(worker, 'dispatch')
  if (!dispatchId) throw new Error('Orca worker-start sin dispatch_id: ' + wStart)

  let resultado = null
  const out = await orcaCmd('orchestration', 'worker-read', '--dispatch', String(dispatchId), ...from, '--json').catch(() => '')
  if (out) { try { resultado = JSON.parse(out) } catch (e) { resultado = out } }

  return { runId, taskId, dispatchId, resultado }
}

/* ── Decisión / loop del turno (por sesión) ── */

// Una conversación es con UN agente: el perfil se fija al crear la sesión y no
// se reenruta a mitad de camino. Solo una sesión nacida del fallback adopta el
// primero que llega. Vive aparte porque hace falta en DOS momentos: al hablar y
// al ENTRAR a la sesión (el precalentado levanta el worker ahí, y si el perfil
// no se aplicó todavía arranca el agente equivocado).
function aplicarPerfilSesion(sesion, perfilEntrante) {
  const decision = decidirPerfilSesion(sesion, perfilEntrante)
  if (decision.ignorado) {
    log('sesion.perfil-ignorado', { sesionId: sesion.id, sesion: sesion.perfil, entrante: String(perfilEntrante).trim() })
  }
  if (!decision.fijar) return false
  // Al FIJAR el perfil por primera vez se adopta SU default. El modelo que
  // traía venía del perfil de respaldo y nunca fue una elección de Robert;
  // arrastrarlo dejaba una sesión de `entrenador` corriendo el modelo de otro
  // perfil solo porque este también lo declaraba.
  const ajuste = ajustarModeloAlPerfil(perfilHermesConfig(decision.perfil), '')
  log('sesion.perfil', { sesionId: sesion.id, de: sesion.perfil, a: decision.perfil, modelo: ajuste.modelo, provider: ajuste.provider })
  sesion.perfil = decision.perfil
  sesion.perfilFijado = true
  sesion.agentModel = ajuste.modelo
  sesion.agentProvider = ajuste.provider
  sesion.agentContext = { loaded: false, messages: [], loadedAt: null }
  persistirSesiones()
  return true
}

async function procesarTurno(textoUsuario, opts = {}) {
  const sesion = getSesion(opts.sessionId)
  aplicarPerfilSesion(sesion, opts.profile)
  // El agente queda attachado a la conversación: el adjunto se fija una vez.
  const adjuntoAgente = decidirAdjuntoAgente(sesion, opts.agentSessionId)
  if (adjuntoAgente.ignorado) log('sesion.adjunto-ignorado', { sesionId: sesion.id, sesion: sesion.agentSessionId, entrante: String(opts.agentSessionId).trim() })
  if (adjuntoAgente.fijar) sesion.agentSessionId = adjuntoAgente.agentSessionId
  // Un agentModel vacío llega en cada turno mientras la UI no terminó de cargar
  // el selector: no debe pisar el modelo ya elegido y persistido.
  const modeloEntrante = typeof opts.agentModel === 'string' ? opts.agentModel.trim() : ''
  if (modeloEntrante && modeloEntrante !== sesion.agentModel) {
    sesion.agentModel = modeloEntrante
    sesion.agentProvider = sesion.perfil ? resolverProviderSesion(perfilHermesConfig(sesion.perfil), modeloEntrante) : ''
  }
  if (adjuntoAgente.fijar || modeloEntrante) persistirSesiones()
  const agente = opts.agente || opts.agent || sesion.agente
  if (opts.agent && AGENTES_DISPONIBLES.includes(opts.agent)) sesion.agente = opts.agent
  if (opts.agente && AGENTES_DISPONIBLES.includes(opts.agente)) sesion.agente = opts.agente
  // modo: 'texto' (texto puro → directo al agente, sin capa, sin TTS) | 'voz' (capa conversacional con STT/TTS/delegación)
  const modo = opts.modo || 'texto'

  setEstado(sesion, 'escuchando')
  await cargarContextoAgente(sesion)
  sesion.thread.push({ role: 'user', text: textoUsuario, ts: Date.now() })

  // ── MODO TEXTO: directo al agente elegido, puro, sin capa conversacional ──
  if (modo !== 'voz') {
    setEstado(sesion, 'transcribiendo')
    let resultado
    try {
      resultado = await delegarAgenente(agente, textoUsuario, sesion.id, opts.adjunto)
    } catch (e) {
      resultado = { error: e.message }
      setEstado(sesion, 'daemon-off')
    }
    const texto = (typeof resultado === 'string' ? resultado : JSON.stringify(resultado)) || 'Listo, señor.'
    sesion.thread.push({ role: 'assistant', text: texto, ts: Date.now() })
    setEstado(sesion, 'idle')
    return { text: texto, delegation: null, sesionId: sesion.id, agente }
  }

  // ── MODO VOZ: JARVIS decide con el contexto si responde o delega ──
  setEstado(sesion, 'transcribiendo')
  // Ventana amplia a propósito: la capa acumula varios turnos y delega el lote
  // cuando Robert confirma. Con los últimos 8 mensajes, un dictado largo se le
  // caía antes de poder delegarlo.
  const hist = ventanaConversacion(sesion.thread)
  const inherited = contextoHeredadoTexto(sesion)
  const providerReal = sesion.agentProvider || (sesion.perfil ? providerDefaultHermes(sesion.perfil) : '') || 'no configurado'
  const modeloReal = sesion.agentModel || (sesion.perfil ? modeloDefaultHermes(sesion.perfil) : '') || 'no configurado'
  const resumenCtx = resumenContextoAgente(sesion)
  // Sin esto la capa delegaba a ciegas: pedirle el tablero de Trello al coach
  // de Pokémon, que no tiene ese MCP, y esperar un resultado que nunca llega.
  const herramientasPerfil = serviciosMcp(perfilHermesConfig(sesion.perfil))
  const avisoCapacidad = `El agente SOLO puede usar esas herramientas. Si Robert pide algo que necesita una que este perfil no tiene (por ejemplo un tablero de Trello desde un perfil sin el MCP de trello), NO delegues: decíselo y sugerí la sesión con el perfil que sí la tiene. Nunca inventes que consultaste una herramienta ausente.\n`
  const contextoEstado = resumenCtx.loaded
    ? `cargado — SOUL.md (${resumenCtx.soulScope}, ${resumenCtx.soulBytes} bytes), ${resumenCtx.skills} skills` + (resumenCtx.historialCargado ? `, historial de ${resumenCtx.messages} mensajes` : ', sin historial remoto')
    : 'no disponible: el perfil no tiene SOUL.md'
  const agentMeta = `\nMETADATOS REALES DE LA SESIÓN ACTIVA — FUENTE DE VERDAD (no los inventes ni los sustituyas):\n- agente: ${sesion.agente || 'hermes'}\n- perfil Hermes: ${sesion.perfil || '—'}\n- provider: ${providerReal}\n- modelo de delegación: ${modeloReal}\n- sesión remota Hermes: ${sesion.agentSessionId || 'no adjunta'}\n- contexto del agente: ${contextoEstado}\n- ruta de trabajo del agente: ${resumenCtx.cwd || '—'}\n- skills disponibles: ${(sesion.agentContext?.perfil?.skills || []).join(', ') || '—'}\n- herramientas externas (MCP) del perfil: ${herramientasPerfil.join(', ') || 'ninguna'}\n${avisoCapacidad}${identidadAgente(sesion)}Si Robert pregunta qué modelo, provider, perfil o agente está usando, responde con estos datos exactos. Si el contexto dice “no disponible” o “pendiente de carga”, no afirmes que recuerdas información de esa sesión. No digas que recuperaste una lista a menos que realmente la tengas en el contexto o una delegación la haya devuelto. Nunca menciones un modelo no presente aquí.`
  const apiMessages = [{ role: 'system', content: VOICE_PROMPT + agentMeta + inherited }, ...hist]
  setEstado(sesion, 'hablando')
  const resp = typeof opts.onFraseTemprana === 'function'
    ? await llmCerebrasStream(apiMessages, [ORCA_TOOL], opts.onFraseTemprana)
    : await llmCerebras(apiMessages, [ORCA_TOOL])
  const yaHablado = resp.hablado || ''
  const msg = resp.choices?.[0]?.message
  let normalizada = normalizarToolCall(msg)

  // Si el modelo escribió el tool call como texto y no se pudo interpretar, el
  // turno se perdía con un "No pude interpretar la respuesta" y el pedido de
  // Robert se evaporaba. Se le da UNA oportunidad de rehacerlo, sin streaming
  // para que el reintento no se sintetice.
  // Dos motivos para rehacer el turno:
  //  · escribió el tool call como texto y no se pudo interpretar;
  //  · PROMETIÓ una acción y no delegó — se midió que ni la orden explícita en
  //    el prompt ni el pedido explícito de Robert bastan para que el modelo use
  //    la herramienta, así que la promesa rota se detecta y se fuerza.
  const promesaRota = !normalizada.toolCall && prometeAccion(normalizada.preambulo)
  if (!normalizada.toolCall && (contieneToolCall(normalizada.preambulo) || promesaRota)) {
    log('capa.reintento', { sesionId: sesion.id, motivo: promesaRota ? 'prometió una acción sin delegar' : 'tool call en texto no interpretable' })
    try {
      const reintento = await llmCerebras([
        ...apiMessages,
        { role: 'assistant', content: String(normalizada.preambulo).slice(0, 1500) },
        { role: 'user', content: promesaRota
          ? `Anunciaste una acción ("${String(normalizada.preambulo).slice(0, 120)}") pero NO llamaste a la herramienta, así que no se ejecutó nada. Rehaz el turno: si de verdad hay que hacerlo, llamá a ${TOOL_DELEGAR} ahora con todo lo acumulado; si no correspondía, respondé sin prometer ninguna acción.`
          : 'Tu respuesta anterior venía en formato de llamada a herramienta y no se pudo ejecutar. Rehazla: si hay que delegar, usá la herramienta por su canal; si no, respondé en texto plano, sin JSON.' },
      ], [ORCA_TOOL])
      const reNorm = normalizarToolCall(reintento.choices?.[0]?.message)
      // Solo se adopta el reintento si mejora: con tool call, o sin la promesa rota.
      // Solo se adopta el reintento si mejora: con tool call, o sin la promesa rota.
      const mejora = reNorm.toolCall || (!contieneToolCall(reNorm.preambulo) && !(promesaRota && prometeAccion(reNorm.preambulo)))
      if (mejora) normalizada = reNorm
    } catch (e) { log('capa.reintento', { sesionId: sesion.id, error: e.message }) }
  }

  // Rescate: si aun después del reintento promete y no llama a la herramienta,
  // no se le deja mentir. Se le pide el pedido en TEXTO PLANO —que sí sabe
  // escribir— y la delegación la arma el daemon. Pasa, por ejemplo, cuando su
  // propio historial afirma que ya hizo el trabajo y concluye que no hay nada
  // que delegar.
  // Se rescata en dos casos: prometió y no llamó, o el turno volvió VACÍO.
  // Lo segundo pasa con modelos de razonamiento que dejan todo en `reasoning`
  // y no emiten ni contenido ni llamada: el turno moría en "No entendí, señor."
  const vacio = turnoVacio(normalizada.preambulo, normalizada.toolCall)
  if (!normalizada.toolCall && (prometeAccion(normalizada.preambulo) || vacio)) {
    if (vacio) log('capa.turno-vacio', { sesionId: sesion.id })
    try {
      const r = await llmCerebras([
        ...apiMessages,
        { role: 'assistant', content: String(normalizada.preambulo).slice(0, 500) },
        { role: 'user', content: vacio
          ? 'Tu turno volvió vacío. Si hay que consultar al agente, escribe SOLO el pedido que hay que enviarle, autocontenido y resolviendo del contexto de qué se está hablando. Si NO hacía falta consultar nada, responde con la palabra NADA y ya.'
          : 'Acabas de decir que lo harías, pero no puedes hacerlo tú: lo hace el agente. Escribe SOLO el pedido que hay que enviarle, autocontenido y con TODOS los datos acumulados en esta conversación. Sin JSON, sin herramientas, sin preámbulo: solo el texto del pedido.' },
      ])
      const pedido = limpiarPedido(r.choices?.[0]?.message?.content || '')
      // "NADA" es la salida explícita para cuando no había que consultar.
      if (pedido && !/^nada\.?$/i.test(pedido)) {
        log('capa.rescate', { sesionId: sesion.id, pedido })
        normalizada = { toolCall: { name: TOOL_DELEGAR, arguments: JSON.stringify({ pedido }) }, preambulo: normalizada.preambulo }
      }
    } catch (e) { log('capa.rescate', { sesionId: sesion.id, error: e.message }) }
  }

  const toolCall = normalizada.toolCall
  log('capa.decision', { sesionId: sesion.id, decision: toolCall ? 'delegar' : 'responder', tool: toolCall?.name })
  if (toolCall?.name === 'delegar_a_orca' || toolCall?.name === 'delegate_to_agent' || toolCall?.name === 'delegar_a_hermes') {
    const pedido = argumentosTool(toolCall).pedido || textoUsuario
    // El preámbulo se habla, así que nunca puede llevar protocolo. Y si el
    // propio se perdió, se prefiere lo que el streaming YA dijo antes que un
    // genérico distinto de lo que Robert acaba de oír.
    const preambulo = preambuloEfectivo(normalizada.preambulo, yaHablado, 'Voy a revisarlo con el agente adecuado, señor.')
    sesion.thread.push({ role: 'assistant', text: preambulo, ts: Date.now() })
    if (typeof opts.onDelegation === 'function') Promise.resolve(opts.onDelegation(preambulo)).catch(() => {})
    if (opts.deferDelegation) {
      setEstado(sesion, 'idle')
      return { text: preambulo, hablado: yaHablado, delegationPending: { pedido, agente: sesion.agente }, sesionId: sesion.id, agente: sesion.agente }
    }
    const resultado = await delegarAgenente(sesion.agente, pedido, sesion.id, null, opts.delegationMeta || {})
    const final = (await sintetizarRespuesta(sesion, pedido, resultado, sesion.agente)).texto || 'Listo, señor.'
    sesion.thread.push({ role: 'assistant', text: final, ts: Date.now() })
    setEstado(sesion, 'idle')
    return { text: final, delegation: resultado, sesionId: sesion.id, agente: sesion.agente }
  }
  const texto = normalizada.preambulo || 'No entendí, señor.'
  const textoSeguro = contieneToolCall(texto) ? 'No pude interpretar la respuesta, señor. ¿Me lo repite?' : texto
  sesion.thread.push({ role: 'assistant', text: textoSeguro, ts: Date.now() })
  setEstado(sesion, 'idle')
  return { text: textoSeguro, sesionId: sesion.id, agente: sesion.agente }
}

function apiMessagesPub(session, utx) {
  const h = session.thread.slice(0, -1).map(m => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }))
  return [{ role: 'user', content: utx }].concat(h.slice(-7))
}

function extraerJsonInicial(texto) {
  const inicio = texto.indexOf('{')
  if (inicio < 0) return null
  let nivel = 0; let cadena = false; let escape = false
  for (let i = inicio; i < texto.length; i++) {
    const ch = texto[i]
    if (cadena) { if (escape) escape = false; else if (ch === '\\') escape = true; else if (ch === '"') cadena = false; continue }
    if (ch === '"') { cadena = true; continue }
    if (ch === '{') nivel++
    if (ch === '}' && --nivel === 0) { try { return { value: JSON.parse(texto.slice(inicio, i + 1)), before: texto.slice(0, inicio).trim(), after: texto.slice(i + 1).trim() } } catch (_) { return null } }
  }
  return null
}

// Rescata `"pedido": "…"` de un bloque que no es JSON válido, respetando las
// comillas escapadas. Sin esto, un argumento mal formado tiraba el turno entero.
function pedidoDeTextoSuelto(texto) {
  const m = String(texto || '').match(/"pedido"\s*:\s*"((?:[^"\\]|\\.)*)"/)
  if (!m) return {}
  try { return { pedido: JSON.parse(`"${m[1]}"`) } } catch (_) { return { pedido: m[1] } }
}

// Se aceptan los alias históricos por si el modelo insiste con uno viejo.
const TOOLS_CONOCIDAS = [TOOL_DELEGAR, 'delegar_a_orca', 'delegate_to_agent', 'delegar_a_hermes']

// Los argumentos viajan a veces como objeto y a veces como string JSON; aguas
// abajo siempre se espera string.
function argumentosComoTexto(args) {
  if (typeof args === 'string') return args || '{}'
  try { return JSON.stringify(desanidarPedido(args ?? {})) } catch (_) { return '{}' }
}

// Extrae {name, arguments} de las formas que el modelo emite cuando serializa
// el tool call como texto en vez de usar el canal nativo.
// Algunos modelos prefijan el nombre con el espacio de nombres de la
// herramienta (gpt-oss-120b emite `{"tool":"functions.delegar_a_orca"}`).
function nombreLimpio(n) { return typeof n === 'string' ? n.replace(/^functions\./, '') : '' }

function funcionDesdeObjeto(obj) {
  if (!obj || typeof obj !== 'object') return null
  const candidatos = [obj.tool_calls?.[0], obj.tool_calls?.[0]?.function, obj.function, obj]
  for (const c of candidatos) {
    // `tool` es otra clave usada para nombrar la herramienta, y `parameters`
    // otra para los argumentos.
    const nombre = nombreLimpio(c?.function?.name || c?.name || c?.tool)
    if (nombre && TOOLS_CONOCIDAS.includes(nombre)) {
      return { name: nombre, arguments: argumentosComoTexto(c.function?.arguments ?? c.arguments ?? c.parameters) }
    }
  }
  return null
}

// Recorta cualquier cola de protocolo del preámbulo. Ese texto se HABLA, así
// que un '<tool' colgando al final se convierte en una frase sintetizada.
function limpiarPreambulo(texto) {
  return String(texto || '').replace(/<\s*\/?\s*(tool|call|function|invoke|antml)[\s\S]*$/i, '').trim()
}

function normalizarToolCall(msg) {
  const estructurada = msg?.tool_calls?.[0]
  if (estructurada) {
    const fn = estructurada.function || estructurada
    return { toolCall: { name: fn.name, arguments: argumentosComoTexto(fn.arguments) }, preambulo: limpiarPreambulo(msg.content) }
  }
  if (typeof msg?.content !== 'string') return { toolCall: null, preambulo: '' }
  const contenido = msg.content

  // Formas `_call:nombre{…}` y `<call:nombre{…}/>`: el modelo alterna entre
  // ellas y ninguna es JSON válido necesariamente — se ha visto
  // `{pedido:{"pedido":"…"}}`, con la clave externa sin comillas. Por eso, si
  // JSON.parse falla, se rescata el pedido por texto en vez de perder el turno.
  const marcado = contenido.match(/<?\s*_?call\s*:\s*([A-Za-z_][\w-]*)\s*\{/)
  if (marcado) {
    if (!TOOLS_CONOCIDAS.includes(marcado[1])) return { toolCall: null, preambulo: limpiarPreambulo(contenido) }
    const desde = contenido.slice(marcado.index)
    const json = extraerJsonInicial(desde)
    const args = json?.value ?? pedidoDeTextoSuelto(desde)
    return {
      toolCall: { name: marcado[1], arguments: argumentosComoTexto(args) },
      preambulo: contenido.slice(0, marcado.index).trim(),
    }
  }

  const json = extraerJsonInicial(contenido)
  const fn = funcionDesdeObjeto(json?.value)
  if (!fn) return { toolCall: null, preambulo: limpiarPreambulo(contenido) }
  return { toolCall: fn, preambulo: json.before }
}

// El modelo a veces anida el argumento: {pedido:{"pedido":"X"}}. Se desenvuelve.
function desanidarPedido(obj) {
  let o = obj
  while (o && typeof o.pedido === 'object' && o.pedido !== null) o = o.pedido
  return o && typeof o.pedido === 'string' ? { ...obj, pedido: o.pedido } : obj
}

function argumentosTool(toolCall) {
  if (!toolCall?.arguments) return {}
  if (typeof toolCall.arguments === 'object') return toolCall.arguments
  try { return JSON.parse(toolCall.arguments) } catch (_) { return {} }
}

// Síntesis de la respuesta tras delegar. NO pasamos herramientas al modelo en esta
// llamada y NO le mostramos la tool-call cruda, para que gemma-4-31b no la repita
// (bug: emitía `_call:delegate_to_agent{...}` como texto). Le damos el output real
// del agente y le pedimos un resumen breve de voz.
// El fallo también se cuenta con voz propia: qué se pidió, qué pasó y qué puede
// hacer Robert. Nunca inventando el resultado que no llegó.
async function sintetizarFallo(session, pedido, error, agente) {
  const motivo = error?.timeout
    ? `la consulta superó el tiempo límite y el agente no devolvió nada`
    : `la consulta falló: ${String(error?.message || '').slice(0, 300)}`
  const m = [
    { role: 'system', content: `Eres la interfaz de voz de Robert (JARVIS). Habías anunciado que ibas a consultar al agente ${agente} y la consulta NO se completó. Explícaselo en 1-2 oraciones, en español, al "señor", sin markdown y sin tecnicismos innecesarios. NO inventes el resultado que no llegó. Si es un tiempo límite, sugiere reintentar o acotar el pedido.` },
    { role: 'user', content: `Pedido: ${String(pedido).slice(0, 500)}\nMotivo: ${motivo}` },
  ]
  try {
    const resp = await llmCerebras(m)
    const out = (resp.choices?.[0]?.message?.content || '').trim()
    if (out) return out
  } catch (_) {}
  return error?.timeout
    ? 'Señor, la consulta al agente superó el tiempo límite y no devolvió nada. ¿Reintento?'
    : `Señor, la consulta al agente no pudo completarse: ${String(error?.message || 'error desconocido').slice(0, 200)}`
}

// La capa NO es un altavoz del agente: confirma que lo que volvió resuelve lo
// que Robert pidió y lo dice si no. Devuelve {texto, cumplido} para que el job
// registre si la tarea quedó realmente cerrada.
async function sintetizarRespuesta(session, pedido, resultadoAgente, agente) {
  // Un resultado vacío no merece una llamada al modelo: no hay nada que juzgar.
  if (resultadoVacio(resultadoAgente)) {
    const aviso = `Señor, delegué la consulta al agente ${agente} pero volvió sin resultado. ¿Reintento?`
    return { voz: aviso, texto: aviso, cumplido: false }
  }

  let contenido = ''
  try { contenido = typeof resultadoAgente === 'string' ? resultadoAgente : JSON.stringify(resultadoAgente) } catch (e) { contenido = String(resultadoAgente) }

  const m = [
    { role: 'system', content: `Eres la interfaz de voz de Robert (JARVIS). Delegaste un trabajo al agente ${agente} y ya volvió. Tu tarea ahora es DOS cosas: (1) juzgar si el resultado realmente resuelve lo que Robert pidió, y (2) contárselo, en español, al "señor", sin mencionar herramientas ni tool calls.
Produce DOS salidas del mismo resultado, porque los canales no aguantan lo mismo:
- "voz": lo que se dice en voz alta. 2 o 3 oraciones, sin markdown ni listas. El audio es lineal y no se puede escanear: da lo esencial y, si hay más, avisa que lo dejas en pantalla.
- "texto": lo que se muestra en el chat. Aquí va el detalle: enumera, usa saltos de línea, da nombres, niveles y cifras. Puede ser mucho más largo que la voz.
JAMÁS copies el resultado del agente tal cual, ni entero ni recortado, ni en "voz" ni en "texto". Tu trabajo es SINTETIZARLO con el contexto de la conversación: quédate con lo que Robert pidió, ordénalo y descarta el ruido. Si copias, no has hecho nada.
NUNCA describas la respuesta en lugar de darla: prohibido "he detallado", "aquí tiene la información" o "le preparé el listado" sin los datos al lado.
Si el resultado NO resuelve el pedido —está vacío, se fue por las ramas, dice que no pudo, o responde otra cosa— NO lo disfraces: dilo y ofrece el siguiente paso.
Responde SOLO con este JSON, sin texto alrededor:
{"cumplido": true|false, "voz": "2-3 oraciones para decir en voz alta", "texto": "el detalle completo para la pantalla", "motivo": "por qué no se cumplió, vacío si se cumplió"}${contextoHeredadoTexto(session)}` },
    { role: 'user', content: `Pedido original de Robert:\n${String(pedido).slice(0, 800)}\n\nResultado del agente:\n${contenido.slice(0, 3000)}` },
  ]

  let salida = ''
  try {
    const resp = await llmCerebras(m)
    salida = resp.choices?.[0]?.message?.content || ''
  } catch (e) {
    // Sin veredicto no se afirma cumplimiento: se entrega el crudo acotado.
    // La voz se recorta más porque no se puede escanear.
    // Se LOGUEA: sin esto el crudo llegaba a la UI sin dejar rastro de que la
    // síntesis había fallado, y parecía que la capa había decidido copiar.
    log('capa.sintesis-falló', { agente, error: e.message })
    return { voz: contenido.slice(0, 400), texto: contenido.slice(0, 3000), cumplido: null }
  }

  let v = interpretarVeredicto(salida)

  // Describir la respuesta no es responder: se vio "He detallado los niveles,
  // naturalezas y sets de movimientos" sin detallar nada. Se rehace una vez
  // exigiendo los datos.
  if (anunciaSinEntregar(v.texto)) {
    log('capa.anuncio-vacio', { agente, texto: v.texto })
    try {
      const r2 = await llmCerebras([
        ...m,
        { role: 'assistant', content: salida.slice(0, 800) },
        { role: 'user', content: 'Anunciaste la información pero no la diste. Rehaz la respuesta con los DATOS concretos del resultado del agente (nombres, niveles, cifras). Si el resultado no los trae, dilo. Mismo JSON.' },
      ])
      const v2 = interpretarVeredicto(r2.choices?.[0]?.message?.content || '')
      if (v2.texto && !anunciaSinEntregar(v2.texto)) v = v2
    } catch (e) { log('capa.anuncio-vacio', { error: e.message }) }
  }

  // Restos de protocolo no se hablan NI se muestran.
  const limpiar = (t) => (t && !/call:\w+\s*\{|delegate_to_agent|tool_calls/.test(t) ? t : '')
  const textoLimpio = limpiar(v.texto)
  let voz = limpiar(v.voz)

  // La voz NUNCA lee la salida cruda: se escuchó recitando markdown, tablas de
  // precios y palabras partidas. Si lo que quedó no es hablable, se sustituye
  // por un aviso corto y el detalle queda en pantalla, que es su sitio.
  // Copiar el resultado no es sintetizar. Se rehace una vez exigiéndolo.
  if (esCopiaLiteral(textoLimpio, contenido) || esCopiaLiteral(voz, contenido)) {
    log('capa.copia-literal', { agente, largo: (textoLimpio || '').length })
    try {
      const r3 = await llmCerebras([
        ...m,
        { role: 'assistant', content: salida.slice(0, 800) },
        { role: 'user', content: 'Copiaste el resultado del agente en vez de sintetizarlo. Rehaz las dos salidas: quédate solo con lo que Robert pidió, ordénalo con tus palabras y descarta el ruido. La "voz" en 2-3 oraciones habladas; el "texto" ordenado pero SIN copiar bloques del resultado. Mismo JSON.' },
      ])
      const v3 = interpretarVeredicto(r3.choices?.[0]?.message?.content || '')
      if (v3.texto && !esCopiaLiteral(v3.texto, contenido)) {
        v = v3
        return { voz: v3.voz || v3.texto, texto: v3.texto, cumplido: v3.cumplido, motivo: v3.motivo }
      }
    } catch (e) { log('capa.copia-literal', { error: e.message }) }
  }

  if (esCruda(voz)) {
    log('capa.voz-cruda', { agente, largo: voz.length })
    voz = textoLimpio && !esCruda(textoLimpio)
      ? textoLimpio
      : 'Señor, la respuesta es extensa: se la dejo en pantalla.'
  }

  return { voz: voz || 'Listo, señor.', texto: textoLimpio || voz, cumplido: v.cumplido, motivo: v.motivo }
}

/* ── Estado de infra (STT/TTS/Orca + modelos + perfiles Hermes) para la UI ── */
async function estadoInfra() {
  const res = { stt:false, tts:false, orca:false, sttModel:'', ttsModel:'', hermesProfiles:[] }
  try {
    const r = await fetch(`${OMLX_BASE}/v1/models`, { signal: AbortSignal.timeout(4000) })
    if (r.ok) {
      const j = await r.json()
      const ids = (j.data || []).map(m => m.id)
      res.stt = ids.some(id => /whisper/i.test(id))
      res.sttModel = ids.find(id => /whisper/i.test(id)) || ''
      res.tts = ids.some(id => /qwen.*tts|tts/i.test(id))
      res.ttsModel = ids.find(id => /qwen.*tts|tts/i.test(id)) || ''
      if (!res.tts && res.ttsModel) res.tts = true
    }
  } catch (e) { res.detalle = 'oMLX no responde: ' + e.message }
  try {
    const { execFileSync } = require('child_process')
    execFileSync('which', ['orca'], { timeout: 2000, stdio: 'ignore' })
    res.orca = true
  } catch (e) { res.orca = false }
  try {
    const { readdirSync } = require('fs')
    const home = process.env.HOME || process.env.USERPROFILE || ''
    const enDisco = readdirSync(home + '/.hermes/profiles', { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name)
    // Encabeza el Hermes raíz (no vive bajo profiles/ y es el único con Trello)
    // y se excluye `voice`, que es esta misma capa.
    res.hermesProfiles = perfilesDelegables(enDisco)
  } catch (e) { res.hermesProfiles = [] }
  return res
}

module.exports = {
  cuerpoChat,
  procesarTurno,
  sttOmlx, ttsOmlx, ttsOmlxStreaming, llmCerebras, llmCerebrasStream,
  delegarHermesApi, delegarHermesSesion, delegarAgenente, ejecutarDelegacionDiferida, listarSesionesHermes, historialSesionHermes, cargarContextoAgente, resumenContextoAgente, normalizarToolCall, listarModelosHermes, fijarModeloDelegacion,
  sesiones, getSesion, crearSesion, listaSesiones, borrarSesion, setEstado,
  bus, emitir,
  AGENTES_DISPONIBLES,
  estadoInfra,
  modeloDefaultHermes,
  providerParaModelo,
  VOICE_PROMPT, ORCA_TOOL, TOOLS_CONOCIDAS, TOOL_DELEGAR,
  aplicarPerfilSesion,
  gestorWorker,
  cerrarWorker,
  precalentarWorker,
  clienteOrca,
  TIMEOUT_DELEGACION_MS,
  PERFIL_HERMES_DEFAULT,
  renombrarSesion,
  idDesdeTitulo,
  tituloVisible,
  catalogoModelos,
  interpretarSeleccion,
  ajustarModeloAlPerfil,
  CAPA_CONVERSACIONAL,
  log,
  cancelarDelegacion,
  contextoPerfilHermes,
  guardarContextoPerfil,
  delegarHermesCli,
  construirArgsHermes,
  resolverProviderSesion,
  resolverProviderDeModelo,
  resolverModeloDefault,
  resolverProviderDefault,
  // backcompat
  get thread() { return threadDefault() },
}