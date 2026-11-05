# Frogg Next release flow

Discord #98 (owner, 25 Oct): "rebuild the beta flow, move Frogg Next back to its own package /
build in gh". This plan replaces the 1.6.14-beta.2 switch, where `main` prereleases shipped Frogg
Next instead of the classic beta.

## Today (1.6.14-beta.2 and later)

| Branch   | Tag            | Client                            | Daemon       |
| -------- | -------------- | --------------------------------- | ------------ |
| `main`   | `X.Y.Z-beta.N` | Frogg Next (`app.frogg.next`)     | normal, 9999 |
| `stable` | `X.Y.Z`        | classic frogg (`app.frogg.frogg`) | normal, 9999 |

Made by e3d15fdc (branding: one identity plus `brand.next`), 80b67eab (release.yml picks the
client from the version), c05833bb (Frogg Next signing and feeds), 897b3c96 and eb427f6e (classic
desktop and Android follow stable only), 2164f316 (side-by-side beta daemon retired), 8f943bea
(docs). The classic "frogg beta" (`app.frogg.frogg.beta`) has had no build since 1.6.14-beta.1.

## Target

| Branch       | Tag            | Client                                          | Daemon       | Cut by                            |
| ------------ | -------------- | ----------------------------------------------- | ------------ | --------------------------------- |
| `frogg-next` | `X.Y.Z-next.N` | Frogg Next (`app.frogg.next`)                   | own, 9969    | `frogg-next.yml` after green push |
| `main`       | `X.Y.Z-beta.N` | frogg beta: classic app, `app.frogg.frogg.beta` | normal, 9999 | `ci.yml` after green push         |
| `stable`     | `X.Y.Z`        | frogg: classic app, `app.frogg.frogg`           | normal, 9999 | unchanged (Rule 1)                |

- **Frogg Next's own daemon (owner, 2026-11-05).** `-next.N` releases ship a separate daemon
  so Frogg Next develops in parallel with frogg and frogg beta and runs beside them on one host:
  port 9969 (web 9968), `~/.frogg-next`, the `frogg-next` CLI, `FROGG_NEXT_` env prefix,
  `frogg-next-daemon` service, `frogg-next-daemon-<v>-<os>-<arch>` bundles. It comes from the
  brand's `next` daemon keys (`brand prepare --daemon next`, `FROGG_BRAND_DAEMON=next`, set by
  `release.yml` on every `-next.N` job except the web UI export). Its install script defaults to
  the `next` channel and its self-update follows `-next.N` only. Frogg Next looks for
  `127.0.0.1:9969` by default. `-next.1` to `-next.3` daemons carry the stable identity. This
  replaces "one daemon" below for the `next` line.
- **One daemon (stable and beta lines).** Every release carries the normal daemon bundles (port 9999, `~/.frogg`, `frogg`
  CLI). The beta daemon (`frogg-beta`, 9989, `~/.frogg-beta`) stays retired.
- **frogg beta is a client identity only.** It installs beside the stable app like it did before
  beta.2 (own app id, name, scheme, binary name, artifact prefix, icon ribbon, `electron-beta`
  feeds) but its daemon identity (port, home, CLI, env prefix, service) is the stable one, so a
  fresh install finds the normal daemon. That mirrors how `brand.next` works for Frogg Next.
- **Frogg Next has its own line.** `frogg-next` is long-lived. Its pushes run CI in
  `frogg-next.yml`, and a green push cuts `X.Y.Z-next.N` and dispatches the release build. Frogg
  Next keeps its own build workflows (`ui-next-desktop.yml`, `ui-next-android.yml`), package
  names (`Frogg-Next-*`), feeds (`frogg-next-latest*.yml`) and checksums.
- **One publisher.** `release.yml` stays the only workflow that creates and publishes a GitHub
  release. It routes on the tag's line: stable → classic, `beta` → frogg beta, `next` → Frogg
  Next. The daemon bundles, Docker image, metadata and publish verification stay in one place
  instead of a second copy in a Frogg Next workflow drifting from the first. Frogg Next's "own
  build in gh" is its own CI and cut workflow plus its own build workflows; flagged below.
- `ui-next-desktop.yml` and `ui-next-android.yml` build artifacts on `frogg-next` pushes instead
  of `main` pushes.

### Versions

- `next` is already an upstream channel name in both `release-version.ts` and
  `release-channel.mjs`, so `X.Y.Z-next.N` is a prerelease everywhere, and forks get
  `X.Y.Z-next.N.acme.M` for free.
- A new `releaseLineOfVersion` (stable | beta | next) splits prereleases by their first
  identifier. `channelOfVersion` stays stable | beta for every existing caller.
- `frogg-next` versions follow `main`'s core: `release:next` cuts `<main's X.Y.Z>-next.N`. At an
  equal core `next` sorts above `beta` (semver compares the identifiers as strings), so Frogg
  Next is always the newest prerelease of its core.
- `frogg-next` merges `main` with `npm run release:sync-main`, which merges and restamps the
  branch's own version (the same restamp `sync-upstream` uses), so version files never conflict.
- `release:promote` still copies `main` to `stable`. Promoting Frogg Next to stable is out of
  scope; it needs its own plan when the owner wants it.

### Where work lands

- Frogg Next UI (`apps/ui-next`, its workflows and scripts) lands on `frogg-next`.
- Everything shared (daemon, protocol, client, CLI, branding, release tooling) lands on `main`,
  then reaches `frogg-next` through `release:sync-main`. A daemon RPC Frogg Next needs ships to
  `main` first, so the one daemon never forks.
- The classic app (`apps/ui`, `apps/desktop`) lands on `main`.
- Nothing merges from `frogg-next` into `main`. A shared fix made on `frogg-next` by mistake is
  cherry-picked to `main`.

## Update contract

Every updater picks from `GET /repos/<repo>/releases`, so all three lines share one release list.
The rule from here on: **an updater only takes a release that carries its own update assets.**
Release order then stops mattering.

| Installed client                       | Picks today                                     | After this change                                                |
| -------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------- |
| Frogg Next desktop 1.6.14-beta.2/.3    | newest prerelease with `frogg-next-latest*.yml` | same; `-next.N` carries the feeds, so it moves on unchanged      |
| Frogg Next Android 1.6.14-beta.2/.3    | newest prerelease, then looks for its APK       | new builds only take releases with a `Frogg-Next-*.apk`          |
| frogg beta desktop ≤1.6.14-beta.1      | newest prerelease, reads its `release.json`     | new builds only take releases with `electron-beta*.yml`          |
| frogg beta Android ≤1.6.14-beta.1      | newest prerelease, then looks for its APK       | new builds only take releases with a `frogg-beta-*.apk`          |
| frogg (stable) desktop, Android        | stable releases only                            | unchanged                                                        |
| Daemon `self-update`, Beta channel     | newest release of either kind                   | newest stable or `-beta.N`; `-next.N` only by pinned version     |
| `install.sh` with `FROGG_CHANNEL=beta` | newest prerelease                               | newest `-beta.N`; `FROGG_VERSION=X.Y.Z-next.N` pins Frogg Next's |

Installed builds cannot be changed, so the old ones need a bridge:

- **Frogg Next desktop**: no bridge needed; it already filters by its feed.
- **Frogg Next Android 1.6.14-beta.2/.3**: takes the newest prerelease. `-next.N` outranks
  `-beta.N` at the same core, so the first `-next.N` is the newest prerelease when it ships and
  stays so while the cores match. Any straggler catches the next `-next.N`. Low risk.
- **frogg beta ≤1.6.14-beta.1 (desktop and Android)**: takes the newest prerelease of any kind,
  and a `-next.N` outranks `-beta.N`. Its first classic beta must be the newest prerelease when
  it checks. Rollout order:
  1. Merge this to `main`. `main` cuts `1.6.14-beta.4` (the next beta; it outranks beta.3) with
     frogg beta builds. Old frogg beta installs update to it; it carries the filtering updater.
  2. Hold the first `frogg-next` cut until the owner is happy with uptake (the coordinator picks
     the window). Frogg Next desktop users are unaffected by the hold.
  3. Create `frogg-next` from `main` and cut `1.6.14-next.1`.
     A frogg beta install that misses the window sees the Frogg Next release's `release.json`
     manual-install message (classic payloads are absent) and reinstalls once from the releases
     page. That message now names the frogg beta releases.
- The old beta daemon is still installed on machines that had it. The new frogg beta finds the
  normal daemon on a fresh install; an existing frogg beta keeps its saved hosts, including the
  old 9989 one, until the user removes it.

## Implementation

1. **Branding**: `resolveBrandManifest(input, { channel: "beta" })` returns the frogg beta client
   identity (derived as before: `<appId>.beta`, "<name> beta", `<scheme>-beta`,
   `<binary>-beta`, `<prefix>-beta`, `channels.beta` overrides, BETA icon ribbon). The daemon
   identity keys stay stable. `FROGG_BRAND_CHANNEL` (and `brand prepare --channel`) selects it;
   only client jobs set it.
2. **Classic desktop**: a frogg beta build follows prereleases: newest non-draft prerelease that
   carries `electron-beta.yml`, verified against its `release.json`; the stable build is
   unchanged. The renderer does not choose; the build's identity does.
3. **Classic Android**: a frogg beta build takes prereleases carrying its own APK prefix.
4. **Frogg Next Android**: only releases carrying a `<prefix>-*.apk` count.
5. **Release scripts**: `releaseLineOfVersion`; `release.json` gets client `classic-beta` with
   `electron-beta` feeds for `-beta.N`; `frogg-next` for `-next.N`; publication checks each
   release carries only its client's files. Streams config gains `streams.next` (default
   `frogg-next`); `assert-tag` sends `-next.N` tags there; `release:next` and `release:sync-main`.
6. **Daemon updates**: Beta channel and `install.sh FROGG_CHANNEL=beta` skip `-next.N`.
7. **Workflows**: `release.yml` routes three ways and sets `FROGG_BRAND_CHANNEL=beta` on the
   classic client jobs of a `-beta.N` tag. New `frogg-next.yml`: CI on `frogg-next` pushes and
   pull requests, then cuts and dispatches `-next.N`. `ui-next-*` push triggers move to
   `frogg-next`. `ci.yml` keeps cutting betas on `main`. `build-selected.yml` builds frogg beta
   for non-stable refs again.
8. **Docs and agent guidance**: `docs/release-streams.md`, release-process and release-streams
   pages, AGENTS.md, CLAUDE.md, the frogg-release skill, stream diagrams.

## Decisions for the owner

- **Separate publisher or shared one.** This plan keeps `release.yml` as the one publisher and
  gives Frogg Next its own CI/cut workflow and build workflows. A fully separate
  `frogg-next-release.yml` would duplicate the daemon, Docker, metadata and publish jobs.
- **Rollout window** between the first frogg beta (`1.6.14-beta.4`) and the first `-next.N`.
- **Daemon RPCs for Frogg Next land on `main` first.** If Frogg Next needs daemon work that
  `main` should not ship yet, the single daemon has to fork or the work waits behind a feature
  flag.
- **Frogg Next's daemon bundles.** Each `-next.N` release carries daemon bundles at its version,
  but the daemon Beta channel follows `-beta.N`. Frogg Next testers get Frogg Next's daemon only
  by pinned version. The alternative (Beta follows the newest of both lines) puts daemons from
  two branches on one channel.
- **The frogg beta icon ribbon** comes back with the identity. Drop it if two plain icons are
  preferred.
