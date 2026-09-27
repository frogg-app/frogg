---
name: frogg-live-dev
description: Run a feature branch end to end with real providers before it ships as a beta. Use when asked to "test this live", "try it for real", "let me use it", "run the branch", "test before beta", when a change needs a real agent run (not the mock preview), when the user wants to drive a branch's daemon from their installed Frogg app, or when tempted to cut a beta just to see a change work.
---

# Live development with `npm run dev:live`

A beta is for release validation, not the first time a change runs. Test locally first.

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
npm run dev:live            # web 7820, daemon 7821
PREVIEW_PORT=7830 npm run dev:live   # another worktree already on 7820
```

Wait for the banner, then give the user both lines verbatim:

```
Live:     http://<lan-ip>:7820
Daemon:   <lan-ip>:7821  (real providers, home .dev/live/home)
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
- Real provider logins come from the user's own `~` (Claude, Codex, …), same as a normal daemon.
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

- Say which rung you used and what you actually exercised (real provider run, host added, etc.).
- If the change needs packaging/update validation, say so explicitly — that still needs a beta.
- Shipping, if asked, follows the normal flow (main → beta). Never touch `stable`.
