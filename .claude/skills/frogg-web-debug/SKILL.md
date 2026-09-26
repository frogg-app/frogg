---
name: frogg-web-debug
description: Debug and verify Frogg UI behaviour in the web preview with scripted, token-cheap probes. Use when checking a UI change actually works, reproducing a layout/animation/resize bug, measuring element positions, sampling an animation frame by frame, checking desktop window-chrome layouts (Windows/Linux controls, mac traffic lights) without Electron, confirming the preview serves your latest code, or when about to write a throwaway Playwright script.
---

# Web debugging with the preview

Everything runs against `npm run preview` (isolated daemon + hot-reloading web app, seeded
demo project and chats). Don't write ad-hoc Playwright scripts: `npm run probe` covers the common
moves and prints a few lines of text instead of screenshots-by-default.

## Loop

1. `npm run preview` as a background task (not under `timeout`). Ready when the log prints
   `Screenshot with`. If it dies with `TS6053 ... @types/...`, run `npm install` in the worktree.
2. Edit code; the web app hot-reloads.
3. **Confirm the edit is live** before measuring: `npm run probe -- --bundle "<new identifier>"`.
   "NOT FOUND" means your edit didn't land (a scripted replace silently missed, or the file
   has a syntax error) — not a cache problem.
4. Measure with `probe` (text). Take a screenshot only when layout needs eyes on it, and crop it.
5. Before committing: `npm run format:files -- <files>` (oxfmt; never `npx prettier`).

## Commands

- `npm run shot -- [target] [--click id] [--crop id] [--chrome windows]` — one PNG to `.dev/shots/`.
- `npm run probe -- --help` — the full step list. Targets: `chat`, `chat2`, `settings[/x]`,
  `host[/x]`, `/route`. Selectors: `@testID`, `@prefix*`, or CSS.

Key probe steps:

| Step                                                 | Use                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------- |
| `box @id`                                            | position/size of every match — compare before/after states    |
| `style @id opacity,width`                            | computed style (`w/h/x/y` = box)                              |
| `sample <sel> <props> <ms>` … `dump`                 | per-frame values during an animation; only changed rows print |
| `drag @handle <dx> 0 hold` / `move <dx>` / `release` | resize handles, split panes                                   |
| `viewport 900x700`                                   | window resize                                                 |
| `frames <name> <n> <x,y,w,h>`                        | stacked strip of rapid shots, for eyeballing a transition     |
| `park`                                               | move the pointer away so tooltips don't cover a shot          |

`--chrome windows|linux|mac` makes the web build reserve window-control space exactly like
Electron (dev-only `?chrome=` override in `apps/ui/src/utils/desktop-window.tsx`). The controls
themselves don't draw; their space does. Use it for anything near the title bar.

## Recipes

Toggle position is stable open vs closed:

```
npm run probe -- --chrome windows -s park -s "box @workspace-explorer-toggle" \
  -s "click @workspace-explorer-toggle" -s park -s "box @workspace-explorer-toggle"
```

Animation never shows clipped content (sample slot width + opacity while resizing):

```
npm run probe -- --chrome windows -s "click @workspace-explorer-toggle" \
  -s "drag @workspace-explorer-sidebar-resize-handle 200 0 hold" -s "wait 500" \
  -s "sample @explorer-sidebar-tab-* w,opacity 500" -s "move -100" -s dump -s release
```

Read the table rather than the frames: opacity > 0 while the width is still well short of its
final value means content is visible while clipped.

## Gotchas

- Screenshots take ~50–100ms each, so `frames` can't resolve a 250ms animation. Use `sample`.
- If you must pass a function to `page.evaluate` from a `.mts` script, pass a string: tsx
  injects `__name` helpers that don't exist in the page.
- A drag that jumps straight to its target can be missed by resize handles; `drag` does a small
  first move for you.
- Reanimated on web: verify timing modifiers (`withDelay`, `withSequence`) with `sample` rather
  than assuming them.
