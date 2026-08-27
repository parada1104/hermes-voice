# Hermes Voice — conversational voice layer for Hermes Desktop

## What we are building

A **standalone conversational voice layer** that plugs into agents, shipped as a
**Hermes Desktop runtime plugin**. A lightweight conversational model handles the
dialogue and **delegates real work to Hermes** (and later to other agents:
opencode, codex, vim).

This is the same architectural shape Codex uses: a small fast model that decides
many times per second whether to speak, listen, pause, or delegate, plus a heavy
backend that does the actual work.

## Scope of THIS task (the only thing to build right now)

A **plugin skeleton with fake data**. No audio. No model. No Hermes calls.

The goal is to prove the plugin door works end to end before any of the hard
parts land.

Deliverables:

1. A runtime plugin loading from `$HERMES_HOME/desktop-plugins/<name>/plugin.js`
   (i.e. `~/.hermes/desktop-plugins/`).
2. **Two window modes**, switchable:
   - **Floating orb** — frameless, transparent, always-on-top. Shows mic state
     with a mute toggle. Nothing else.
   - **Text + voice** — the main pane. Shows a live conversation thread.
3. A **fake conversation thread** rendered in the text+voice mode, exercising the
   full data model below (see "Data model"). Hardcoded fixtures are fine and
   expected.
4. Mode switching works, state survives a plugin reload.

**Explicitly out of scope for this task:** microphone capture, STT, TTS,
WebRTC/Realtime transport, any LLM call, any call to Hermes. Do not build them,
do not stub network clients for them. Leave clean seams where they will attach.

## Data model (important — this is the part that is easy to get wrong)

The conversational agent owns **its own thread**. Hermes conversations are NOT
its conversations — they are its **delegated tasks**.

Each delegation renders as a **nested, collapsible run inside the voice turn**,
collapsed by default:

```
Voice thread (owned by this plugin)
├─ user:  "how is the project board doing"
├─ agent: "give me a second"
│         ▸ Hermes · 4 tools · 12s        ← nested, collapsed, expandable
└─ agent: "there are 4 tickets in review..."
```

Two distinct histories. Do not flatten them into one, and do not reuse Hermes'
own thread store for the voice thread.

Why the nested run must be visible at all: it is the only way to catch the known
failure mode where a small conversational model **confabulates** an answer
without ever calling the delegation tool. If only the synthesis is shown, that
bug is invisible.

Both sides of the conversation must be shown as **live-updating transcripts**
(user speech and agent speech), because the transport that will land later emits
text and audio in parallel as first-class outputs.

## Where to look first

**Fetch the `hermes-desktop-plugins` skill before writing any code.** It is
referenced by the Hermes Desktop plugin README but is not installed on this
machine. It is the authoritative guide for the plugin contract.

Hermes Desktop source (read-only reference — do NOT modify it, see Constraints):
`~/.hermes/hermes-agent/apps/desktop`

- `src/plugins/README.md` — documents the disk door and the plugin contract.
- `src/contrib/` — `registry.ts`, `plugin.ts`, `plugins-store.ts`,
  `runtime-loader.ts`, `events.ts`, `react/`, `types.ts`.
- `src/app/contrib/` — `surfaces.tsx`, `panes.tsx`, `controller.tsx`,
  `wiring.tsx`. This is how a plugin gets a surface in the app.
- `src/plugins/kanban/` — **the best reference**. A full-featured plugin with its
  own pane, drawer, API layer, i18n and CSS. Proves a plugin can be a complete
  UI surface, not just a widget. Study this before designing anything.
- `electron/wake-indicator-window.ts` — an existing frameless + transparent +
  always-on-top window. **The floating orb machinery already exists; reuse this
  pattern rather than inventing it.**
- More reference plugins live upstream at
  `github.com/NousResearch/hermes-example-plugins`.

## Constraints

- **Runtime plugins may only import `@hermes/plugin-sdk` and `react`.** This is
  enforced by `runtime-loader.ts`. Design within it.
- **Do not modify the Hermes Desktop repo.** `~/.hermes/hermes-agent` is a clone
  of `NousResearch/hermes-agent` and `hermes update` reverts local changes —
  there are already 4 patched files there that keep getting reverted. Living
  outside the repo, in the plugin door, is the entire point of this approach.
  If something seems to require patching upstream, stop and report it instead.
- Source of truth for this project lives in this repo. The built plugin is
  installed/symlinked into `~/.hermes/desktop-plugins/`.
- Hot reload exists: a file watcher, a poll fallback, and a ⌘K
  "Reload desktop plugins" command. Use it in the dev loop.

## Design decisions already made (do not relitigate)

- **Two window modes, not three.** An earlier standalone macOS app had a third
  "compact" mode with buttons and a sphere. That was scaffolding for living
  outside Hermes. Inside Hermes Desktop it is dropped.
- **Host is Hermes Desktop, not a standalone Swift app.** The previous
  `HermesVoz.app` (~1,290 lines of Swift) is superseded. Desktop already provides
  conversations, themes, i18n, command palette, overlay windows — and, critically,
  Chromium's native WebRTC, which is the default transport for the realtime
  speech API that lands later.
- **The conversational model is not chosen yet.** Cerebras and others will be
  tested. Therefore the layer must be provider-portable.
- **Keep the toolset minimal** — ideally one delegation tool plus stop/cancel.
  Small models degrade quickly as tools multiply.
- **Routing decisions belong in code, not in the prompt.** A previous iteration
  put delegation discipline in the system prompt and a 7B model confabulated
  anyway; the fix was deterministic pre-routing in code. Keeping routing out of
  the model is what makes swapping providers cheap. Nothing in this task
  implements routing, but do not design a seam that assumes the model decides.

## Definition of done for this task

- `orca worktree` builds clean, typechecks, lints.
- The plugin loads from the disk door into a running Hermes Desktop.
- Both window modes render and switch.
- The fake thread renders with at least one collapsed nested delegation run that
  expands and collapses.
- A short `README.md` explains the dev loop: build, install to the door, reload.
- No changes anywhere under `~/.hermes/hermes-agent`.

## Report back

When done, report: what loaded, what did not, and anything in the plugin contract
that blocked the design. If the `hermes-desktop-plugins` skill cannot be fetched,
say so early rather than guessing the contract from source.
