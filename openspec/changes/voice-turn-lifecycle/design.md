# Design: Voice turn lifecycle (barge-in + task fencing/cancellation)

## Technical Approach

Three independent mechanisms, deliberately decoupled so the riskiest one does not gate the others:

1. **Client reflex** (`app/ui/index.html`) — barge-in is local: stop audio, bump the turn counter, reopen the mic. No round-trip, no job, no model.
2. **Fence at the delivery boundary** (`daemon/server.js`) — one gate inside `broadcastSession`, keyed by job state. Structural: every delegation path funnels through it, so a future fifth path is fenced by default.
3. **Real kill per path** (`daemon/procesos.js`, `daemon/orca.js`) — layered in only where a mechanism is verified, and reported honestly where it is not.

Delegation paths affected: **Orca worker (PRIMARY)**, **headless Hermes CLI (FALLBACK)**, **`/v1/runs` (LAST)**, and **Pi**.

## Live delegation topology (corrects the proposal)

| Path | Entry | Registered today | Killable after this change | Honest outcome |
|---|---|---|---|---|
| Orca worker | `gestorWorker.delegar` (`connector.js:632`) | No | Only if measurement **M1** passes | `cancelada` if M1 passes, else `detenida` |
| Hermes CLI | `delegarHermesCli` (`connector.js:639`) | **Yes** (`:831`/`:846`, throws `cancelada` at `:839`) | Yes, already | `cancelada` |
| Hermes API | `delegarHermesApi` (`connector.js:641`) | No | No — the run lives on `:8642`; we only stop polling | `detenida` |
| Pi | `delegarPi` (`connector.js:646`, `:911-925`) | No | Yes — swap `execFileAsync` for a child + `procesosDelegacion.registrar` | `cancelada` |
| `delegarOrca` | `connector.js:648`, `:927-952` | — | **Unreachable** (`AGENTES_DISPONIBLES = ['hermes','pi']`, `:172`) | see D8 |

Fencing covers **all four live paths**; killability is per path and is never implied by fencing.

## Architecture Decisions

### D1 — Fence gate lives in `broadcastSession`, keyed by job state

**Choice**: `broadcastSession` (`server.js:197-203`) drops `speech.frase` and `respuesta` messages whose `payload.jobId` names a job in `fenced`/`discarded`. An advisory pre-check before `ttsOmlxStreaming` (`:266`, `:282`) saves synthesis cost but is never the authority.
**Alternatives**: per-path checks inside each `delegar*` function (rejected: enumerated, so a fifth path is silently exempt); a fence check only in `ejecutarDelegacionDiferida` (rejected: misses the wait-notice `speech.frase` at `:267`).
**Rationale**: all four paths funnel through `delegarAgenente` → `ejecutarDelegacionDiferida` → `lanzarDelegacion`, whose only user-facing emissions go through `broadcastSession`. Coverage is structural over *paths*. **Tradeoff, stated honestly**: it is enumerated over *message types* — a future message type that speaks must be added to the gated set. That set is two entries and lives beside the gate.
**Not covered**: a jointless turn (a plain answer with no job). That is the client reflex's job by design (D4) — the constraint is zero round-trip.

### D2 — Fence state lives in `jobs.js`, not a separate registry

**Choice**: no `RegistroFences`. `fenced` is a job state; the gate reads `delegaciones.obtener(jobId)`.
**Alternatives**: the exploration's separate in-memory fence-flag registry (rejected: duplicates state `jobs.js` already persists, diverges on daemon restart, and would need its own `delegation.status` broadcast to reach the UI).
**Rationale**: `jobs.js` is already persisted, per-session keyed, reconciled on restart, and already broadcast to the card UI. One source of truth.

### D3 — New job states and their relation to `ESTADOS_TERMINALES`

| State | Terminal? | Meaning | Effect on `reconciliarJobs` / `podarJobs` |
|---|---|---|---|
| `fenced` | **No** | Work still running; result may never be spoken | Stays in `vivos()`; a restart correctly closes it as `interrupted`; never pruned |
| `resumed` | No | Fence lifted; the pending result regains the right to speak | Same as `running` |
| `discarded` | **Yes** (added to `ESTADOS_TERMINALES`) | Fenced work that finished; `resultado` retained as thread context, never spoken | Prunable; idempotent under reconciliation |

**Rationale**: `fenced` must be non-terminal or the system resumes lying — a terminal `fenced` would claim the work ended. `discarded` is the only terminal outcome a fenced job may reach through its own completion.
**Replaces**: the binary `e.cancelada` signal (`connector.js:684`, `server.js:290`) stays, but only for real cancellation; it is no longer the sole "stay silent" mechanism.

### D4 — Barge-in in continuous mode needs the mic open during playback

**Verified blocker not in the exploration**: `speech.frase` calls `pararContinuo()` (`index.html:927`), which **releases the microphone stream** (`:1198`). In continuous mode the mic is off while Hermes speaks, so `bargeIn()` could not fire even if the `modo==='cont'` guard at `:1225` were removed.
**Choice**: while audio is playing, keep `contStream` and the `AudioContext` analyser alive in a **monitor-only** loop (no `MediaRecorder`, no partials, no STT) that fires barge-in on **sustained** voice (`>= minVozMs` of consecutive frames above threshold), then `detenerAudio()` + `audioTurnoActual += 1` + `syncContinuo()`.
**Alternatives**: reuse `DetectorVoz` unchanged with a single-frame trigger (rejected — an isolated 0.115 spike was measured at audio start and would self-trigger); rely on browser AEC alone (rejected — the 600/1200 ms anti-feedback cooldown at `:963` exists precisely because self-echo was observed).
**Open measurement M2**: the barge-in threshold during playback must be measured on the real speaker/mic pair, exactly as `vad.js:14-16` records its 0.02. Until measured, the monitor ships **disabled by default** behind a flag rather than shipping a self-triggering guess.

### D5 — "Do nothing" must be an explicit outcome, not an empty one

**Verified blocker**: an empty layer turn is not silence today. `turnoVacio` (`connector.js:1093-1111`) treats it as a failure and forces a delegate-or-`NADA` rescue, and `:1133` falls back to speaking `'No entendí, señor.'`.
**Choice**: `procesarTurno` returns `{ silencio: true, text: '' }` for the do-nothing branch; the rescue is skipped when that branch is selected, and the caller emits neither `speech.frase` nor `respuesta`.
**Alternatives**: let empty content mean silence (rejected: indistinguishable from the real empty-turn defect that the rescue was built to fix — that defect is documented in the code and must keep working).

### D6 — Three-way honesty contract, with a code-owned claim clause

```js
// { resultado, jobId, via, detalle }
resultado: 'cancelada' | 'detenida' | 'no-cancelable'
via:       'proceso' | 'interrupt' | 'fence' | 'ninguno'
```

| `resultado` | Claim clause (code-owned, Spanish, injected verbatim) |
|---|---|
| `cancelada` | `Cortado de verdad, señor.` |
| `detenida` | `Dejé de esperarlo, señor; puede que el agente ya haya hecho parte del trabajo.` |
| `no-cancelable` | `No puedo cortar esa tarea, señor; sigue corriendo y le avisaré cuando vuelva.` |

**Choice**: the layer receives the enum and **must include the mapped clause verbatim**; it may add surrounding context, never restate the claim.
**Alternatives**: describe the enum in the prompt and let the model phrase it (rejected: the failure being fixed *is* the system overclaiming, and `capa.js:21-49` records that prompt rules alone did not hold — gemma4 kept answering "lo tengo anotado" without delegating).

### D7 — Single-active-session enforced at WS message acceptance

**Choice**: reject in `wss.on('message')` (`server.js:307+`) before any turn starts, for `audio-end` and `text`, when another session owns the live turn/jobs. Reuse the existing shape at `:377`: `{ type:'error', payload:{ error, code:'session_busy' } }` — the UI already renders `type:'error'`.
**Alternatives**: keep the worker-layer eviction (rejected: silent and lossy); queue the second session (rejected: hides the constraint and inherits `GestorWorker.cola`'s global serialization).
**Rationale**: an explicit rejection is the only variant the losing session can see. `GestorWorker._asegurar`'s cross-session close (`worker.js:120-130`) stays for *sequential* session switches, which are legitimate; the gate makes the concurrent race unreachable.
**Exit criterion / seam**: when fence/cancel/resume/discard are proven for 1:1, the gate is removed and `GestorWorker.actual` **and `GestorWorker.cola`** become `Map<sesionId, …>`. Generalizing `actual` alone leaves one global queue serializing every session's delegations — a bottleneck multi-session never asked for. `jobs.js`, `procesos.js` and `broadcastSession` are already N-ready.

### D8 — Dead code: guard, do not wire, do not delete

`delegarOrca` (`:927-952`) and `delegarHermesSesion` (`:852-855`, drops the 6th `sesionId` arg) are unreachable. **Choice**: guard — `delegarOrca` throws `Agente no soportado` before doing any work, and both get a comment naming the missing `sesionId` registration. **Alternatives**: wire them into the lifecycle (rejected: builds and tests a path no user can reach); delete (rejected: out of this change's scope, and deletion is a separate reviewable decision). Guarding costs two lines and makes the trap loud if resurrected.

### D9 — Slice 0 harness: hybrid (live baseline, replay regression)

| Mode | Runs | Purpose | Blind to |
|---|---|---|---|
| `--live` | manual, at decision points; N repeats per turn | records the baseline and exposes nondeterminism | nothing (costly) |
| `--replay` | every `node --test` run | regression guard on the pure classifier over recorded responses | model/provider drift |

**Choice**: both. Live runs produce a dated baseline; replay is the CI guard.
**Alternatives**: live-only (rejected: non-deterministic and costly on every test run — the suite is 404 tests); replay-only (rejected: blind to exactly the drift the harness exists to catch, and `capa.js`'s history is a history of model drift).
**Drift mitigation**: a fresh `--live` baseline is **required** before any change to `VOICE_PROMPT`, the tool set, or the capa provider/model — the same discipline `capa.js:21-49` applied by hand, now automated.
**Measured**: per-branch accuracy (respond / delegate / cancel / do-nothing) over a labelled turn set; repair count (`capa.reintento` + `capa.rescate`); tool-call format validity; TTFB p50/p90.
**Regression** = any branch's accuracy below its baseline minus tolerance, **or** any increase in repairs. Both are hard gates; TTFB is reported, not gating.

### D10 — Tool shape: chosen by data, not by argument

| Candidate | Shape | Tools total |
|---|---|---|
| A | `delegar_a_orca` + `gestionar_tarea{accion: cancelar\|retomar\|descartar}` | 2 |
| B | `delegar_a_orca` + `cancelar_tarea` + `retomar_tarea` + `descartar_tarea` | 4 |
| C | one tool: `delegar_a_orca{accion: delegar\|cancelar\|retomar\|descartar}` | 1 |

**Turn set**: the same labelled set D9 defines, extended with lifecycle turns and — critically — the existing delegate/answer turns unchanged, so a lifecycle gain that costs delegation accuracy is visible.
**Decision rule, in priority order**: (1) no regression in the **existing** delegate/answer baseline; (2) highest lifecycle-branch accuracy; (3) fewest repairs; (4) lowest TTFB p90. A candidate failing (1) is eliminated regardless of (2).
**If every candidate fails (1)**: no shape ships. Lifecycle operations fall back to a non-model path (explicit UI action) and the model keeps one tool — an honest degradation rather than a degraded router. `openspec/config.yaml` warns that small models degrade fast as tools multiply; this rule makes that warning falsifiable instead of decorative.
**This design deliberately names no winner.** The measurement has not been run.

## Measurements not yet run (gates, not assumptions)

**M1 — Orca `--interrupt` against a live Hermes REPL** (gates the Slice 3 Orca path):

1. `orca terminal create --command hermes` (the shape `comandoWorker` produces); wait for the prompt via `tareaTerminada`.
2. Send a request that runs ≥60 s. After ~10 s: `orca terminal send --terminal <handle> --interrupt`.
3. Assert, in order: (a) `terminal read --screen` still answers → terminal alive; (b) `tareaTerminada` true within 10 s → the turn stopped; (c) a following `enviar(handle, …)` produces a new store row under the same `agentSessionId` → REPL usable and thread intact; (d) no final assistant row appears for the interrupted turn → it really stopped, rather than continuing.

| Result | Slice 3 Orca path | Reported outcome |
|---|---|---|
| a+b+c+d pass | `orca.interrumpir(handle)` ships | `cancelada` |
| a+b pass, c fails (REPL wedged) | fence only | `detenida` |
| a fails (terminal dies) | fence only | `detenida` |

Kill-and-recreate is **not** adopted as the fallback: PR #2 (`de5f8c3`) fixed worker churn that was killing the REPL on every `activate`, and `precalentar` deliberately no longer evicts (`worker.js:204-219`). Recreation stays an explicit, user-requested last resort after a `detenida`.

**M2 — barge-in threshold during playback** (gates D4's default-on). Record in `openspec/changes/voice-turn-lifecycle/mediciones.md` before the dependent slice starts.

## Data Flow

Cancel across all four layers:

```
UI            daemon/server.js        connector.js         GestorWorker/orca      Hermes store
 |                   |                     |                      |                     |
 |-- voz "cortalo" ->|                     |                      |                     |
 |                   |-- procesarTurno --->| (live-task context injected, not a tool)   |
 |                   |                     |-- lifecycle op ----->|                     |
 |                   |                     |   (M1 pass: --interrupt / else: fence)     |
 |                   |<-- {resultado,via}--|                      |                     |
 |                   |-- job: fenced ----->  jobs.js (persisted, broadcast as card state)
 |<- respuesta with code-owned claim clause |                      |                     |
 |                   |                     |                      |--- late answer ---->|
 |                   |  broadcastSession gate: job fenced -> speech.frase/respuesta DROPPED
 |                   |-- job: discarded (resultado kept as thread context, never spoken)
```

Barge-in (no daemon involvement, by design):

```
mic monitor (sustained voice) -> detenerAudio() -> audioTurnoActual+1 -> descartarCola() -> syncContinuo()
```

## File Changes

| File | Action | Description |
|---|---|---|
| `daemon/jobs.js` | Modify | Add `fenced`/`resumed`/`discarded`; `discarded` joins `ESTADOS_TERMINALES` |
| `daemon/server.js` | Modify | Fence gate in `broadcastSession`; `session_busy` rejection; wait-notice user-activity check in `lanzarDelegacion`'s `latido` |
| `daemon/connector.js` | Modify | Live-task context injection into `apiMessages` (`:1048`); `silencio` branch; lifecycle op dispatch; `delegarPi` child registration; `delegarOrca` guard |
| `daemon/procesos.js` | Modify | Accept the Pi child; no API change to `cancelar`/`fueCancelado` |
| `daemon/orca.js` | Modify | `interrumpir(handle)` — **only if M1 passes** |
| `daemon/espera.js` | Unchanged | Stays pure; the user-activity check lives at the caller |
| `daemon/lifecycle.js` | Create | Enum → claim-clause map, outcome shape, per-path capability table |
| `daemon/bench/arbol.js` | Create | Harness runner (`--live` / `--replay`) |
| `daemon/bench/turnos.json` | Create | Labelled turn set |
| `daemon/bench/baseline-*.json` | Create | Dated baselines, recorded before any prompt change |
| `app/ui/index.html` | Modify | Playback mic monitor; remove the `modo==='cont'` barge-in guard (`:1225`); `audioTurnoActual` bump in `detenerAudio()` |
| `app/ui/lib/vad.js` | Modify | Sustained-voice helper for barge-in (separate from capture close) |

## Testing Strategy

| Layer | What | Approach |
|---|---|---|
| Unit | job state transitions; `reconciliarJobs`/`podarJobs` with `fenced`+`discarded`; enum → claim clause; sustained-voice detector | `node --test`, pure functions, no I/O |
| Unit | fence gate: `speech.frase`/`respuesta` dropped for a fenced job, `delegation.status` still delivered | fake `clients` map, as existing `server` tests do |
| Integration | each of the four paths: fenced result never broadcast after completion | injected fake `orca`/`execFile`, per `GestorWorker`'s existing injection seam |
| Integration | `session_busy` rejection; the active session's worker survives | two fake WS clients |
| Replay | decision-tree regression over recorded responses | `daemon/test-arbol.test.js` |
| Manual (gates) | **M1** Orca interrupt, **M2** barge-in threshold | recorded in `mediciones.md` before dependent slices |

All tests are written RED first (strict TDD, `openspec/config.yaml` `rules.apply.tdd`).

## Threat Matrix

| Boundary | Applicability | Design response | Planned RED tests |
|---|---|---|---|
| Documentation-like paths | N/A — no file classification or execution of repo content | — | — |
| Git repository selection | N/A — no VCS automation in this change | — | — |
| Commit state | N/A | — | — |
| Push state | N/A | — | — |
| PR commands | N/A | — | — |
| **Subprocess argument composition** (added — `orca terminal send --interrupt`, `execFile('pi', …)`) | **Applicable** | Fixed argv arrays only, never a shell string; the handle must match `RE_HANDLE` (`worker.js:25`) before reaching argv; `pedido` never interpolated into a command | `interrumpir` rejects a non-`term_` handle; Pi args stay an array with the request as one element |
| **Process kill attribution** (added) | **Applicable** | `RegistroProcesos.cancelados` already distinguishes a deliberate SIGTERM from an `execFile` timeout (`procesos.js:8-20`); the Pi path must set it, or a 120 s timeout is reported as `cancelada` | a timed-out Pi delegation reports `timed_out`, never `cancelada` |

## Migration / Rollout

No data migration. Existing job records lack the new states and reconcile unchanged. Slice order: 0 (harness baseline, unreconstructable later) → 1 (client reflex) → 2 (fence) → 5 (session gate, independent) → 3 (real kill, gated on M1) → 4 (lifecycle ops, gated on Slice 0 + D10). Slices 1 and 3's Orca half ship behind flags until M2 and M1 are recorded.

## Open Questions

- [ ] **M1** Orca `--interrupt` against a live Hermes REPL — unrun; gates the Slice 3 Orca path and its reported outcome.
- [ ] **M2** barge-in energy threshold during playback on the real speaker/mic pair — unrun; gates D4 defaulting to on.
- [ ] **D10** tool shape — deliberately undecided; the winner comes from Slice 0's data under the stated rule.
- [ ] Does a `retomar` on an already-`discarded` job re-speak the retained result, or only surface it as text? Leaning text-only (re-speaking a stale answer is the same class of defect), to confirm in tasks.
