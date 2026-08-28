# Spec: voice-turn-lifecycle

## ADDED Requirements

### Requirement: Client-side barge-in reflex on sustained voice

While continuous-mode playback is active, the client SHALL stop audio
playback and open the microphone the moment sustained voice is detected,
with zero round-trip to the server (no model call, no network request
gates this reflex).

- A single VAD frame SHALL NOT be sufficient to trigger barge-in. The
  reflex SHALL require sustained voice across more than one frame, because
  an isolated 0.115 RMS spike has been measured at audio start and must
  not be mistaken for the user speaking.
- Triggering the reflex SHALL bump `audioTurnoActual` so that any phrase
  already queued for the interrupted turn is discarded rather than played.
- A phrase belonging to the turn that was interrupted SHALL NOT play after
  the reflex has fired, even if it was already in flight or queued before
  the interruption.
- This reflex SHALL only stop audio and open the mic. It SHALL NOT cancel,
  fence, or otherwise affect any background delegation by itself.

#### Scenario: Sustained voice during continuous playback triggers barge-in

- **GIVEN** continuous-mode playback of a Hermes phrase is in progress
- **WHEN** the VAD reports sustained voice across consecutive frames
- **THEN** the client stops audio playback immediately
- **AND** the client opens the microphone
- **AND** no network request or model call precedes these two actions

#### Scenario: A single frame spike does not trigger barge-in

- **GIVEN** continuous-mode playback of a Hermes phrase is in progress
- **WHEN** the VAD reports a single isolated voice frame (e.g. an 0.115 RMS
  spike at audio start) with no sustained voice following it
- **THEN** the client SHALL NOT stop audio playback
- **AND** the client SHALL NOT open the microphone

#### Scenario: A queued phrase for the interrupted turn never plays afterward

- **GIVEN** a phrase for turn N is queued or in flight during continuous
  playback
- **WHEN** sustained voice triggers barge-in during turn N
- **THEN** `audioTurnoActual` advances past N
- **AND** any phrase queued or arriving afterward for turn N is discarded
  by the playback guard and never played

### Requirement: Fencing at the result-delivery boundary

Once a turn's in-flight delegation is fenced, its result SHALL NOT reach
the user through the `speech.frase` or `respuesta` broadcast boundary,
regardless of which delegation path produced it and regardless of when the
underlying work completes. This is the binding, general rule: **any**
delegation path capable of producing a deliverable result is in scope by
default, including any path added later. The following are today's four
live result-producing paths inside `delegarAgenente`
(`daemon/connector.js:620-650`) and are listed as illustration of the
rule, not as an exhaustive limit on it:

1. `gestorWorker.delegar(sesion, pedido)` — the primary path, taken when
   `ORCA_ACTIVO && sesion.perfil && !adjunto` and Orca is available
   (`:630-632`).
2. `delegarHermesCli(...)` — taken when `sesion.perfil` is set but the
   Orca route is unavailable, or there is an attachment (`:639`).
3. `delegarHermesApi(pedido)` — the fallback taken when `agente ===
   'hermes'` and there is no profile (`:641`).
4. `delegarPi(pedido, ...)` — taken when `agente === 'pi'` (`:646`).

(`delegarOrca`, `:648`, is excluded from this enumeration because it is
unreachable from the voice UI — `AGENTES_DISPONIBLES = ['hermes','pi']`,
`connector.js:172` — not because it would be exempt from fencing if it
ever became reachable.)

- Fencing SHALL be checked only at the `speech.frase`/`respuesta` delivery
  boundary. It SHALL NOT require changes inside any delegation function's
  internals to take effect.
- A fenced result MAY still be retained as thread/context, but it SHALL
  NOT be spoken or otherwise delivered through the normal turn-completion
  path.
- Fencing is distinct from cancelling: fencing revokes only the right to
  speak on its own; it makes no claim about whether the underlying work
  stopped.
- **Fencing coverage is INDEPENDENT of whether a path is killable.**
  Whether a path can be actively stopped (see the separate cancel-honesty
  requirement) has no bearing on whether its result must be fenced at
  delivery — a killable path (e.g. `delegarHermesCli`, which registers a
  killable child process) still produces a result that must be fenced
  exactly like an unkillable one. These are two orthogonal properties of
  a delegation path, and a path scoring differently on one SHALL NOT be
  read as scoring differently on the other.

#### Scenario: A fenced result never reaches delivery, for every live path

- **GIVEN** a turn is delegated through one of the four live
  result-producing paths (`gestorWorker.delegar`, `delegarHermesCli`,
  `delegarHermesApi`, or `delegarPi`) and that turn is fenced
- **WHEN** the delegation later completes and produces a result,
  regardless of path
- **THEN** that result SHALL NOT be broadcast as `speech.frase` or
  `respuesta`
- **AND** the result MAY still be appended to the thread as context
- **AND** this holds identically whether or not the path in question has
  a working kill mechanism

#### Scenario: A killable path still requires fencing, not just kill

- **GIVEN** a turn delegated through `delegarHermesCli`, whose child
  process is registered with `RegistroProcesos` and can be killed, is
  fenced
- **WHEN** the CLI process is not (yet) killed and keeps running to
  completion
- **THEN** its eventual result SHALL still be blocked at the
  `speech.frase`/`respuesta` boundary by the fence
- **AND** the presence of a kill mechanism for this path does not
  substitute for or exempt it from the fencing check

#### Scenario: A future fifth delegation path is covered by default

- **GIVEN** a new delegation path is added inside `delegarAgenente` after
  this change ships
- **WHEN** a turn delegated through that new path is fenced
- **THEN** the general rule applies without requiring the new path to be
  separately enumerated
- **AND** the new path's result SHALL NOT reach `speech.frase`/
  `respuesta` after fencing, exactly like the four paths listed above

#### Scenario: A late result after fencing does not affect a later turn

- **GIVEN** a fenced turn's underlying delegation completes after the user
  has already started an unrelated new turn
- **WHEN** the fenced result arrives
- **THEN** it SHALL NOT be delivered as a spoken turn
- **AND** it SHALL NOT block, interrupt, or contaminate the new turn's
  processing

### Requirement: Lifecycle operations — cancel, resume, discard semantics

The conversational layer SHALL support three lifecycle operations over a
live background task, defined by observable semantics. This requirement
does not fix a tool signature, tool count, or wire shape for these
operations — that shape is a deferred design decision to be settled by
measurement, not specified here.

- **Cancel** SHALL report exactly one of three outcomes, and SHALL NEVER
  report an outcome stronger than what actually happened to the
  underlying process/worker:
  - `cancelled-for-real`: the underlying work was actively stopped.
  - `stopped-waiting`: Hermes stopped waiting for/reporting on the work,
    but the work may still be running or partially done in the
    background.
  - `cannot-cancel-this-path`: no cancellation mechanism exists for this
    delegation path; the work continues unaffected.
- **Resume** SHALL surface a task's outcome to the user when that outcome
  arrives after the turn that started waiting for it has already ended,
  without requiring the user to re-ask, and SHALL NOT alter or attach
  itself to any turn other than the one that originated the task.
- **Discard** SHALL cause a live or completed task's result to be
  excluded from any future delivery or context injection, without
  implying that the underlying work was stopped (discard is not cancel).
- Interrupting speech (the barge-in reflex) SHALL NEVER by itself trigger
  cancel, resume, or discard. Only an explicit model decision on a
  subsequent turn, made using injected live-task context, SHALL invoke a
  lifecycle operation.

#### Scenario: Cancel reports cancelled-for-real only when work actually stopped

- **GIVEN** a live task on a delegation path with a verified kill
  mechanism
- **WHEN** the model invokes cancel for that task
- **THEN** the underlying process/worker is actually stopped
- **AND** the reported outcome is `cancelled-for-real`

#### Scenario: Cancel reports stopped-waiting when the path cannot be killed

- **GIVEN** a live task on a delegation path with no verified kill
  mechanism (e.g. the Orca worker path before Ctrl-C verification passes)
- **WHEN** the model invokes cancel for that task
- **THEN** Hermes stops waiting for/announcing that task
- **AND** the reported outcome is `stopped-waiting`, never
  `cancelled-for-real`
- **AND** the underlying work MAY continue running in the background

#### Scenario: Cancel reports cannot-cancel-this-path honestly

- **GIVEN** a delegation path with no cancellation mechanism implemented
  at all
- **WHEN** the model invokes cancel for a task on that path
- **THEN** the reported outcome is `cannot-cancel-this-path`
- **AND** no claim of stopping or reduced work is made

#### Scenario: Resume surfaces a late answer to the user

- **GIVEN** a task whose delegation completed after the turn that started
  waiting for it had already ended (the watermark-drop scenario)
- **WHEN** the model's next turn evaluates live-task context and finds the
  completed result
- **THEN** the result is surfaced to the user through the normal turn
  response
- **AND** it is not silently dropped

#### Scenario: A resumed answer does not contaminate an unrelated later turn

- **GIVEN** a resumed task result exists and the user has since started an
  unrelated new turn
- **WHEN** the unrelated turn is processed
- **THEN** the resumed result SHALL NOT be injected into or alter that
  unrelated turn's response
- **AND** the resumed result remains available for the model to surface
  only when relevant (e.g. explicitly asked about, or on its own
  dedicated turn)

#### Scenario: Discard excludes a task without claiming it was cancelled

- **GIVEN** a live or completed task the user asks to discard
- **WHEN** the model invokes discard for that task
- **THEN** the task's result is excluded from any future delivery or
  injected context
- **AND** no cancellation outcome (`cancelled-for-real`,
  `stopped-waiting`, `cannot-cancel-this-path`) is reported for it

### Requirement: Silence is the correct outcome when there is nothing to say

When the user's only input on a turn was an interruption (barge-in) with
no follow-up content, the model's next-turn decision SHALL be to say
nothing. No acknowledgement, filler, or confirmation phrase SHALL be
produced for that turn.

#### Scenario: Interruption with no follow-up produces silence

- **GIVEN** the user's speech that triggered barge-in contained no
  actionable content once transcribed (e.g. only "cállate" or silence)
- **WHEN** the model evaluates the next-turn decision
- **THEN** the decision is "do nothing"
- **AND** no phrase is spoken and no `speech.frase`/`respuesta` is
  produced for that turn

#### Scenario: Interruption followed by an unrelated request proceeds normally

- **GIVEN** the user interrupts and then immediately asks something
  unrelated in the same or a following turn
- **WHEN** the model evaluates the next-turn decision
- **THEN** the new request is handled normally
- **AND** the fenced turn's result never resurfaces and does not block the
  new turn

### Requirement: Wait-notice only plays without an intervening user turn

The wait-notice ladder ("sigo en ello" and its escalating rungs) SHALL
only play if no user turn has occurred since the delegation that it
refers to was created.

- If the user has spoken or otherwise produced a turn since the
  delegation was created, the wait-notice SHALL NOT play. The next reply
  SHALL instead carry the task's current state as part of its normal
  content, without an unprompted standalone status announcement.

#### Scenario: Wait-notice plays when the user has been silent

- **GIVEN** a delegation is pending and no user turn has occurred since it
  was created
- **WHEN** the wait-notice threshold is reached
- **THEN** the wait-notice ladder plays as scheduled

#### Scenario: Wait-notice is suppressed after an intervening user turn

- **GIVEN** a delegation is pending and the user has produced at least one
  turn since it was created
- **WHEN** the wait-notice threshold would otherwise be reached
- **THEN** the wait-notice SHALL NOT play
- **AND** the next reply to the user carries the task's current state
  instead of an unprompted status update

### Requirement: Single active session — temporary constraint

Exactly one session SHALL be the active session at a time. A second
session's attempt to become active SHALL be rejected explicitly and
visibly to the client attempting it. Rejection SHALL NEVER take the form
of silently evicting the currently active session's worker.

- Rejection SHALL be explicit (a distinct, identifiable rejection
  signal reaching the rejected client) and visible (surfaced to that
  client through the UI/protocol layer). Rejection is NOT required to be
  spoken/audible — a session-activation rejection is a UI/protocol
  concern, not a voice concern.
- This constraint is explicitly TEMPORARY scaffolding dated to this
  change (2026-08-28) and does NOT weaken, edit, or contradict
  `REQUIREMENTS.md` R1/R2 (multi-session, multi-worker), which remain the
  target state.
- **Exit criterion**: once fence, cancel, resume, and discard are proven
  correct and tested for a single active session, this constraint SHALL
  be lifted by generalizing `GestorWorker`'s single `this.actual`/
  `this.cola` into a `Map<sesionId, {...}>`. No other design change is
  expected to be needed to lift it.

#### Scenario: A second session's activation attempt is rejected explicitly

- **GIVEN** session A is the active session with an in-flight worker
- **WHEN** session B attempts to become the active session
- **THEN** session B receives an explicit, visible rejection
- **AND** session A's worker is NOT evicted, closed, or otherwise
  disturbed by session B's attempt

#### Scenario: Rejection is visible but not required to be spoken

- **GIVEN** session B's activation attempt is rejected
- **WHEN** the rejection is delivered to session B
- **THEN** it SHALL be surfaced explicitly through the UI/protocol layer
- **AND** it is NOT required to be synthesized as speech/TTS output

#### Scenario: Constraint does not alter multi-session-capable subsystems

- **GIVEN** `jobs.js`, `procesos.js`, and `broadcastSession` are already
  keyed/filtered per `sesionId`
- **WHEN** the single-active-session gate is enforced
- **THEN** no change is required to those subsystems to satisfy this
  requirement
- **AND** `REQUIREMENTS.md` R1/R2 remain unmodified and uncontradicted
