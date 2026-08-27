// Tests de la señal de "el REPL está libre" en un worker de Orca.
//
// Ya NO se prueba extracción de respuesta: eso salía de raspar el TTY y ahora
// sale del store (`test-store-hermes.test.js`). Queda solo lo que el terminal
// sabe mejor que nadie: si el proceso está ocupado.
//
// El spike dejó dos hechos medidos contra el binario real:
//  · `terminal wait --for tui-idle` responde `satisfied:true` MIENTRAS el agente
//    sigue trabajando ("Initializing agent…"). No sirve como fin de tarea.
//  · La señal fiable es que el prompt vuelve a `<perfil> ❯`; mientras trabaja
//    muestra `⚕ ❯ msg=interrupt · /queue · /bg · /steer · Ctrl+C cancel`.
// El fixture es la captura literal de esa corrida.
const test = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const path = require('path')
const { tareaTerminada } = require('./tty-hermes.js')

const real = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'tty-hermes-pong.json'), 'utf8'))

/* ── Señal de fin de tarea ── */

test('el prompt de entrada marca tarea terminada', () => {
  assert.strictEqual(tareaTerminada(['algo', 'entrenador ❯'], 'entrenador'), true)
})

test('el prompt de trabajo NO marca tarea terminada', () => {
  assert.strictEqual(tareaTerminada(['⚕ ❯ msg=interrupt · /queue · /bg · /steer · Ctrl+C cancel'], 'entrenador'), false)
})

test('las líneas vacías tras el prompt no lo invalidan', () => {
  assert.strictEqual(tareaTerminada(['entrenador ❯', '', '   '], 'entrenador'), true)
})

test('no discrimina por perfil: el prompt no siempre lo lleva', () => {
  // Se probó exigir `<perfil> ❯`, pero la captura en vivo mostró que Hermes
  // también imprime `❯ Ask anything…` sin el perfil. Discriminar así dejaba al
  // gestor esperando un prompt que nunca llegaba. No hace falta: el terminal es
  // dedicado a una sola sesión de voz, no hay otro perfil con quien confundirse.
  assert.strictEqual(tareaTerminada(['default ❯'], 'entrenador'), true)
})

test('sobre la captura real la tarea figura terminada', () => {
  assert.strictEqual(tareaTerminada(real.tail, real.perfil), true)
})

/* ── El prompt de entrada no siempre lleva el nombre del perfil ── */
// Capturado en vivo: a veces es `entrenador ❯ <sugerencia>` y a veces
// `❯ Ask anything, or type / for commands…`. Exigir el perfil dejaba al gestor
// esperando 240s a un prompt que nunca iba a llegar con esa forma.

test('reconoce el prompt sin nombre de perfil', () => {
  assert.strictEqual(tareaTerminada(['⚕ ❯ msg=interrupt · /queue', '❯ Ask anything, or type / for commands…'], 'entrenador'), true)
})

test('reconoce el prompt con nombre de perfil', () => {
  assert.strictEqual(tareaTerminada(['⚕ ❯ msg=interrupt · /queue', 'entrenador ❯ Research this topic'], 'entrenador'), true)
})

test('reconoce el prompt duplicado que dibuja el TUI', () => {
  assert.strictEqual(tareaTerminada(['⚕ ❯ msg=interrupt', '❯ ❯ Ask anything, or type / for commands…'], 'entrenador'), true)
})

test('sigue sin dar por terminado mientras solo está el prompt de trabajo', () => {
  assert.strictEqual(tareaTerminada(['❯ Ask anything…', '⚕ ❯ msg=interrupt · /queue'], 'entrenador'), false)
})

test('un texto que menciona ❯ dentro de una respuesta no cuenta como prompt', () => {
  assert.strictEqual(tareaTerminada(['╭─ ⚕ Hermes ─╮', 'usá la flecha ❯ para avanzar', '╰─╯'], 'entrenador'), true)
})
