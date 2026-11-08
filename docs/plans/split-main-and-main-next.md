# Split `main` and Frogg Next

Status: done. `main` was reset to the tree from before Frogg Next was merged, and Frogg Next and
the Rust daemon carry on in parallel on `frogg-next`.

- `main` is the supported product. It takes downstream changes and fixes, and ships `-beta.N`.
- `frogg-next` is the parallel main branch (this plan called it `main-next`). It already had its
  own CI, `-next.N` releases and update feeds, and held all of the old `main`, so it was used as is
  rather than renamed.
- `stable` is not part of this plan. Rule 1 in [CLAUDE.md](../../CLAUDE.md) still applies.

## Refs

| Ref              | Commit     | Notes                                                 |
| ---------------- | ---------- | ----------------------------------------------------- |
| Pre-merge        | `fbca0b75` | `1.6.13-beta.5`, base of the new `main`               |
| Frogg Next merge | `28fff87e` | `integrate/frogg-next`; CI rejects it on `main`       |
| Old `main`       | `f2ebd3a1` | `1.6.14-beta.10`; kept as `archive/main-before-split` |

## What the new `main` adds on `fbca0b75`

- `ci(release)`: retry half-completed asset uploads (from `96949dca`, without the ui-next jobs).
- `fix(config)`: accept `daemon.usageStats`, which the Frogg Next betas write. The daemon schema is
  strict, so without it a beta user's daemon would refuse to start.
- `chore(release)`: version `1.6.14-beta.10`, so the first green CI run cuts `1.6.14-beta.11` and
  beta users receive it as an update.
- CI step `Keep Frogg Next off main`: fails any push or PR to `main` whose history contains
  `28fff87e`.

Left off `main` on purpose:

- Rust (`rust-rebuild`, `befe7a04`) stays on `frogg-next`.
- #114 provider switch (`a9127d2f`): a Frogg Next composer feature.
- `264f48e2`, `2e8cf14e`: release changes that only matter for the Frogg Next release jobs.
- The `bl/*` and `nb/*` merges and the ui-next CI attach jobs.

## Working on the two lines

- **Downstream into `main`:** branch from `origin/main` and open the PR against `main`. A fork of
  1.6.9 rebases cleanly enough; it predates Frogg Next.
- **Old branches:** anything cut from `main` before the split carries Frogg Next. Rebase the
  commits you want onto `main` (`git rebase --onto origin/main <old-main-base>`), or target
  `frogg-next` instead. CI blocks the mistake.
- **Porting to Frogg Next:** pick per change. Daemon, protocol, CLI and release fixes usually apply
  as a cherry-pick (`git cherry-pick -x`) onto `frogg-next`. Classic UI changes (`apps/ui`) are
  reimplemented in `apps/ui-next` when they make sense there, not merged.
- **Avoid `release:sync-main`** for now. It merges all of `main` into `frogg-next`, including the
  version move, which conflicts with the `-next.N` line. Cherry-pick instead.
- **Clones and worktrees:** `git fetch && git reset --hard origin/main` on any checkout of `main`.
  `main` moved non-fast-forward.

## Beta users

Beta users on `1.6.14-beta.1` to `.10` move to `1.6.14-beta.11`, which has no Frogg Next. Checked:

- Daemon `config.json`: `daemon.usageStats` was the only new key; now accepted.
- Provider account preferences: the new `launchArgs` is dropped on load, not rejected.
- `frogg.json` `agentDefaults` and plugin `agentTools`: ignored by the older schemas, not rejected.

## Later

- When `frogg-next` is ready it comes down to a new `main`. That step is planned separately.
