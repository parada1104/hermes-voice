# Hermes Voice

A hybrid chat + voice layer over coding agents. A small, fast conversational
model holds the dialogue and decides, turn by turn, whether to answer itself or
**delegate the real work to a heavy agent**.

The point is the split. The conversational layer stays cheap and responsive so it
can talk; the agent does the work that takes tools, files and time. Every
delegation is visible in the thread as a nested, collapsible run — which is the
only way to catch a small model confabulating an answer it never actually
delegated.

## Shape

Two components:

| | |
|---|---|
| `app/` | Electron shell + vanilla HTML/JS UI. Microphone capture, silence-based VAD, playback. The only client. |
| `daemon/` | Node.js daemon on `:8471` (WS + REST). Owns the voice pipeline, the sessions and the delegation cascade. |

The voice pipeline:

```
mic → VAD (silence) → STT (oMLX whisper) → conversational layer → TTS (oMLX)
                                                 ↓
                                          delegate to an agent
```

The conversational layer is provider-portable: provider, model and API key are
configurable (`daemon/capa.js`). Model choice here is **measured, not assumed** —
the measurement table lives in that file.

Delegation to the `hermes` agent walks three paths, in order: a live Orca worker
REPL (primary — keeps the agent thread warm and reads the answer from Hermes'
SQLite store), a headless CLI fallback, and the HTTP run API as a last resort.
See `ARCHITECTURE.md`.

## Running it

The daemon and the app are independent npm packages.

```bash
# daemon — needs the Hermes API server key, which start.sh resolves for you
cd daemon && npm install && ./start.sh

# app, in another shell
cd app && npm install && npm start
```

The daemon expects a local oMLX server on `:8000` for STT and TTS, and an API key for the conversational layer provider in the environment
(see `daemon/capa.js` for the provider catalog and which variable each one reads).

## Tests

```bash
cd daemon && node --test              # daemon suite
cd app && node --test ui/lib/*.test.js  # UI library suite
```

`test-backend.js` and `test-ui-e2e.js` at the root are smoke harnesses that
require live processes. They are not part of the automated gate.

## Documents

| | |
|---|---|
| `REQUIREMENTS.md` | The product contract (R1..R8). What this has to be. |
| `ARCHITECTURE.md` | The technical design. How it has to be built. |
| `IDEA.md` | The north star and the reasoning behind it. |
| `BRIEF.md` | **Historical.** The original framing, superseded. Kept for the decisions it records. |
| `openspec/` | Spec-driven development artifacts. Progress lives here and in git, never in prose. |

## Status

This is a personal project under active development. Interfaces move.
