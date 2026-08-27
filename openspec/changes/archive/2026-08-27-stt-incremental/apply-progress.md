# Apply Progress: stt-incremental

Fecha: 2026-08-26
Estado: remediation — CRITICAL live-path fix applied
Branch / worktree: `feat/stt-incremental` / `.worktrees/stt-incremental/`

## Resumen

Implementado el STT incremental (paso 2 del realtime): transcripción parcial
(`parcial:true`) mientras se graba, con el turno final inalterado.

**Remediación (post-verify FAIL):** `deberiaProcesar` ya no exige
`st.buffer.length > 0`. El parcial se procesa con sesión activa (`st`) y
`st.processing === false`, porque en continuo/PTT el parcial es el primer audio
de la captura.

## Cambios

| Archivo | Cambio |
|---|---|
| `daemon/parcial.js` (nuevo) | Lógica pura: `deberiaProcesar`, `procesarParcial`, `tieneCabeceraWebm`. Dependencias inyectadas para testeabilidad. |
| `daemon/parcial.js` (remediation) | `deberiaProcesar`: sesión activa + `!processing`; sin gate de buffer. |
| `daemon/test-parcial.test.js` (nuevo) | Tests de parcial (RED/GREEN original). |
| `daemon/test-parcial.test.js` (remediation) | Contrato correcto: buffer vacío + sesión activa → procesa; `processing=true` / `st=null` → ignora; eliminado el test “buffer vacío se ignora”. |
| `daemon/server.js` | Rama `parcial:true` en el handler de `audio`: resuelve con `procesarParcial` y emite `transcripcion parcial:true`. `audio-end` y `st.buffer` intactos. Comentario alineado al contrato. |
| `app/ui/lib/parcial.js` (nuevo) | Módulo puro: `debeEnviarParcial`, `construirParcial` (blob acumulado → b64 → mensaje WS). Patrón de `vad.js`. |
| `app/ui/lib/test-parcial.test.js` (nuevo) | 6 tests: umbral de bytes, WS cerrado/sin carga, mensaje parcial correcto, null sin data. |
| `app/ui/index.html` | Script tag de parcial.js; `parcialTimer` ~2s en modo continuo y push-to-talk; limpieza en `pararContinuo`/`pararMic`/`onstop`. `audio-end` intacto. |
| `test-ui-e2e.js` | Bloque 7b: integración `construirParcial` con webm real (arma mensaje parcial/bytes; null sin chunks). |
| `openspec/.../spec.md` (remediation) | Scenario R1: GIVEN sesión activa / sin turno; scenario “sin sesión o turno en curso” (ya no “sin buffer”). |

## Evidencia de TDD

### TDD Cycle Evidence

| Cycle | Phase | File(s) | Tests | Result | Notes |
|---|---|---|---|---|---|
| Original apply | RED | `daemon/test-parcial.test.js`, `app/ui/lib/test-parcial.test.js` | modules missing | fail | Modules did not exist |
| Original apply | GREEN | `daemon/parcial.js`, `app/ui/lib/parcial.js`, `server.js`, `index.html` | daemon 389, UI lib 18 | pass | Masked live empty-buffer path |
| Remediation | RED | `daemon/test-parcial.test.js` | 13 tests | **5 fail / 8 pass** | Empty-buffer + processing contract vs old buffer gate |
| Remediation | GREEN | `daemon/parcial.js` | focused 13/13 | pass | Session + !processing; no buffer requirement |
| Remediation | GREEN suites | full | daemon **391**/391, UI lib **18**/18 | pass | +2 tests vs prior 389 (13 parcial tests; net +2 vs old 11) |

- RED (remediation): `cd daemon && node --test test-parcial.test.js` → fail 5 (empty buffer must process; processing=true must ignore with seeded buffer).
- GREEN (remediation): same focused file → 13/13; full daemon `node --test` → 391/391; `cd app && node --test ui/lib/*.test.js` → 18/18.
- Regresión previa: smoke backend 21/21 contra daemon del worktree.
- E2E WS real (apply original): `{parcial:true, text:"Gracias.", turnId:0}` seguido de
  `{parcial:false, text:"Gracias.", turnId:1}` — re-verify should confirm empty-buffer path.

## Tasks completadas

T1–T13. Todas las casillas `[x]` en `tasks.md`.

Persisted checkbox updates this remediation: none new (no new task rows); contract
fix documented in spec + tests + this progress file.

## Remaining / parent lifecycle

- DoD checkboxes in `tasks.md` still `- [ ]` until re-verify confirms live WS
  `transcripcion parcial:true` during captura.
- Parent owns: re-verify, commit/PR gates (gentle-pi commit gate is out of scope).

## Riesgos / notas

- El e2e completo de Electron (`test-ui-e2e.js`) no se ejecutó (CDP no levantado),
  pero el bloque 7b se agregó y el comportamiento de parcial se validó por WS
  real contra el daemon del worktree (apply original; re-verify pending).
- El daemon se relanzó desde el worktree para cargar los cambios (el de main
  worktree era una instancia previa). Hubo que `npm install` deps en el worktree
  (node_modules es gitignored).
- Se mató el daemon del main worktree para arrancar el del worktree; al limpiar,
  conviene reinstalarlo/relanzarlo según el flujo normal.
- Unit tests now match the UI empty-buffer protocol; full capture→WS e2e still
  not automated in this remediation batch.

## Structured status consumed

| Field | Value |
|---|---|
| Parent native status (repo root) | `changeName: null`, `applyState: blocked` — root has no openspec change |
| Authoritative change location | `.worktrees/stt-incremental/openspec/changes/stt-incremental/` |
| actionContext | Parent authorized remediation edits in worktree |
| Workload / PR | Decision needed: No; Chained: No; 400-line risk: Low — single-PR slice |
| next_recommended | `parent-lifecycle` → re-verify |
