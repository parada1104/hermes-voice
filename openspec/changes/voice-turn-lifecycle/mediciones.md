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

**Status**: RUN — 2026-08-29
**Gates**: Slice 4 (lifecycle tool shape, design decision D10)
**Artifact**: `daemon/bench/baseline-2026-08-29.json`
**Command**: `node daemon/bench/arbol.js --live`

> Slice 1's default-on was previously listed here. It is a different measurement —
> an audio threshold, not a routing one — and moved to M3 below.

### Result

| Branch | Baseline | Note |
|---|---|---|
| `responder` | 4/4 (100%) | |
| `delegar` | 7/7 (100%) | |
| `cancelar` | 0/3 (0%) | **Expected.** No cancel tool exists yet |
| `nada` | 0/3 (0%) | **Expected.** Silence is blocked twice today |

17 turns · 2 repairs · tool-call format valid 100% · TTFB p50 2186 ms / p90 6991 ms.

### Reading the zeros

`cancelar` and `nada` at 0% are not failures. They are the point of the
measurement: empirical proof that neither branch is reachable before this change
touches anything. `cancelar` has no tool (`connector.js:147` registers only
`delegar_a_orca`), and silence is prevented twice — `turnoVacio`
(`daemon/promesas.js:93`) forces a rescue re-prompt, and `connector.js:1133`
falls back to a spoken `'No entendí, señor.'`.

This turns a code reading into a number: after Slice 4, these two rows must move
off zero, and `responder`/`delegar` must not regress from 4/4 and 7/7.

### Corroboration of the historical hand measurement

`daemon/capa.js:21-49` records a hand-taken run for the same provider/model:
*"7/7 delegación · 3/3 continuidad · TTFB p50 2566ms / p90 3189ms"*.

This automated run reproduces **7/7 delegación exactly**, which is good evidence
the harness measures the same thing the prose comment measured. TTFB p50 came out
slightly better (2186 ms vs 2566 ms); **p90 came out materially worse (6991 ms vs
3189 ms)**. Different day, different network, and the historical figure was taken
by hand, so this is recorded as an observation rather than a regression — but p90
is worth re-checking on the next `--live` run before reading anything into it.

### Regression rule

A later run regresses if per-branch accuracy falls below baseline minus tolerance,
**or** if the repair count rises above 2. TTFB is reported, not gating.

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
