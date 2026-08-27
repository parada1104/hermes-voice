# hermes-voice Runtime Brief

## Project

- **Project**: `hermes-voice`
- **Enabled runtimes**: `claude`, `cursor`, `opencode`
- **Integration branch**: `main`
- **Repo topology**: `standalone` (via auto)

## Runtime MCPs

**vault-canonical** *(global)*
- description: Canonical project notes in the vault (scoped to the project path).

Never expose env-backed secrets from MCP config in generated docs or comments.

## Runtime Flow

- VCS/PR provider: GitHub (`gh` CLI); base branch: `main`

## Context Sources

- Vault is the canonical note-taker for decisions, handoffs, and structured project context.

## Conflict Policy

- Current explicit human instruction controls the immediate scope unless it conflicts with safety, secrets, or a higher-authority project rule.
- Tracker controls work state; vault controls canonical decisions and handoffs; repo docs and manifests control versioned project contracts. Agent plans are lowest authority until accepted and recorded.

## Workflow Rules

- A session works on one explicit user request or tracker card; resolve focus from memory and tracker before starting.
- Use a PR-based merge workflow; all changes to `main` go through a pull request.
- VCS/PR provider: GitHub (gh CLI). Use gh for all PR operations.
- Do not push directly to `main`; always open a PR from a feature branch.
- After a merged PR, remove the feature worktree and delete the local branch (`git branch -D` after squash); delete the remote branch if it still exists.
- After a merged PR, sync `main` in the main worktree before further work: `git checkout main` then `git pull --ff-only`.
- Create a dedicated worktree for changes that write artifacts or modify code. Pure exploration can happen before a worktree if it writes no files.
- Do not merge or push to `main` without a PR and explicit human instruction.
- Preserve unrelated worktree changes; never revert changes you did not make.
- Before dispatching a write-capable subagent or task, verify which git repository, worktree, and branch yourself (`git rev-parse --show-toplevel`, `git branch --show-current`, `git worktree list`). Under monorepo-submodules, confirming which-repo via show-toplevel is mandatory. Do not rely solely on runtime pre-tool-use hooks — they may not fire for delegated/subprocess tool calls on opencode/pi/omp.
- If a structured Edit/Write/MultiEdit call is blocked or errors for any reason while on a protected branch, that is never grounds to retry the write via bash/shell (heredoc, `python3 -c`, `cat >`, `tee`, `sed -i`). Create a worktree first (e.g. `/worktree-new`) and write there instead.

## Useful Commands

- For ai-specs harness operations (init, sync, recipes, skills/deps, doctor), load the `harness-lifecycle`, `harness-recipes`, or `harness-skills-deps` skills.
