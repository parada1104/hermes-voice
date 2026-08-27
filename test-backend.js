#!/usr/bin/env node
// Batería de tests del backend Hermes Voice (REST + WS + STT).
// Corre contra el daemon :8471. Salida: lista P/F + resumen. Exit != 0 si algo falla.
const DAEMON = 'http://127.0.0.1:8471'
const WS = 'ws://127.0.0.1:8471/ws'
const child = require('child_process')
const fs = require('fs')
// ws está instalado en daemon/
const WS_MOD = require('./daemon/node_modules/ws')

let pass = 0, fail = 0
const ok = (name) => { pass++; console.log('  ✔', name) }
const bad = (name, why) => { fail++; console.log('  ✘', name, '—', why) }
const assert = (name, cond, why) => cond ? ok(name) : bad(name, why)

async function get(url){ const r = await fetch(DAEMON+url); return { status: r.status, json: await r.json().catch(()=>({})) } }
async function post(url, body){ const r = await fetch(DAEMON+url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) }); return { status: r.status, json: await r.json().catch(()=>({})) } }

async function main(){
  console.log('== 1. Health ==')
  const h = await get('/v1/health')
  assert('health 200', h.status===200, 'status '+h.status)
  assert('realtime true', h.json.realtime===true, JSON.stringify(h.json).slice(0,80))

  console.log('== 2. Sesiones ==')
  const sess = await get('/v1/sessions')
  assert('sessions 200', sess.status===200, 'status '+sess.status)
  const before = sess.json.sessions?.length || 0
  const tid = 't-test-'+Date.now()
  const cr = await post('/v1/sessions', { id: tid })
  assert('crear sesión '+tid+' 201/200', [200,201].includes(cr.status), 'status '+cr.status)
  const sess2 = await get('/v1/sessions')
  assert('sesión aparece en lista', (sess2.json.sessions||[]).some(s=>s.id===tid), 'no aparece')
  const th = await get('/v1/thread?sessionId='+encodeURIComponent(tid))
  assert('thread vacío de sesión nueva', th.status===200 && Array.isArray(th.json.messages), 'status '+th.status)

  console.log('== 3. Agentes ==')
  const ag = await get('/v1/agents')
  assert('agents 200 + hermes presente', ag.status===200 && (ag.json.agents||[]).includes('hermes'), 'agents='+JSON.stringify(ag.json.agents))

  console.log('== 4. Turno conversacional (texto, modo VOZ — capa) ==')
  const t1 = await post('/v1/turn', { sessionId: tid, text: 'quien eres', agent: 'hermes', modo: 'voz' })
  assert('turn voz 200', t1.status===200, 'status '+t1.status)
  assert('turn voz devuelve text', typeof t1.json.text==='string' && t1.json.text.length>0, 'text='+String(t1.json.text).slice(0,60))
  // conversacional NO debe delegar
  assert('turn voz "quien eres" NO delega', !t1.json.delegation, 'deleg='+JSON.stringify(t1.json.delegation).slice(0,60))
  assert('turn voz NO devuelve _call:', !String(t1.json.text).includes('_call:'), 'text='+String(t1.json.text).slice(0,80))
  const th2 = await get('/v1/thread?sessionId='+encodeURIComponent(tid))
  assert('thread guardó mensajes', (th2.json.messages||[]).length >= 2, 'len='+(th2.json.messages||[]).length)

  console.log('== 4b. Turno texto (modo TEXTO → directo al agente, sin capa) ==')
  const t3 = await post('/v1/turn', { sessionId: tid, text: 'saluda brevemente', agent: 'hermes', modo: 'texto' })
  assert('turn texto 200', t3.status===200, 'status '+t3.status)
  assert('turn texto responde del agente', typeof t3.json.text==='string' && t3.json.text.length>0, 'text='+String(t3.json.text).slice(0,60))

  console.log('== 5. STT (audio webm real → transcripción) ==')
  // genera webm de 1s con ffmpeg si no existe
  const wav = '/tmp/test_silence.webm'
  if (!fs.existsSync(wav)){
    child.execSync('ffmpeg -y -f lavfi -i anullsrc=r=16000:cl=mono -t 1 -c:a libopus -f webm '+wav, {stdio:'ignore'})
  }
  const b64 = fs.readFileSync(wav).toString('base64')
  const a1 = await post('/v1/turn', { sessionId: tid, audio_base64: b64, mime: 'audio/webm', agent: 'hermes' })
  assert('turn audio (webm) 200 — NO 500 STT', a1.status===200, 'status '+a1.status+' err='+String(a1.json.error||'').slice(0,80))

  console.log('== 6. WebSocket realtime (texto) ==')
  await new Promise((resolve)=>{
    const ws = new WS_MOD(WS)
    const got = { phases:[], respuesta:null, error:null }
    const to = setTimeout(()=>{ ws.close(); resolve() }, 15000)
    ws.on('open', ()=>{
      ws.send(JSON.stringify({ type:'activate', sessionId: tid, agent:'hermes', profile:'' }))
      setTimeout(()=>ws.send(JSON.stringify({ type:'text', text:'hola cómo estás', sessionId: tid, agent:'hermes' })), 20)
    })
    ws.on('message', d=>{
      const m = JSON.parse(d.toString())
      if (m.type==='phase') got.phases.push(m.payload?.estado)
      if (m.type==='respuesta') { got.respuesta = m.payload?.text }
      if (m.type==='error') { got.error = m.payload?.error }
      if (got.respuesta || got.error){ clearTimeout(to); ws.close(); resolve() }
    })
  }).then(res=>{})
  // (arriba no guarda; usamos closure) — ver bloque siguiente

  console.log('== 6b. WebSocket realtime (texto) — verificación ==')
  const wsRes = await new Promise((resolve)=>{
    const ws = new WS_MOD(WS)
    const got = { phases:[], respuesta:null, error:null }
    const to = setTimeout(()=>{ ws.close(); resolve(got) }, 20000)
    ws.on('open', ()=>{
      ws.send(JSON.stringify({ type:'activate', sessionId: tid, agent:'hermes', profile:'' }))
      setTimeout(()=>ws.send(JSON.stringify({ type:'text', text:'hola cómo estás', sessionId: tid, agent:'hermes', modo:'voz' })), 20)
    })
    ws.on('message', d=>{
      const m = JSON.parse(d.toString())
      if (m.type==='phase') got.phases.push(m.payload?.estado)
      if (m.type==='respuesta') { got.respuesta = m.payload?.text; clearTimeout(to); ws.close(); resolve(got) }
      if (m.type==='error') { got.error = m.payload?.error; clearTimeout(to); ws.close(); resolve(got) }
    })
  })
  assert('WS recibe fases', wsRes.phases.length>0, 'phases='+JSON.stringify(wsRes.phases))
  assert('WS llega a hablando/idle', wsRes.phases.includes('hablando')||wsRes.phases.includes('idle'), 'phases='+JSON.stringify(wsRes.phases))
  assert('WS devuelve respuesta sin error', !!wsRes.respuesta && !wsRes.error, 'err='+String(wsRes.error||'')+' resp='+String(wsRes.respuesta||'').slice(0,60))

  console.log('== 7. WebSocket realtime (audio webm) ==')
  const wsRes2 = await new Promise((resolve)=>{
    const ws = new WS_MOD(WS)
    const got = { phases:[], respuesta:null, error:null }
    const to = setTimeout(()=>{ ws.close(); resolve(got) }, 20000)
    ws.on('open', ()=>{
      ws.send(JSON.stringify({ type:'activate', sessionId: tid, agent:'hermes', profile:'' }))
      setTimeout(()=>{
        ws.send(JSON.stringify({ type:'audio', data:b64, mime:'audio/webm', sessionId: tid, agent:'hermes' }))
        ws.send(JSON.stringify({ type:'audio-end', sessionId: tid, agent:'hermes', mime:'audio/webm' }))
      }, 20)
    })
    ws.on('message', d=>{
      const m = JSON.parse(d.toString())
      if (m.type==='phase') got.phases.push(m.payload?.estado)
      if (m.type==='respuesta') { got.respuesta = m.payload?.text; clearTimeout(to); ws.close(); resolve(got) }
      if (m.type==='error') { got.error = m.payload?.error; clearTimeout(to); ws.close(); resolve(got) }
    })
  })
  assert('WS audio NO da error sin audio', !wsRes2.error, 'err='+String(wsRes2.error||''))
  assert('WS audio responde (fase hablando/idle)', wsRes2.phases.includes('hablando')||wsRes2.phases.includes('idle')||!!wsRes2.respuesta, 'phases='+JSON.stringify(wsRes2.phases))

  console.log('== 8. TTS (vía connector, bytes wav) ==')
  try {
    process.env.API_SERVER_KEY = process.env.API_SERVER_KEY || ''
    const c = require('./daemon/connector')
    const wavBytes = await c.ttsOmlx('Hola señor, soy JARVIS.')
    assert('TTS genera wav (>1KB)', Buffer.isBuffer(wavBytes) && wavBytes.length > 1000, 'bytes='+(wavBytes?.length||0))
  } catch(e){ bad('TTS genera wav', e.message) }

  console.log('\nRESULTADO: '+pass+' passed, '+fail+' failed')
  // cleanup: borrar la sesión de test creada
  try { await fetch(`${DAEMON}/v1/sessions/${encodeURIComponent(tid)}`, { method:'DELETE' }) } catch(e){}
  process.exit(fail>0?1:0)
}
main().catch(e=>{ console.error('EXC', e.message); process.exit(2) })
