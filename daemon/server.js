/**
 * Hermes Voice — server local del daemon conector (multi-sesión + real-time)
 *
 * Expone la capa de voz + sesiones del conector como HTTP/WebSocket local.
 * Puerto por defecto 8471.
 *
 * Real-time (WS /ws, bidireccional):
 *   → cliente manda:  {type:'audio', data:<b64>, mime}  (fragmento de captura)
 *                     {type:'audio-end', sessionId}      (termina la frase)
 *                     {type:'text', text, sessionId, agent}
 *   ← daemon emite:   {type:'phase', payload:{sesionId, estado}}
 *                     {type:'transcripcion', payload:{sesionId, text, parcial}}
 *                     {type:'speech.frase', payload:{sesionId, frase, audio(b64), total, idx}}
 *                     {type:'respuesta', payload:{sesionId, text, agent, delegation}}
 *
 * REST (compat):
 *   POST /v1/turn {sessionId?, agent?, audio_base64 or text, mime} → {text, audio_base64, delegation, sessionId, agent}
 *   GET  /v1/thread ?sessionId=
 *   GET  /v1/sessions · POST /v1/sessions · GET /v1/agents · GET /v1/health
 */

const http = require('http')
const { WebSocketServer } = require('ws')
const fs = require('fs')
const os = require('os')
const pathLib = require('path')

try {
  var { procesarTurno, ejecutarDelegacionDiferida, sttOmlx, ttsOmlx, ttsOmlxStreaming, listaSesiones, crearSesion, getSesion, AGENTES_DISPONIBLES, estadoInfra, modeloDefaultHermes, historialSesionHermes, borrarSesion, setEstado, listarSesionesHermes, listarModelosHermes, fijarModeloDelegacion, contextoPerfilHermes, guardarContextoPerfil, cancelarDelegacion, precalentarWorker, CAPA_CONVERSACIONAL, renombrarSesion, tituloVisible, TIMEOUT_DELEGACION_MS, _bus, bus, emitir } = require('./connector')
} catch (e) {
  const m = require('./connector')
  procesarTurno = m.procesarTurno; ejecutarDelegacionDiferida = m.ejecutarDelegacionDiferida; sttOmlx = m.sttOmlx; ttsOmlx = m.ttsOmlx
  ttsOmlxStreaming = m.ttsOmlxStreaming; listaSesiones = m.listaSesiones; crearSesion = m.crearSesion
  getSesion = m.getSesion; AGENTES_DISPONIBLES = m.AGENTES_DISPONIBLES; estadoInfra = m.estadoInfra; modeloDefaultHermes = m.modeloDefaultHermes; historialSesionHermes = m.historialSesionHermes; listarSesionesHermes = m.listarSesionesHermes; listarModelosHermes = m.listarModelosHermes; fijarModeloDelegacion = m.fijarModeloDelegacion; contextoPerfilHermes = m.contextoPerfilHermes; guardarContextoPerfil = m.guardarContextoPerfil; cancelarDelegacion = m.cancelarDelegacion; precalentarWorker = m.precalentarWorker; CAPA_CONVERSACIONAL = m.CAPA_CONVERSACIONAL; renombrarSesion = m.renombrarSesion; tituloVisible = m.tituloVisible; TIMEOUT_DELEGACION_MS = m.TIMEOUT_DELEGACION_MS
  borrarSesion = m.borrarSesion; setEstado = m.setEstado
  bus = m.bus; emitir = m.emitir
}

const PORT = Number(process.env.HV_CONNECTOR_PORT || 8471)

function send(res, code, obj) {
  const b = typeof obj === 'string' ? obj : JSON.stringify(obj)
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' })
  res.end(b)
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', c => { body += c; if (body.length > 1e8) req.destroy() })
    req.on('end', () => { try { resolve(body ? JSON.parse(body) : {}) } catch (e) { reject(new Error('JSON inválido')) } })
    req.on('error', reject)
  })
}

function guardarDataUrl(dataUrl, nombre = 'adjunto') {
  const m = String(dataUrl || '').match(/^data:([^;,]+);base64,(.+)$/s)
  if (!m) throw new Error('Adjunto inválido')
  const ext = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif', 'application/pdf': '.pdf' })[m[1].toLowerCase()] || pathLib.extname(nombre) || '.bin'
  const file = pathLib.join(os.tmpdir(), `hv-attachment-${Date.now()}${ext}`)
  fs.writeFileSync(file, Buffer.from(m[2], 'base64'))
  return { path: file, mime: m[1], name: nombre }
}

async function handle(req, res) {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST,GET,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' }); res.end(); return }

  const url = new URL(req.url, `http://localhost:${PORT}`)
  const path = url.pathname
  const q = url.searchParams

  try {
    if (req.method === 'GET' && path === '/v1/health') return send(res, 200, { status: 'ok', service: 'hermes-voice-daemon', realtime: true })

    if (req.method === 'GET' && path === '/v1/thread') {
      const sesion = getSesion(q.get('sessionId') || 'default')
      return send(res, 200, { sessionId: sesion.id, messages: sesion.thread })
    }

    if (req.method === 'GET' && path === '/v1/sessions') return send(res, 200, { sessions: listaSesiones() })
    if (req.method === 'GET' && path === '/v1/jobs') {
      const sessionId = q.get('sessionId') || ''
      return send(res, 200, { jobs: delegaciones.listar(sessionId) })
    }
    if (req.method === 'GET' && path === '/v1/agents') return send(res, 200, { agents: AGENTES_DISPONIBLES })
    if (req.method === 'GET' && path === '/v1/infra') {
      const inf = await estadoInfra()
      return send(res, 200, inf)
    }
    if (req.method === 'GET' && path === '/v1/hermes-sessions') {
      const profile = q.get('profile') || ''
      return send(res, 200, { profile, sessions: await listarSesionesHermes(profile) })
    }
    if (req.method === 'GET' && path === '/v1/hermes-models') {
      const profile = q.get('profile') || ''
      const catalogo = await listarModelosHermes(profile)
      return send(res, 200, {
        profile,
        defaultModel: (catalogo.find(m => m.esDefault) || {}).id || '',
        models: catalogo,
        // La capa conversacional se informa aparte para dejar claro que el
        // selector configura al AGENTE, no a la voz que responde.
        conversationLayer: CAPA_CONVERSACIONAL,
      })
    }
    if (req.method === 'GET' && path === '/v1/hermes-session-history') {
      const profile = q.get('profile') || ''
      const agentSessionId = q.get('sessionId') || ''
      return send(res, 200, { profile, agentSessionId, messages: await historialSesionHermes(profile, agentSessionId) })
    }

    // Contexto real del agente (SOUL.md + skills + cwd) para el modal editable.
    if (req.method === 'GET' && path === '/v1/agent-context') {
      const profile = q.get('profile') || ''
      if (!profile) return send(res, 400, { error: 'Falta profile' })
      return send(res, 200, { profile, context: contextoPerfilHermes(profile) })
    }
    if (req.method === 'PUT' && path === '/v1/agent-context') {
      const data = await readBody(req)
      if (!data.profile) return send(res, 400, { error: 'Falta profile' })
      if (typeof data.soul !== 'string') return send(res, 400, { error: 'Falta soul' })
      const destino = guardarContextoPerfil(data.profile, data.soul)
      return send(res, 200, { profile: data.profile, savedTo: destino, context: contextoPerfilHermes(data.profile) })
    }

    const tituloMatch = path.match(/^\/v1\/sessions\/(.+)\/title$/)
    if (req.method === 'POST' && tituloMatch) {
      const data = await readBody(req)
      const sesion = renombrarSesion(decodeURIComponent(tituloMatch[1]), data.title || data.titulo || '')
      return send(res, 200, { session: { id: sesion.id, titulo: tituloVisible(sesion) } })
    }

    const modelMatch = path.match(/^\/v1\/sessions\/(.+)\/delegation-model$/)
    if (req.method === 'POST' && modelMatch) {
      const data = await readBody(req)
      const sesion = fijarModeloDelegacion(decodeURIComponent(modelMatch[1]), data.model || '')
      return send(res, 200, { session: { id: sesion.id, agentModel: sesion.agentModel } })
    }

    if (req.method === 'POST' && path === '/v1/sessions') {
      const data = await readBody(req)
      if (data.agent === 'pi' && data.workingDir && !require('fs').existsSync(data.workingDir)) return send(res, 400, { error: 'La ruta de trabajo de Pi no existe' })
      const titulo = (data.title || data.titulo || '').trim()
      const sesion = crearSesion(data.id || '', data.agent, data.profile, data.agentSessionId, data.agentModel, data.workingDir || '', titulo)
      return send(res, 201, { session: { id: sesion.id, titulo: tituloVisible(sesion), agente: sesion.agente, perfil: sesion.perfil, agentSessionId: sesion.agentSessionId, agentModel: sesion.agentModel, workingDir: sesion.workingDir, agentContext: sesion.agentContext, estado: sesion.estado } })
    }

    const delMatch = path.match(/^\/v1\/sessions\/(.+)$/)
    if (req.method === 'DELETE' && delMatch) {
      const ok = borrarSesion(decodeURIComponent(delMatch[1]))
      return send(res, ok ? 200 : 404, { ok })
    }

    if (req.method === 'POST' && path === '/v1/turn') {
      const data = await readBody(req)
      const adjunto = data.dataUrl ? guardarDataUrl(data.dataUrl, data.name || 'adjunto') : null
      let texto = data.text
      if (!texto && data.audio_base64) {
        const ab = Buffer.from(data.audio_base64, 'base64')
        texto = await sttOmlx(ab, data.mime)
      }
      if (!texto || !texto.trim()) return send(res, 400, { error: 'sin transcripción' })
      const modo = data.modo || (data.audio_base64 ? 'voz' : 'texto')
      log('turno.inicio', { ruta: 'rest', sesionId: data.sessionId || 'default', modo, agente: data.agent, texto })
      const turno = await procesarTurno(texto.trim(), { sessionId: data.sessionId || 'default', agent: data.agent, modo, agentSessionId: data.agentSessionId, agentModel: data.agentModel, profile: data.profile, adjunto })
      log('turno.fin', { ruta: 'rest', sesionId: turno.sesionId, delegó: !!turno.delegation })

      // Solo el modo voz sintetiza TTS; el modo texto devuelve texto puro del agente.
      let audio = null
      if (modo === 'voz' && turno.text) {
        const chunks = []
        await ttsOmlxStreaming(turno.text, (frase, wav) => {
          chunks.push(wav)
          // REST devuelve el audio al solicitante; no lo retransmitimos a todos los WS.
        })
        audio = Buffer.concat(chunks).toString('base64')
      }
      return send(res, 200, { text: turno.text, audio_base64: audio, delegation: turno.delegation || null, sessionId: turno.sesionId, agent: turno.agente, modo })
    }

    return send(res, 404, { error: 'not found' })
  } catch (e) {
    return send(res, 500, { error: e.message, terminal: true })
  }
}

const server = http.createServer(handle)

/* ── WebSocket real-time bidireccional ── */
const wss = new WebSocketServer({ server, path: '/ws' })
const clients = new Map() // ws -> { buffer: [], sesion, agent, processing }

function broadcast(msg, wsLive) {
  const data = JSON.stringify(msg)
  for (const [client] of clients) if (client.readyState === client.OPEN) client.send(data)
}
function broadcastSession(sesionId, msg) {
  for (const [client, state] of clients) {
    if (state.sesion !== sesionId || client.readyState !== client.OPEN) continue
    const payload = { ...(msg.payload || {}), sesionId, turnId: msg.payload?.turnId || state.turnId, seq: msg.payload?.seq || ++state.eventSeq }
    client.send(JSON.stringify({ ...msg, payload }) )
  }
}
function tieneCabeceraWebm(buf) { return buf && buf.length >= 4 && buf.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])) }
// enviar a UN cliente (el que inició el turno)
function sendTo(ws, msg) {
  if (ws.readyState !== ws.OPEN) return
  const st = clients.get(ws)
  if (st && msg.payload && msg.payload.sesionId && !msg.payload.turnId) msg.payload.turnId = st.turnId
  if (st && msg.payload && !msg.payload.seq) msg.payload.seq = ++st.eventSeq
  ws.send(JSON.stringify(msg))
}
function conTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(label + ' timeout')), ms) })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

// Supervisor persistente: los jobs sobreviven al reinicio del daemon y los que
// quedaron a medias se cierran como `interrupted` en vez de colgarse en la UI.
const { DelegationManager } = require('./jobs')
const { restoNoHablado } = require('./streaming')
const { crearLogger } = require('./log')
const { guardaExterna } = require('./timeouts')
const { avisoDeEspera } = require('./espera')
const log = crearLogger({ activo: process.env.HV_LOG !== '0' })
const delegaciones = new DelegationManager({ file: pathLib.join(os.homedir(), '.hermes', 'voice', 'jobs.json') })
delegaciones.onCambio(job => broadcastSession(job.sesionId, { type: 'delegation.status', payload: job }))

let nextJobId = 1
// El sufijo temporal evita colisiones tras un reinicio, cuando el contador y el
// turnId vuelven a empezar en 1 sobre un store que ya tiene jobs.
function nuevoJobId(sesionId, turnId) { return `job-${sesionId}-${turnId}-${Date.now().toString(36)}-${nextJobId++}` }
function actualizarJob(jobId, patch) { return delegaciones.actualizar(jobId, patch) }
// Ojo con `ws`: la delegación es asíncrona y SOBREVIVE a la conexión que la
// lanzó. Si el desenlace se mandara por `sendTo(ws)`, un reinicio o reconexión
// de la app lo descartaría en silencio — el trabajo se hace en Orca y en
// Electron no aparece nada. Todo lo que cierra el job se difunde por sesión.
function lanzarDelegacion(ws, sesionId, agente, pedido, meta) {
  const sesion = getSesion(sesionId)
  const job = delegaciones.crear({
    jobId: meta.jobId, turnId: meta.turnId, sesionId, agente,
    perfil: sesion.perfil || '', provider: sesion.agentProvider || '', modelo: sesion.agentModel || '',
    agentSessionId: sesion.agentSessionId || '', workingDir: sesion.workingDir || '', pedido,
  })
  log('delegacion.lanzada', { sesionId, jobId: job.jobId, turnId: job.turnId, perfil: job.perfil, provider: job.provider, modelo: job.modelo, pedido })
  broadcastSession(sesionId, { type: 'tool.start', payload: job })
  actualizarJob(job.jobId, { estado: 'running', startedAt: Date.now() })
  // Sin esto la UI se queda más de un minuto sin ninguna señal de que el agente
  // sigue trabajando, y parece colgada.
  // El latido es visual; con voz Robert no suele estar mirando la pantalla, así
  // que una espera larga además se dice — en umbrales espaciados, sin repetir.
  let ultimoAviso = 0
  const latido = setInterval(async () => {
    const vivo = delegaciones.obtener(job.jobId)
    if (!vivo || !['queued', 'running'].includes(vivo.estado)) return clearInterval(latido)
    const segundos = Math.round((Date.now() - job.createdAt) / 1000)
    broadcastSession(sesionId, { type: 'delegation.latido', payload: { jobId: job.jobId, sesionId, turnId: job.turnId, segundos } })

    const aviso = avisoDeEspera(segundos, ultimoAviso)
    if (!aviso) return
    ultimoAviso = aviso.desde
    log('delegacion.aviso', { sesionId, jobId: job.jobId, segundos, frase: aviso.frase })
    try {
      await ttsOmlxStreaming(aviso.frase, (frase, wav) => {
        broadcastSession(sesionId, { type: 'speech.frase', payload: { sesionId, turnId: job.turnId, jobId: job.jobId, frase, audio: wav.toString('base64'), espera: true } })
      })
    } catch (_) {}
  }, 5000)
  Promise.resolve().then(async () => {
    try {
      // La capa conversacional ya redactó la respuesta, salga bien o mal: aquí
      // solo se reproduce. El único caso mudo es la cancelación deliberada.
      const resultado = await conTimeout(ejecutarDelegacionDiferida(sesionId, agente, pedido, job), guardaExterna(TIMEOUT_DELEGACION_MS), 'Delegación')
      clearInterval(latido)
      actualizarJob(job.jobId, { estado: resultado?.estado || 'completed', finishedAt: Date.now(), resultado: resultado?.text || '', cumplido: resultado?.cumplido, motivo: resultado?.motivo || '', ...(resultado?.error ? { error: resultado.error } : {}) })
      if (!resultado?.text) return
      let idx = 0
      // Se habla la `voz` (corta) y se muestra el `text` (completo): son dos
      // salidas del mismo resultado, no una inconsistencia.
      await ttsOmlxStreaming(resultado.voz || resultado.text, (frase, wav) => {
        broadcastSession(sesionId, { type: 'speech.frase', payload: { sesionId, turnId: job.turnId, jobId: job.jobId, frase, audio: wav.toString('base64'), index: idx++ } })
      }).catch(() => {})
      broadcastSession(sesionId, { type: 'respuesta', payload: { sesionId, text: resultado.text, agent: agente, delegation: resultado.delegation || null, modo: 'voz', terminal: true, turnId: job.turnId, jobId: job.jobId, estado: resultado?.estado || 'completed' } })
    } catch (e) {
      clearInterval(latido)
      // Barge-in: no es un fallo, es Robert retomando la palabra. Se cierra el
      // job y se calla; anunciarlo por voz pisaría lo que acaba de decir.
      if (e.cancelada) {
        actualizarJob(job.jobId, { estado: 'cancelled', finishedAt: Date.now(), error: 'Cancelada por el usuario' })
        return
      }
      // Aquí solo llega un fallo del propio orquestador (p. ej. el techo de
      // 180s): los del agente ya vuelven redactados por la capa conversacional.
      const timedOut = !!e.timeout || /timeout/i.test(e.message)
      actualizarJob(job.jobId, { estado: timedOut ? 'timed_out' : 'failed', finishedAt: Date.now(), error: e.message })
      broadcastSession(sesionId, { type: 'respuesta', payload: { sesionId, text: 'La delegación no pudo completarse: ' + e.message, agent: agente, delegation: { error: e.message, terminal: true }, modo: 'voz', terminal: true, turnId: job.turnId, jobId: job.jobId, estado: 'failed' } })
    }
  })
}

wss.on('connection', (ws) => {
  clients.set(ws, { buffer: [], sesion: 'default', agent: undefined, perfil: '', agentSessionId: '', agentModel: '', processing: false, turnId: 0, eventSeq: 0 })
  ws.on('close', () => clients.delete(ws))

  ws.on('message', async (raw) => {
    const st = clients.get(ws)
    let msg
    try { msg = JSON.parse(raw.toString()) } catch { return }
    try {
      // Barge-in explícito desde la UI: corta la delegación viva de la sesión.
      if (msg.type === 'cancel') {
        const sesionId = msg.sessionId || st.sesion
        const cortado = cancelarDelegacion(sesionId)
        log('barge-in', { sesionId, procesoCortado: cortado })
        delegaciones.vivos(sesionId).forEach(j => actualizarJob(j.jobId, { estado: 'cancelled', finishedAt: Date.now(), error: 'Cancelada por el usuario' }))
        sendTo(ws, { type: 'cancelled', payload: { sesionId, proceso: cortado } })
        return
      }

      if (msg.type === 'audio' && msg.data) {
        if (st.processing) return
        if (msg.sessionId && msg.sessionId !== st.sesion) return
        const chunk = Buffer.from(msg.data, 'base64')
        // Para WebM solo aceptamos archivos autocontenidos; los fragmentos sin EBML se descartan.
        if ((msg.mime || '').includes('webm') && !tieneCabeceraWebm(chunk)) return
        st.buffer.push(chunk)
        st.sesion = msg.sessionId || st.sesion
        st.agent = msg.agent || st.agent
        st.perfil = msg.profile || st.perfil
        st.agentSessionId = msg.agentSessionId || st.agentSessionId
        st.agentModel = msg.agentModel || st.agentModel
        return
      }
      if (msg.type === 'audio-end') {
        if (st.processing) return
        if (msg.sessionId && msg.sessionId !== st.sesion) return
        const turnoSesion = msg.sessionId || st.sesion
        const turnoAgente = msg.agent || st.agent
        const turnoPerfil = msg.profile || st.perfil
        const turnoAgentSessionId = msg.agentSessionId || st.agentSessionId
        const turnoAgentModel = msg.agentModel || st.agentModel
        st.sesion = turnoSesion
        st.agent = turnoAgente
        st.perfil = turnoPerfil
        st.agentSessionId = turnoAgentSessionId
        st.agentModel = turnoAgentModel
        st.turnId += 1
        st.eventSeq = 0
        const turnoId = st.turnId
        const audio = Buffer.concat(st.buffer); st.buffer = []
        if (!audio.length) return
        if ((msg.mime || 'audio/webm').includes('webm') && !tieneCabeceraWebm(audio)) return
        st.processing = true
        try {
          sendTo(ws, { type: 'phase', payload: { sesionId: st.sesion, estado: 'transcribiendo' } })
          const texto = await sttOmlx(audio, msg.mime || 'audio/webm')
          if (!texto || !texto.trim()) return
          sendTo(ws, { type: 'transcripcion', payload: { sesionId: turnoSesion, text: texto, parcial: false } })
          await conTimeout(runTurnoLive(ws, { ...st, sesion: turnoSesion, turnId: turnoId, agent: turnoAgente, perfil: turnoPerfil, agentSessionId: turnoAgentSessionId, agentModel: turnoAgentModel }, texto, turnoAgente, 'voz'), 180000, 'Turno de voz')
        } finally {
          st.processing = false
          try { const ses = getSesion(turnoSesion); if (ses.estado !== 'idle') setEstado(ses, 'idle') } catch (_) {}
        }
        return
      }
      if (msg.type === 'text') {
        if (st.processing) {
          sendTo(ws, { type: 'error', payload: { sesionId: st.sesion, error: 'Hay una delegación en curso. Espera la respuesta final antes de enviar otra solicitud.', code: 'turn_in_progress' } })
          return
        }
        if (msg.sessionId && msg.sessionId !== st.sesion) return
        st.sesion = msg.sessionId || st.sesion
        st.agent = msg.agent || st.agent
        st.perfil = msg.profile || st.perfil
        st.agentSessionId = msg.agentSessionId || st.agentSessionId
        st.agentModel = msg.agentModel || st.agentModel
        st.processing = true
        st.turnId += 1
        st.eventSeq = 0
        // Acuse inmediato: sin esto la UI pinta el mensaje del usuario y no
        // tiene forma de saber si el daemon lo tomó. Un turno que se pierde se
        // ve exactamente igual que uno que va lento.
        sendTo(ws, { type: 'turno.recibido', payload: { sesionId: st.sesion, texto: msg.text } })
        try { await conTimeout(runTurnoLive(ws, { ...st, turnId: st.turnId }, msg.text, st.agent, msg.modo || 'texto'), 180000, 'Turno') }
        finally {
          st.processing = false
          try { const ses = getSesion(st.sesion); if (ses.estado !== 'idle') setEstado(ses, 'idle') } catch (_) {}
        }
        return
      }
      if (msg.type === 'attachment') {
        if (st.processing) {
          sendTo(ws, { type: 'error', payload: { sesionId: st.sesion, error: 'Hay una delegación en curso. Espera su cierre antes de enviar otro adjunto.', code: 'turn_in_progress', terminal: true } })
          return
        }
        if (msg.sessionId && msg.sessionId !== st.sesion) return
        const turnoSesion = msg.sessionId || st.sesion
        st.sesion = turnoSesion
        st.agent = msg.agent || st.agent
        st.perfil = msg.profile || st.perfil
        st.agentSessionId = msg.agentSessionId || st.agentSessionId
        st.agentModel = msg.agentModel || st.agentModel
        st.processing = true
        st.turnId += 1
        st.eventSeq = 0
        const adjunto = guardarDataUrl(msg.dataUrl, msg.name || 'adjunto')
        const pedido = msg.text || 'Analiza la imagen adjunta e identifica con precisión lo que aparece.'
        try {
          const turno = await conTimeout(procesarTurno(pedido, { sessionId: turnoSesion, agent: st.agent, modo: 'texto', agentSessionId: st.agentSessionId, agentModel: st.agentModel, profile: st.perfil, adjunto }), 180000, 'Análisis de adjunto')
          sendTo(ws, { type: 'respuesta', payload: { sesionId: turnoSesion, text: turno.text, agent: turno.agente, delegation: null, modo: 'texto', terminal: true } })
        } catch (e) {
          sendTo(ws, { type: 'respuesta', payload: { sesionId: turnoSesion, text: 'El análisis del adjunto no pudo completarse: ' + e.message, agent: st.agent, delegation: { error: e.message, terminal: true }, modo: 'texto', terminal: true } })
        } finally {
          try { fs.unlinkSync(adjunto.path) } catch (_) {}
          st.processing = false
          try { const ses = getSesion(turnoSesion); if (ses.estado !== 'idle') setEstado(ses, 'idle') } catch (_) {}
        }
        return
      }
      if (msg.type === 'activate') {
        if (st.processing || !msg.sessionId) return
        st.sesion = msg.sessionId
        st.agent = msg.agent || st.agent
        st.perfil = msg.profile || ''
        st.agentSessionId = msg.agentSessionId || st.agentSessionId
        st.agentModel = msg.agentModel || st.agentModel
        sendTo(ws, { type: 'room.active', payload: { sesionId: st.sesion, agent: st.agent, profile: st.perfil, agentModel: st.agentModel } })
        // En segundo plano: que el agente esté listo antes del primer pedido.
        precalentarWorker(st.sesion, st.perfil)
          .then(ok => { if (ok) sendTo(ws, { type: 'worker.listo', payload: { sesionId: st.sesion } }) })
          .catch(() => {})
        return
      }
    } catch (e) {
      const sesionError = (st && st.sesion) || 'default'
      sendTo(ws, { type: 'error', payload: { sesionId: sesionError, error: e.message, terminal: true } })
      sendTo(ws, { type: 'tool.end', payload: { sesionId: sesionError, ok: false, error: e.message, terminal: true } })
      sendTo(ws, { type: 'respuesta', payload: { sesionId: sesionError, text: 'La solicitud no pudo completarse: ' + e.message, agent: st && st.agent, delegation: { error: e.message, terminal: true }, modo: 'voz', terminal: true } })
      // nunca dejar la sesión pegada en escuchando/transcribiendo tras un error
      try { const ses = getSesion(sesionError); if (ses.estado !== 'idle') setEstado(ses, 'idle') } catch (_) {}
    }
  })
})

async function runTurnoLive(ws, st, texto, agente, modo) {
  if (!texto || !texto.trim()) { sendTo(ws, { type: 'error', payload: { error: 'sin transcripción' } }); return }
  const turnoSessionId = st.sesion
  const turnoAgent = agente || st.agent
  const jobId = nuevoJobId(turnoSessionId, st.turnId)
  log('turno.inicio', { ruta: 'ws', sesionId: turnoSessionId, turnId: st.turnId, modo, agente: turnoAgent, texto })
  // Streaming: cada frase que cierra la capa conversacional se sintetiza y se
  // envía al momento, sin esperar a que termine de escribir. `hablado` lleva la
  // cuenta de lo ya dicho para que las etapas siguientes no lo repitan.
  let hablado = ''
  let fraseIdx = 0
  const hablarFrase = async (frase, extra = {}) => {
    try {
      await ttsOmlxStreaming(frase, (trozo, wav) => {
        sendTo(ws, { type: 'speech.frase', payload: { sesionId: turnoSessionId, turnId: st.turnId, frase: trozo, audio: wav.toString('base64'), index: fraseIdx++, ...extra } })
      })
    } catch (_) {}
  }
  const turno = await procesarTurno(texto.trim(), {
    deferDelegation: modo === 'voz',
    delegationMeta: { jobId, turnId: st.turnId },
    sessionId: turnoSessionId, agent: turnoAgent, modo: modo || 'texto',
    agentSessionId: st.agentSessionId, agentModel: st.agentModel, profile: st.perfil,
    onFraseTemprana: modo === 'voz' ? async (frase) => { hablado += (hablado ? ' ' : '') + frase; await hablarFrase(frase) } : undefined,
    onDelegation: modo === 'voz' ? async (preambulo) => {
      sendTo(ws, { type: 'respuesta', payload: { sesionId: turnoSessionId, text: preambulo, agent: turnoAgent, delegation: null, modo, turnId: st.turnId, acknowledgement: true } })
      const resto = restoNoHablado(preambulo, hablado)
      if (resto) await hablarFrase(resto, { acknowledgement: true })
    } : null,
  })
  if (turno.delegationPending) {
    lanzarDelegacion(ws, turnoSessionId, turno.delegationPending.agente, turno.delegationPending.pedido, { jobId, turnId: st.turnId })
    return
  }
  log('turno.fin', { ruta: 'ws', sesionId: turnoSessionId, turnId: st.turnId, salida: 'respuesta-directa' })
  // Todas las respuestas de este turno usan turnoSessionId inmutable; el WS puede cambiar de sesión después.
  // Solo en MODO VOZ se sintetiza audio; en texto puro la respuesta es del agente, sin capa/TTS.
  // Todas las respuestas de este turno usan turnoSessionId inmutable; el WS puede cambiar de sesión después.
  // Solo en MODO VOZ se sintetiza audio; en texto puro la respuesta es del agente, sin capa/TTS.
  if (modo === 'voz' && turno.text) {
    const resto = restoNoHablado(turno.text, hablado)
    if (resto) await hablarFrase(resto)
  }
  sendTo(ws, { type: 'respuesta', payload: { sesionId: turno.sesionId, text: turno.text, agent: turno.agente, delegation: turno.delegation || null, modo, turnId: st.turnId } })
}

// Reenviar fases y ciclo de delegación del conector a WS.
// La UI puede pintar el trabajo antes de que exista una respuesta final.
if (bus) {
  bus.on('sesion.estado', p => broadcastSession(p.sesionId, { type: 'phase', payload: p }))
  // El bus es el canal de la delegación en línea (modo texto), que no crea job.
  // Cuando hay jobId manda el sistema de jobs: emitir por los dos canales daba
  // eventos duplicados, desordenados y con el estado viejo.
  const soloSinJob = (fn) => (p) => { if (!p.jobId) fn(p) }
  bus.on('delegacion.inicio', soloSinJob(p => broadcastSession(p.sesionId, { type: 'tool.start', payload: p })))
  bus.on('delegacion.ok', soloSinJob(p => broadcastSession(p.sesionId, { type: 'tool.end', payload: { ...p, ok: true } })))
  bus.on('delegacion.error', soloSinJob(p => broadcastSession(p.sesionId, { type: 'tool.end', payload: { ...p, ok: false } })))
}

server.timeout = 0
server.listen(PORT, () => {
  console.log(`[hermes-voice] conector :${PORT} (REST + WS /ws realtime)`)
})