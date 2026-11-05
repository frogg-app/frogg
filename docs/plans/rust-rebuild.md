# Rust rebuild: research

Discord #98 (owner, 25 Oct): "start a branch called rust-rebuild and research rebuilding the app
in rust, needs to beat current speeds." Co-owner: "Rust rebuild needs to be branched from frogg
next." This branch starts from the Frogg Next release-flow work, which becomes the base of
`frogg-next` (see [frogg-next-release-flow.md](frogg-next-release-flow.md)). Research only: no
port lands here.

## What "the app" is today

| Part                           | Today                                                                                                                                        | Size (non-test)                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Daemon (`packages/server`)     | Node 22, supervisor plus worker process, WebSocket API, providers, MCP, relay                                                                | ~194k lines TS                                              |
| Frogg Next UI (`apps/ui-next`) | React Native + Expo Router, react-native-web on desktop and web                                                                              | ~60k lines TS/TSX                                           |
| Desktop shell                  | Electron (`apps/ui-next/desktop/*.cjs`), app-only, no bundled daemon                                                                         | small                                                       |
| Android                        | Expo / React Native APK                                                                                                                      | shared with UI                                              |
| `apps/daemon-rs`               | Rust (tokio + axum) "front half": terminates HTTP/WS, answers ping, terminals and auth natively, forwards everything else to the Node daemon | ~22.5k lines Rust; reactivated as the phase 2 front (below) |

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

## Phases 1 and 2: built and measured

Branch `rust-rebuild`. Everything is behind `FROGG_RS_FRONT=1`, off by default; the Node daemon
stays the default.

### What was built

- **Supervised front** (`frogg-daemond --supervise --node <node> --worker <daemon-worker.js>`).
  Replaces `packages/server/scripts/supervisor.ts` when the flag is on. It takes the PID lock
  (same `frogg.pid` format and heartbeat, so `daemon status/stop` and port discovery work
  unchanged) and the local token, binds the public listener, then starts the Node worker on a
  private loopback port. The worker contract is the Node supervisor's: Node IPC on fd 3 (JSON
  lines), `frogg:ready/restart/shutdown/listen-failed`, heartbeat every second, crash backoff
  1 s doubling to 30 s, graceful stop with a 10 s kill, worker output into `daemon.log`
  (size-rotated). Clients connect before the worker is ready; their frames queue and pings are
  answered natively meanwhile. The worker reports the public address (`FROGG_PUBLIC_LISTEN`)
  and trusts only loopback as a proxy.
- **Forwarding.** Each client's upstream socket is owned by its connection task (no pump tasks
  or channels), with `TCP_NODELAY` both ways and an envelope peek (type plus the raw session
  payload) instead of a JSON tree per frame. Loopback clients go upstream as loopback, others
  with `X-Forwarded-For`. Workspace service hosts (`<label>.localhost`) and hosts the front
  would refuse go to Node with their Host intact, upgrades spliced. A client the front cannot
  authorize becomes passthrough-only and Node decides; Node's 4401 close reasons reach the
  client unchanged.
- **CLI.** `daemon start` runs the front instead of the Node supervisor when
  `FROGG_RS_FRONT=1` (Linux and macOS); it falls back to Node with a warning when the binary is
  missing or on Windows. `FROGG_RS_FRONT_BIN` points at another binary.
- **Packaging.** `-next.N` daemon bundles for Linux (glibc 2.28 via zigbuild, x64 and arm64)
  and macOS carry `bin/frogg-daemond`; `manifest.json` records it. Stable and beta bundles do not.
- **CI.** `rust-daemon.yml`: generated protocol types vs `packages/protocol` and `cargo test` on
  every pull request touching either, and on `frogg-next`/`rust-rebuild` pushes; the bench
  (Node, supervised front, front alone) on `ubuntu-24.04` with the targets in the job summary
  on pushes and manual dispatch. `ci.yml` fails when its build leaves the generated types stale.
- **Bench.** `measure-rust-baselines.mjs --front` measures the supervised front: spawn to
  first pong and to first session RPC, and session RPCs through the front interleaved with the
  same worker pinged directly. `report-rust-targets.mjs` prints the table below.
- **Conformance hook.** `FROGG_TEST_RS_FRONT=<binary>` routes every server e2e test daemon
  through the front.

### Results (this VM, same scripts, 5 cold starts, 2,000 timed pings)

| Target (phase 2)                    | Node             | Rust front + Node worker      | Pass |
| ----------------------------------- | ---------------- | ----------------------------- | ---- |
| Spawn → first pong ≤ 150 ms         | 1,425 ms         | 15.8 ms p50, 139 ms p95       | yes  |
| Forwarded session RPC p99 ≤ +0.2 ms | 1.34 ms (direct) | 1.42 ms (+0.08)               | yes  |
| No protocol test regressions        | 297 e2e tests    | identical outcome for all 297 | yes  |

| Also measured                   | Node     | Front + worker | Front alone |
| ------------------------------- | -------- | -------------- | ----------- |
| Spawn → listening (p50)         | 1,397 ms | 14.4 ms        | 12.6 ms     |
| Spawn → first session RPC (p50) | 1,446 ms | 1,284 ms       | n/a         |
| Forwarded session RPC p50       | 0.35 ms  | 0.51 ms        | n/a         |
| Transport ping p99              | 0.25 ms  | 0.22 ms        | 0.15 ms     |
| Idle RSS, process tree (p50)    | 374 MB   | 309 MB         | 5.7 MB      |

- **How the RPC budget is measured.** Pings through the front alternate with pings to the same
  worker's private port in one run, so both see the same load. Separate runs on this shared VM
  varied by more than the budget (a Node-only run measured p99 0.38 ms in one run and 1.04 ms
  in the next). Across four interleaved runs the front added +0.04 to +0.17 ms at p50 and
  −0.01 to +0.14 ms at p99. Against the separate Node-only run of the final set (p99 0.52 ms)
  the front's 1.42 ms would miss: the interleaved run doubles the worker's load for both sides.
- **The cold-start p95** (139 ms) is one of five starts; the front alone stays under 23 ms at
  p95, so the outlier is machine contention with the worker it starts, not the front's own path.
- **Spawn to first session RPC** is still the Node worker's boot. The front removes the Node
  supervisor (about 160 ms and 65 MB) but the session layer is Node's until phase 3.
- **Conformance.** The server e2e suite (`test:e2e`, fake providers) ran with and without the
  front. 166 of its 297 tests fail on this branch with or without the front (suite drift such
  as "Project is not registered: /tmp"; CI does not run `test:e2e`), so the gate is per-test
  parity, not a green run. Before the fixes above, the front differed on 2 tests
  (password-protected daemons); now none differ. Protocol unit tests: 791 pass; CLI daemon
  command tests: 251 pass; `cargo test`: 94 pass.
- **Lifecycle, verified live** with throwaway homes: worker crash (`kill -9`) restarts after
  1 s; `daemon start/status/stop` through the CLI; the stop RPC reaches the front through the
  worker's `frogg:shutdown`; SIGTERM leaves no worker and no lock; the worker exits when the
  front dies.

### Open before phase 3

- **Windows.** The front supervises over Node IPC on fd 3; Windows needs the named-pipe
  channel. Until then the flag falls back to Node there and Windows bundles do not carry the
  binary.
- **Hosted CI unverified.** `rust-daemon.yml` and the release changes have not run on GitHub
  yet (nothing pushed); the zigbuild glibc 2.28 and darwin-x64 cross builds are untested.
- **Native terminals** (`FROGG_RS_NATIVE_TERMINALS`) are still opt-in inside the front and were
  not part of this measurement; phase 4 owns them.
- **Config parity.** The front reads `config.json` for auth, origins and hostnames at start and
  reloads auth files on change; the front's own checks only gate what it serves natively, and
  Node decides the rest, so a stale front can be stricter for ping but never looser for RPCs.
- **Phase 3 needs the session layer.** Native read paths (sessions list, timeline fetch) need
  hello/session state in Rust, or a way to answer those RPCs on a connection whose session Node
  owns. That design is the first phase 3 decision.

## Decisions

Recorded with the owner's approval of this plan:

- Option A: Rust daemon, React UI kept. Option B (Tauri shell) is a later, separately measured
  step.
- `apps/daemon-rs` is reactivated as the base for phase 2; `architecture.mdx` says so.
- Claude provider (phase 5): a Node sidecar first, for parity.
