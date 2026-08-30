# Tasks: Voice turn lifecycle (barge-in + task fencing/cancellation)

Branch / worktree: `sdd/voice-turn-lifecycle` / `.worktrees/voice-turn-lifecycle/`
Refs: `proposal.md`, `design.md` (D1-D12), `specs/voice-turn-lifecycle/spec.md` (6 requirements, 23 scenarios), `mediciones.md`
Test runners: `node --test daemon/test-*.test.js` (404 passing today), `node --test app/ui/lib/*.test.js` (22 passing today)

**M1 UPDATE**: M1 ran 2026-08-28 against a live Hermes REPL (v0.20.5, `deepseek-v4-flash`)
and **PASSED**: terminal alive, turn stopped immediately, REPL usable with thread intact,
only a truncated partial persisted (771 chars of a ~18,000-char request). Slice 3's Orca
kill path is **no longer gated** and ships unconditionally with outcome `cancelada`.
`detenida` stays in the contract, now owned by `delegarHermesApi` (its run genuinely
survives on `:8642`). M1's partial-not-erased finding also surfaced D11 (partial
preservation) and D12 (interrupt must bypass `GestorWorker.cola`) — new tasks below.

**M2/M3 split**: what was one "M2" gate in the earlier draft is now two. **M2** —
decision-tree baseline — still gates Slice 4/D10 only, and still must run FIRST
(unreconstructable after any `VOICE_PROMPT`/tool/model change). **M3** — barge-in energy
threshold during playback — is a distinct audio measurement gating Slice 1's default-on
(D4). Slice 1 now ships flag-off pending **M3**, not M2.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1900-2200 (additions + deletions) |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR, staged as slices 0-5 in commit order |
| Delivery strategy | exception-ok |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

Reviewer note: this deliberately exceeds the 1200-line budget; `size:exception` was
explicitly accepted (proposal.md, Scope). Do not split into chained PRs. Slices below
are commit-order checkpoints inside the one PR, not separate PRs. Forecast raised from
the prior ~1700-2000 estimate: M1 passing adds `GestorWorker.interrumpir` (D12,
`daemon/worker.js`), the `parcial` field and its independence tests (D6/D11), and three
new spec scenarios' worth of coverage, instead of removing work as a failed M1 would have.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 0 | Decision-tree measurement harness + `--live` **M2** baseline | PR 1 (slice 0) | `node --test daemon/test-arbol.test.js` | `node daemon/bench/arbol.js --live` against the current one-tool/two-branch prompt | Delete `daemon/lifecycle.js`, `daemon/bench/*`; no other code touched |
| 1 | Client-side barge-in reflex, mic-lifetime fix, `audioTurnoActual` bump | PR 1 (slice 1) | `node --test app/ui/lib/*.test.js` | **M3** manual: real speaker/mic pair, measure RMS threshold + sustained-frame count during playback | Ship flag OFF pending M3; revert `app/ui/index.html`/`vad.js` diffs |
| 2 | Fence at delivery boundary (`fenced`/`resumed`/`discarded` job states) | PR 1 (slice 2) | `node --test daemon/test-jobs.test.js daemon/test-fence.test.js` | N/A — pure state-machine + broadcast gate, no live agent needed | Revert `jobs.js`/`server.js` gate diff; `cancelled` path untouched |
| 5 | Single-active-session rejection | PR 1 (slice 5) | `node --test daemon/test-session-gate.test.js` | Manual: two WS clients, second `audio-end` while first has a live job | Revert the WS-accept guard in `server.js`; `GestorWorker._asegurar` unchanged |
| 3 | Real kill per path — Orca **ships unconditionally (M1 passed)**, CLI/Pi unconditional, partial preservation (D11) + non-queued interrupt (D12) | PR 1 (slice 3) | `node --test daemon/test-cancelacion.test.js daemon/test-orca.test.js daemon/test-gestor-worker.test.js` | N/A for Orca (M1 already recorded in `mediciones.md`); manual spot-check optional | Revert `orca.js`/`worker.js`/`connector.js` diffs; CLI/Pi kill stands alone |
| 4 | Lifecycle ops (cancel/resume/discard), live-task context, wait-notice gate, `parcial` wiring into `lifecycle.js` | PR 1 (slice 4) | `node --test daemon/test-lifecycle.test.js daemon/test-promesas.test.js daemon/test-espera.test.js` | `node daemon/bench/arbol.js --live` (**M2**, re-run against the chosen tool shape before enabling) | Revert `lifecycle.js` wiring in `connector.js`/`server.js`; tool set falls back to `delegar_a_orca` only |

## Phase 0: Slice 0 — Decision-tree measurement harness (FIRST, unreconstructable)

- [x] 0.1 RED: create `daemon/test-arbol.test.js` asserting `daemon/bench/arbol.js --replay` computes per-branch accuracy (respond/delegate/cancel/do-nothing), repair count, tool-call format validity, TTFB p50/p90 over a fixture turn set — fails (no `arbol.js` yet).
- [x] 0.2 GREEN: create `daemon/bench/arbol.js` (`--live`/`--replay` modes per D9) and `daemon/bench/turnos.json` (labelled turn set covering respond/delegate/cancel/do-nothing branches, plus existing delegate/answer turns unchanged per D10's turn set requirement).
- [x] 0.3 **M2**: run `node daemon/bench/arbol.js --live` against the **current** one-tool/two-branch prompt/tool set (before any prompt/tool/model change) and commit the dated result to `daemon/bench/baseline-<date>.json`. Record status in `mediciones.md`. Unreconstructable after Slice 4 changes `VOICE_PROMPT` — must run before 5.x starts. **DONE 2026-08-29**: key provisioned from `~/.hermes/.env` into the gitignored `.env`; `arbol.js` gained a `.env` loader since the bench runs outside the daemon's direnv context. Baseline at `daemon/bench/baseline-2026-08-29.json`: responder 4/4, delegar 7/7, cancelar 0/3, nada 0/3, 2 repairs, format 100%, TTFB p50 2186ms / p90 6991ms. The two zeros are the point — empirical proof neither branch is reachable yet. Reproduces `capa.js`'s hand-taken 7/7 delegación exactly. Slice 4 is unblocked.
- [x] 0.4 REFACTOR: extract the pure classifier (branch scoring, regression comparison against baseline minus tolerance) so `--replay` runs deterministically in CI without network calls.
- [x] 0.5 `mediciones.md` already records M1 as RUN/PASS (2026-08-28); confirm M2 (0.3) and M3 (Phase 1) sections stay accurate as their tasks complete — no separate file creation needed, it exists. Confirmed: both sections still correctly read NOT RUN (M2 could not be run this session — see 0.3 blocker; M3 untouched, Phase 1 not started).

## Phase 1: Slice 1 — Client-side "callar" reflex (flag-gated on **M3**, not M2)

- [x] 1.1 RED: in `app/ui/lib/test-vad.test.js`, add a sustained-voice-for-barge-in test: a single 0.115 RMS frame does NOT trigger; consecutive frames totaling `>= minVozMs` (300ms) DO trigger — fails (no such helper in `vad.js`).
- [x] 1.2 GREEN: add a sustained-voice helper to `app/ui/lib/vad.js`, separate from `DetectorVoz.procesar`'s capture-close semantics (it must fire on sustained voice immediately, not wait for silence). **Done**: `MonitorVozSostenida` class.
- [x] 1.3 RED: add a test (new `app/ui/lib/test-bargein.test.js` or extend `test-vad.test.js`) for the play-guard regression: given `audioTurnoActual` bumped mid-turn, a phrase queued for the old turn is discarded, never played (mirrors `playWav`'s `t<audioTurnoActual` guard at `index.html:1031`) — fails today since `detenerAudio()` never bumps the counter. **Done**: `app/ui/lib/test-bargein.test.js`, against a new pure module `app/ui/lib/turno-audio.js` (same extraction pattern as `parcial.js`) so the guard is testable without DOM.
- [x] 1.4 GREEN: in `app/ui/index.html`, bump `audioTurnoActual` inside `detenerAudio()` (`:1039-1043`). **Done**: `detenerAudio()` now calls `siguienteTurno(audioTurnoActual)`; `playWav`/`nextAudio` guards rewired onto `turno-audio.js`'s `turnoVigente`/`esTurnoNuevo` so production and tests share one implementation.
- [x] 1.5 Remove the `if(modo==='cont') return` barge-in guard at `index.html:1225` (mousedown handler) per design D4's file-change list. **Done, corrected after review**: the guard is not simply deleted — it is moved to AFTER `bargeIn()` instead of before it, and its condition inverted to `if(!debeArrancarCapturaPtt(modo)) return` (new pure predicate, `app/ui/lib/mic-boton.js`, pinned by `app/ui/lib/test-mic-boton.test.js`). First pass removed the guard unconditionally, which made `bargeIn()` reachable in continuous mode (intended) but also let a plain mic-button click in continuous mode fall through into the push-to-talk capture flow (`getUserMedia`+`MediaRecorder`) on top of the recorder continuous mode already runs — a second live stream with no release path, since `mouseup`/`mouseleave` only stop it for `modo==='ptt'`; it would have run hot until the 120s hard timeout. Now `bargeIn()` fires in any mode, but the PTT capture only starts when `modo==='ptt'`.
- [x] 1.6 GREEN (mic-lifetime fix, blocker 1): add a playback-time monitor loop that keeps `contStream`/`AudioContext` analyser alive instead of calling `pararContinuo()` (which releases the mic, `:1198`) before `playWav` at `speech.frase` (`:927`). Monitor-only: no `MediaRecorder`, no partials, no STT: on sustained voice it calls `detenerAudio()` + the 1.4 bump, THEN releases/reopens for the next capture. **Done**: `iniciarMonitorBargeIn()`/`pararOMantenerParaBargeIn()`, wired at both mic-release call sites that fire when playback starts (`phase:hablando` and `speech.frase` — the `hablando` phase event releases the mic before `speech.frase` even arrives, so both needed gating, not just the one line cited above). With the flag OFF, `pararOMantenerParaBargeIn()` is byte-for-byte `pararContinuo()`.
- [ ] 1.7 **M3 (manual, blocks default-on)**: on the real speaker/mic pair, measure the RMS threshold and sustained-frame count that separate Robert's voice from Hermes' own TTS bleeding back through the mic, the same way `vad.js:14-16` recorded its 0.02 (silent-room peak 0.00392, voice p50 0.05585). Record the result in `mediciones.md`'s M3 section (currently NOT RUN). **BLOCKED — not run this session**: this is a manual measurement on Robert's real speaker/microphone pair; no agent can produce it. `BARGE_IN_MONITOR_ACTIVO` (1.8) stays `false` until this is recorded.
- [x] 1.8 Gate 1.6 behind a flag defaulting OFF until M3 (1.7) is recorded — **not** M2, which gates Slice 4/D10 only. Document the flag name and default in `app/ui/index.html` beside the monitor code. **Done**: `const BARGE_IN_MONITOR_ACTIVO = false` beside `iniciarMonitorBargeIn()`, with the M3 rationale in a comment.
- [x] 1.9 Regression: `node --test app/ui/lib/*.test.js` stays green; manually verify the existing 600/1200ms anti-feedback cooldown (`:963`) is untouched by the monitor loop. **Done**: 32/32 passing (22 baseline + 10 new); cooldown block at `:963-965` diffed byte-identical to pre-change.

## Phase 2: Slice 2 — Fence at the delivery boundary

- [ ] 2.1 RED: extend `daemon/test-jobs.test.js` — `podarJobs`/`reconciliarJobs` regression for the new enum: `fenced` stays in `vivos()` and is never pruned; a restart reconciles a `fenced` job to `interrupted`; `discarded` is prunable and idempotent under reconciliation; `discarded` is in `ESTADOS_TERMINALES`. Fails against today's enum (`daemon/jobs.js:16`).
- [ ] 2.2 GREEN: in `daemon/jobs.js`, add `fenced` (non-terminal), `resumed` (non-terminal, same effect as `running`), `discarded` (add to `ESTADOS_TERMINALES`).
- [ ] 2.3 RED: create `daemon/test-fence.test.js` — with a fake `clients` map (per existing `server` test style), a `speech.frase`/`respuesta` broadcast for a job in `fenced`/`discarded` state is dropped by `broadcastSession`; `delegation.status` for the same job is still delivered. Fails (no gate yet).
- [ ] 2.4 GREEN: add the gate in `daemon/server.js` `broadcastSession` (`:197-203`), keyed by `delegaciones.obtener(jobId)` per D2 — no new registry.
- [ ] 2.5 RED: integration test (extend `daemon/test-fence.test.js`) — for each of the four live paths (`gestorWorker.delegar`, `delegarHermesCli`, `delegarHermesApi`, `delegarPi`), inject a fake completion after fencing and assert no `speech.frase`/`respuesta` broadcast, using each path's existing injection seam (`GestorWorker`'s fake `orca`/fake `execFile`).
- [ ] 2.6 GREEN: verify 2.4's gate satisfies 2.5 without per-path changes (structural coverage per D1); if a path bypasses `broadcastSession`, fix that path's emission to route through it.
- [ ] 2.7 Test: a late fenced result does not block or contaminate a new unrelated turn (spec scenario "A late result after fencing does not affect a later turn") — add to `daemon/test-fence.test.js`.
- [ ] 2.8 Test: the gate keys only on `payload.jobId` for job-completion deliveries, per D11's two-turn separation — a message with no `jobId` (e.g. a cancel-turn's own `respuesta`) is never subject to the fence gate. Add to `daemon/test-fence.test.js`; this is load-bearing for Phase 4/5's partial-delivery tasks.
- [ ] 2.9 REFACTOR: keep the gated message-type set (`speech.frase`, `respuesta`) as a small named constant beside the gate per D1's stated tradeoff (future message types must be added explicitly).

## Phase 3: Slice 5 — Single-active-session enforcement (independent of Slice 3/4)

- [ ] 3.1 RED: create `daemon/test-session-gate.test.js` — two fake WS clients; session A has a live job; session B's `audio-end`/`text` message is rejected with `{type:'error', payload:{error, code:'session_busy'}}` (reuses shape at `server.js:377`); session A's worker is untouched. Fails today (accidental eviction, no gate).
- [ ] 3.2 GREEN: add the rejection check in `server.js` `wss.on('message')` (`:307+`) for `audio-end` and `text`, before any turn starts, per D7.
- [ ] 3.3 Regression test: legitimate sequential session switches (session A ends, session B starts) still work — `GestorWorker._asegurar`'s cross-session close (`worker.js:120-130`) must be unaffected by the new gate.
- [ ] 3.4 Test: rejection reaches the client via the UI/protocol layer without requiring TTS/speech (spec scenario "Rejection is visible but not required to be spoken").

## Phase 4: Slice 3 — Real kill per path (Orca ships unconditionally — M1 PASSED; CLI/Pi unconditional; D11/D12 partial + non-queued interrupt)

- [ ] 4.1 RED: extend `daemon/test-cancelacion.test.js` — `delegarPi` registers its child process with `procesosDelegacion` (mirrors `delegarHermesCli` at `connector.js:831`/`:846`) so it becomes killable; a killed Pi child reports `cancelada`, a **timed-out** one reports `timed_out` never `cancelada` (threat-matrix: process kill attribution). Fails today (`delegarPi` uses `execFileAsync` with no registration).
- [ ] 4.2 GREEN: in `daemon/connector.js` `delegarPi` (`:911-925`), swap to a registrable child (mirror `delegarHermesCli`'s `execFileAsync(...).child` + `registrar`/`liberar` pattern) and set `procesosDelegacion.registrar`/`liberar`. No API change to `daemon/procesos.js`.
- [ ] 4.3 RED: create `daemon/test-orca.test.js` — `orca.interrumpir(handle)` rejects a non-`term_` handle before composing any argv (threat-matrix: subprocess argument composition), using `esHandle`/`RE_HANDLE` from `worker.js:24-27`. Fails (no `interrumpir` yet).
- [ ] 4.4 GREEN: add `interrumpir(handle)` to `daemon/orca.js`, built on fixed argv `orca terminal send --terminal <handle> --interrupt` (never a shell string). **No flag needed — M1 passed 2026-08-28 (`mediciones.md`); this ships on by default.** Outcome is `cancelada`, the strongest rung of the honesty contract.
- [ ] 4.5 **D12, RED**: extend `daemon/test-gestor-worker.test.js` with a fake `orca` whose `leerPantalla` never settles (mirrors design's Testing Strategy row) — assert `gestorWorker.interrumpir(sesionId)` resolves **while a concurrent `delegar()` call is still mid-poll**, proving it is NOT routed through `_enFila`/`this.cola` (`worker.js:94-99`). Fails today (no `interrumpir` method on `GestorWorker`).
- [ ] 4.6 **D12, GREEN**: add `GestorWorker.interrumpir(sesionId)` to `daemon/worker.js` — calls `orca.interrumpir(handle)` directly (never wrapped in `_enFila`) and sets an abort flag; `_esperarTurno`'s poll loop (`:156-199`) checks the flag on its next tick and returns `{ ...resumenTurno(ultimas), incompleto: true, motivo: 'interrumpido' }` — a third `motivo` beside `repl-libre` (`:182`) and `timeout` (`:195`). `interrumpir` must never create or recreate a terminal (that invariant belongs to the queue it is bypassing).
- [ ] 4.7 **D12 pinning test**: a dedicated regression test in `daemon/test-gestor-worker.test.js` asserting `interrumpir` is not wrapped in `_enFila`, so a later refactor cannot silently reintroduce the queue and deadlock the interrupt behind the delegation it is meant to stop.
- [ ] 4.8 **D11, RED**: extend `daemon/test-store-hermes.test.js` or a new integration test in `daemon/test-gestor-worker.test.js` — with `motivo:'interrumpido'`, `informeParcial(parcial)` (`store-hermes.js:113`) produces the same partial-report shape it already does for `motivo:'timeout'`; confirm no code change is needed there (motivo is interpolated generically) but pin the behavior with an explicit test so Phase 5's cancel wiring can rely on it.
- [ ] 4.9 **D11, integration test**: fake `orca.interrumpir` + fake store — the interrupt returns the partial via `_esperarTurno`'s new `motivo:'interrumpido'` branch, and the rows read so far are preserved (per design's Testing Strategy: "interrupt returns the partial").
- [ ] 4.10 Confirm partial availability per non-Orca path (open question from `design.md`'s Open Questions, verified only for Orca via M1): during this slice, wire `delegarHermesCli`'s SIGTERM path and `delegarPi`'s kill path and **record their actual partial behavior** (plausibly `parcial: null` since a SIGTERM'd child loses stdout and `--print` has no incremental output) rather than assuming either way. Add a test per path asserting the observed behavior, and note the result in `mediciones.md`.
- [ ] 4.11 D8 guard (dead code, do not wire, do not delete): in `daemon/connector.js`, make `delegarOrca` (`:927-952`) throw `Agente no soportado` before doing any work; add a comment on `delegarHermesSesion` (`:852-855`) naming the dropped 6th `sesionId` argument as a latent trap. Add a one-line regression test that `delegarOrca` throws without side effects.

## Phase 5: Slice 4 — Lifecycle operations, live-task context, silence, wait-notice, `parcial` wiring (gated on M2 + D10)

- [ ] 5.1 Prerequisite check: confirm Slice 0's `--live` **M2** baseline (0.3) is recorded before touching `VOICE_PROMPT` or the tool set — per D9's drift-mitigation rule. Do not proceed if missing.
- [ ] 5.2 RED: create `daemon/test-lifecycle.test.js` — enum → claim-clause mapping is exhaustive and verbatim (`cancelada`→`Cortado de verdad, señor.`, `detenida`→`Dejé de esperarlo...`, `no-cancelable`→`No puedo cortar esa tarea...`) per D6; the layer must include the mapped clause, never restate it. Fails (no `daemon/lifecycle.js` yet).
- [ ] 5.3 GREEN: create `daemon/lifecycle.js` — enum → claim-clause map, `{resultado, via, jobId, parcial, detalle}` outcome shape (D6, `parcial: null | {texto, herramientas, avances}` as an explicit field on the shape), per-path capability table (Orca `cancelada` unconditional, CLI `cancelada`, API `detenida`, Pi `cancelada` from the Live delegation topology table).
- [ ] 5.4 **RED**: `daemon/test-lifecycle.test.js` — "`resultado` is computed without reading `parcial`": building the outcome for a non-killable path (e.g. `delegarHermesApi` → `detenida`) with a partial present still reports `detenida`, never upgraded to `cancelada`. Fails until 5.3's shape strictly separates the two computations.
- [ ] 5.5 GREEN: ensure `daemon/lifecycle.js`'s `resultado`-computing code path never reads `parcial` (separate functions/inputs, per D6/D11 — "the claim clause alone is not the safeguard, the shape is").
- [ ] 5.6 Test: when no partial exists, `parcial` is `null` and nothing is invented — `informeParcial` already returns falsy on an empty turn (`store-hermes.js:114`), so this is the existing code path, not a new branch (D11 guard). Add to `daemon/test-lifecycle.test.js`.
- [ ] 5.7 Test (D11 two-turn separation, spec scenario "Fencing still holds even when a partial is surfaced via cancel"): a turn is fenced, its delegation is cancelled producing a partial; assert the partial is delivered ONLY via the cancel operation's own result (no completing `jobId`, per Phase 2.8), and the fenced turn's `speech.frase`/`respuesta` for its own `jobId` stays dropped. Add to `daemon/test-lifecycle.test.js`.
- [ ] 5.8 Test (spec scenario "A cancel that produces a partial surfaces it to the user"): cancel wiring renders the partial through `informeParcial` and presents it as the cancel turn's own result, without upgrading the reported outcome.
- [ ] 5.9 Test (spec scenario "A cancel with no partial available invents nothing"): cancel on a path/turn with no captured output reports the outcome with no partial content and no filler.
- [ ] 5.10 **M2 re-run**: `node daemon/bench/arbol.js --live` with lifecycle turns added to `turnos.json`, scoring candidates A/B/C from D10 by: (1) no regression vs 0.3's existing delegate/answer baseline, (2) highest lifecycle-branch accuracy, (3) fewest repairs, (4) lowest TTFB p90. If all candidates fail (1), no shape ships — fall back to a non-model UI action for lifecycle ops and keep one tool.
- [ ] 5.11 Record the D10 decision (winning candidate or "no shape ships") in `mediciones.md` before implementing the tool/prompt wiring.
- [ ] 5.12 GREEN: wire the chosen shape into `daemon/connector.js`'s tool set and dispatch cancel/resume/discard to `daemon/lifecycle.js`, calling the per-path kill (Phase 4: Orca `interrumpir`, CLI/Pi process kill) or the `detenida`/`no-cancelable` fallback per D6's honesty contract.
- [ ] 5.13 RED: `daemon/test-promesas.test.js` — add a pure predicate test distinguishing "user's only input was an interruption with no follow-up" (silence, do-nothing) from the existing `turnoVacio` unintelligible-turn case and the `prometeAccion` promised-action case; must not regress the three existing `turnoVacio` tests (`:177-191`).
- [ ] 5.14 GREEN: add the pure predicate (e.g. `esSilencioIntencional`) to `daemon/promesas.js`; wire it into `daemon/connector.js`'s decision branch (`:1093-1137`) so the do-nothing branch skips both the reintento (`:1066-1083`) and rescate (`:1085-1111`) paths and `procesarTurno` returns `{silencio:true, text:''}` (D5) instead of falling through to `'No entendí, señor.'` at `:1133`.
- [ ] 5.15 GREEN: at the caller (`daemon/server.js`), when `silencio:true` is returned, emit neither `speech.frase` nor `respuesta` for that turn.
- [ ] 5.16 RED+GREEN: inject live-task context into `apiMessages` assembly in `daemon/connector.js` (`:1048`) so the model sees pending/completed background tasks for the session, sourced from `jobs.js` (new plumbing — `connector.js` does not import `jobs.js` today).
- [ ] 5.17 Test: resume surfaces a late answer on the next turn without the user re-asking, and does not attach to or alter an unrelated later turn (two spec scenarios) — add to `daemon/test-lifecycle.test.js`.
- [ ] 5.18 Test: discard excludes a task from future delivery/context without reporting any cancel outcome — add to `daemon/test-lifecycle.test.js`.
- [ ] 5.19 RED: `daemon/test-espera.test.js` — the wait-notice ladder is suppressed when a user turn has occurred since the delegation was created; `daemon/espera.js` itself stays pure (per design, unchanged) and the check lives at the caller.
- [ ] 5.20 GREEN: add the user-activity check in `daemon/server.js`'s `lanzarDelegacion`'s `latido` (around `:259-267`) before invoking the wait-notice `speech.frase`.
- [ ] 5.21 Regression: re-run `node daemon/bench/arbol.js --replay` to confirm no branch dropped below baseline minus tolerance and no repair-count increase (D9's hard gate).

## Phase 6: Cleanup / full regression

- [ ] 6.1 Run `node --test daemon/test-*.test.js` (expect 404 + new tests, zero regressions) and `node --test app/ui/lib/*.test.js` (expect 22 + new tests, zero regressions).
- [ ] 6.2 Finalize `openspec/changes/voice-turn-lifecycle/mediciones.md`: M1 already RUN/PASS; record M2 and M3 results (or confirm both remain the sole open gates) and the D10 decision, dated.
- [ ] 6.3 Confirm flag defaults are documented: Slice 1's playback monitor (OFF pending **M3**); Slice 3's Orca interrupt now ships **unconditionally, no flag** (M1 passed) — remove any stale "flag off pending M1" language from code comments.
- [ ] 6.4 Verify `REQUIREMENTS.md` R1/R2 are unmodified; confirm `jobs.js`/`procesos.js`/`broadcastSession` needed no per-session-key changes (spec scenario "Constraint does not alter multi-session-capable subsystems").
- [ ] 6.5 Verify the two D11 open questions are resolved, not left as assumptions: (a) whether `retomar` on an already-`discarded` job re-speaks or only surfaces as text (design leans text-only); (b) actual partial behavior for CLI/Pi paths (Phase 4.10) is recorded, not assumed.
