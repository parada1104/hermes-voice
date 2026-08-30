# Proposal: Voice turn lifecycle (barge-in + task fencing/cancellation)

## Why

Today "interrupting" Hermes is a lie the system tells itself. Four concrete,
verified failures make this true:

- **The 480-second promise nobody can keep.** `avisoDeEspera`
  (`daemon/espera.js:20-32`) fires a fixed wait-notice ladder and its last
  rung literally asks the user *"¿Prefiere que la corte?"* ("Would you like
  me to cut it off?"). There is no code path anywhere that can act on "yes" —
  `daemon/worker.js` has no kill/abort concept, and cancel
  (`daemon/server.js:311-320`) is blind and session-wide. The UI offers a
  button with nothing behind it.
- **Silent mid-turn worker eviction, already happening today.** `GestorWorker`
  keeps exactly one `this.actual` worker and one `this.cola` queue for the
  entire daemon process. `decidirWorker`/`_asegurar` close the previous
  worker whenever `sesion.id` differs, but only at delegation time — not at
  session-switch time. If two sessions race to delegate, the loser's worker
  is evicted mid-turn with zero user-visible signal. This is not a designed
  behavior; it is an accident of a singleton with no session gate.
- **The late answer that vanishes without a trace.** `_esperarTurno`
  (`daemon/worker.js:156-199`) gives up on REPL idle or on timeout, and each
  new delegation recomputes its watermark (`store.ultimoId()`) fresh. An
  answer written between one delegation's give-up and the next delegation's
  watermark call is silently dropped forever — it never resurfaces and never
  contaminates the next turn, but it also never reaches the user who was
  waiting for it.
- **The agent that keeps talking after being told to stop.** Continuous-mode
  barge-in is currently a dead code path (`app/ui/index.html:1225` returns
  before reaching `bargeIn()`). Even once wired, `detenerAudio()`
  (`1039-1043`) never bumps `audioTurnoActual`, and the `playWav` guard only
  discards audio queued for turns older than the current one. A phrase
  already in flight for the *same* turn number resumes playback right after
  the user interrupted it — the agent answers "ok" and then keeps talking.

None of these are missing features in the sense of "nice to have." They are
places where the system's stated behavior (a cancel option, a queued answer,
a stopped voice) and its actual behavior have already diverged, and the
divergence is invisible until a user hits it.

## Product decisions already settled (context, not open questions)

These are binding constraints on the design, carried over from prior
discussion and the exploration phase:

1. **Callar ≠ cancelar.** Interrupting stops the agent from *talking*; it
   never kills background work by inference. A VAD only knows "the user
   started speaking" — it cannot know intent.
2. **Callar is a local client reflex.** Stop audio, open the mic — zero
   round-trip, no model call.
3. **"Has the user finished speaking?" belongs to the VAD** (`silencioMs`,
   1500ms today), not the model.
4. **The model owns a narrower decision on the *next* turn**: respond /
   delegate / cancel / **do nothing**. "Do nothing" is the critical branch —
   if the user only said "cállate", the correct output is silence. Getting
   this wrong reproduces the exact bug being fixed: the agent shuts up and
   immediately talks again just to say "ok".
5. **The in-flight turn is fenced, not killed.** Its result loses the right
   to speak on its own but may still land in the thread or serve as context.
6. **Task lifecycle is a capability of the conversational layer**, sibling to
   `delegar_a_orca`, not a separate subsystem the model has to reason about
   differently.
7. **Live tasks reach the layer as injected context, not a tool.** A tool
   would force the model to guess something is cancellable before even
   asking, and costs a round-trip to find out.
8. **The cancel capability must not lie.** Three-way honesty contract:
   cancelled-for-real / stopped-waiting-work-may-be-partially-done /
   cannot-cancel-this-path. Saying "ok, cancelado" while Hermes keeps working
   in the background is today's bug, made more articulate.
9. **Wait-notice rule.** "Sigo en ello" ("still working on it") only plays if
   there has been no user turn since the delegation. If the user kept
   talking, the returning card carries state instead of interrupting with a
   status update nobody asked for.
10. **Single-active-session is temporary scaffolding, not a retreat from
    multi-session.** `REQUIREMENTS.md` R1/R2 (multi-session, multi-worker)
    remain the target state and this change does not weaken, edit, or
    contradict them. Rationale: lifecycle correctness (fence / cancel /
    resume / discard) needs to be proven for 1:1 before it can be trusted for
    1:N. **Exit criterion**: once fence/cancel/resume/discard are correct and
    tested for a single active session, the constraint is lifted by
    generalizing the one hard-coded seam below — no other design change is
    expected to be needed.

### The seam, named explicitly

Per the exploration, `jobs.js`, `procesos.js`, and `broadcastSession` are
already keyed by `sesionId` / filtered per session — no changes needed there
to go multi-session later. The one place hard-coded to a single global
instance is `GestorWorker`: one `this.actual` worker and, importantly, **one
`this.cola` queue for the entire process**, which today serializes every
session's delegation operations globally, not just the active one. This is
harmless under the single-active-session constraint but must become a
`Map<sesionId, {...}>` when the constraint lifts, or the multi-session future
silently inherits a global serialization bottleneck it never asked for. This
proposal deliberately does not build that seam now — only names it so it
isn't rediscovered the hard way later.

## Deferred design decision — tool shape

The layer has exactly one tool today (`delegar_a_orca`), and
`openspec/config.yaml` explicitly warns to keep the toolset minimal because
small models degrade fast as tools multiply. Adding three more tools
(cancel/resume/discard) is not free.

This proposal defines the **semantic contract** of the three lifecycle
operations — cancel, resume, discard — including the three-way honesty
contract for cancel. It deliberately does **not** fix whether these ship as
one tool with an action parameter or as three separate tools. That is a
design-phase decision, to be settled by data: Slice 0 builds a measurement
harness that compares candidate shapes over the same recorded turn set before
any shape commitment is made in the design or implementation.

## Users / situations

- **Robert (the only real user of hermes-voice), interrupting mid-answer.**
  He starts talking while Hermes is speaking, expecting Hermes to shut up
  immediately — not to finish its sentence, not to keep going in the
  background thinking it was told to stop.
- **Robert, walking away from a long delegation.** He delegates a task to
  Orca or Hermes CLI, the wait stretches past the point where a raw silence
  feels broken, and he needs a truthful answer to "is this still running,
  can you actually stop it, and if I ask again will you tell me the truth
  about what happened to the first one."
- **Two sessions racing.** Whoever is driving a second WS session today can
  silently evict the first session's in-flight worker with no signal to
  either side. This must become an explicit, honest rejection instead of an
  invisible accident.

## Business rules

- Interrupting speech never implies cancelling work. Only an explicit
  lifecycle decision (cancel/resume/discard), made by the model on the next
  turn using injected live-task context, may affect background work.
- The cancel capability must report one of exactly three outcomes and must
  never claim a stronger outcome than what actually happened:
  cancelled-for-real, stopped-waiting (work may be partially done), or
  cannot-cancel-this-path.
- A fenced turn's result must never be spoken or delivered to the user
  through the normal turn-completion path once fenced, even if the
  underlying work completes afterward. It may still be retained as thread
  context.
- The wait-notice ladder may only play "sigo en ello" if no user turn has
  occurred since the delegation was created; otherwise the next reply must
  carry state instead of announcing progress unprompted.
- Only one session may be the active session at a time. A second session
  attempting to become active must be rejected explicitly and audibly to the
  session attempting it (not silently starved), never by silently evicting
  the currently active session's worker.

## Product outcome

After this change:

- Saying anything while Hermes is speaking (in continuous mode) stops audio
  and opens the mic immediately, with no round-trip and no chance of a
  delayed phrase from the interrupted turn resuming playback afterward.
- A background task (Orca, Hermes CLI, or Pi) that the user asks to cancel
  gets a truthful answer about what actually happened to it, not a
  reassurance that outruns reality.
- A turn that gets interrupted never causes the agent to speak again on its
  own just to acknowledge the interruption — silence is a valid, correct
  outcome when that's genuinely what the user wanted.
- Two sessions can no longer silently steal each other's in-flight worker;
  the conflict becomes visible and honest instead of invisible and lossy.

## Current-state gap

Already itemized above in Why/decisions — summarized as code-level gaps:

- No `AbortController` or process-kill concept anywhere under `daemon/`; all
  network calls use timeout ceilings only, never active cancellation.
- `daemon/orca.js` exposes no interrupt method; the worker path has no way to
  stop a live Orca REPL.
- `delegarPi` and `delegarOrca` never register with `RegistroProcesos`, so
  even the process-registry-based kill path that already exists for
  something isn't wired to two of the three live delegation paths.
- No `fenced` job state distinct from `cancelled` — today `cancelled` is set
  on a job while its work keeps running in the background, which is exactly
  the honesty gap this proposal closes.
- No coupling between job state and worker state at all.
- `connector.js` never imports `jobs.js` — the conversational layer currently
  has zero visibility into live tasks; this is new plumbing, not a rewire.
- Continuous-mode barge-in is dead code, gated off before it can run.
- No explicit single-active-session gate exists in `server.js` today; the
  only "enforcement" is the accidental worker eviction described above.

## Implications / impact

- **`app/ui/index.html`**: the barge-in path needs to be reachable in
  continuous mode, gated on *sustained* VAD voice (a single frame is
  insufficient — an isolated 0.115 spike was measured at audio start and
  would cause false-positive barge-in), plus a real `audioTurnoActual` bump
  in `detenerAudio()`.
- **`daemon/server.js` / `daemon/connector.js`**: a new fence check at the
  `speech.frase`/`respuesta` broadcast boundaries, live-task context
  injection into prompt assembly, and an explicit single-active-session
  gate.
- **`daemon/worker.js` / `daemon/orca.js`**: a new `orca.interrumpir(handle)`
  built on `orca terminal send --interrupt`, gated on verifying that a live
  Hermes REPL survives Ctrl-C the way a plain shell did in manual testing (1
  byte written, `sleep 300` killed, terminal survived) — this has not yet
  been verified against the actual Hermes REPL target.
- **`daemon/procesos.js`**: generalized so CLI and Pi delegation paths
  register with `RegistroProcesos` and can be genuinely killed, not just
  fenced.
- **`daemon/jobs.js`**: new `fenced`, `resumed`, `discarded` states/
  transitions distinct from the existing `cancelled` (which currently lies).
- **Test suite**: 404 passing daemon tests, 22 passing app tests today
  (`node --test daemon/test-*.test.js`, `node --test app/ui/lib/*.test.js`).
  Strict TDD applies; every slice adds behavior-first tests before
  implementation, per `openspec/testing-capabilities.md`.
- **Prompt/tool surface**: whichever shape Slice 0's measurement selects for
  the lifecycle operations, it adds to a currently single-tool prompt, which
  is exactly the kind of change `openspec/config.yaml` warns is expensive for
  small models — this is the reason the shape is measured, not assumed.

## Edge cases

- **User says "cállate" and nothing else.** Correct outcome is silence on
  the next turn — no acknowledgment, no filler. This is the "do nothing"
  branch and is treated as a first-class outcome, not an omission.
- **User interrupts, then immediately asks something unrelated.** The fenced
  turn's result must not resurface later and must not block the new turn
  from proceeding normally.
- **A wait-notice would fire, but the user has kept talking since the
  delegation.** The notice must not play; the next reply carries the current
  state of the task instead.
- **Two sessions attempt to delegate at nearly the same time.** The losing
  session's attempt must be explicitly rejected with a reason, never allowed
  to silently evict the active session's worker.
- **The Orca REPL does not survive Ctrl-C the way a shell did.** Slice 3's
  Orca kill path is explicitly gated on this verification; if it fails, the
  fallback is kill+recreate, which is more costly but still gives an honest
  "stopped-waiting" answer rather than a false "cancelled" one.
- **A background job finishes after being fenced.** Its result is retained
  as thread context per decision #5, never delivered as a spoken turn.
- **`delegarHermesSesion` is ever resurrected.** It is dead code today (zero
  callers) with a real argument-dropping bug (drops the 6th `sesionId`
  parameter). This proposal does not fix or exercise it; it is flagged as a
  latent trap to delete or guard, not part of any lifecycle path built here.

## Scope

This ships as **one PR**, staged as slices for review clarity and
sequencing, per the reaffirmed single-PR delivery strategy. The 1200-line
review budget will be exceeded; this has been explicitly accepted.

**In scope:**

- **Slice 0** — automated decision-tree measurement harness against the
  current one-tool/two-branch baseline, run and recorded *before* any
  prompt or tool change. First because it is unreconstructable afterward,
  and because it is the basis for the deferred tool-shape decision above.
- **Slice 1** — client-side "callar" reflex: continuous-mode barge-in gated
  on sustained VAD voice, plus the `audioTurnoActual` bump in
  `detenerAudio()`. Zero round-trip, no server change.
- **Slice 2** — fence-at-delivery layer, checked only at the
  `speech.frase`/`respuesta` broadcast boundaries. Implements "fenced, not
  killed" for all four delegation paths immediately, without touching any
  delegation function's internals.
- **Slice 3** — real kill per path, gated on the Orca Ctrl-C verification.
  CLI/Pi via `RegistroProcesos` generalization (lower risk, already-existing
  registry). Orca worker via new `orca.interrumpir(handle)` (higher risk,
  unverified against a live REPL).
- **Slice 4** — lifecycle operations (cancel/resume/discard) in the
  conversational layer, live-task injected context, and the wait-notice
  user-activity check. Depends on Slice 0's harness existing to measure
  tool-shape impact.
- **Slice 5** — explicit single-active-session enforcement, replacing the
  accidental eviction behavior with an honest rejection.

**Out of scope:**

- Text/voice sync (painting `payload.frase` live) — tracked separately as
  vault card `2026-08-28-barge-in-continuo-sync-texto-voz.md`. Note: the
  `audioTurnoActual` bump is *not* part of that card and stays in Slice 1.
- Adaptive per-microphone VAD thresholds — tracked as vault card
  `2026-08-28-umbral-adaptativo-por-microfono.md`.
- Changing worker cardinality from 1 to N. The seam is named and left in
  place; it is not built here.
- Fixing or resurrecting `delegarHermesSesion`. Flagged as a latent trap
  only (see edge cases); no code path here calls or repairs it.

## Approach outline

**Fencing mechanism**: staged hybrid, per the exploration's recommendation.
Ship a fence-flag registry checked at result-delivery boundaries first
(Slice 2) — it closes the honesty gap for all four paths immediately,
including the three that currently have no kill mechanism at all, and does
not depend on the unresolved Orca unknown. Layer real per-path kill
(`AbortController` / process signal / Orca interrupt) in afterward per path
as each one is verified (Slice 3). This decouples "stop lying about
cancellation" from "actually free the compute," which is the right order:
honesty is cheap and can ship immediately; real kill is riskier and gated on
an unverified REPL behavior.

**Tool shape**: deferred to Slice 0's measurement, as described above — not
decided in this proposal.

**Single-active-session**: enforced as an explicit rejection at the point
where a second session attempts to become active, replacing today's
accidental worker-eviction race. Framed as a correctness fix over an
existing accidental behavior, not a new restriction.

## Success criteria / how this gets verified

- Barge-in: a sustained-voice interruption during continuous-mode playback
  stops audio and opens the mic with no round-trip; a phrase queued for the
  interrupted turn never plays afterward (regression test against the
  `audioTurnoActual` bug).
- Fencing: for all four delegation paths, a fenced turn's result never
  reaches `speech.frase`/`respuesta` broadcast after the fence is set, even
  if the underlying delegation completes later.
- Cancel honesty: for each delegation path, the returned outcome
  (cancelled-for-real / stopped-waiting / cannot-cancel) matches what
  actually happened to the underlying process/worker, verified per path.
- Do-nothing branch: a decision-tree evaluation (via the Slice 0 harness)
  confirms the model correctly stays silent when the user's only input was
  an interruption with no follow-up content.
- Wait-notice: no "sigo en ello" notice plays when a user turn has occurred
  since the delegation was created.
- Single-active-session: a second session's delegation attempt is rejected
  explicitly and does not silently evict the active session's worker
  (regression test against the current accidental-eviction race).
- All new behavior is covered by tests added before implementation (strict
  TDD), and the full suite (404 daemon + 22 app tests today, plus new tests
  per slice) passes.
- Orca interrupt path is only claimed as "real kill" in Slice 3 after the
  Ctrl-C-against-a-live-Hermes-REPL verification passes; if it fails, the
  path ships with the fence-only behavior from Slice 2 and an honest
  "stopped-waiting" outcome instead of a false "cancelled" one.

## Proposal question round

This proposal was assembled from an already-substantial set of prior product
decisions and a verified exploration; no open product ambiguity was found
that blocks writing it. Two points are surfaced here for explicit
confirmation rather than being decided silently:

1. **Single-PR delivery despite exceeding the 1200-line budget** is treated
   as already reaffirmed per the session brief — flagged here only so it is
   visible in the artifact itself, not re-litigated.
2. **Tool shape for cancel/resume/discard is deferred to measurement**, not
   fixed by this proposal. If there is a strong prior preference (e.g. one
   tool with an action parameter, for minimal toolset growth) that should
   override the measurement step, say so now — otherwise Slice 0/design will
   decide from data.

No other assumptions here are believed to need correction; proceeding to
`sdd-spec`/`sdd-design` unless redirected.
