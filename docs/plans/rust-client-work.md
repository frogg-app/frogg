# Rust client: work plan

Execution plan for [rust-client.md](rust-client.md). The coordinator runs workstreams as
parallel `rust-client-dev` agents in their own worktrees, merges each wave with a
`rust-client-reviewer`, and pushes to `frogg-next`. The reference implementation for every
behaviour and look is `apps/ui-next`.

## Goal: a usable build

The "usable" bar, before parity polish:

1. CI builds the Rust client for Linux, Windows, macOS (Tauri bundles) and Android (APK) as
   **Frogg Next RS** (`app.frogg.next.rs`), installable beside Frogg Next and frogg.
2. Hosts: add a host by address (direct WebSocket, password or device token), pair with a code
   or link (relay, E2EE), several saved hosts, switch between them, reconnect.
3. Sessions: rail and list of agents with status, open one, timeline (user/assistant messages,
   reasoning, tool calls with their panes, markdown and code), streaming updates, send a
   prompt with attachments, stop, approve or deny permissions, archive.
4. New session: provider, model, mode, project/folder, worktree option.
5. Terminals (view and type), files (browse, view, diff), SCM status.
6. Settings: hosts, theme, the main prefs. Desktop window chrome; Android keyboard and back.

Then parity: walk `apps/ui-next/PARITY.md`, the lab entries, and the remaining panels.

## Contracts (all workstreams)

- **Client core API.** `DaemonClient` (Rc-shared, single-threaded) exposes one async method per
  `@frogg/client` `DaemonClient` method ui-next uses, in snake_case (`fetchAgents` →
  `fetch_agents`), taking plain arguments or an options struct and returning the generated
  `outbound::*Payload` (or a local struct where the generated type is wrong), `Result<T, Error>`.
  Pushes arrive as `Event::Session(SessionFrame)`; typed convenience subscriptions may be added
  beside it. Connection: `ws::connect(&client, url, ConnectOptions)` (password / token),
  relay via `relay::connect`. Request timeout default 30 s.
- **UI layout** (`apps/client/ui/src`): `main.rs` (mount only), `app.rs` (root: picks desktop /
  tablet / phone layout), `theme/`, `components/` (primitives: Button, Select, Text, Icon, Seg,
  Skeleton, Sheet, Menu, Field…), `shell/` (Rail, Brackets, StatusBar, PhoneTabs, Palette, kbd,
  toasts), `state/` (hosts, connection, agents, prefs, ui store — reactive stores other code
  reads), `views/` (screens and panels, one module per area), `native/` (Tauri bridge; no-ops
  on the web). Breakpoints: phone < 700 px ≤ tablet < 1100 px ≤ desktop.
- **Storage**: `state::storage` (localStorage on every target; the Tauri WebView persists it).
- **Identity**: app id `app.frogg.next.rs`, product name "Frogg Next RS", default daemon
  `127.0.0.1:9969`.

## Waves

### Wave 1 (parallel)

| Stream | Owns                                                                                       | Delivers                                                                                                                                                                                                                                                                                                                                                                                                               |
| ------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| core   | `apps/client/core`                                                                         | Full RPC surface ui-next uses (`grep -rho "client\.[a-zA-Z]*(" apps/ui-next/src`), auth (password, device token), reconnect with backoff, liveness heartbeat, timeouts, stale-socket guard, terminal stream router, relay v2 transport with E2EE (tweetnacl-compatible), device identity, pairing-link parsing. Tests against a fake transport.                                                                        |
| shell  | `apps/client/ui` except `native/` and `views/*` beyond stubs                               | Theme (every theme in `themes.ts`, switchable), primitives, icons, state stores (hosts with persistence, connection per host, agents list with live updates), app shell (Rail, Brackets, StatusBar, PhoneTabs, Palette, kbd, toasts) at all three breakpoints, host add/switch sheet, empty `views/` modules routed from the shell, `scripts/shot.mjs`.                                                                |
| render | `apps/client/render`                                                                       | `Markdown` (pulldown-cmark, GFM tables/tasks, code blocks), `Code` (syntax highlighting in pure Rust, themed from CSS vars), `DiffView` (unified + split, word-level), `Terminal` (vt100 parser, DOM or canvas grid, input, resize, scrollback, selection/copy). Each with a demo page in a `render` example or test.                                                                                                  |
| native | `apps/client/src-tauri`, `apps/client/ui/src/native/`, `.github/workflows/rust-client.yml` | Tauri plugins (store, notification, opener, dialog, deep-link, updater, os, clipboard), window chrome per OS (custom title bar like ui-next desktop), bridge API in `native/` with web fallbacks, Android project (`cargo tauri android init`, committed), CI workflow building Linux/Windows/macOS bundles and a signed-if-secrets-present APK on `frogg-next` pushes touching `apps/client/**`, uploading artifacts. |

### Wave 2 (parallel, after wave 1 merges)

| Stream   | Ports                                                                                                                                                                                              |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| chat     | `components/chat`, `Chat`, `ToolCall`, `tools/`, `PermissionCard`, `Composer`, `subwork/`, `markdown/` usage                                                                                       |
| sessions | `SessionList`, `sessions/`, `Inbox`, `Home`, `NewSession`, archive/labels                                                                                                                          |
| panels   | `Files`, `ScmPanel`, `scm/`, `DiffView` usage, `TerminalsPanel`, `TerminalView`, `TasksPanel`, `tasks/`, `SearchPanel`, `PrsPanel`, `ci/`, `UsagePanel`, `Meter`, `PluginsPanel`, `CompanionPanel` |
| flows    | `onboarding/`, `signin/`, `hosts/`, `HostsPanel`, `settings/`                                                                                                                                      |

### Wave 3

Parity walk (PARITY.md, lab entries, screenshot comparison per area), performance against the
gates in rust-client.md, release integration (attach Rust client artifacts to `-next.N`
releases), docs.

### Wave 7 (parity gaps, parallel)

From the parity audit against `apps/ui-next`. Each slice owns its paths; shared files take
additive edits only. Sizes are S/M/L.

**7a chat-session** — owns `ui/src/views/chat/mod.rs`, `ui/src/views/chat/item.rs`, new
`ui/src/views/chat/{session_menu,session_state,notices,chips}.rs`

- [done] L: session menu in the chat head (rename, fork, rewind, clean cut, detach, new window, copy
  ID, archive with unsaved-work check) — `chat/SessionMenu.tsx`.
- [done: `chat/chips.rs`, `session_state.rs`; composer (7b) places the chips and calls `session_state::busy`/`queue_message`] L: provider chip and clean-cut flow (scissors with blocked reason, cut queue, move/cut
  dialogs) — `chat/ProviderChip.tsx`, `cutQueue.ts`, `cleanCut.ts`, `sessionOps.ts`.
- [done: `chips::AccountChip`, placed by 7b] M: account chip (move or clean cut to another account) — `chat/AccountChip.tsx`.
- [done] L: session state cards (host offline + Reconnect, waiting on background work, finished,
  ready to review, signed out, failed) — `chat/SessionState.tsx`.
- [done] M: composer notices (operation progress, queued message, stale cache, auto-resume) —
  `chat/Notices.tsx`.
- [done: viewing presence; typing state needs the composer to report it] M: viewers ("also here") and typing presence — `chat/Viewers.tsx`.
- [done] S: full header title from the first prompt line (`chat/title.ts`); M: reveal heading (CSS rise on title change).
- L: streaming text reveal per `textReveal` pref — `chat/TextReveal.tsx`.
- [done] M: bottom anchor on content resize (images, clamps), 24px slack — `chat/useBottomAnchor.ts`.
- [done] S: key permission cards with `<For>` on id so live agent updates keep a half-typed reply
  (`chat/mod.rs` permission block); mount `Lightbox` once per window, not per pane; resubscribe
  when the active client changes while online.

**7b composer** — owns `ui/src/views/chat/{composer,permission}.rs`

- M: thinking-level picker in agent controls; S: model label falls back to provider default.
- M: slash menu groups (Commands/Skills), prefix-first sort, load-error state.
- M: draft stash (Ctrl+S); S: `!cmd` shell-escape note behind `agentShellEscape`.
- M: resizable/expandable composer, size per session — `chat/composerSize.ts`.
- M: question card multi-select, "Other…", back/next, dismiss, answers keyed by `header`
  (verify the daemon key) — `chat/QuestionCard.tsx`.
- S: context meter ring with token counts; attach menu (images/files) with dedupe; offline
  disables attach/paste/drop; drag-highlight depth counter; drop `Uploading` chips from saved
  drafts; keep focus on send (`readonly` instead of `disabled`).
- M: fork-context attachment (`initialAttachments`).

**7c tools-subwork-markdown** — owns `ui/src/views/chat/{tool,subwork}.rs`,
`apps/client/render/src/markdown`

- M: host-relative images (`HostImage`, `ImageRoot`) in markdown and image tool rows.
- S: markdown tables with inline-markdown cells and measured widths — `markdown/MdTable.tsx`.
- S: `Clamp` remeasures on resize (ResizeObserver) and animates; tool pane body not rebuilt per
  streamed chunk.
- L: full sub-work model (background commands, workflows, ports, to-dos, nesting) and strip
  (tone roll-up, "+N more", elapsed, port chips) — `subwork/*`.
- M: sub-work detail live status, links, scroll anchor, refetch on reconnect.

**7d sessions-shell** — owns `ui/src/views/sessions/**`, `ui/src/views/new_session/**`,
`ui/src/shell/**`, `ui/src/state/{sessions,projects,ui}.rs`

- M (done): merged terminals in the sessions list (`sessions/merged.tsx`), active host only
  (other hosts' terminals not merged); S (done): fall back to Sessions when the current tool
  stops being offered.
- M (done): projects dialog and device-local projects — `sessions/ProjectsDialog.tsx`,
  `localProjects.ts`.
- M (done): sub-work chips on session rows and in the status summary (provider subagents;
  workspace scripts not counted yet).
- M (done): launch fields: provider feature toggles, project defaults ("Save for project"),
  account flag merge — `sessions/LaunchFields.tsx`, `launch.ts`.
- S (done): New session name label by session type, not layout. S (done): host feature gating
  hints.
- M (done): modal stack: one Escape closes the top layer only; back guard counts
  sheets/popovers; hardware back on every Android layout (desktop browser back untouched) —
  `shell/modalStack.ts`, `useHardwareBack.ts`.
- S (done): phone layout must not rebuild the list on selection (`shell/layout.rs` phone branch).
- S (done): palette "New terminal" creates one; "Getting started"; sessions by `updatedAt`.
- S (done): status-bar host segment opens Hosts; `railBadge` pref honoured.
- M: home composer reuses the full composer. Blocked on 7b: `chat::Composer` needs a detached
  mode (no agent; `on_send`, `placeholder`, `chips` props).
- M (done): phone keyboard frame and tab hiding while the keyboard is up.
- M (done): error boundary screen (panic hook crash page); M (done): popout single-session
  window.
- M (done): toast history log, live toast updates, accurate pause; host toasts with Retry.
  Left: toast variants (`toastStyle` hud/facet).

**7e panels** — owns `ui/src/views/panels/{files,scm,terminals,tasks,search,prs,usage,plugins,companion,util}.rs`,
`apps/client/render/src/terminal`

- M: file search in the Files header; L: file editing (edit mode, save/revert, dirty state);
  M: editor menu, tab "+" and tab context menu. S: row menu reads live changed state; revoke
  image blob URLs.
- M: commit graph and SCM quick settings (makes the `scm*` prefs work); S: "Commit" first in
  the More menu (**done**).
- S: terminal wheel uses the program's mouse encoding and pointer cell; S/M: cancel drop
  uploads; S: ASCII-only safe chars in `shell_path` (**done**).
- M: to-do templates, category field, "Moved to X" undo toast, urgency sort (**done**);
  claim/progress lists in detail, filter note detail.
- M: PRs Streams tab, merge split button (allowed methods, auto-merge, disabled reason), CI run
  actions (re-run, cancel, logs), live CI visuals, expandable jobs, branch/PR switcher.
- L: multi-account usage cards; S: meter prefs (`meterTimer`, `meterSeconds`, `meterHover`,
  `meterAfterReply`) drive refresh (**done**; after-reply only while the Usage panel is open).
- L: plugin-contributed panels and forms; M: remote-control toggle and capability chips; S:
  unlink dev plugins, update confirm with new capabilities, incompatible reason text.
- S: companion uses the compact composer and bubble icons.

**7f hosts-settings-native** — owns `ui/src/views/panels/hosts/**`, `ui/src/views/settings/**`,
`ui/src/native/`, `apps/client/src-tauri/src` (not the CI workflow)

- **Done:** M: pairing QR code (pure-Rust QR), relay vs local link, copy link/code, new code, expiry
  countdown, auto-create on open — `hosts/PairDevice.tsx`, `Qr.tsx`.
- M: pair confirm dialog with expiry, role and not-a-link states — `hosts/PairConfirm.tsx`. **Open:** lives in `shell/host_sheet.rs` (7d).
- **Done:** M: Here now, Tailscale and Service URL cards.
- **Done:** M: offline view: "Use this daemon" rebind, TLS toggle probe, Retry now; route latency.
- **Done:** S: route "Use" only reconnects the active host; offline route dot; forget-route confirm;
  restart daemon in host detail.
- **Done:** M: OS notifications on finish/permission honouring delivery, sound and quiet-hours prefs.
- **Done:** M: accounts move between hosts; usage & limits page controls; app usage-stats opt-in; bug
  report attach/save. S: session order setting; device role select.
- **Partly done:** L: design options live preview (button, logo, toast previews; shape, state, sub-work and reveal previews still missing).
- **Done:** M: app updates download mode with progress and periodic checks. **Open:** L: Android APK updater.
