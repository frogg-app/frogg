# Rust rebuild: research

Discord #98 (owner, 25 Oct): "start a branch called rust-rebuild and research rebuilding the app
in rust, needs to beat current speeds." Co-owner: "Rust rebuild needs to be branched from frogg
next." This branch starts from the Frogg Next release-flow work, which becomes the base of
`frogg-next` (see [frogg-next-release-flow.md](frogg-next-release-flow.md)). Research only: no
port lands here.

## What "the app" is today

| Part                           | Today                                                                                                                                        | Size (non-test)                                     |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Daemon (`packages/server`)     | Node 22, supervisor plus worker process, WebSocket API, providers, MCP, relay                                                                | ~194k lines TS                                      |
| Frogg Next UI (`apps/ui-next`) | React Native + Expo Router, react-native-web on desktop and web                                                                              | ~60k lines TS/TSX                                   |
| Desktop shell                  | Electron (`apps/ui-next/desktop/*.cjs`), app-only, no bundled daemon                                                                         | small                                               |
| Android                        | Expo / React Native APK                                                                                                                      | shared with UI                                      |
| `apps/daemon-rs`               | Rust (tokio + axum) "front half": terminates HTTP/WS, answers ping, terminals and auth natively, forwards everything else to the Node daemon | ~22.5k lines Rust, inactive, excluded from releases |

The protocol is generated: `apps/daemon-rs/src/generated/` already carries Rust types for the
whole inbound and outbound schema (~1,100 serde variants), produced from `packages/protocol`.

## Options

| Option                                          | What gets rewritten                                   | Keeps                                         | Verdict                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| A. Rust daemon, React UI kept                   | Daemon, step by step behind `daemon-rs`'s proxy       | ui-next, Android, Electron or a lighter shell | **Recommended.** The daemon is where the measured cost sits and the proxy already allows a strangler migration                              |
| B. Tauri shell around the React UI              | Desktop shell only (Electron → Tauri/WebView)         | All UI code, the Node daemon                  | Cuts desktop memory and install size; no daemon gain. Good second step after A, on desktop only                                             |
| C. Full native UI (Dioxus, egui, Slint)         | UI and shell for desktop; Android needs its own story | Nothing of ui-next                            | Not recommended: rewrites ~60k lines of polished UI, loses react-native Android and web, and the measured client cost is not the bottleneck |
| D. Dioxus with web + desktop + mobile renderers | Everything                                            | Nothing                                       | Highest risk; Dioxus mobile is not production-grade for this app's Android needs                                                            |

The client is a WebView or browser in every option except C, and its render cost is mostly
React work and bundle size, which a Rust shell does not change. The daemon is a long-running
process on every machine, and that is where Rust wins clearly.

## Measured baselines (this VM)

8 vCPU QEMU VM, 15 GB RAM, Node v22.23.2, headless. Daemon numbers come from
`scripts/bench/measure-rust-baselines.mjs` (5 cold starts each, 1,000 sequential pings, RSS
after 10 s idle, throwaway HOME/FROGG_HOME/CODEX_HOME/CLAUDE_CONFIG_DIR under `.dev/`). Client
numbers come from `scripts/bench/measure-ui-next-web.mjs` (the Frogg Next web export in headless
Chromium, lab `chat` entry on fixtures, 5 cold contexts). Medians unless noted.

| Metric                                 | Node daemon (`packages/server`, production build) | `daemon-rs` front half (release build, no upstream) |
| -------------------------------------- | ------------------------------------------------- | --------------------------------------------------- |
| Cold start, spawn → listening          | 1,508 ms (p95 1,582)                              | 11.9 ms (p95 12.8)                                  |
| Cold start, spawn → first pong         | 1,544 ms (p95 1,612)                              | 13.0 ms (p95 14.9)                                  |
| Idle RSS, whole process tree           | 382 MB (supervisor + worker)                      | 5.6 MB                                              |
| Transport ping RTT (`ping`/`pong`)     | p50 0.67 ms, p95 1.72, p99 3.49                   | p50 0.09 ms, p95 0.11, p99 0.13                     |
| Session RPC ping (DaemonClient `ping`) | p50 0.44 ms, p95 1.10, p99 2.46                   | n/a (session layer is Node's)                       |

| Client metric (Frogg Next web, lab `chat`) | Value                             |
| ------------------------------------------ | --------------------------------- |
| JS bundle                                  | 6.54 MB (one 6.9 MB `index-*.js`) |
| Navigation → DOMContentLoaded              | 246 ms                            |
| Navigation → chat timeline rendered        | 733 ms                            |
| Main-thread long tasks during load         | 578 ms                            |
| JS heap after settling                     | 55.9 MB                           |
| DOM nodes                                  | 3,699                             |

Not measured here:

- **Electron cold start and memory.** Needs a packaged Frogg Next build (`build-desktop.mjs`) and
  a display; run `smoke-desktop.mjs` under `xvfb-run` on a build machine and add the numbers.
- **Android cold start.** Needs a device or emulator.
- **Daemon under load** (many agents streaming). `scripts/bench/benchmark-terminal-latency.ts`
  already measures echo latency and ping RTT under mock-agent load; use its L0–L3 levels as the
  load baseline.
- The `daemon-rs` numbers are for the front half alone. With a Node upstream behind it, a
  forwarded RPC costs the Node time plus a hop; only natively answered messages get the Rust
  numbers.

## What has to beat what

A Rust phase ships only when it beats the Node baseline on the same machine, measured with the
same scripts:

| Target                            | Node baseline                         | Rust must reach                                                             |
| --------------------------------- | ------------------------------------- | --------------------------------------------------------------------------- |
| Daemon spawn → first pong         | 1.5 s                                 | ≤ 150 ms with every native module loaded (10× better)                       |
| Idle daemon RSS                   | 382 MB                                | ≤ 60 MB with no agents; per-agent overhead reported separately              |
| Session RPC p99                   | 2.5 ms                                | ≤ 1 ms for natively served RPCs; forwarded RPCs no worse than Node + 0.2 ms |
| Terminal echo and ping under load | benchmark-terminal-latency L0–L3      | lower p99 at every level                                                    |
| Client (if option B lands)        | Electron cold start, RSS (to measure) | Tauri ≥ 2× lower RSS and faster cold start, with identical UI               |

## Phased approach

Each phase is a feature-flagged step that ships on `frogg-next` prereleases only, behind the
existing proxy, and is measured against the table above before the next starts. Size is relative.

1. **Harness (S).** Bench scripts in CI on a fixed runner; the generated-protocol drift check
   (`daemon-rs` types vs `packages/protocol`) runs on every protocol change. Package `daemon-rs`
   as an opt-in front for `-next.N` daemon bundles.
2. **Front half in front (M).** `daemon-rs` terminates every connection and forwards to the Node
   worker it supervises, replacing the Node supervisor. Gains: cold start to listening and
   connection handling; Node starts lazily behind it. Pass condition: no protocol test
   regressions, forwarded RPCs within budget.
3. **Native read paths (M).** Sessions list, timeline fetch and pagination, server info,
   workspaces, files and search served from the same on-disk state in Rust. These are the hot
   paths for the timeline render the client waits on.
4. **Terminals and workspace services (M).** `daemon-rs` already has PTYs; make them the
   default and move workspace scripts and port management.
5. **Providers (L).** Codex (app-server JSON-RPC over stdio) and ACP agents (Cursor, Copilot)
   port cleanly. Claude runs through `@anthropic-ai/claude-agent-sdk`, a JS SDK: either keep a
   small Node sidecar per Claude agent or drive the Claude CLI's stream-json protocol directly.
   Decide per provider; the sidecar keeps parity first.
6. **MCP, relay, permissions, persistence (L).** The remaining Node surface. When it is empty,
   Node is no longer required to run the daemon.
7. **Shell (optional, M).** Tauri shell for the existing React UI on desktop, measured against
   Electron. Android stays React Native.

## Risks

- **Protocol drift.** Two implementations of one wire protocol. Mitigation: the generated
  types plus a conformance suite that replays recorded sessions against both daemons.
- **Provider SDKs are JavaScript.** Frogg drives Claude through the JS Agent SDK; a sidecar keeps some
  Node in the process tree and part of the memory cost.
- **Behavioural parity is large.** ~194k lines of server code carry edge cases (permissions,
  relay reconnect, worktrees, provider quirks) that the TS test suite encodes. Each port needs
  those tests ported or run against the Rust daemon over the wire.
- **The client is not the daemon's cost.** A native UI rewrite (option C) spends the most effort
  where the measurements show the least gain; the client's 733 ms first render is dominated by
  a 6.5 MB bundle and React work, which bundle splitting and timeline virtualisation address in
  TypeScript.
- **Two daemons in the field.** During migration a host may run either. The one-daemon rule
  from the release-flow plan holds: the Rust daemon replaces the Node one in place (same port,
  home, service), never beside it.
- **Cross-platform builds.** Windows and macOS Rust daemon bundles need their own CI targets
  and signing, alongside the existing daemon matrix.

## Decisions for the owner

- Option A (Rust daemon, keep the React UI) as the direction, with B (Tauri shell) as a later,
  separately measured step.
- Claude provider strategy for phase 5: Node sidecar or a direct stream-json implementation.
- Whether `daemon-rs` (today "inactive, reference only") is reactivated as the base for phase 2,
  which changes its status in `architecture.mdx`.
