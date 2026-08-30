---
name: vault-post-merge
description: "Trigger: PR merged, close card, cerrar card, limpiar vault, post-merge cleanup, update rumbo. Reconcile the vault tracker after a PR lands."
license: Apache-2.0
metadata:
  author: "parada1104"
  version: "1.0"
---

## Activation Contract

Use after a PR merges, or when asked to close a card or tidy the tracker.

The vault is the tracker for this project — not Trello, not GitHub issues.
Scope: `engineering/hermes-voice/` in the vault MCP (`rumbo.md`, `pendientes/`,
`decisiones/`, `sessions/`).

Skip when nothing merged. An open PR closes nothing.

## Hard Rules

- Verify the merge with `gh pr view <n> --json state,mergeCommit`. `MERGED` plus
  a commit hash is the only evidence that closes a card. Never close on intent.
- Vault content is **Spanish**; this file and code stay English.
- Deferred work becomes its **own card**, never a note inside a closed one — a
  closed card is where follow-ups go to die.
- Record what was verified (suites, counts), not that it "works".
- If the PR delivered less than the card claimed, write that in the card. A
  tracker that overstates is worse than no tracker.
- Never invent a card for work nobody did.

## Decision Gates

| Situation | Action |
|---|---|
| Card fully delivered | `estado: cerrado` + merge commit, date, verification |
| Partially delivered | Card stays open; note what landed and what did not |
| Work deferred during the PR | New card, with the reason it was cut |
| Card blocked by the merged one | Unblock it and say so in its text |
| Card done but still `abierto` | Close it — stale states hide real progress |
| A premise proved wrong | Record the correction so it is not re-litigated |

## Execution Steps

1. Confirm the merge and capture the squash commit.
2. Read `rumbo.md` to find which épica owns the affected cards.
3. Close delivered cards: frontmatter `estado: cerrado`, plus commit, date and
   the verification evidence.
4. Create cards for deferred work and link them from the closing card.
5. Update `rumbo.md`: tick the épica checklist and add to `## Cerrado`.
6. Follow inbound links — cards naming the closed one may now be unblocked or
   wrong.
7. Scan the remaining cards for stale `abierto` states.

## Output Contract

Report: cards closed (with commit), cards created and why, `rumbo.md` edits,
cards unblocked or corrected, and stale states fixed. State explicitly when a
step found nothing.

## References

- `../../../CLAUDE.md` — vault scope and workflow rules for this project.
