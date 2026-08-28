# Exploration: voice-turn-lifecycle (barge-in + task lifecycle)

Verified on `main @ 1d1e39e` by reading the code directly.

## Current state — confirmations and one correction

**Corrected.** `delegarHermesSesion` (`daemon/connector.js:852-855`) does call `delegarHermesCli`
with 5 arguments, dropping the 6th `sesionId` parameter (`connector.js:825`). The bug is real, but
`delegarHermesSesion` has **zero callers** anywhere under `daemon/` (grep-confirmed, tests
included) and is exported yet dead. It is a latent trap for whoever resurrects it, not an active
leak: the only live caller of `delegarHermesCli` (`connector.js:639`, inside `delegarAgenente`)
does pass `sesionId` correctly.

Confirmed:

- Continuous-mode barge-in is a dead path: `app/ui/index.html:1225` starts with
  `if(modo==='cont') return` before reaching `bargeIn()`.
- The mic is shut off through `pararContinuo()` at **four** call sites, not three: `912`
  (`transcribiendo`), `913` (`hablando`), `927` (`speech.frase`), `963` (`respuesta` cooldown).
- The `speech.frase` handler (`927`) never paints `payload.frase` (out of scope here).
- `detenerAudio()` (`1039-1043`) never bumps `audioTurnoActual`, and the `playWav` guard (`1031`)
  only discards `t < audioTurnoActual`. A late phrase from the same turn therefore resumes speech
  after an interrupt. Fixing this bump is **distinct** from the excluded text/voice-sync card and
  belongs to the barge-in slice.
- Cancel is blind and session-wide (`daemon/server.js:311-320`).
- The primary Orca-worker path (`daemon/worker.js`) has no kill/abort concept anywhere.
- `delegarPi` (`connector.js:911-925`) and `delegarOrca` (`927-952`) register nothing in
  `RegistroProcesos`. `delegarOrca` is additionally unreachable from the voice UI
  (`AGENTES_DISPONIBLES = ['hermes','pi']`, `connector.js:172`).
- Zero `AbortController` anywhere under `daemon/`; all six `fetch` calls use
  `AbortSignal.timeout(...)` ceilings only.
- `daemon/orca.js` `enviar()` (`47-52`) exposes no interrupt method. The Ctrl-C result is accepted
  as reported for a plain shell but **remains unverified against a live Hermes REPL**.
- `daemon/espera.js` `avisoDeEspera` (`20-32`) is purely time-based across five fixed thresholds,
  with no user-activity signal. `FRASES_ESPERA[4]` ("¿Prefiere que la corte?") promises a cancel
  capability that has no code path able to act on a "yes".
- `worker.js` `_esperarTurno` (`156-199`) behaves as described: partial on REPL idle
  (`motivo:'repl-libre'`), partial on timeout (`motivo:'timeout'`), and the watermark
  (`store.ultimoId()`) is recomputed fresh per delegation. A late answer written between one
  delegation's give-up and the next delegation's watermark call is silently dropped — it never
  resurfaces and never contaminates.
- `connector.js` never imports or references `jobs.js`/`delegaciones`. The conversational layer has
  **zero live-task visibility** today; wiring it in is new plumbing into prompt assembly.
- `daemon/test-capa.test.js` only covers `resolverCapa()` provider/model resolution. No test
  exercises routing outcomes. The only measurement is a prose comment (`capa.js:21-49`) taken by
  hand against one tool and a two-branch prompt.
- `openspec/config.yaml` warns: *"Keep the toolset minimal: small models degrade fast as tools
  multiply"* — directly relevant to adding three tools.

## State machine as it exists today

**Turn** (`server.js`, per-WS-client `st.processing`): `idle → escuchando → transcribiendo →
hablando → (delegation pending ? create job : respond) → idle`. The turn ends locally even though
its job keeps running in the background.

**Job** (`jobs.js`): `queued → running → {completed | incompleta | failed | timed_out | interrupted
| cancelled}`. Missing: no `fenced` state distinct from `cancelled` (today `cancelled` is set while
work keeps running — the lie); no `resumed`/`discarded` transitions; no coupling at all between job
state and worker state.

**Worker** (`worker.js` `GestorWorker.actual`): `null → creating → ready → delegating
(_esperarTurno polling, no interrupt point) → ready | replaced-by-close`. No externally observable
interrupt signal is accepted mid-poll.

## Single-active-session constraint — temporary

R1 and R2 (multi-session, multi-worker) remain the **target state** and are not narrowed by this
change. The single-active-session, single-worker constraint is deliberate, documented, temporary
scaffolding that makes turn/task lifecycle tractable to build and test first.

**Exit criterion**: lifecycle correctness (fence / cancel / resume / discard) proven for 1:1 before
attempting N.

### Seam analysis

Already N-ready, no changes needed:

- `DelegationManager` / `jobs.js` — keyed by `sesionId` throughout.
- `RegistroProcesos` / `procesos.js` — `this.porSesion = new Map()`.
- `broadcastSession` — filters WS clients by `state.sesion` per connection.

Hard-coded to one, the real seam:

- `GestorWorker` holds one `this.actual` and one `this.cola` queue for the **entire daemon
  process**. `decidirWorker`/`_asegurar` close the previous worker whenever `sesion.id` differs —
  enforced only at delegation time, not at session-switch time (`precalentar()` deliberately does
  not evict, per its own test). Generalizing later means `this.actual`/`this.cola` become a
  `Map<sesionId, {...}>` and cross-session eviction is removed entirely.

There is currently **no explicit single-active-session gate** anywhere in `server.js`. Any number of
WS clients can drive turns on different sessions. The only eviction today happens *accidentally*
inside `GestorWorker` when two sessions race to delegate — the loser's worker is silently evicted
mid-turn with no user-visible signal. The explicit invariant is therefore a **correctness fix over
an existing accidental one**, not a new restriction.

**Cheap-today / expensive-later tradeoff to flag**: `GestorWorker`'s single `this.cola` serializes
every session's delegation operations globally, not just the active one. Fine under this
constraint; when lifted it must become one queue per worker, or the future step silently inherits a
global serialization bottleneck.

## Split assessment

This is a change **family**, not one unit, and will exceed the 1200-line review budget.
Recommended sequencing:

- **Slice 0** (first; unreconstructable later) — automated decision-tree baseline harness against
  the current one-tool/two-branch state, recorded before any prompt or tool change.
- **Slice 1** — client-side "callar" reflex: barge-in in continuous mode gated on sustained VAD
  voice, plus the `audioTurnoActual` bump. Zero round-trip, no server change.
- **Slice 2** — fence-at-delivery layer, checked only at `speech.frase`/`respuesta` broadcast
  boundaries. Implements "fenced, not killed" for all four paths immediately, with no changes
  inside any delegation function.
- **Slice 3** (riskiest; gated on the Orca Ctrl-C unknown) — real kill per path. CLI and Pi via
  `RegistroProcesos` generalization (low risk); Orca worker via a new `orca.interrumpir()` (high
  risk, unverified).
- **Slice 4** — `cancelar_tarea` / `retomar_tarea` / `descartar_tarea`, injected live-task context,
  and the wait-notice user-activity check. Gated on Slice 0 existing.
- **Slice 5** — explicit single-active-session enforcement. Can be sequenced early and
  independently.

## Riskiest unknowns to measure before implementing

1. Orca `terminal send --interrupt` against a **live Hermes REPL**, not a shell: cancels and
   survives, crashes, or no-ops. Decides whether Slice 3's Orca path is cheap or requires
   kill+recreate (which defeats the keep-hot design).
2. Decision-tree harness design: real API calls (costly, non-deterministic) versus recorded-fixture
   replay (fast, deterministic, blind to model drift). Must be decided explicitly for Slice 0 to be
   trustworthy.
3. Fence-versus-cancel is currently binary in code (`e.cancelada` is the only "stay silent" signal,
   `connector.js:684`, `server.js:290`). A third "fenced but still running" outcome does not fit
   that shape yet.
4. The cancel tool needs a three-way honesty contract — cancelled for real / stopped waiting, work
   may be partially done / cannot cancel this path — defined before wiring any path, or it just
   repackages today's lie more articulately.
5. Where to enforce the single-active-session invariant: explicit WS-layer rejection versus silent
   worker-layer eviction. Decides UX; must precede Slice 5.

## Approaches for the fence/cancellation token

**A. Per-job `AbortController` threaded through all four delegation paths.** Idiomatic; unifies
fetch and process cancellation. Cannot alone stop the Orca REPL, which still needs Ctrl-C.

**B. Fence-flag registry checked only at result-delivery boundaries.** Implements "fenced, not
killed" everywhere immediately, including the three currently unkillable paths, with no changes
inside any delegation function. Does not save compute or TTS cost, and does not free the Orca
worker's global queue for the fenced turn's remaining duration.

**C. Staged hybrid — recommended.** Ship B unconditionally first: it closes the honesty requirement
immediately and decouples shipping from the unresolved Orca unknown. Then layer A in per path as
each path's real-kill mechanism is verified. This is also the only approach compatible with chained
delivery given the line budget.

## Ready for proposal

Yes, with one caveat: `delivery_strategy` must be revisited before `sdd-tasks`, since this exceeds
1200 lines. Decide whether to run one SDD change with staged tasks or split into two or three named
changes.
