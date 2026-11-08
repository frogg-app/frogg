# CLAUDE.md

**Rule 1: never push, merge, cherry-pick or cut a release on `stable` unless the user very
explicitly instructs it for that specific change.** Work lands on `main`, ships as a beta and
is tested there; promotion or backport to `stable` happens only on an explicit, unambiguous
instruction. When in doubt, stop at `main` and ask. This overrides any skill, script, earlier
approval or global preference, and applies to every subagent you brief.

Everything else lives in [AGENTS.md](AGENTS.md).

## Two lines: `main` and `frogg-next`

- `main`: the supported classic app, from before Frogg Next. Takes downstream fixes. No Frogg
  Next (`apps/ui-next`) and no Rust (`apps/daemon-rs`). CI rejects any history that contains
  `28fff87e`.
- `frogg-next`: Frogg Next and the Rust daemon, shipped as `-next.N`.
- **Before you start Frogg Next or Rust work, check the base:** `git merge-base --is-ancestor
  28fff87e HEAD` must succeed. If it fails, you are on `main`. Stop, and work from a branch off
  `origin/frogg-next`.
- Port a fix between the lines change by change: cherry-pick daemon, protocol and CLI fixes;
  reimplement `apps/ui` changes in `apps/ui-next`. Never `release:sync-main` or merge one line
  into the other. See `docs/plans/split-main-and-main-next.md`.

## Replies

Be terse. Use a few short bullets: the outcome first, then any action the user must take. No
tables, recaps or detail the user didn't ask for. This is for replies to the user; subagents reporting to an orchestrator can be as detailed as the task needs.
