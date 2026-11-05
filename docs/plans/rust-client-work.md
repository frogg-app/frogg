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
