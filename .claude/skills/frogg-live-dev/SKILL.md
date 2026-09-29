---
name: frogg-live-dev
description: Run a feature branch end to end with real providers before it ships as a beta. Use when asked to "test this live", "try it for real", "let me use it", "run the branch", "test before beta", when a change needs a real agent run (not the mock preview), when the user wants to drive a branch's daemon from their installed Frogg app, or when tempted to cut a beta just to see a change work.
---

# Live development with `npm run dev:live`

Frogg runs **Development → Beta → Stable**. This skill is the Development stage: local
`dev:live` builds, no CI, nothing published. Beta is CI-built with auto-update (`main`);
Stable moves only by explicit promotion. A beta is for release validation, not the first time
a change runs. Test locally first.

## Pick the rung

| Change touches                       | Test it with                                                               |
| ------------------------------------ | -------------------------------------------------------------------------- |
| UI layout, copy, styling             | `npm run preview`, then `shot` / `probe` (`frogg-web-debug`)               |
| A feature end to end, real providers | `npm run dev:live`, open the printed URL                                   |
| Daemon behaviour behind the real app | `npm run dev:live`, add its daemon endpoint as a host in the installed app |
| Electron shell, native bridge        | `npm run dev:desktop` on a machine with a display                          |
| Packaging, installers, auto-update   | a beta build; nothing local covers these                                   |

## Start it

Prerequisites once per worktree: `npm ci` (wait for worktree setup to finish; a half-installed
`node_modules` fails with `ERR_MODULE_NOT_FOUND` inside `tsx`), then `npm run build:server`.

Run it as a **background task**, not under `timeout`:

```bash
npm run dev:live            # web 7820, daemon 9898 (LIVE_DAEMON_PORT)
PREVIEW_PORT=7830 npm run dev:live   # another worktree already on 7820
```

Wait for the banner, then give the user both lines verbatim:

```
Live:     http://<lan-ip>:7820
Daemon:   <lan-ip>:9898  (real providers, home .dev/live/home)
```

- **Web:** the URL opens in any browser on the LAN. Never hand out `localhost`; the VM is headless.
- **Installed app:** Hosts → Add host → the daemon endpoint. This drives the branch's daemon
  from the user's real client. The installed app's own UI code is unchanged — for UI changes
  use the web URL.

## What reloads

| Edit                                           | Effect                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------ |
| `apps/ui/**`                                   | hot-reload in the open page                                                          |
| `packages/server/src/**`                       | daemon restarts itself in a few seconds                                              |
| `packages/protocol` / `packages/client`        | run `npm run build:client`; the dist change restarts the daemon. Reload the page too |
| `EXPO_PUBLIC_*`, Metro config, new native deps | restart `dev:live`                                                                   |

Clients reconnect on their own after a daemon restart. A running agent turn is cut by the restart.

## State and isolation

- Home is `.dev/live/home`, persistent across runs: projects, chats and settings survive.
  Delete it for a clean slate. Nothing is seeded.
- Every start imports the installed daemon's provider accounts (`providerAccounts`, which are
  just config-dir pointers such as `~/.claude-steve`) and its projects/workspaces from `~/.frogg`,
  and its agent records, so no re-sign-in and existing repos and conversations open. The provider
  sessions behind those conversations are shared with the installed daemon: continue a
  conversation in one daemon at a time. `FROGG_LIVE_SOURCE_HOME=<dir>` picks another
  source; `=none` skips the import.
- The daemon names itself `<hostname>-DEVELOPMENT` (`FROGG_HOSTNAME`), so it can't be mistaken
  for the installed daemon in a host list.
- It never touches the installed stable daemon (9999, `~/.frogg`) or the side-by-side beta
  daemon. It is not "the deployed beta"; deployed daemons run release builds, not this branch.
- Relay is off and auth is not required — LAN only.

## Verify without the user

```bash
npm run shot -- host/providers --live      # screenshot a route of the live stack
npm run probe -- --live ...                # text probes, see frogg-web-debug
```

`chat`/`chat2` targets need seeded chats, which live mode does not create; use routes.

## Stop it

Stop the background task. If the launcher died uncleanly, the next `dev:live` reaps the leftover
process groups from `.dev/live/pids.json`. Don't `pkill -f preview.mts` in the same shell
command that names the path — it matches the shell and kills it.

## Before handing off

- Development is done only when the change works on a rung that exercises it. Say which rung you used and what you actually exercised (real provider run, host added, etc.).
- If the change needs packaging/update validation, say so explicitly — that still needs a beta.
- Shipping, if asked, follows the normal flow (main → beta). Never touch `stable`.
