# Measurements — voice-turn-lifecycle

Gates defined in `design.md`. A slice that depends on a measurement stays flag-off
until its result is recorded here.

---

## M1 — Orca `--interrupt` against a live Hermes REPL

**Status**: RUN — 2026-08-28
**Gates**: Slice 3, the Orca worker kill path
**Result**: **PASS** → `orca.interrumpir(handle)` ships; reported outcome `cancelada`

### Setup

| | |
|---|---|
| Terminal | `orca terminal create --command "hermes"` (the shape `comandoWorker` produces for the default profile) |
| Agent build | Hermes Agent v0.20.5 (2026.8.19), upstream `650cf334` |
| Model | `deepseek-v4-flash` |
| Request | a ≥3000-word, 10-section essay — a long generation with no side effects |
| Interrupt | `orca terminal send --terminal <handle> --interrupt`, sent ~12 s into the turn |
| Wire | `{"accepted": true, "bytesWritten": 1}` — one byte, `0x03` |

Worth noting: while generating, Hermes' own status bar reads
`msg=interrupt · /queue · /bg · /steer · Ctrl+C cancel`. The agent documents
Ctrl+C as its cancel affordance, so this is a supported input, not a hack.

### Assertions

| | Assertion | Result | Evidence |
|---|---|---|---|
| a | Terminal still alive | **PASS** | `terminal read --screen` answered `ok: true` after the interrupt |
| b | Turn stopped within 10 s | **PASS** | Immediate. The essay cut off mid-intro-paragraph and the idle prompt returned (`✓ 0s`) |
| c | REPL usable, thread intact | **PASS** | A follow-up ("in one short sentence: what did I just ask you?") answered correctly, recalling the pre-interrupt request. Store row `122504` |
| d | Work really stopped rather than continuing | **PASS (assertion needs rewording — see below)** | Store row `122502` is **771 characters**; a 3000-word essay would be ~18,000. The persisted text ends exactly where the screen was cut |

### Correction to assertion (d)

As written in `design.md`, (d) reads *"no final assistant row appears for the
interrupted turn"*. Taken literally it **fails**: an `assistant` row **is**
persisted (`122502`).

Taken by intent — *"it really stopped, rather than continuing"* — it **passes**:
the row holds the truncated partial, not a completed answer. Hermes flushes what
it had generated and returns to the prompt.

The assertion should therefore be restated as:

> **(d)** No *complete* answer appears for the interrupted turn. A truncated
> partial row MAY be persisted, and is desirable.

Desirable because it matches a decision this project already took: `_esperarTurno`
returns partial facts on timeout rather than discarding them, with the recorded
rationale that *"tirarlo era el peor desenlace posible"* — a turn given up at 360 s
had six web searches already done. An interrupted turn is the same situation.

### Design implications

1. **The Slice 3 Orca kill path ships.** `orca.interrumpir(handle)` on
   `orca terminal send --interrupt`. Reported outcome is `cancelada`, the strongest
   rung of the honesty contract. The `detenida` degradation is not needed for this
   path.
2. **The REPL survives, so the keep-hot design holds.** No churn is reintroduced;
   the concern that motivated rejecting kill-and-recreate does not materialise.
3. **New requirement surfaced by this measurement**: an interrupt leaves a partial
   in the store, and that partial is information the user already paid for. Cancel
   must not silently drop it. It should reach the user the same way a timeout
   partial does (via `informeParcial`), rather than vanishing the way the late
   post-timeout answer does today.

---

## M2 — Decision-tree baseline

**Status**: NOT RUN
**Gates**: Slice 4 (lifecycle tool shape, design decision D10)
**Blocking**: must be recorded `--live` **before** any change to `VOICE_PROMPT`,
the tool set, or the model. Once those change, the baseline cannot be reconstructed.

> Slice 1's default-on was previously listed here. It is a different measurement —
> an audio threshold, not a routing one — and moved to M3 below.

**Harness ready, run not attempted successfully yet**: `daemon/bench/arbol.js`
(`--live`/`--replay`) and `daemon/bench/turnos.json` exist and are covered by
`daemon/test-arbol.test.js` (pure-classifier replay, no network). A `--live`
attempt on 2026-08-29 could not proceed: `NAN_BUILDERS_API_KEY` was not present
in this worktree's environment (checked `.envrc`, `.env`, `ai-specs.env` in this
worktree and the main worktree, `process.env`, and `direnv exec .`). No baseline
was fabricated — per design, an invented M2 number is worse than none, since
every later regression check would compare against a lie. Provision the key (or
explicitly decide to defer) before re-attempting `node daemon/bench/arbol.js --live`.

---

## M3 — Barge-in energy threshold during playback

**Status**: NOT RUN
**Gates**: Slice 1's default-on (design decision D4)
**What to measure**: the RMS threshold and sustained-frame count that separate
Robert's voice from Hermes' own TTS coming back through the speakers, on the real
speaker/microphone pair — the same way `app/ui/lib/vad.js:14-16` records its 0.02
(silent room peak 0.00392, voice p50 0.05585).
**Why it is not optional**: `speech.frase` calls `pararContinuo()`
(`app/ui/index.html:927`), which releases the microphone stream (`:1198`), so
barge-in requires holding the mic open during playback — which is exactly the
self-echo the 600/1200 ms cooldown at `:963` was added to avoid. Until this is
measured, the playback monitor ships disabled by default rather than shipping a
self-triggering guess.
