# What frogg has built since forking Paseo

Source material for a website changelog / patch-notes section. Forked from
Paseo v0.7.2 (`77aff0f`); everything below is frogg's own work, grouped by
theme rather than by release. Version numbers in brackets say where a thing
landed, for anyone tracing it back to `CHANGELOG.md`.

## Product shape and identity

- Forked from Paseo v0.7.2 into a new repository, reorganised into
  `apps/` + `packages/`, upstream Electron shell and website dropped. [0.1.x]
- Two full renames: Paseo → FDE (Frogg Development Environment), then FDE →
  frogg, covering the `frogg` binary, `@frogg/*` scope, `FROGG_*` environment,
  `~/.frogg` home, `frogg.json`, the `frogg://` scheme and every artifact name.
  The daemon migrates `~/.fde` to `~/.frogg` on first start, rewriting stored
  paths and repairing moved git worktrees. [1.0.0]
- Desktop shell rewritten twice: a Tauri v2 shell, then Electron as the shipped
  app-only desktop for Windows, macOS and Linux; the Tauri shell and the
  experimental Rust backend were retired and removed. [0.4.2, 0.6.0, 1.3.6]
- Workspaces renamed to **sessions** throughout the UI and docs; routes, config
  keys, protocol and CLI flags keep the old names, so nothing stored breaks. [1.5.4]
- Upstream's plugin system removed (package, CLI, RPCs, UI); schedules, the
  Help & Support menu and the Star/Sponsor/Community links removed. [0.1.x, 0.7.0]
- Own visual identity: origami frog mark, cyan/blue accent, larger home logo,
  dark loading paint, transparent-margin taskbar and dock icons.

## Clients and platforms

- **App-only desktop** on Windows, macOS and Linux: no bundled daemon, no
  separate Node runtime, no CLI or provider binaries in the download. [0.4.3, 0.6.0]
- **Android client** (arm64 APK) with its own app identity, CI build, release
  signing when keystore secrets exist, and a low-memory dev build that can sit
  alongside production. [0.1.9, 0.6.14]
- Web client served by the daemon.
- One-click per-user Windows installer in a small branded window, replacing the
  wizard; an older all-users install is removed once, with app data kept. [1.0.0]
- Windows portable zip; Windows releases ship the installer inside a zip because
  GitHub rejects raw `.exe` assets, and the updater signature covers the zip. [0.1.19]
- Linux desktop entries launch the installed GUI and forward pairing URLs;
  AppImage entries stay relocatable.

## Daemon, hosts and connectivity

- Independently installed Node daemon with its own install story: self-contained
  bundle builder, `install.sh` / `uninstall.sh` / `install-docker.sh`, systemd
  and launchd service installation, and a Docker image built from the bundle.
- Install scripts served live from `frogg.app` by a Cloudflare Worker that
  answers a fixed three-path allowlist and fails closed with a 502 when the
  source looks wrong, so `curl -f | bash` pipes nothing. Smoke-tested after
  deploy by a real install/uninstall in a throwaway container. [0.1.19]
- **Remote SSH transports** with an SSH-config host picker, daemon-vs-ssh
  password handling, honest ssh error reporting (`Permission denied (publickey)`
  surfaces instead of a generic timeout) and full transport logging; plus
  unix-socket and named-pipe hosts. [0.1.4–0.1.6]
- **First-run pairing**: an unclaimed daemon serves a claim page with a
  single-use pairing link and QR, `frogg daemon claim-status` / `reset-claim`,
  and `https://pair.frogg.app` as a standalone stateless service — a pairing code
  carries the whole offer, so one deployment serves every daemon without
  contacting any of them. Also runs as a Cloudflare Worker that returns
  byte-identical HTML to the daemon's own route (asserted by a test). [0.1.17, 0.1.19]
- **Network discovery**: scans local /24 subnets for daemons, resolves
  hostnames, one-click connect, flags daemons that still need pairing, with
  scan cancellation that keeps what it found. [0.1.12, 0.6.14]
- `frogg://host/add?type=directTcp&…` deep link so provisioning tooling can
  register a direct host without writing the app's private host registry. [1.5.1]
- Default port moved to 9999; daemons default to listening on `0.0.0.0` for
  startup, services, Nix and SSH deployment, preserving explicit addresses.
- The hosted relay endpoint was removed — run your own relay or use direct/SSH. [0.6.0]
- The app refuses a _different_ daemon answering on a saved host's address and
  explains why, under the host's status, in the app's language. [1.5.7]
- `frogg start`/`restart` keep the daemon under the service that owns it, and
  `frogg status` reports the registered service and who is running the daemon. [1.5.9]

## Updates

- **Daemon self-update with automatic rollback**: installs a release beside the
  running version, a detached supervisor flips `current`, restarts the service,
  verifies `/api/identity` and `/api/health` and reverts to `previous` on
  failure. Outcome in `last-update.json`, three versions retained. [0.1.14]
- Opt-in automatic updates that wait for agents to go idle and honour quiet
  hours, with per-version exponential backoff (one interval, doubling to seven
  days) that survives the restarts each attempt causes. **Update now** is never
  held back. Checks are logged even when they find nothing, with the time of the
  next check. [0.1.14, 1.5.8, 1.5.9]
- Every host's settings page has a Daemon updates section: version, check,
  progress, applied/rolled-back outcome, auto-update toggle and channel.
- Desktop update checks on launch and every 30 minutes with a corner toast and
  in-app progress, no extra confirmation, duplicate installs blocked.
- Versioned JSON update discovery (`release.json`) with runtime and
  minimum-client compatibility, plus a publication gate that verifies exact
  payload names, platform coverage, sizes and both hashes against the downloaded
  binaries before a release can go out. [0.6.10, 0.6.19]
- Downstream rebuild suffixes rank above the release they rebuild, in one shared
  ordering module used by the CLI and the desktop app. [1.3.6]
- Upgrading from a terminal the daemon hosts no longer kills the daemon: the
  restart goes to a transient `systemd-run --user` unit that outlives the
  service-cgroup stop. [1.5.9]

## Providers and accounts

- **Provider accounts (multi-sign-in)** — the largest divergence. A provider can
  be signed in as several accounts, each with its own CLI config directory, with
  selected folders symlinked from the primary one so commands, skills, agents,
  projects and sessions stay shared while credentials stay private. [1.3.0, 1.3.6]
- Per-provider settings sheet, one tab per sign-in, scoping sign-in state,
  usage, new-agent defaults, model access, per-account system prompt, nickname,
  colour, moving the account to another host, and deletion. [1.5.0, 1.5.6]
- **Per-account model restrictions**, enforced by the daemon at agent start and
  resume, so a client cannot bypass them. [1.5.0]
- Account export/import to move a set of accounts to another daemon. Bundles
  hold live credentials in plain text, are never written to disk by the daemon,
  and imported credential files are written 0600. [1.5.0]
- Codex multi-account via `CODEX_HOME`; Gemini CLI multi-account behind an
  opt-in switch (synthetic HOME with the real home's tooling symlinked back,
  because Gemini has no config-dir environment variable). [1.5.0]
- An agent stays on the account it started with rather than following the
  daemon-wide active account, with the account shown as a pill above the
  composer and a glyph on sidebar rows. [1.4.0, 1.5.5, 1.5.8]
- **Move a running conversation to another account**, with the cost stated
  first: the new account has never sent this context upstream, so the whole
  context is re-sent uncached. The source account keeps its copy. [1.5.8]
- **Prompt-cache warning**: typing into a Claude conversation idle for over an
  hour outlines the composer in amber and says how many input tokens the next
  message re-bills. [1.5.8]
- Context-window usage reads the quota of the account the session actually runs
  on. Provider agent definition files (Claude Code, Codex, OpenCode, Copilot)
  found on the host are listed in host and project settings.

## Companion (voice)

- **Companion: a real-time voice conversation layered above projects and
  sessions.** It answers immediately and never does the work itself — anything
  needing thought is handed to a headless subagent while it keeps talking, and
  it drives, starts and reports on the agents running in your sessions. A fast
  orchestrator model answers over the Messages API rather than the agent
  provider stack. [0.2.0]
- Never leaves a silence: text is cut into speakable segments and sent to TTS
  mid-generation, with a pre-synthesised filler if nothing has been said 700 ms
  after you stop. Keeps its own small notebook of topics and open tasks, so its
  context stays tiny.
- Barge-in, VAD independent of response generation and playback, incremental
  transcripts, interruption with context retained, adjustable pauses,
  acknowledgements, quiet task dispatch and completion/failure announcements.
- Local speech stack: Kitten nano FP32 Rosie by default, with Piper and Kokoro
  overrides, separate recognition and synthesis workers, next-segment
  preparation during playback, and reproducible audio benchmarks.
- Voice-speed selector (0.75×–2×, default 1.3×) applied at synthesis without
  changing pitch or other clients' settings.
- Purple/cyan **Nebula** identity with a live transparent shader, monochrome
  crossfade on mute, independent microphone and playback feedback, a device
  motion preference and reduced-motion support.
- Mobile Call/Media audio routing, iOS background audio, an Android microphone
  foreground service with an End notification action.
- Codex subscription orchestration alongside Claude, with explicit API opt-in
  and live authentication/readiness checks.
- Opt-in and off by default per device; conversations resume after daemon
  reconnection, and unheard results stay pending rather than re-running workers.

## Sessions, projects and the sidebar

- Agents and **expandable subagents beneath session rows**, opening either an
  existing interactive session or the live provider-owned transcript, with
  cross-workspace navigation; finished subagents drop off the list while their
  transcript history is kept. [0.3.0, 0.3.1]
- Claude Code Workflow runs list the agents they fan out beneath their own row,
  each with label, phase, model and token use, updating live and opening its own
  timeline — instead of every child replaying onto one row. [1.5.9]
- **Sidebar sort**: recent activity, date created, name, needs-attention-first,
  or manual drag order, with a reverse toggle; dragging while sorted switches to
  manual. [1.0.1]
- **Alt-hover quick actions** on sidebar rows — rename, pin, labels, copy
  session ID, archive — so several sessions can be handled without opening a
  menu each time. [1.5.7]
- **Short session IDs** (`s_` + eight characters) on sessions and subagents,
  identifying a session that has no git branch. [1.5.7]
- Archived sessions browsable per project, not just in app-wide History. [1.5.7]
- Live directory and branch context pills beside the composer, with the change
  badge counting only uncommitted work, and the directory pill naming the source
  project checkout rather than frogg's internal worktree. [1.3.3, 1.3.4]
- Unfinished session forms restore from the sidebar with their project, prompt,
  attachments, provider selection, isolation and starting reference; failed
  launches are kept for retry. [0.7.0]
- **Project and conversation import** from client files or the selected daemon,
  with preview, canonical project merging, persistent deduplication and explicit
  native-session versus text-history presentation. [0.7.0]
- Explicit project registration only — no more silent registration when an
  agent, terminal or script touches a new directory. [1.3.0]
- Folder browser starts at the brand's configured default directory, hides
  dot-folders by default, and pins selection and parent navigation above the
  list.
- **CI tab** in the right-hand pane showing the session branch's runs: GitHub
  Actions, and Jenkins when `frogg.json` names a job — status, progress, timing,
  a bar per job, steps, runners, and which machines are busy. [1.5.8]
- Merge-target handover: a successful merge activates the target session and
  archives the clean source. [1.3.5]
- Pull request panel with an uncapped checks list that scrolls as one panel.

## Interaction and platform polish

- Confirmation dialogs drawn by frogg itself rather than by Windows, macOS or
  the browser, so they match the app everywhere — and reversible actions no
  longer ask at all: archiving prompts only for uncommitted or unpushed work,
  and daemon/skill updates say their effect in the row instead. [1.5.7]
- Settings as a large centred modal on wide layouts; host settings folded into
  Overview; explorer close button inside its own panel on every desktop layout.
- Window dragging across the whole top bar on Windows and Linux, with settings
  modal headers excluded.
- **Streaming performance**: markdown block splitting no longer re-parses the
  whole message per animation frame, code fences are not re-tokenised mid-stream,
  and the desktop transport coalesces inbound WebSocket frames instead of paying
  an IPC hop each. [0.2.0]
- Attachment selections over 50 MB are rejected before the byte read, with
  bounded native reads and cleanup of incomplete managed copies. [0.6.20]

## White-labelling and fork support

- **Build-time branding** across UI, desktop and mobile packaging, CLI, daemon,
  pairing pages, provider skills, installers and deployment inputs: a fork
  supplies a manifest and artwork and keeps independent state and update
  sources. Both-brand generation, browser, runtime and native packaging CI. [0.2.24, 0.4.0]
- Branded builds use the brand's own `envPrefix` for every setting and
  deliberately ignore `FROGG_*`, so an upstream deployment's configuration
  cannot leak into a branded product. [1.2.0]
- Brand-registered deep-link scheme, with `frogg://` links still accepted.
- A brand can hide host settings sections, and an admin can turn one back on for
  their own host without a new build; a downstream build can report its own
  version in Settings > About. [1.5.1]
- Concurrent products, cross-brand management rejection and foreign-asset
  rejection verified against real daemon archives.

## Architecture

- **Opt-in independent execution service**: the supervised daemon becomes a
  restartable HTTP/WebSocket gateway while a separate execution service retains
  agents, provider turns, permissions, MCP tools and orchestration, so
  restarting or updating the gateway does not drop running work. Client
  authorization is preserved through the gateway, and crash-left Unix sockets
  recover safely. Opt-in, not enabled by default. [0.5.0]
- Graceful daemon shutdown that forwards the service manager's stop signal and
  waits for its supervisor; worker crash restarts back off from 1 s to 30 s; a
  port-bind failure names who holds the port. [1.5.8]

## Repo, CI and tooling

- Full CI and release pipelines: format, lint, typecheck, unit tests, and
  per-platform desktop, daemon and Android artifacts, with individual target
  retries and PR builds scoped to Windows.
- Daemon packages built independently of desktop and Android: the server and web
  UI are compiled once and shared across all six daemon targets. [0.4.1]
- Project skills and agent definitions for working in the repo — build order and
  dev daemon, the session-RPC checklist, the nine-locale i18n procedure, a
  release skill, an asynchronous build-monitor skill — plus
  `scripts/ci/verify.mjs --changed`, which lints and tests only what changed. [0.2.0, 0.6.10, 0.6.18]
- `npm run preview` for a hot-reloading UI with demo data and `npm run shot` to
  screenshot any screen of it. [1.5.4]
- Tests get a throwaway frogg home per worker, so the suite can never move a
  running daemon's state. [0.1.18]
- Nix distributions validated in CI; Dependabot across npm, cargo and actions.
