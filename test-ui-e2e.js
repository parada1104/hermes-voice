#!/usr/bin/env node
// E2E de la UI Hermes Voice vía Electron+CDP (Chrome DevTools Protocol).
// Requiere: daemon :8471 corriendo, y la app lanzada con --remote-debugging-port=9222.
// Verifica: sin errores console, WS conectado, sesiones cargadas, enviar texto → respuesta en DOM,
// crear sesión, tool-call render, mic flush con webm real (sin mic físico).
const WS_MOD = require('./daemon/node_modules/ws')
const http = require('http')

const CDP_PORT = 9222
const DAEMON = 'http://127.0.0.1:8471'
let pass=0, fail=0
const ok=(n)=>{pass++;console.log('  ✔',n)}
const bad=(n,w)=>{fail++;console.log('  ✘',n,'—',w)}
const assert=(n,c,w)=>c?ok(n):bad(n,w)

// Sondea una condición en la página hasta que se cumple o vence el techo.
async function esperarA(cdp, expr, techoMs=60000, pasoMs=1000){
  const inicio=Date.now()
  while(Date.now()-inicio<techoMs){
    try{ if(await cdp.eval(expr)) return true }catch(_){}
    await new Promise(r=>setTimeout(r,pasoMs))
  }
  return false
}

async function cdpList(){
  const data = await new Promise((res,rej)=>{
    http.get('http://127.0.0.1:'+CDP_PORT+'/json',r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>res(JSON.parse(b)))}).on('error',rej)
  })
  const page = data.find(t=>t.type==='page')
  if(!page) throw new Error('no page CDP target')
  return page
}
class CDP {
  constructor(ws){ this.ws=ws; this.id=0; this.pending=new Map(); this.consoleErrors=[]
    ws.on('message',d=>{ const m=JSON.parse(d.toString())
      if(m.id && this.pending.has(m.id)){ const {res,rej}=this.pending.get(m.id); this.pending.delete(m.id); m.error?rej(new Error(m.error.message)):res(m.result) }
      else if(m.method==='Runtime.consoleAPICalled' && ['error','assert'].includes(m.params.type)){ this.consoleErrors.push(m.params.args.map(a=>a.value||a.description||'').join(' ')) }
      else if(m.method==='Runtime.exceptionThrown'){ this.consoleErrors.push(m.params.exceptionDetails?.text||'exception') }
    })
  }
  static async connect(url){ const ws=new WS_MOD(url); await new Promise((r,j)=>{ws.on('open',r);ws.on('error',j)}); return new CDP(ws) }
  send(method,params={}){ return new Promise((res,rej)=>{ const id=++this.id; this.pending.set(id,{res,rej}); this.ws.send(JSON.stringify({id,method,params})) }) }
  async eval(expr){ const r=await this.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true}); return r.result?.value }
}

async function main(){
  const page = await cdpList().catch(e=>{ throw new Error('CDP no disponible — lanza la app con --remote-debugging-port=9222 ('+e.message+')') })
  const c = await CDP.connect(page.webSocketDebuggerUrl)
  await c.send('Runtime.enable')
  await c.send('Page.enable')
  console.log('== UI e2e (cargada en Electron) ==')

  // 1. Estado de carga
  await new Promise(r=>setTimeout(r,1500))
  const ready = await c.eval('document.readyState')
  assert('document ready', ready==='complete', 'ready='+ready)

  // 2. Componentes clave del layout actual: agente/perfil arriba, sin selector en composer.
  const els = await c.eval(`JSON.stringify({
    sidebar: !!document.querySelector('#sidebar'),
    sbList: !!document.querySelector('#sbList'),
    agentTop: !!document.querySelector('#agentTop'),
    profileTop: !!document.querySelector('#profileTop'),
    delegationModel: !!document.querySelector('#delegationModel'),
    agentIcon: !!document.querySelector('#sbList .agent-icon'),
    modeToggle: !!document.querySelector('#modeToggle'),
    sessionModal: !!document.querySelector('#sessionModal'),
    dropUp: !!document.querySelector('#dropUp'),
    mic: !!document.querySelector('#micBtn'),
    composer: !!document.querySelector('#composerText'),
    pill: !!document.querySelector('#pill'),
    infra: !!document.querySelector('#sbInfra'),
    // Perfil y contexto salieron del composer: viven en el menú ⋯ de la sesión.
    perfilEnComposer: !!document.querySelector('#composer #profileTop'),
    ctxEnComposer: !!document.querySelector('#composer #contextStatus'),
    modeloJuntoAlPtt: !!document.querySelector('.voice-group #delegationModel') && !!document.querySelector('.voice-group #micBtn'),
    contextModal: !!document.querySelector('#contextModal'),
    contextSoul: !!document.querySelector('#contextSoul'),
    abrirContextoEnMenu: !!document.querySelector('#sessionMenu #openContext'),
    titlesNativos: document.querySelectorAll('[title]').length,
    tooltipsPropios: document.querySelectorAll('[data-tip]').length,
    // El selector es del AGENTE y va cualificado por provider.
    modeloAgrupadoPorProvider: document.querySelectorAll('#delegationModel optgroup').length > 0,
    modeloCualificado: [...document.querySelectorAll('#delegationModel option')].every(o=>!o.value||o.value.includes('/')),
    // Identidad de sesión: id estable, título editable.
    renombrarEnMenu: !!document.querySelector('#sessionMenu #renameSession'),
    // El estado vacío no puede convivir con mensajes: quedaba colgado arriba.
    vacioConMensajes: !!document.querySelector('.empty') && document.querySelectorAll('.msg').length > 0
  })`)
  const e=JSON.parse(els)
  assert('sidebar presente', e.sidebar)
  assert('lista sesiones presente', e.sbList)
  assert('agente visible como icono de sesión', e.agentIcon)
  assert('perfil fuera del composer', !e.perfilEnComposer)
  assert('contexto fuera del composer', !e.ctxEnComposer)
  assert('selector de modelo junto al PTT', e.modeloJuntoAlPtt)
  assert('modal de contexto presente', e.contextModal && e.contextSoul)
  assert('acceso al contexto desde el menú de sesión', e.abrirContextoEnMenu)
  assert('sin tooltips nativos truncados (title=)', e.titlesNativos===0, e.titlesNativos+' quedan')
  assert('tooltips propios en uso', e.tooltipsPropios>0)
  assert('selector de modelo agrupado por provider', e.modeloAgrupadoPorProvider)
  assert('cada opción de modelo lleva su provider', e.modeloCualificado)
  assert('renombrar sesión disponible en el menú', e.renombrarEnMenu)
  assert('el estado vacío desaparece al haber mensajes', !e.vacioConMensajes)
  assert('agente no está en header', !e.agentTop)
  assert('toggle PTT/Continuo presente', e.modeToggle)
  assert('modal nueva sesión presente', e.sessionModal)
  assert('drop-up adjuntar presente', e.dropUp)
  assert('mic presente', e.mic)
  assert('composer presente', e.composer)
  assert('infra (modelos/perfiles) presente', e.infra)

  // 3. Esperar WS + sesiones (tolerancia 4s)
  await new Promise(r=>setTimeout(r,2500))
  const pillText = await c.eval('document.querySelector("#pillText").textContent')
  // Por defecto Push-to-talk: pill "conectado" (no graba hasta que mantengas el mic); si estuviera cont/escuchando, también válido.
  assert('pill conectado (WS ok, default ptt)', ['conectado','escuchando','hablando'].includes(pillText.toLowerCase()), 'pill='+pillText)
  const sbCount = await c.eval('document.querySelectorAll("#sbList .sb-item").length')
  assert('sesiones renderizadas en sidebar', sbCount>0, 'count='+sbCount)

  // 4. Enviar texto → debe aparecer mensaje user + respuesta assistant en DOM
  const audioAntes = await c.eval('window.__speechCount || 0')
  await c.eval(`document.querySelector('#composerText').value='quien eres'; document.querySelector('#composerText').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  // Modo texto va directo al agente vía /v1/runs y puede tardar más que la capa conversacional.
  // Esperar por condición, no por reloj: el primer turno puede incluir el
  // arranque del worker de Orca, y un sleep fijo lo convierte en una carrera.
  await esperarA(c, 'document.querySelector(".msg.assistant .bubble") !== null', 120000)
  const msgCount = await c.eval('document.querySelectorAll(".msg").length')
  assert('mensajes en DOM tras enviar', msgCount>=2, 'msgs='+msgCount)
  const bubbleTail = await c.eval('document.querySelector(".msg.assistant .bubble") ? document.querySelector(".msg.assistant .bubble").textContent.slice(0,60) : "(null)"')
  assert('respuesta assistant visible', !bubbleTail.startsWith('(null)'), 'bubble='+bubbleTail)
  // Se cuenta el audio DE ESTE turno, no el global: las delegaciones de voz se
  // difunden a la sesión y su audio puede llegar mientras corre un turno de
  // texto. Eso es correcto —la respuesta pertenece al turno de voz— pero
  // inflaba el contador y hacía fallar el assert.
  const textAudio = await c.eval('window.__speechCount || 0') - audioAntes
  assert('modo texto no genera TTS propio', textAudio===0, 'speech.frase='+textAudio)

  // 5. Crear sesión vía UI (prompt es nativo — usamos el endpoint y refrescamos)
  // La app queda donde la dejemos: si el test se va sin restaurar, Robert
  // vuelve y le está hablando a una sesión de prueba.
  const sesionPrevia = await c.eval('sessionId')
  const newId = 'e2e-'+Date.now()
  await c.eval(`fetch(${JSON.stringify(DAEMON+'/v1/sessions')},{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:${JSON.stringify(newId)}})}).then(()=>{ sessionId=${JSON.stringify(newId)}; fetchSessions(); fetchChat() })`)
  // Por condición: crear la sesión dispara fetchSessions + fetchChat asíncronos.
  await esperarA(c, `document.querySelector("#sbList .sb-item.active .nm")?.textContent === ${JSON.stringify(newId)}`, 20000, 300)
  await esperarA(c, '!!document.querySelector(".empty")', 15000, 300)
  const active = await c.eval('document.querySelector("#sbList .sb-item.active .nm") ? document.querySelector("#sbList .sb-item.active .nm").textContent : "(null)"')
  assert('sesión creada y activa en UI', active===newId, 'active='+active)
  const emptyShown = await c.eval('!!document.querySelector(".empty")')
  assert('empty state en sesión nueva', emptyShown, 'no empty')

  // 6. Render de tool-call: test SINTÉTICO determinista (addTool) + si en la delegación real
  //    el modelo decidió delegar, verificar .tool (si respondió directo, .msg.assistant es válido).
  await c.eval(`(function(){ const t=addTool('irrelevante'); if(typeof t.ok==='function') t.ok('ok sintetico'); return typeof t.ok==='function' })()`)
  const synthTool = await c.eval('!!document.querySelector(".tool")')
  assert('addTool renderiza .tool', synthTool, 'no .tool')
  const synthState = await c.eval('document.querySelector(".tool .check")?"check":(document.querySelector(".tool .x")?"err":"run")')
  assert('tool-call con ok() → state check', synthState==='check', 'state='+synthState)

  // delegación real (puede delegar o responder directo; ambos = turno OK)
  await c.eval(`document.querySelector('#composerText').value='qué pendientes hay en el tablero'; document.querySelector('#composerText').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`)
  await new Promise(r=>setTimeout(r,20000))
  const toolReal = await c.eval('!!document.querySelector(".tool:not(:first-child), .tool")')
  const assReal = await c.eval('document.querySelectorAll(".msg.assistant").length')
  assert('delegación → tool O respuesta assistant', toolReal||assReal>0, 'tool='+toolReal+' ass='+assReal)

  // 7. Mic: flushAudio con webm real (silencio). STT de silencio suele dar "sin transcripción",
  //    lo que NO debe crashear la UI (verificamos que siga viva y sin console error).
  const fs=require('fs')
  const b64 = fs.readFileSync('/tmp/test_silence.webm').toString('base64')
  const micFlush = await c.eval(`(async()=>{ const ab=new Uint8Array(atob(${JSON.stringify(b64)})).buffer; const blob=new Blob([ab],{type:'audio/webm'}); await flushAudio(blob); return 'flushed' })()`)
  assert('flushAudio(webm) ejecuta sin throw', micFlush==='flushed', 'res='+micFlush)
  await new Promise(r=>setTimeout(r,8000))
  const alive = await c.eval('document.readyState==="complete"')
  assert('UI viva tras flushAudio(silencio)', alive, 'no alive')

  // 8. Console errors durante todo el flujo
  console.log('== Console errors capturados: '+(c.consoleErrors.length)+' ==')
  c.consoleErrors.slice(0,8).forEach(e=>console.log('   !',e.slice(0,120)))
  assert('sin errores console/JS', c.consoleErrors.length===0, 'errors='+c.consoleErrors.length)

  // Devolver la app a la sesión en la que estaba y borrar la de prueba.
  try{
    await fetch(DAEMON+'/v1/sessions/'+encodeURIComponent(newId),{method:'DELETE'}).catch(()=>{})
    await c.eval(`sessionId=${JSON.stringify(sesionPrevia)}; salaActiva=sessionId; activarSala(); fetchSessions(); fetchChat()`)
  }catch(_){}

  console.log('\nRESULTADO UI: '+pass+' passed, '+fail+' failed')
  process.exit(fail>0?1:0)
}
main().catch(e=>{ console.error('EXC', e.message); process.exit(2) })