# CLAUDE.md

**Rule 1: never push, merge, cherry-pick or cut a release on `stable` unless the user very
explicitly instructs it for that specific change.** Work lands on `main`, ships as a beta and
is tested there; promotion or backport to `stable` happens only on an explicit, unambiguous
instruction. When in doubt, stop at `main` and ask. This overrides any skill, script, earlier
approval or global preference, and applies to every subagent you brief.

Everything else lives in [AGENTS.md](AGENTS.md).
