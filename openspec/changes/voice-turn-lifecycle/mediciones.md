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

**Status**: RUN — 2026-08-30
**Gates**: Slice 1's default-on (design decision D4)
**Result**: **PASS with the current constants** → `BARGE_IN_MONITOR_ACTIVO` flips to `true`
**Device**: MacBook Pro M1, Chrome 150, built-in speaker + microphone, `sr=48000`,
`aec=true ns=true agc=true` (the app's own `getUserMedia({audio:true})` defaults)

### Result

Both phases ran 8 s with the speaker playing, mic open with the app's constraints.

| Phase | vozMs @ `umbral 0.02` | Verdict at `minVozMs 300` |
|---|---|---|
| **A — echo only, user silent** | **105 ms** | does not fire, **2.9× short** |
| **B — user speaking over the speaker** | **4197 ms** | fires, **14× over** |

Sustained levels: voice p50 `0.02094` against echo p95 `0.00211` = **9.9× separation**.
Echo p50 `0.00168`, max `0.05015` in a **single** frame out of 77 (`cruces = 1`).

### The reading, and a corrected formula

The first version of the diagnostic's verdict computed a suggested threshold from
`eco.max` and returned **red** on data that actually passes. That was wrong twice
over:

- `eco.max` is normally **one** frame — the transient when playback starts. Using
  it as the basis pushes the threshold (`0.075`) above the user's own voice
  (`0.021`), which is absurd.
- Comparing percentiles is also wrong: in phase B roughly half the window is gaps
  between words, so its p50 understates the voice.

The verdict now reads `vozMs`, which is **what the monitor actually does** — it
already integrates threshold and sustained time. If the echo cannot accumulate
`minVozMs`, it cannot fire. That is the whole question.

The isolated `0.05015` spike is exactly why the monitor requires *sustained* voice
instead of a single frame. One frame is 100 ms; it needs 300.

### Scope of this result

**This number belongs to this device.** A phone holds its speaker centimetres from
its microphone and runs a different AEC. Re-run M3 on each device before enabling
the monitor there — see the vault card
`2026-08-28-umbral-adaptativo-por-microfono`, which this measurement promotes from
optional to required once the UI is reachable from other devices.
