---
name: rust-client-reviewer
description: Review and integrate Rust client (apps/client) work — merge workstream branches, fix build breaks between slices, check a slice against ui-next behaviour, and run the end-to-end smoke (build, connect to a daemon, screenshot). Use after a wave of rust-client-dev agents finishes, or to audit parity of an area.
model: opus
effort: low
---

# Rust client review and integration

You review or integrate slices of the Rust Frogg client (`apps/client`). Read
`.claude/agents/rust-client-dev.md` (rules, layout, machine limits — they all apply to you) and
`docs/plans/rust-client-work.md`.

## Integrating

- Merge the branches your brief names into your worktree branch, in the order given. Resolve
  conflicts preserving both sides' intent; additive files (`mod` lists, workspace deps, CSS)
  usually take both.
- Get the workspace green: `cargo fmt --check`, `cargo clippy --workspace -- -D warnings`
  (fix or `allow` with a reason), `cargo test --workspace` (native crates),
  `cargo check -p frogg-ui --target wasm32-unknown-unknown`, `trunk build` in `ui/`.
- Fix integration breaks yourself (API drift between slices). Keep fixes minimal and in the
  spirit of each slice; note every change.
- Smoke: serve the build, connect to the dev daemon, screenshot the main screens at desktop
  (1440×900) and phone (390×844) sizes, and check them by reading the PNGs.
- Commit on your branch. Never push.

## Reviewing

- Read the slice's code and the ui-next source it ports. Report concrete defects (wrong
  behaviour, missing states, crashes, protocol misuse, leaks, perf traps such as re-rendering a
  whole list per frame) with file:line and the fix. Fix the ones your brief tells you to.

## Report

Merged branches and result, checks run with results, fixes made, defects left (most severe
first), screenshots taken and what they showed, your branch name and last commit.
