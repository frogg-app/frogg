# Rust client: Frogg Next rebuilt in Rust + Tauri

Owner decision (2026-11-05): rebuild the Frogg Next client (`apps/ui-next`) entirely in Rust,
with a Leptos UI compiled to WebAssembly, shipped in a Tauri v2 shell on desktop and Android
and as a plain WASM bundle on the web. This overrides option C's "not recommended" verdict in
[rust-rebuild.md](rust-rebuild.md); the daemon migration there continues independently.

Work lands on `frogg-next` only. `apps/ui-next` stays the shipping Frogg Next client until the
Rust client passes the parity and performance gates below; `apps/ui` (stable) is untouched.

## Architecture

| Layer          | Crate / path                  | Replaces                                      | Runs on                         |
| -------------- | ----------------------------- | --------------------------------------------- | ------------------------------- |
| Wire types     | `crates/frogg-protocol`       | `@frogg/protocol` (types only)                | everywhere (generated from zod) |
| Client core    | `apps/client/core`            | `@frogg/client` (`DaemonClient`), relay E2EE  | wasm32 (all targets), native    |
| UI             | `apps/client/ui` (Leptos CSR) | `apps/ui-next/src` (React Native + Expo)      | WebView / browser, as WASM      |
| Shell + bridge | `apps/client/src-tauri`       | `apps/ui-next/desktop/*.cjs` (Electron), Expo | Win/mac/Linux, Android          |
| Web            | Trunk `dist/`                 | react-native-web export                       | served by the daemon            |

Decisions:

- **One client core, in WASM.** The daemon connection, RPC correlation, subscriptions and relay
  E2EE run inside the WebView on every target, so desktop, Android and web share one code path.
  The Tauri side is only the native bridge (windows, chrome, updater, notifications, file
  pickers, deep links, keychain), exposed as Tauri commands that mirror `desktop-bridge.ts`.
- **Generated wire types.** Requests are built from `frogg_protocol::inbound`; responses are
  correlated on the raw `payload.requestId` first and decoded into `frogg_protocol::outbound`
  second, so an outbound variant the generator does not model yet never drops a response.
- **No JS in the product.** Replacements for the JS dependencies: markdown via
  `pulldown-cmark`; diffs via `similar`; syntax highlighting via `syntect` (fancy-regex, so it
  builds for wasm32) or a tree-sitter port of `@frogg/highlight`; the terminal via a Rust VT
  parser (`vt100`) with a canvas/DOM renderer instead of xterm.js; storage via `localStorage`
  on web and the Tauri store plugin elsewhere; relay crypto via `crypto_box`/`xsalsa20poly1305`
  (byte-compatible with tweetnacl).
- **Styling.** ui-next's theme tokens (`src/theme/tokens.ts`, `themes.ts`) become CSS custom
  properties; components use plain CSS, with no CSS framework. Rail.tsx stays the polish bar
  for look and motion.

## Parity scope (ui-next, non-test lines)

| Area                                                             | Size  | Phase |
| ---------------------------------------------------------------- | ----- | ----- |
| Client core (`DaemonClient`, transports, relay E2EE, identity)   | ~9.7k | 1     |
| Stores (`src/daemon/*`, `ui-store`, `prefs`)                     | ~3.6k | 1     |
| Shell: Rail, Brackets, StatusBar, PhoneTabs, Palette, kbd, Home  | ~3k   | 2     |
| Sessions, Chat, Composer, ToolCall, tools/, markdown, perms      | ~14k  | 3     |
| Panels: Files, SCM/Diff, PRs, CI, Terminals, Tasks, Search, …    | ~8k   | 4     |
| NewSession, onboarding, sign-in/pairing, hosts, settings         | ~15k  | 5     |
| Native: window chrome, updater, splash, session windows, Android | ~1.1k | 6     |
| Lab (fixtures, sim) for parity screenshots                       | ~13k  | 7     |

## Phases

Each phase lands on `frogg-next` behind its own app id (`frogg-next-rs`), so it never replaces
the shipping Frogg Next install until phase 8.

0. **Foundation (S).** Shared `frogg-protocol` crate; Cargo workspace `apps/client`; Leptos CSR
   app built by Trunk; Tauri v2 shell loading it; client core connects, sends `hello`, lists
   agents against a dev daemon; CI builds wasm and the Linux shell.
1. **Client core (L).** Port the full `DaemonClient` RPC surface, reconnect/backoff, liveness
   heartbeat, terminal stream router, relay v2 transport with E2EE, device identity and
   pairing. Tests ported from `daemon-client.test.ts` against a fake transport.
2. **Shell (M).** Theme, layout breakpoints (desktop/tablet/phone), Rail, Brackets, status
   bar, palette, keyboard map, host switching.
3. **Sessions and chat (L).** Session list, timeline with virtualisation, composer with
   attachments, tool calls and panes, markdown and code, permission cards, subwork.
4. **Panels (L).** Files, SCM and diff, PRs, CI, terminals (Rust VT), tasks, search, usage,
   plugins, inbox, toasts.
5. **Flows (L).** New session, onboarding, sign-in and pairing, hosts, all settings pages.
6. **Native (M).** Tauri bridge parity with `desktop/*.cjs`: window chrome per OS, theme sync,
   session pop-out windows, splash, updater against the existing feed, notifications; Android
   build (Tauri mobile), share/attachment intents, keyboard insets.
7. **Lab and parity (M).** Port the lab fixtures; screenshot each entry in both clients and
   diff; walk `apps/ui-next/PARITY.md`.
8. **Switch (S).** Benchmarks pass; `frogg-next` ships the Rust client under the Frogg Next app
   id with an upgrade path from the Electron and Expo builds; `apps/ui-next` is retired.

### Where it stands

| Phase               | State                                                                     |
| ------------------- | ------------------------------------------------------------------------- |
| 0 Foundation        | Reached                                                                   |
| 1 Client core       | Reached                                                                   |
| 2 Shell             | Reached                                                                   |
| 3 Sessions and chat | Reached                                                                   |
| 4 Panels            | Reached                                                                   |
| 5 Flows             | Reached                                                                   |
| 6 Native            | Reached on desktop; Android builds in CI, not yet run on a real device    |
| 7 Lab and parity    | Not started (parity checked by the smoke walk and live verification only) |
| 8 Switch            | Not started                                                               |

Verified live against a real Claude provider: daemon restart mid-turn (reconnect about 0.8 s after
the daemon is healthy; the resumed turn completes and a message sent meanwhile is answered),
60 fps while streaming a 1,200-word reply, fork carrying provider/model/thinking, pair-by-code
address prefill, file editor Revert, subagent step counts, and a warning-free debug walk.

What remains:

- Android on a real device (keyboard insets, share intents, background behaviour).
- A signing key for the Tauri updater.
- iOS.
- Protocol decode slimming for WASM size (release is about 2.1 MB gzip, just over the gate).
- CI re-run and cancel: needs a daemon RPC.
- Phase 7 lab fixtures and screenshot parity, then the phase 8 switch.

## Gates

Measured with `scripts/bench/measure-ui-next-web.mjs` (ported to the Rust web build) and the
desktop smoke scripts, on the same machine as the ui-next baseline.

| Metric                              | ui-next today    | Rust client must reach |
| ----------------------------------- | ---------------- | ---------------------- |
| Web bundle (wasm + js, gzip)        | 6.54 MB js (raw) | ≤ 2 MB gzip            |
| Navigation → chat timeline rendered | 733 ms           | ≤ 350 ms               |
| Main-thread long tasks during load  | 578 ms           | ≤ 150 ms               |
| JS/WASM heap after settling         | 55.9 MB          | ≤ 30 MB                |
| Desktop cold start, RSS vs Electron | to measure       | ≥ 2× better on both    |
| Android cold start vs Expo APK      | to measure       | no worse               |
| Lab screenshot parity               | n/a              | every entry signed off |

## Risks

- **Scale.** About 60k lines of polished UI plus about 10k of client core. Parity is tracked
  per area against `PARITY.md`, not by line count.
- **Tauri on Android.** Less mature than React Native for keyboard insets, share intents and
  background behaviour; phase 6 spikes these first and records any gap here.
- **WebKitGTK on Linux** renders and performs differently from Chromium; the gates are measured
  per platform.
- **Terminal.** Replacing xterm.js is the largest single component risk; phase 4 starts with it.
- **Protocol drift** is handled by the generated crate and its CI check.
