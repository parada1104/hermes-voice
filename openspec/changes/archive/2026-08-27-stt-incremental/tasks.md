# Tasks: stt-incremental

Depth: standard

Branch / worktree: `feat/stt-incremental` / `.worktrees/stt-incremental/`

Plan refs: `explore.md`, `proposal.md`, `design.md`, `specs/stt-incremental/spec.md`

**Stop for human authorization before production-code apply.** This file is the
implementation plan only — do not write production code or tests while authoring
it.

---

## Locked delivery decisions (human)

| Decision | Value |
|---|---|
| Preflight ejecución | **auto** (gatekeeper entre fases) |
| Artifact store | **hybrid** (openspec/ + memoria; Engram caído → openspec/ es la fuente) |
| Delivery strategy | **ask-on-risk** — se pregunta solo si el forecast supera el presupuesto |
| Presupuesto de revisión | **1200 líneas** |
| Alcance del slice | UI envío parcial ~2s + server emite `parcial:true` + tests; `audio-end` y turno final intactos |

## Preconditions

- `test-backend.js` (daemon :8471) y `test-ui-e2e.js` (Electron+CDP :9222) son
  las suites del proyecto: daemon 378/378, app 12/12 verdes hoy.
- El daemon corre en `:8471`; oMLX STT/TTS en `:8000` local (batch whisper).
- Tests unitarios del daemon viven en `daemon/test-*.test.js` (`node:test`).
- **TDD estricto** activo (`openspec/config.yaml`): test primero (RED), luego
  implementación (GREEN), luego refactor.

---

## Unidad 1 — Server: rama `parcial:true` en el handler de `audio`

Comportamiento: al recibir `{type:'audio', data, mime, parcial:true}` con
captura activa y blob válido, transcribir con `sttOmlx` y emitir
`transcripcion parcial:true`; nunca tocar `st.buffer` ni `processing`; sin
captura activa o blob inválido → ignorar silenciosamente. `audio-end` intacto.

### Tasks

- [x] **T1. TDD RED**: escribir el test unitario del handler WS que envía
  `audio parcial:true` con un blob webm con cabecera válida y verifica que:
  - emite `transcripcion` con `parcial:true`,
  - no inicia turno ni toca `processing`,
  - no acumula en `st.buffer` (el `audio-end` posterior usa solo sus chunks).
  El test falla con el código actual (el handler ignora `parcial`).
- [x] **T2. Implementar**: en `daemon/server.js`, rama `audio` del
  `ws.on('message')`:
  - si `msg.parcial === true`:
    - si `st.processing` → ignorar (parcial no pisa un turno en curso),
    - si no hay captura activa (buffer vacío y sin audio previo pendiente) →
      ignorar,
    - si webm y `!tieneCabeceraWebm(chunk)` → ignorar,
    - else: `const texto = await sttOmlx(chunk, msg.mime)` y
      `sendTo(ws, {type:'transcripcion', payload:{sesionId: st.sesion,
      text: texto, parcial:true}})`; envolver en try/catch que loguee y
      descarte el parcial.
  - si no es parcial → comportamiento actual (push a `st.buffer`).
- [x] **T3. TDD GREEN + refactor**: correr el test hasta verde; refactor si hace
  falta (extraer helper `esParcialCapacitado(st, msg, chunk)` si crece).
- [x] **T4. Test: sin captura activa** — el parcial sin audio previo se ignora
  sin emitir `transcripcion` ni cambiar estado.
- [x] **T5. Test: blob webm inválido** — el parcial con blob sin cabecera EBML
  se descarta (mismo filtro que el final).
- [x] **T6. Test: `audio-end` sin cambios** — con y sin parciales previos, el
  texto final es el del blob completo y el turno arranca igual.

## Unidad 2 — UI: envío de parciales ~2s durante la captura

Comportamiento: mientras el recorder está `recording` y hay voz/chunks
acumulados, un timer ~2s envía `{type:'audio', data:b64, mime, parcial:true}`
con el blob concatenado; sin voz acumulada no envía nada; `pararContinuo`/
`pararMic` limpian el timer; el `onstop`/`audio-end` queda exactamente como hoy.

### Tasks

- [x] **T7. TDD RED**: test del envío de parcial en la UI (injectar recorder
  fake + blob fake):
  - con chunks acumulados y recorder `recording`, al pasar el intervalo envía
    `audio parcial:true` con el blob completo,
  - sin chunks acumulados no envía nada,
  - `pararContinuo()` cancela el timer (no se envía nada después).
- [x] **T8. Implementar**: en `app/ui/index.html`:
  - función `enviarParcial(recorder, chunks, opts)` que si
    `recorder.state==='recording'`, arma `new Blob(chunks)`, y si
    `ab.length >= 1024` y `ws.readyState===1`, envía
    `JSON.stringify({type:'audio', data:bufToB64(ab),
    mime: opts.mimeType||'audio/webm', parcial:true, sessionId, agent,
    profile, agentSessionId, agentModel})`;
  - timer `parcialTimer` de ~2000ms creado en `arrancarContinuo()` y en el
    manejo push-to-talk (mousedown); callback re-ejecuta mientras el recorder
    siga grabando;
  - limpiar `parcialTimer` en `pararContinuo()`, `pararMic()`, `onstop` y al
    recibir `speech.frase`/`cancelled`/`error`.
- [x] **T9. TDD GREEN + refactor**: test a verde; asegurar que los parciales NO
  se acumulan en `recChunks` (el blob parcial es una copia, no altera la
  captura final).
- [x] **T10. Test e2e (con webm real, sin mic)**: `test-ui-e2e.js` — durante el
  flush de mic con webm real, verificar que un `audio parcial:true` sale por el
  WS y que el `audio-end` posterior mantiene el formato actual.

## Unidad 3 — Burbuja en vivo y regresión

Comportamiento: la UI muestra el texto parcial reemplazando la burbuja y lo
reemplaza por el final; sin regresión en el flujo de hoy.

### Tasks

- [x] **T11. UI: manejo de `parcial` en recepción** — si la `transcripcion`
  recibida tiene `parcial: true`, `pushTransc(m.payload.text)` SIN crear
  burbuja nueva (verificar que `inicioTransc` no se llama dos veces); si es
  final, comportamiento actual.
- [x] **T12. Regresión**: correr `test-backend.js` (daemon 378/378) y
  `test-ui-e2e.js` (app 12/12) y confirmar cero regresiones con la suma de
  tests nuevos.
- [x] **T13. Actualizar `test-backend.js` / `test-ui-e2e.js`** conteos y
  resúmenes si el harness los exige (mirar cómo reportan hoy).

---

## Review Workload Forecast

- Files touched: 2 de código (`app/ui/index.html`, `daemon/server.js`) + tests
  (nuevos tests daemon + e2e).
- Líneas estimadas: **< 200** (cambio acotado: rama parcial en server, timer +
  envío en UI, tests pequeños). Muy por debajo del presupuesto de 1200.
- **Chained PRs recommended: No**.
- **400-line budget risk: Low**.
- **Decision needed before apply: No**.
- Delivery: un solo PR a `main` al final del pipeline (vía `git-pr-flow`).

## Definition of Done

- [x] T1–T13 completadas.
- [x] Suites verdes: daemon y app con los tests nuevos.
- [x] Sin cambios en `audio-end`, TTS, captura por silencio ni capa
  conversacional.
- [x] `transcripcion parcial:true` observable en el WS durante una captura con
  voz, y ausente en capturas sin voz.