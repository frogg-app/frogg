---
name: ui-next-dev
description: Build features in apps/ui-next, the Bracket + Rail prototype frontend (Expo Router, web + Android), against the round-4 design mockups and a live daemon. Use for any ui-next screen, panel, menu, settings page, phone/tablet layout or native fix. Not for apps/ui (use client-dev).
---

# ui-next development

You build one slice of `apps/ui-next`, a from-scratch Expo Router frontend for Frogg, inside
a worktree that several other agents are editing at the same time. Your brief names the files
you own. Ship your slice working against the live daemon, matching the mockups.

## Hard rules

- **Never** push, merge, commit, cherry-pick or touch `stable` or `main`. The coordinating agent
  commits. Read-only git only (`git diff`, `git log`, `git status`).
- Edit only the files your brief gives you. Shared files (`ui-store.ts`, `theme/tokens.ts`,
  `settings/controls.tsx`, `daemon/*.ts`, `util.ts`) take **additive** edits only: re-read
  immediately before each Edit, add new exports, never rename or reshape existing ones. If you
  need a breaking change in a file you don't own, report it instead.
- No timelines or effort-in-time estimates anywhere.
- No `apps/ui` edits. You may read it freely as a reference for daemon RPCs and behaviour.

## Where things are

- Design source: `design-exploration/mockups/round-4/` — `shots/<state>.jpg` is the target
  picture for each state; `app/*.js` (`settings.js`, `chat.js`, `tools.js`, `overlays.js`,
  `ui.js`, `data.js`) is the mockup markup and copy. Match layout, copy and hierarchy.
- App: `apps/ui-next/src/` — `app/index.tsx` (shell, responsive layout), `components/`,
  `components/settings/` (`Settings.tsx` nav + registry, `controls.tsx` rows/toggles/segments,
  `pages/<Page>.tsx` one file per page), `daemon/` (zustand stores over `@frogg/client`),
  `ui-store.ts` (selection/tool state), `theme/tokens.ts` (palette, fonts, motion).
- Daemon API: `packages/client/src/daemon-client.ts` (every RPC), `packages/protocol/src/messages.ts`
  (schemas, config shape). `apps/ui/src` shows how the shipping app uses them.

## Conventions (lint enforces most of these)

- Styles in `StyleSheet.create`; no inline style objects, no inline arrow props. Callbacks via
  `useCallback`; per-row callbacks by extracting a row component. Conditional style arrays
  `[s.a, on && s.b]` are fine. No nested ternaries, no index keys.
- Colours, fonts and motion only from `theme/tokens.ts`. Text through `T` (`components/Text.tsx`)
  with its variants. Chamfered shapes via `Cut`, selection via `Brackets`.
- Must work on web **and** native (Hermes, Android). No DOM APIs outside `*.web.tsx` files;
  provide a native fallback when you add a web-only file. No `localStorage` — use AsyncStorage.
- Responsive: phone 390, portrait tablet 768, landscape tablet 1024, desktop 1440. Phone uses
  bottom tabs and full-screen pushes; design every view to work at 390 wide.
- UI copy is plain English literals for now (no i18n in this prototype).

## Verify before reporting

From the worktree root:

1. `npx oxfmt apps/ui-next` then `npx oxlint apps/ui-next` (0 errors in your files) and
   `(cd apps/ui-next && npx tsgo --noEmit)`.
2. The web app is served from this worktree at `http://127.0.0.1:7830/` against a seeded mock
   daemon on `127.0.0.1:7821`; it hot-reloads. Add scenarios for your states to
   `apps/ui-next/scripts/scenarios.cjs` (additive; re-read before editing) and shoot them:
   `node apps/ui-next/scripts/shots.cjs <your-tag> <scenario,...> phone,desktop`. Use the tag your
   brief gives you (never a bare number — those are checkpoint galleries). Shots land in
   `design-exploration/mockups/ui-next/`. Look at every shot you take against the matching
   mockup, and report "no console errors" only if the script printed it.
3. Other agents run shots too. Keep runs to your own scenarios, at most two sizes per run.

## Report

One line per state built (with its shot filename), then anything not done, anything that
needs a file you don't own, and any daemon capability that is missing. Facts only.
