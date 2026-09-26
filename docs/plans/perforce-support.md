# Perforce support

Status: analysis only; no implementation yet.

Goal: Perforce projects in the ADE. Agents get read-only (or open-without-submit) access; the ADE client performs submits. Must work for sandboxed daemon installs reaching host files over 9p or similar.

## Current coupling

- No VCS abstraction. ~10k lines of git-specific code: `packages/server/src/utils/checkout-git.ts`, `utils/worktree.ts`, `server/workspace-git-service.ts`; ~131 `runGitCommand` call sites across 16 files.
- Protocol encodes git directly: `isGit` literal discriminants and `projectKind: "git" | "non_git" | "directory"` (`packages/protocol/src/messages.ts`).
- Approach: add `projectKind: "p4"` as a parallel path rather than refactoring git behind an interface. `non_git`/`directory` already prove the UI degrades without git features.

## Concept mapping

| Frogg/git concept         | Perforce equivalent                                                                                     | Size  |
| ------------------------- | ------------------------------------------------------------------------------------------------------- | ----- |
| Status / diff panel       | `p4 -ztag -Mj opened` + `p4 diff -du`, adapted to `CheckoutDiffResult`                                  | M     |
| Worktree per workspace    | v1: pending changelist per workspace in a shared client. Client-per-workspace needs a full sync — defer | M / L |
| Watcher-driven refresh    | Poll `p4 opened` + path-scoped `reconcile -n`; watchers unreliable on 9p anyway                         | S     |
| Commit / merge / PR       | Shelve + submit; Swarm out of scope                                                                     | M     |
| Branch suggestions, forge | N/A — hide                                                                                              | S     |

## Sandboxed / 9p installs

- p4 is a network client; state lives on the server, so no `.git` index over 9p. Sandbox needs network reach to `P4PORT`.
- Host vs guest path mismatch: client spec `AltRoots` with blank `Host`. Host P4V and guest daemon can share one client workspace.
- Gotchas: full-tree `p4 reconcile` over 9p is slow (scope it); files are read-only until `p4 edit` (use `allwrite` + reconcile before shelve/submit, or teach agents to `p4 edit`); `P4TICKETS`/`P4CONFIG` placement inside the sandbox.

## Permissions

- Provider deny rules (`p4 submit`, `obliterate`, `revert`, …) are a soft layer only — bypassable.
- Hard enforcement: dedicated agent p4 user, limited in the protections table to `read` or `open`. Only that ticket is injected into the agent env.
- Human submit credential must not sit on the daemon filesystem (agents share the uid). Client (desktop keychain) passes it per submit RPC; daemon never persists it.
- Changelist ownership: prefer agent shelves → human's client unshelves and submits (clean audit trail, doubles as review). Alternative: `p4 change -U` / `reopen`.
- To verify: exact protection level required by `p4 shelve`.

## Order

1. `projectKind: "p4"` detection + read-only status/diff panel (M)
2. Agent p4 user + ticket injection + provider deny rules (S–M)
3. Shelve → submit RPC with per-request human credential (M)
4. Isolated client workspaces per Frogg workspace (L; only if changelist-per-workspace falls short)
