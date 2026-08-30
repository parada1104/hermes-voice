/**
 * Decisión pura de qué hacer en el mousedown del botón de mic.
 *
 * El barge-in manual (bargeIn()) tiene que ser alcanzable en CUALQUIER modo
 * (design.md D4) — el mousedown ya no vuelve antes de llamarlo. Pero
 * arrancar una captura push-to-talk (getUserMedia + MediaRecorder) SOLO
 * tiene sentido en modo 'ptt': en modo continuo el mic YA está grabando
 * (arrancarContinuo()), y una segunda captura no tiene quien la pare —
 * mouseup/mouseleave en index.html solo liberan en modo 'ptt' — así que
 * quedaría viva hasta el timeout duro de 120s sin que nada la corte antes.
 *
 * Módulo puro (mismo patrón que vad.js/parcial.js/turno-audio.js): index.html
 * lo carga con <script src> y lo usa en el handler de mousedown; los tests
 * lo importan con require. Es la única guarda entre "un click interrumpe" y
 * "dos getUserMedia vivos a la vez", así que se pinea con test en vez de
 * quedar verificable solo a mano.
 */
'use strict'

function debeArrancarCapturaPtt(modo) {
  return modo === 'ptt'
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { debeArrancarCapturaPtt }
}
