# Tasks: Voice turn lifecycle (barge-in + task fencing/cancellation)

Branch / worktree: `sdd/voice-turn-lifecycle` / `.worktrees/voice-turn-lifecycle/`
Refs: `proposal.md`, `design.md`, `specs/voice-turn-lifecycle/spec.md` (6 requirements, 20 scenarios)
Test runners: `node --test daemon/test-*.test.js` (404 passing today), `node --test app/ui/lib/*.test.js` (22 passing today)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1700-2000 (additions + deletions) |
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
are commit-order checkpoints inside the one PR, not separate PRs.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 0 | Decision-tree measurement harness + `--live` baseline | PR 1 (slice 0) | `node --test daemon/test-arbol.test.js` | `node daemon/bench/arbol.js --live` against the current one-tool/two-branch prompt | Delete `daemon/lifecycle.js`, `daemon/bench/*`; no other code touched |
| 1 | Client-side barge-in reflex, mic-lifetime fix, `audioTurnoActual` bump | PR 1 (slice 1) | `node --test app/ui/lib/*.test.js` | Manual: speak over continuous playback, verify mic stays live and interrupted phrase never plays | Ship flag OFF (see 1.7); revert `app/ui/index.html`/`vad.js` diffs |
| 2 | Fence at delivery boundary (`fenced`/`resumed`/`discarded` job states) | PR 1 (slice 2) | `node --test daemon/test-jobs.test.js daemon/test-fence.test.js` | N/A — pure state-machine + broadcast gate, no live agent needed | Revert `jobs.js`/`server.js` gate diff; `cancelled` path untouched |
| 5 | Single-active-session rejection | PR 1 (slice 5) | `node --test daemon/test-session-gate.test.js` | Manual: two WS clients, second `audio-end` while first has a live job | Revert the WS-accept guard in `server.js`; `GestorWorker._asegurar` unchanged |
| 3 | Real kill per path (CLI/Pi unconditional; Orca gated on M1) | PR 1 (slice 3) | `node --test daemon/test-cancelacion.test.js daemon/test-orca.test.js` | **M1**: `orca terminal create --command hermes` + `--interrupt` against a live REPL (manual, recorded in `mediciones.md`) | Ship Orca half flag OFF if M1 fails; CLI/Pi kill stands alone |
| 4 | Lifecycle ops (cancel/resume/discard), live-task context, wait-notice gate | PR 1 (slice 4) | `node --test daemon/test-lifecycle.test.js daemon/test-promesas.test.js daemon/test-espera.test.js` | `node daemon/bench/arbol.js --live` re-run against the chosen tool shape (D10) before enabling | Revert `lifecycle.js` wiring in `connector.js`/`server.js`; tool set falls back to `delegar_a_orca` only |

## Phase 0: Slice 0 — Decision-tree measurement harness (FIRST, unreconstructable)

- [ ] 0.1 RED: create `daemon/test-arbol.test.js` asserting `daemon/bench/arbol.js --replay` computes per-branch accuracy (respond/delegate/cancel/do-nothing), repair count, tool-call format validity, TTFB p50/p90 over a fixture turn set — fails (no `arbol.js` yet).
- [ ] 0.2 GREEN: create `daemon/bench/arbol.js` (`--live`/`--replay` modes per D9) and `daemon/bench/turnos.json` (labelled turn set covering respond/delegate/cancel/do-nothing branches, plus existing delegate/answer turns unchanged per D10's turn set requirement).
- [ ] 0.3 Run `node daemon/bench/arbol.js --live` against the **current** one-tool/two-branch prompt/tool set (before any prompt/tool change) and commit the dated result to `daemon/bench/baseline-<date>.json`. This step is unreconstructable after Slice 4 changes `VOICE_PROMPT` — must run before 4.x starts.
- [ ] 0.4 REFACTOR: extract the pure classifier (branch scoring, regression comparison against baseline minus tolerance) so `--replay` runs deterministically in CI without network calls.
- [ ] 0.5 Record M1/M2 measurement procedures as pending in `openspec/changes/voice-turn-lifecycle/mediciones.md` (create file; both gates unrun per design.md).

## Phase 1: Slice 1 — Client-side "callar" reflex (flag-gated on M2)

- [ ] 1.1 RED: in `app/ui/lib/test-vad.test.js`, add a sustained-voice-for-barge-in test: a single 0.115 RMS frame does NOT trigger; consecutive frames totaling `>= minVozMs` (300ms) DO trigger — fails (no such helper in `vad.js`).
- [ ] 1.2 GREEN: add a sustained-voice helper to `app/ui/lib/vad.js`, separate from `DetectorVoz.procesar`'s capture-close semantics (it must fire on sustained voice immediately, not wait for silence).
- [ ] 1.3 RED: add a test (new `app/ui/lib/test-bargein.test.js` or extend `test-vad.test.js`) for the play-guard regression: given `audioTurnoActual` bumped mid-turn, a phrase queued for the old turn is discarded, never played (mirrors `playWav`'s `t<audioTurnoActual` guard at `index.html:1031`) — fails today since `detenerAudio()` never bumps the counter.
- [ ] 1.4 GREEN: in `app/ui/index.html`, bump `audioTurnoActual` inside `detenerAudio()` (`:1039-1043`).
- [ ] 1.5 Remove the `if(modo==='cont') return` barge-in guard at `index.html:1225` (mousedown handler) per design D4's file-change list.
- [ ] 1.6 GREEN (mic-lifetime fix, blocker 1): add a playback-time monitor loop that keeps `contStream`/`AudioContext` analyser alive instead of calling `pararContinuo()` (which releases the mic, `:1198`) before `playWav` at `speech.frase` (`:927`). Monitor-only: no `MediaRecorder`, no partials, no STT: on sustained voice it calls `detenerAudio()` + the 1.4 bump, THEN releases/reopens for the next capture.
- [ ] 1.7 Gate 1.6 behind a flag defaulting OFF (M2 not yet run per design.md "Measurements not yet run"). Document the flag name and default in `app/ui/index.html` beside the monitor code.
- [ ] 1.8 Regression: `node --test app/ui/lib/*.test.js` stays green; manually verify the existing 600/1200ms anti-feedback cooldown (`:963`) is untouched by the monitor loop.

## Phase 2: Slice 2 — Fence at the delivery boundary

- [ ] 2.1 RED: extend `daemon/test-jobs.test.js` — `podarJobs`/`reconciliarJobs` regression for the new enum: `fenced` stays in `vivos()` and is never pruned; a restart reconciles a `fenced` job to `interrupted`; `discarded` is prunable and idempotent under reconciliation; `discarded` is in `ESTADOS_TERMINALES`. Fails against today's enum (`daemon/jobs.js:16`).
- [ ] 2.2 GREEN: in `daemon/jobs.js`, add `fenced` (non-terminal), `resumed` (non-terminal, same effect as `running`), `discarded` (add to `ESTADOS_TERMINALES`).
- [ ] 2.3 RED: create `daemon/test-fence.test.js` — with a fake `clients` map (per existing `server` test style), a `speech.frase`/`respuesta` broadcast for a job in `fenced`/`discarded` state is dropped by `broadcastSession`; `delegation.status` for the same job is still delivered. Fails (no gate yet).
- [ ] 2.4 GREEN: add the gate in `daemon/server.js` `broadcastSession` (`:197-203`), keyed by `delegaciones.obtener(jobId)` per D2 — no new registry.
- [ ] 2.5 RED: integration test (extend `daemon/test-fence.test.js`) — for each of the four live paths (`gestorWorker.delegar`, `delegarHermesCli`, `delegarHermesApi`, `delegarPi`), inject a fake completion after fencing and assert no `speech.frase`/`respuesta` broadcast, using each path's existing injection seam (`GestorWorker`'s fake `orca`/fake `execFile`).
- [ ] 2.6 GREEN: verify 2.4's gate satisfies 2.5 without per-path changes (structural coverage per D1); if a path bypasses `broadcastSession`, fix that path's emission to route through it.
- [ ] 2.7 Test: a late fenced result does not block or contaminate a new unrelated turn (spec scenario "A late result after fencing does not affect a later turn") — add to `daemon/test-fence.test.js`.
- [ ] 2.8 REFACTOR: keep the gated message-type set (`speech.frase`, `respuesta`) as a small named constant beside the gate per D1's stated tradeoff (future message types must be added explicitly).

## Phase 3: Slice 5 — Single-active-session enforcement (independent of Slice 3/4)

- [ ] 3.1 RED: create `daemon/test-session-gate.test.js` — two fake WS clients; session A has a live job; session B's `audio-end`/`text` message is rejected with `{type:'error', payload:{error, code:'session_busy'}}` (reuses shape at `server.js:377`); session A's worker is untouched. Fails today (accidental eviction, no gate).
- [ ] 3.2 GREEN: add the rejection check in `server.js` `wss.on('message')` (`:307+`) for `audio-end` and `text`, before any turn starts, per D7.
- [ ] 3.3 Regression test: legitimate sequential session switches (session A ends, session B starts) still work — `GestorWorker._asegurar`'s cross-session close (`worker.js:120-130`) must be unaffected by the new gate.
- [ ] 3.4 Test: rejection reaches the client via the UI/protocol layer without requiring TTS/speech (spec scenario "Rejection is visible but not required to be spoken").

## Phase 4: Slice 3 — Real kill per path (CLI/Pi unconditional; Orca gated on M1)

- [ ] 4.1 RED: extend `daemon/test-cancelacion.test.js` — `delegarPi` registers its child process with `procesosDelegacion` (mirrors `delegarHermesCli` at `connector.js:831`/`:846`) so it becomes killable; a killed Pi child reports `cancelada`, a **timed-out** one reports `timed_out` never `cancelada` (threat-matrix: process kill attribution). Fails today (`delegarPi` uses `execFileAsync` with no registration).
- [ ] 4.2 GREEN: in `daemon/connector.js` `delegarPi` (`:911-925`), swap to a registrable child (mirror `delegarHermesCli`'s `execFileAsync(...).child` + `registrar`/`liberar` pattern) and set `procesosDelegacion.registrar`/`liberar`. No API change to `daemon/procesos.js`.
- [ ] 4.3 RED: create `daemon/test-orca.test.js` — `orca.interrumpir(handle)` rejects a non-`term_` handle before composing any argv (threat-matrix: subprocess argument composition), using `esHandle`/`RE_HANDLE` from `worker.js:24-27`. Fails (no `interrumpir` yet).
- [ ] 4.4 GREEN: add `interrumpir(handle)` to `daemon/orca.js`, built on fixed argv `orca terminal send --terminal <handle> --interrupt` (never a shell string), gated behind a flag defaulting OFF until M1 passes.
- [ ] 4.5 **M1 (manual, blocks 4.6)**: run the verification in design.md against a live Hermes REPL — `orca terminal create --command hermes`, run a >=60s request, send `--interrupt` after ~10s, assert in order: terminal alive, `tareaTerminada` within 10s, a following `enviar()` produces a new row under the same `agentSessionId`, no late final row for the interrupted turn. Record pass/fail in `mediciones.md`.
- [ ] 4.6 If M1 passes: flip the Slice-3-Orca flag on, wire `orca.interrumpir(handle)` into the cancel path, report `cancelada`. If M1 fails (any assertion): leave the flag OFF, keep fence-only behavior from Slice 2, report `detenida`. Do NOT implement kill-and-recreate as a fallback (explicitly rejected, PR #2 `de5f8c3`).
- [ ] 4.7 D8 guard (dead code, do not wire, do not delete): in `daemon/connector.js`, make `delegarOrca` (`:927-952`) throw `Agente no soportado` before doing any work; add a comment on `delegarHermesSesion` (`:852-855`) naming the dropped 6th `sesionId` argument as a latent trap. Add a one-line regression test that `delegarOrca` throws without side effects.

## Phase 5: Slice 4 — Lifecycle operations, live-task context, silence, wait-notice (gated on Slice 0 + D10)

- [ ] 5.1 Prerequisite check: confirm Slice 0's `--live` baseline (0.3) is recorded before touching `VOICE_PROMPT` or the tool set — per D9's drift-mitigation rule. Do not proceed if missing.
- [ ] 5.2 RED: create `daemon/test-lifecycle.test.js` — enum → claim-clause mapping is exhaustive and verbatim (`cancelada`→`Cortado de verdad, señor.`, `detenida`→`Dejé de esperarlo...`, `no-cancelable`→`No puedo cortar esa tarea...`) per D6; the layer must include the mapped clause, never restate it. Fails (no `daemon/lifecycle.js` yet).
- [ ] 5.3 GREEN: create `daemon/lifecycle.js` — enum → claim-clause map, `{resultado, jobId, via, detalle}` outcome shape, per-path capability table (Orca/CLI/API/Pi from the Live delegation topology table in design.md).
- [ ] 5.4 Run `node daemon/bench/arbol.js --live` again with lifecycle turns added to `turnos.json`, scoring candidates A/B/C from D10 by: (1) no regression vs 0.3's existing delegate/answer baseline, (2) highest lifecycle-branch accuracy, (3) fewest repairs, (4) lowest TTFB p90. If all candidates fail (1), no shape ships — fall back to a non-model UI action for lifecycle ops and keep one tool.
- [ ] 5.5 Record the D10 decision (winning candidate or "no shape ships") in `mediciones.md` before implementing the tool/prompt wiring.
- [ ] 5.6 GREEN: wire the chosen shape into `daemon/connector.js`'s tool set and dispatch cancel/resume/discard to `daemon/lifecycle.js`, calling the per-path kill (4.2/4.6) or fence-only fallback per D6's honesty contract.
- [ ] 5.7 RED: `daemon/test-promesas.test.js` — add a pure predicate test distinguishing "user's only input was an interruption with no follow-up" (silence, do-nothing) from the existing `turnoVacio` unintelligible-turn case and the `prometeAccion` promised-action case; must not regress the three existing `turnoVacio` tests (`:177-191`).
- [ ] 5.8 GREEN: add the pure predicate (e.g. `esSilencioIntencional`) to `daemon/promesas.js`; wire it into `daemon/connector.js`'s decision branch (`:1093-1137`) so the do-nothing branch skips both the reintento (`:1066-1083`) and rescate (`:1085-1111`) paths and `procesarTurno` returns `{silencio:true, text:''}` (D5) instead of falling through to `'No entendí, señor.'` at `:1133`.
- [ ] 5.9 GREEN: at the caller (`daemon/server.js`), when `silencio:true` is returned, emit neither `speech.frase` nor `respuesta` for that turn.
- [ ] 5.10 RED+GREEN: inject live-task context into `apiMessages` assembly in `daemon/connector.js` (`:1048`) so the model sees pending/completed background tasks for the session, sourced from `jobs.js` (new plumbing — `connector.js` does not import `jobs.js` today).
- [ ] 5.11 Test: resume surfaces a late answer on the next turn without the user re-asking, and does not attach to or alter an unrelated later turn (two spec scenarios) — add to `daemon/test-lifecycle.test.js`.
- [ ] 5.12 Test: discard excludes a task from future delivery/context without reporting any cancel outcome — add to `daemon/test-lifecycle.test.js`.
- [ ] 5.13 RED: `daemon/test-espera.test.js` — the wait-notice ladder is suppressed when a user turn has occurred since the delegation was created; `daemon/espera.js` itself stays pure (per design, unchanged) and the check lives at the caller.
- [ ] 5.14 GREEN: add the user-activity check in `daemon/server.js`'s `lanzarDelegacion`'s `latido` (around `:259-267`) before invoking the wait-notice `speech.frase`.
- [ ] 5.15 Regression: re-run `node daemon/bench/arbol.js --replay` to confirm no branch dropped below baseline minus tolerance and no repair-count increase (D9's hard gate).

## Phase 6: Cleanup / full regression

- [ ] 6.1 Run `node --test daemon/test-*.test.js` (expect 404 + new tests, zero regressions) and `node --test app/ui/lib/*.test.js` (expect 22 + new tests, zero regressions).
- [ ] 6.2 Finalize `openspec/changes/voice-turn-lifecycle/mediciones.md` with M1/M2 results (pass/fail/pending) and the D10 decision, dated.
- [ ] 6.3 Confirm both new-flag defaults are documented: Slice 1's playback monitor (OFF pending M2), Slice 3's Orca interrupt (OFF unless M1 passed).
- [ ] 6.4 Verify `REQUIREMENTS.md` R1/R2 are unmodified; confirm `jobs.js`/`procesos.js`/`broadcastSession` needed no per-session-key changes (spec scenario "Constraint does not alter multi-session-capable subsystems").
