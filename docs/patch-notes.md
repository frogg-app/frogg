# frogg patch notes

Every release since the fork from Paseo v0.7.2 (`77aff0f`), newest first, with
what shipped in each. This is the per-version companion to
[`divergence-from-paseo.md`](divergence-from-paseo.md), which groups the same
work by theme.

Everything listed here is frogg's own work; nothing below came from upstream.
Releases marked _unpublished_ never reached users — their contents were carried
forward into the next release that built successfully.

---

## 1.5.9 — 2026-09-20

- Claude Code Workflow runs list the agents they fan out beneath their own row
  in the subagents track, indented one level. Each child shows its label, phase,
  model and token use, updates from running to finished while the run is still
  going, and opens its own timeline. Previously only the Workflow was visible
  and every child's transcript replayed onto that one row, interleaving agents
  that had run in parallel.
- Upgrading from a terminal the daemon hosts no longer leaves the host with no
  daemon. The restart goes to a transient `systemd-run --user` unit that
  outlives the service-cgroup stop, and the installer says the terminal it was
  typed in will end with the daemon.
- `frogg start` and `frogg restart` keep the daemon under the service that owns
  it instead of starting a loose detached daemon beside an inactive unit.
  Explicit overrides (`--home`, `--listen`, `--foreground`) still start a daemon
  by hand.
- `frogg status` reports the registered service and who is running the daemon
  (`Service`, `Managed By`), and names the command that repairs a daemon that has
  drifted out from under its service.
- Automatic update checks are logged even when they find nothing, with the time
  of the next check, so a stale host can be told apart from a stopped updater.
- The FDE compatibility warning no longer fires for an already-disabled
  `fde-daemon` service, and explains how to retire one that has not been.

## 1.5.8 — 2026-09-19

- **CI tab** in the right-hand pane, after Files and Changes, showing the CI runs
  for the session's branch: GitHub Actions for GitHub repositories, Jenkins when
  the project's `frogg.json` names a job. Each run shows status, progress, start
  time and elapsed time with a bar per job; jobs list their steps and runner, and
  a Runners section shows which machines are busy. Jenkins credentials come from
  `FROGG_JENKINS_USER` and `FROGG_JENKINS_TOKEN` on the daemon host.
- The sidebar opens with the brand mark, linking home, above icon-only navigation.
- The sidebar's Show menu can hide or show the account on session rows.
- An agent started without an explicit provider account stays on the account that
  was active when it started, instead of following the daemon-wide active account
  at every launch — which had silently moved old conversations onto a new account
  and re-sent their whole context uncached while the pill named the wrong account.
- A provider sheet's account tab shows that account's own usage, read from its own
  config directory.
- A renamed default sign-in no longer appears twice in the composer's account picker.
- **Move a running conversation to another account** from the account pill, with the
  cost stated first: the destination has never sent this conversation upstream, so
  the whole context is re-sent as fresh input with no cache read. Timeline and
  session placement survive, and the source account keeps its copy so it can move back.
- **Prompt-cache warning**: typing into a Claude conversation idle for over an hour
  outlines the composer in amber and says how many input tokens the next message
  re-bills.
- Provider accounts are managed only inside their provider's settings sheet, one
  tab per sign-in, scoping sign-in state, usage, new-agent defaults, model access,
  system prompt, nickname, colour, host moves and deletion. The provider row is its
  own tab, keeping the model catalogue and uninstall. The host page's separate
  "Provider sign-ins" list is gone.
- An account can set a default model and thinking level for new agents, a colour,
  a nickname, and a system prompt appended to every agent launched as that account.
- Daemon self-update no longer fails, or rolls back a healthy release, when a
  leftover pre-rename `fde-daemon` service on the same port wins the restart race.
  The updater stops and disables a legacy service on that port and retries; if the
  port stays foreign it restores the version that was running rather than blaming
  the new bundle.
- Foreground daemon start forwards the service manager's stop signal and waits for
  its supervisor, so stop and restart shut the worker down gracefully.
- A failed port bind names who holds it — daemon product, version, server id, and
  pid and process name where available. Worker crash restarts back off 1 s → 30 s.
- Automatic updates back off per version: after a failure the next try waits one
  check interval, doubling to a maximum of seven days, surviving the restarts each
  attempt causes, and resetting on a newer release or a success. **Update now** is
  never held back.
- The app refuses a different daemon answering on a saved host's address and keeps
  retrying until the host's own daemon returns, explaining why under the host's
  status. A local placeholder host only adopts the server id of this product's daemon.
- The pull request panel's checks list is no longer capped at eight rows with its own
  scroll area; checks and activity take the height they need and the panel scrolls as
  one, so checks are readable on a phone. Collapsing either section gives its space to
  the other.

## 1.5.7 — 2026-09-19

- **Alt-hover quick actions**: holding Alt over the sidebar expands a session's menu
  into icons — rename, pin, labels, copy session ID, archive — so several sessions can
  be archived or renamed without opening a menu each time. Only the selected row and
  the row under the cursor expand.
- **Short session IDs**: every session has an `s_` + eight character id, shown in the
  session menus, hover card and on subagents, which identifies a session with no git
  branch. Subagents get their own even while attached to a parent.
- Archived sessions can be browsed per project from the project menu, not only in the
  app-wide History list.
- Confirmation dialogs are drawn by frogg rather than by Windows, macOS or the browser,
  so they match the app on every platform.
- Reversible actions no longer ask first. Archiving prompts only when the worktree has
  uncommitted changes or unpushed commits; updating or restarting a daemon and updating
  skills do not prompt at all — their effect on running agents is written in the row.
  Restoring a branch's stash is an offer in a toast instead of a dialog.
- The account a session runs as sits at the right end of its row with its name; sessions
  with subagents or several tabs show it per child and keep the change count at session
  level.
- "Copy path" removed from the session menus.

## 1.5.6 — 2026-09-19

- Provider accounts managed inside the provider's settings sheet, one tab per sign-in,
  each scoping sign-in state, usage, new-agent defaults, model access, per-account system
  prompt, nickname, colour, host moves and deletion.
- A new agent starts on its account's default model and thinking level, with the account's
  system prompt appended at launch.
- The New session composer always opens on Chat. Picking a terminal profile no longer
  sticks to later sessions, which had hidden the provider and account chips and disabled
  image paste.

## 1.5.5 — 2026-09-19

- A new session starts on the account its picker shows. With a second account signed in,
  an untouched picker had resolved to the daemon-wide active account while reading
  "Default"; it now names the account the agent will really launch as. Picking Default
  explicitly still pins the default config directory.
- The context-window usage popover reports the quota of the account the session is
  running on rather than always the default account's.

## 1.5.4 — 2026-09-19

- The sidebar list is headed **Projects**, translated in every bundled language, since
  each row is a project with its sessions nested underneath.
- **Workspaces are called sessions** everywhere they are shown — sidebar, menus, command
  center, settings and docs. The projects-and-workspaces docs page became
  projects-and-sessions with a redirect. History import talks about conversations.
  Routes, config keys, the daemon protocol and CLI flags keep the old names, so links and
  stored state are unaffected.
- The pill row above the composer lines up with the composer's left edge on wide panes.
- A running agent's account shows as a pill above the composer instead of a greyed-out
  toolbar control, including when the provider has only one account.
- The desktop top bar is draggable across its whole width, not only by the title.
- Contributors get `npm run preview` for a hot-reloading UI with demo data and
  `npm run shot` to screenshot any screen of it.

## 1.5.3 — 2026-09-18

- Carries 1.5.1 and 1.5.2, neither published because desktop builds failed. The brand
  fingerprint no longer depends on line endings or path separators, so a Windows runner
  accepts a web UI export built once on Linux.

## 1.5.2 — 2026-09-18 · _unpublished_

- Carries 1.5.1. Building the desktop app from a prebuilt web UI export now builds the
  protocol package first.

## 1.5.1 — 2026-09-18 · _unpublished_

- A `frogg://host/add?type=directTcp&host=…&port=…` link registers a direct host, so
  provisioning tooling can introduce a daemon that does not require pairing without
  writing the app's private host registry.
- Add project starts browsing where the brand says (`projects.defaultDirectory`, `~`
  unless set) and shows an editable path bar, falling back to home when the directory
  is missing.
- A brand can hide host settings sections (`hostSettings.hiddenSections`). The daemon
  seeds its config from the brand default, and an admin can re-enable a section for
  their own host without a new build.
- A downstream build can report its own version in Settings > About via
  `<PREFIX>_RELEASE_VERSION` at brand:prepare time.
- The provider settings modal lists the default account among the Models account tabs
  so it can be restricted like any other, and a + button beside the tabs adds an account.

## 1.5.0 — 2026-09-18

- Each installed provider gets a settings cog in Settings > Providers opening a
  per-provider modal. Uninstalling a provider moved from the row's overflow menu into
  the modal's danger zone.
- Provider accounts managed from that modal: rename, sign out, remove, inspect usage.
  Renaming the default account is a label change only and never moves its config directory.
- **Account export and import**, so a set of accounts can move to another daemon or
  server. A bundle contains live credentials in plain text (base64 is encoding, not
  encryption) — handle it like a password. The daemon never writes a bundle to disk and
  imported credential files are written 0600.
- **Per-account model restrictions**, so a plan that should not reach a model cannot
  select it. Enforced by the daemon at agent start and resume, regardless of what a
  client sends. Unrestricted by default.
- **Codex multi-account** via `CODEX_HOME`: `auth.json` holds the credential, `prompts/`
  stays shared.
- **Gemini CLI multi-account** behind an opt-in switch. Gemini has no config-directory
  environment variable — it reads `$HOME` and a hardcoded `.gemini` — so an account is a
  synthetic HOME with `.npm`, `.npmrc`, `.cache`, `.gitconfig`, `.ssh` and
  `.config/gcloud` symlinked back. Anything else Gemini reads from home will not be
  there, so it ships disabled.
- The pill row above the composer scrolls horizontally instead of squeezing its pills.

## 1.4.1 — 2026-09-17

- Sidebar session rows carry a small account glyph when the agent runs under a provider
  signed into more than once; icon-only so the diff stat and timestamp keep the trailing
  slot, with the account named on hover.
- Self-update reconciles who owns the running daemon before restarting a registered
  service: an inactive unit beside a hand-started daemon now has that daemon stopped
  first, so the restart brings up the newly installed version.

## 1.4.0 — 2026-09-17

- The provider account pill stays in the composer once an agent is running, showing the
  account the agent actually runs as — including the active account an unspecified
  launch resolved to — greyed out, since the account is fixed at start. The daemon echoes
  `providerAccountId` on its snapshot; older daemons show the provider's active account.

## 1.3.6 — 2026-09-17

- **Provider accounts (multi-sign-in).** A provider can be signed in as several accounts,
  each backed by its own CLI config directory with selected folders symlinked from the
  primary one, so commands, skills, agents, projects and sessions stay shared while
  credentials stay separate. Signing in opens a terminal running the provider's own login
  command. An account is chosen per agent from the picker beside the model selector,
  shown only for providers that have accounts. Claude is enabled; other providers are
  declared but disabled pending verification.
- Disabled provider account manifests are marked unverified — their config directory,
  environment variable and credential filenames are best-known guesses — and carry a note
  saying what was never confirmed. The settings UI shows it, and the daemon warns at
  startup when a `config.json` override enables one.
- **Breaking:** the `params.claudeAccount` mechanism from 1.3.0 is removed, superseded by
  provider accounts. Existing entries parse and are ignored, with a startup warning naming
  them. No automatic migration.
- A daemon reports its full version including any downstream build suffix, and a
  downstream rebuild ranks above the release it rebuilds when checking for updates, so
  rebuilds no longer install over each other.
- The same ordering applies to the desktop app's update check, now in one shared module
  used by the CLI and the app. The desktop app also accepts a bundled daemon whose
  manifest carries a rebuild suffix the app's own version does not.
- `daemon status` no longer reports a healthy daemon as unresponsive when it binds a
  wildcard address; the listen target is normalised to a connectable host before probing,
  which also restores the blank `Daemon Version` field.
- The unused Tauri desktop shell (`apps/desktop-tauri`), its build and packaging entry
  points, and the Electron settings migration that imported Tauri preferences are removed.
  Electron is the desktop client.

## 1.3.5 — 2026-09-16

- Merge-target handover completed: a successful merge activates the target session and
  archives the clean source session.
- Claude account setup, authentication entry points and provider configuration improved.

## 1.3.4 — 2026-09-16

- The session directory and checked-out branch appear in separate composer context pills.
  For frogg-managed worktrees the directory pill identifies the source project checkout
  rather than frogg's internal worktree directory.
- Confirmation dialogs removed for sidebar-only project removal and ordinary session
  archiving. Archiving a managed worktree still confirms, because that cleanup can remove
  the worktree directory.

## 1.3.3 — 2026-09-16

- The active session directory and branch show continuously beside the composer. The
  change badge reports only uncommitted tracked and untracked changes, not committed
  differences against the base branch.
- Branded About screens credit frogg rather than its upstream predecessor.
- Branded daemon status reads the signed product manifest in daemon bundles, so it reports
  the same downstream version suffix as the client (e.g. `1.3.3-xx.1`).

## 1.3.2 — 2026-09-16

- `frogg daemon claim-status --json` reports the live authenticated client count under
  `daemon.connectedClients`, and keeps the live pairing decision only under `daemon`.

## 1.3.1 — 2026-09-16

- Daemon service environment settings are written using each brand's environment
  namespace, so custom installations keep their configured listen address, web UI and
  execution-service mode.
- A branded Electron renderer's `<brand-scheme>://app` WebSocket origin is allowed
  alongside stock `frogg://app`, keeping the restrictive origin allowlist.

## 1.3.0 — 2026-09-15

- Projects are added only through an explicit project action — agents, sessions, terminals
  and scripts using a new directory no longer register one silently. Worktrees stay under
  their main checkout's project.
- Isolated Claude account provider profiles, each launching with its own
  `CLAUDE_CONFIG_DIR` and sharing only selected content directories. (Superseded by
  provider accounts in 1.3.6.)

## 1.2.0 — 2026-09-15

- **Custom-brand environment migration:** a branded daemon and desktop use the brand's
  `envPrefix` for all settings. Branded service units and `.env` files must replace
  inherited `FROGG_*` entries with `<BRAND>_*` (e.g. `ACME_LISTEN`, `ACME_HOME`). Branded
  builds deliberately ignore `FROGG_*` so an upstream deployment's configuration cannot
  leak into the branded product. Official frogg is unaffected.
- The configured brand deep-link scheme is registered and handled for desktop agent links;
  branded desktop apps still accept `frogg://` links.

## 1.1.3 — 2026-09-15

- The Electron updater shows installer progress, so the app keeps reporting what is
  happening after download and verification.

## 1.1.2 — 2026-09-15

- The native Skia Companion Nebula is kept out of web and Electron bundles, so the desktop
  renderer starts normally.
- Android CI and release setup restored with the supported SDK package.

## 1.1.1 — 2026-09-15

- The standard AudioLines Companion launcher icon is restored in the composer.
- The Companion Nebula renders with the transparent live shader used on frogg.app,
  replacing the layered static image and opaque background.
- Local speech preview stays stable while a user speaks; the final sentence is submitted
  after endpointing.

## 1.1.0 — 2026-09-14

- The approved purple/cyan **Companion Nebula** identity lands in the app. The composer
  launcher and Companion presence use the same Nebula artwork instead of the legacy
  squiggle mark and layered blue orb.
- Companion stays an opt-in voice preview with its local-speech readiness checks and
  conversation controls.

## 1.0.1 — 2026-09-14

- **Sidebar sort**: recent activity (default), date created, name, needs attention first,
  or manual drag order, with a reverse toggle. Dragging while sorted keeps the on-screen
  order and switches to manual; saved drag order is kept for manual.
- The daemon sends session and project creation times (`createdAt`, `projectCreatedAt`,
  advertised as `server_info.features.workspaceCreatedAt`). Date-created sorting stays
  unavailable until every connected host reports them.
- Dot-prefixed folders are hidden in the folder browser and directory suggestions, with a
  **Show hidden folders** setting under Settings > General. Typed paths into hidden folders
  still open; older daemons ignore the new request field.

## 1.0.0 — 2026-09-13

First major frogg release: independently installed Node daemons and an app-only Electron
desktop client for Windows, macOS and Linux, plus Android and web clients.

- **Rename from FDE to frogg everywhere**: the `frogg` binary and daemon commands,
  `@frogg/*` packages, `FROGG_*` environment variables, `~/.frogg` home, `frogg.json`, the
  `frogg://` scheme, the `app.frogg.frogg` application id and all artifact names. On first
  start the daemon moves `~/.fde` to `~/.frogg`, rewriting stored paths, repairing moved
  git worktrees and moving their Claude Code sessions. `FDE_*` variables are no longer
  read; the daemon lists any it finds with their `FROGG_*` names. Desktop and mobile apps
  need a fresh install.
- **One-click per-user Windows installer** in a small branded window, replacing the wizard.
  An older all-users install is removed once, with administrator approval and app data
  kept, so updates never leave two copies. Its copy, colours and artwork come from the new
  optional `installer` block in `brand.json`.
- Window headers stay draggable with both sidebars open; settings-modal headers are
  excluded from dragging; the explorer close toggle moved into its panel toolbar.
- The home-screen logo is 2.5× larger, and desktop taskbar and dock icons lost their excess
  padding while keeping a small transparent margin.

## 0.7.0 — 2026-09-13

- Host Connections, Metadata and Workspaces settings folded into Overview. The Agents tab
  and project settings list the provider agent definition files (Claude Code, Codex,
  OpenCode, Copilot) found on the host.
- **The plugin system is removed**: the `@fde/plugin` package, the `fde plugin` CLI, plugin
  RPCs and all plugin UI. Plugin folders on disk are left untouched, and a saved plugin
  theme falls back to auto.
- Unfinished session forms restore from the sidebar with their project, prompt,
  attachments, provider selections, isolation and starting reference. Pending submissions
  stay locked across navigation and failed launches are kept for retry.
- **Project and conversation import** from client files or the selected daemon, with
  preview, canonical project merging, persistent session and history deduplication,
  bounded transfer, and explicit native-session versus text-history presentation.
- Website deployment credentials are checked from the runner workspace before checkout, so
  an unset Cloudflare token skips deployment as intended.
- Nix installation collisions from redundant self-links fixed; macOS branded executables
  are inspected through their actual bundle metadata.
- Prior Linux/macOS desktop update payloads are preserved exactly in selected development
  releases, with independent platform versions and strict continuity verification.

## 0.6.21 — 2026-09-13

- Internal dependency lockfile pins synchronised and the Nix dependency hash regenerated
  for the attachment pre-read safeguards.

## 0.6.20 — 2026-09-13

- Oversized attachment selections are rejected before browser/Expo byte reads and Electron
  managed-file copies, keeping the localized 50 MB error. Native reads are bounded when
  files grow, and incomplete managed copies are removed.

## 0.6.19 — 2026-09-13

- Draft release assets are verified through paginated release discovery, including on older
  GitHub CLI versions, so completed drafts pass the publication gate.

## 0.6.18 — 2026-09-13

- An asynchronous **build-monitor skill** covering targeted CI repairs, persistent
  monitoring, and isolated local/hosted build scheduling.

## 0.6.17 — 2026-09-13

- LF shell templates are preserved on Windows checkouts, and individual Windows, Linux
  daemon or Android artifacts can be rebuilt when retrying a platform-specific fix.

## 0.6.16 — 2026-09-13

- Main CI artifacts limited to Windows x64 desktop, Linux x64 daemon and bundled Android
  arm64 clients; desktop PR builds limited to Windows.

## 0.6.15 — 2026-09-13

- Daemon configuration tests aligned with all-interface listen defaults and explicit
  generated settings; transactional rollback verified to restore the full persisted config.

## 0.6.14 — 2026-09-13

- Committed relay runtime databases removed and Wrangler state ignored. The repository
  namespace was audited so upstream names remain only in attribution and licensing.
- Daemon startup, port-only listen targets, service installation, Nix and SSH deployment
  all default to `0.0.0.0`, preserving explicitly configured addresses. Generated daemon
  configuration gained editable defaults and explicit formatting for existing `config.json`
  files.
- Directory browsing starts at the daemon home and lists immediate subdirectories.
  Directory selection and parent navigation are pinned above the folder list, navigation is
  distinguished from adding a project, and `~` navigation is fixed.
- **Network-scan cancellation**, retaining discovered servers when cancelled, with
  simplified scan status and no per-address probe diagnostics in the main connection flow.
- Session cards align with disclosure chevrons on the right; subagent cards are compact
  single-line rows with a small extra indent.
- **Companion mobile audio routing** (Call/Media), Call remaining the default. Media uses
  Android media volume and routing and iOS non-voice-processing capture.
- Companion artwork crossfades to monochrome on mute and back to colour on unmute over
  150 ms, including the minimized presence and independent playback motion.
- **Companion voice-speed selector** (0.75×–2×, default 1.3×), applied during synthesis
  from the next conversation without changing pitch or other clients' speech settings.
- Companion refined into animated cyan/violet light ribbons with a matching launcher,
  compact live presence, distinct microphone and playback feedback, a device motion
  preference and larger labelled controls.
- Local speech defaults to Kitten nano FP32 Rosie, with explicit Piper/Kokoro overrides,
  fixed native inference-thread configuration and markdown stripped before synthesis. Adds
  reproducible audio benchmarks and an interactive design harness.
- Companion given an animated glass sphere with flowing cyan/violet light and independent
  microphone/playback feedback; Listening stays visible during thinking and speaking;
  muted and reconnecting states are shown honestly and reduced-motion is honoured.
- Opening Companion against a running Claude or Codex worker observes it without reloading,
  resuming or cancelling its thread.
- The composer's Voice mode action is replaced by a host/project-bound **Companion
  launcher**, and its sidebar entry is removed. Dismissing or minimizing keeps the
  conversation running, with a host/project indicator and an explicit End control.
- Quiet task dispatch, concise replies, completion and failure announcement preferences,
  optional acknowledgements, adjustable pauses and interruption. Completed workers are read
  directly instead of spawning another summarization job.
- Microphone and VAD processing stay independent of response generation and playback: VAD
  is isolated from STT/TTS, incremental Parakeet transcripts are published, speech survives
  overlapping finalization, and idle silence is not decoded.
- **Companion is optional and off by default on each device**, with explicit Start, Mute,
  End and Minimize controls and a persistent active indicator. Disabling it removes the
  launch controls and releases audio without stopping coding tasks.
- **Codex subscription orchestration** alongside Claude, with explicit API opt-in, live
  authentication and readiness checks, and bounded conversation context.
- Piper LJSpeech as the default local English voice, separate recognition and synthesis
  workers, and the next segment prepared during playback. Explicitly selected Kokoro voices
  are preserved.
- Startup/stop races, typed-message acknowledgement, retry deduplication, backend
  cancellation, stale audio and playback-based conversation history all fixed.
- Active Companion conversations resume after daemon reconnection, keeping local foreground
  capture and mute state. Ending during an outage cancels resumption.
- Delegated job receipts and results persist, and worker and permission events are followed
  across reconnects. Voice can reach existing permission decisions and end a conversation.
- Unheard local Companion results stay pending after a model, synthesis, playback or
  receipt-write failure, retrying on user input or reconnect without rerunning workers or
  continuously consuming subscription allowance.
- Outstanding Codex RPCs are rejected and their timers cleared when the transport is
  disposed, so an interrupted request cannot keep a completed Companion process alive.
- An explicit Codex WebRTC voice preview and reproducible subscription probes.
- iOS background-audio configuration and an Android microphone foreground service with an
  End notification action.
- An Android low-memory test build option and an independent development app ID, for a
  standalone APK that can coexist with production. License and speech-model notices are
  preserved in standalone daemon bundles.

## 0.6.13 — 2026-09-13

- `fde start --no-relay` can override invalid saved relay settings: the already-running
  check is independent of startup validation, and worker flags are applied before
  configuration is validated.
- `fde status` stays usable with invalid relay settings or malformed configuration, showing
  process information and a diagnostic note, with unknown values represented explicitly.
- Native installer web UI URLs print real host interface addresses, preserving explicit
  listeners and IPv6 brackets, and report unavailable network addresses and Unix sockets
  without a placeholder URL.
- Daemon lifecycle and script-install updates repaired: stop no longer requires valid
  startup configuration, matching systemd/launchd services stop through their owner, and
  installer activation stops the old same-home daemon and verifies the running version and
  health before reporting success.
- Older update requests for versioned installations route through the release updater, and
  the duplicate npm update control is hidden for those installations.
- Pre-0.6 daemon incompatibility is explained in network discovery and failed direct
  connections, and relay configuration recovery is included in startup errors.
- Generated deployment shell scripts normalised to LF, with verified concurrent bundle
  staging tolerated on Windows.

## 0.6.11 — 2026-09-13

- The unpublished runtime-specific discovery proposal is replaced by product-level
  `release.json`, protocol adapters and explicit automatic and manual update paths. Shipped
  compatibility manifests are kept, and removing a previously declared update protocol
  without a migration path is blocked.

## 0.6.10 — 2026-09-13

- The **release skill**, versioned JSON update discovery, explicit runtime and
  minimum-client compatibility, and a **publication gate** verifying exact payload names,
  platform coverage, sizes and both hashes against downloaded binaries.
- Repeatable local build timing reports, with measured Linux versus CI performance
  documented.

## 0.6.8 — 2026-09-13

- Electron updater metadata matches the actual Linux `x86_64.AppImage` filename, so complete
  releases pass the publication gate.

## 0.6.7 — 2026-09-13

- Android process and foreground checks continue when the system activity-display wait times
  out, while still rejecting process exits, restarts and foreground loss.

## 0.6.6 — 2026-09-13

- Roadmap corrected to record the Android launch repair and successful emulator cold
  launches, retaining the physical-device validation gap.

## 0.6.5 — 2026-09-13

- Companion provider selection moved into its backend factory instead of generic server
  startup, restoring the architecture check.

## 0.6.4 — 2026-09-13

- The latest Companion work integrated with the Android startup fix, preserving voice
  controls, mobile routing, preferences and build tooling.

## 0.6.3 — 2026-09-12

- Native runtime polyfills initialise before the router and application modules are
  imported. Android had loaded xterm before `navigator.userAgent` existed, causing an
  immediate JavaScript exception during launch.
- Entry ordering is covered with the real xterm bundle in a React Native-like runtime.

## 0.6.2 — 2026-09-12

- An explicit-device Android APK startup check observing two cold launches and retaining
  crash logs, screenshots, process and foreground-activity evidence, plus a
  hardware-accelerated Android diagnostic workflow for existing build artifacts.

## 0.6.1 — 2026-09-12

- Native dependency caches isolated by operating system, OS image version and architecture,
  after an inherited cache key collision restored Linux dependencies on Intel macOS.
- Clean-build helper paths repaired so renamed protocol outputs can be removed before local
  repackaging.

## 0.6.0 — 2026-09-12

- **Electron becomes the production app-only desktop** on Windows, macOS and Linux. The
  previous native shell and experimental Rust backend are retired from active builds.
  Desktop downloads contain no local daemon, CLI, separate Node runtime or provider
  binaries.
- Node daemon packages stay independent, remote SSH deployment is retained, and connected
  daemons keep running when the desktop app closes or updates. The 0.5 opt-in independent
  execution service is preserved.
- Environment, wire, storage, plugin, skill and desktop names standardised on FDE: `FDE_*`,
  `fde://`, `window.fdeDesktop`, `FDE` client symbols. This requires coordinated
  client/server upgrades; legacy naming is not transparently supported.
- Production FDE application and artifact identity, retaining the tested FDE Electron
  profile for 0.4.x continuity. Users of the retired shell must install the new app manually
  and add or pair hosts.
- **The default hosted relay endpoint is removed.** Configure a relay you operate, or use
  direct and SSH connections; existing relay-dependent pairing needs reconfiguration.
- Default daemon port stays 9999. Android remains a separate release target; there is no
  iOS store release pipeline.

## 0.5.0 — 2026-09-12

- **Opt-in independent execution** (`FDE_EXECUTION_SERVICE=1`): the supervised daemon
  becomes a restartable HTTP/WebSocket gateway while the execution service retains agents,
  provider turns, permissions, MCP tools and orchestration.
- `execution-status` and `stop --all` commands; execution is preserved during normal and
  forced gateway shutdown, and a retained runtime is reconnected to even when a later
  launcher omits the opt-in flag. Idle agents prevent automatic runtime replacement.
- Original client authorization is preserved through the gateway, requests and upgrades are
  streamed, and crash-left Unix sockets recover safely. Public service URLs stay separate
  from private execution and MCP endpoints.
- Updates verify against the installed gateway version, completed update handoffs reconcile
  in retained execution, and release directories are retained for running code. Linux
  opt-in service definitions avoid descendant cleanup during gateway stop.
- Sidebar hosts show **Connecting** while reconnecting or not yet initialized, reserving
  Offline for disconnected or failed connections. Cached activity keeps live indicators
  hidden until the connection returns.
- The existing host runtime survives development hot reloads, so active connections are not
  abandoned for an empty connection store.

## 0.4.3 — 2026-09-12

- Electron packaged as the app only, removing the bundled daemon, separate Node runtime, CLI
  and provider binaries from desktop downloads. Daemon packages and SSH deployment remain
  available independently.
- Local daemon setup and management hidden in Electron, legacy local commands rejected, and
  migrated settings prevented from starting a server. Direct, relay, SSH and separately
  installed local server connections are preserved.

## 0.4.2 — 2026-09-12

- The Electron desktop shell restored alongside Tauri with the current UI and bridge
  contract, isolated app profiles, native integrations, SSH transports and an independently
  bundled Node daemon.
- Branded Electron packaging, development commands, comparison artifact CI, and a real
  renderer/daemon close-and-relaunch smoke runner.
- Desktop IPC restricted to trusted app frames, with clipboard and network permissions
  adapted to Electron 44. Comparison builds update only through an explicitly configured
  Electron feed.

## 0.4.1 — 2026-09-12

- Daemon packages build independently of Android and desktop releases: the server is
  compiled and the exported web UI packaged once, then shared across all six daemon targets.
- `npm run build:local` for Windows/Linux desktop iteration with preserved compiler caches,
  bounded concurrency, package checksums and per-stage timings.

## 0.4.0 — 2026-09-12

- **Fork-friendly branding merged across desktop, web, mobile, CLI, daemon, installers and
  deployment tooling.** A fork supplies a manifest and artwork while retaining shared
  sources and independently owned product distributions.

## 0.3.2 — 2026-09-12

- Active-agent sidebar visibility and session controls integrated, preserving the completed
  branding implementation and synchronized versions.

## 0.3.1 — 2026-09-12

- Single-agent sessions are represented by one selectable row. The disclosure control sits
  on the session for multiple agents or active subagents, and chevrons are omitted when
  there are no visible children.
- Finished subagents are removed from the sidebar automatically while their transcript
  history is preserved. Running descendants and permission-waiting agents stay reachable.

## 0.3.0 — 2026-09-12

- **Agents and expandable subagents beneath session rows in the sidebar.** Clicking a child
  opens its existing interactive session or live provider-owned transcript, with
  cross-workspace navigation and the configured tab placement.
- Provider-child discovery and transcript loading failures are shown with retry actions,
  disconnected activity is marked as saved, and child data refreshes after reconnect.

## 0.2.30 — 2026-09-12

- Archive safety and Add host improvements integrated, with explicit release asset names
  reconciled against branded distributions and FDE compatibility.

## 0.2.29 — 2026-09-12

- Host-picker scope and the translated Add host fix integrated, preserving the branding
  implementation and synchronized distribution versions.

## 0.2.28 — 2026-09-12

- The branding delivery record completed with two-product runtime, upgrade, fork, platform
  packaging, browser and Nix evidence, and explicit operator acceptance limits.

## 0.2.27 — 2026-09-12

- Generated skill descriptions escaped for Unicode product names containing colons and
  quotation marks.
- Custom Tauri packaging without its generated configuration overlay is rejected, as is
  stale web branding in native release builds and identity or version drift.

## 0.2.26 — 2026-09-12

- Linux desktop entries launch the installed GUI directly and forward pairing URLs, while
  AppImage entries stay relocatable. Actual native package identities are inspected in
  both-brand CI.
- Fork-lifecycle, concurrent-daemon, Nix, browser and simulator acceptance recorded, with
  test artifacts retained on the feature PR.

## 0.2.25 — 2026-09-12

- Concurrent products and cross-brand management rejection verified using real daemon
  archives; cosmetic upgrades and foreign-asset rejection checked.
- Nix distributions validated in CI, required public configuration templates preserved, and
  actual environment files excluded from Nix sources.
- Windows npm arguments preserved without shell parsing, native build flag forwarding fixed,
  and selected identities applied to Windows development and SSH defaults.

## 0.2.24 — 2026-09-12

- **Fork-owned build-time branding** across the UI, desktop and mobile packaging, CLI,
  daemon, pairing pages, provider skills, installers and deployment inputs. Custom products
  keep independent state and update sources; FDE retains its legacy identity and
  compatibility.
- Both-brand generation, browser, runtime and native packaging CI.

## 0.2.16 — 2026-09-12

- Session archival lives solely in each session's overflow menu, its keyboard shortcut is
  removed, and every archive confirms. Worktrees with uncommitted or unpushed work keep
  their additional risk warning.
- Add host opens directly from the sidebar instead of layering over Settings, with `Ctrl+H`
  as its global shortcut.
- Release assets are named by product, version, platform, architecture and package kind.
  Android and desktop builds take priority over daemon bundle jobs, Windows first in the
  desktop matrix.

## 0.2.15 — 2026-09-12

- The Settings host picker is focused on switching hosts; host creation stays in the main
  sidebar, whose Add host action renders its translated label instead of a missing key.

## 0.2.11 — 2026-09-11

- Local speech loads when npm hoists the native Sherpa library away from its JavaScript
  wrapper: the wrapper API is recovered and incomplete exports are rejected instead of
  returning raw bindings without `OfflineRecognizer`.

## 0.2.10 — 2026-09-11

- Hidden compatibility restored for legacy `fde daemon` commands used by installed services,
  installers and update supervisors, so existing services start again without changing the
  concise top-level CLI.

## 0.2.1 – 0.2.9 — 2026-09-11

Nine maintenance releases; several were unpublished and rolled forward. Together they
delivered:

- **Desktop update checks on launch and every 30 minutes**, with available updates announced
  in a bottom-right toast and download/install progress shown in-app, no extra confirmation
  dialog, and duplicate installs blocked.
- An update notification feedback loop fixed: reading a cached available update no longer
  emits another event that triggers another check. Missing assets and failed cache
  persistence cannot restart the loop.
- A GitHub rate-limited unauthenticated CLI update check retries once using an existing
  GitHub login. Tokens stay in memory and are never sent to mirrors.
- Repeating `fde start` reports that the daemon is already running, with no error log dump.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project and
  Settings became stacked labelled footer buttons; sessions belong to projects. Existing
  navigation preferences migrate.
- **Voice lifecycle cleanup**: Android recording effects, audio resources, callbacks and
  worker threads are released; stopped microphone and playback operations cannot start late;
  speech connections cancelled during connection are closed.
- Desktop transport bounds pending writes and cancels stalled ones, MCP waits release abort
  listeners, and terminal output pauses PTY reads when the headless parser falls behind.
  Desktop exit bounds daemon cleanup to 15 seconds and records lifecycle events.
- Companion interrupts on voice activity, retains interrupted conversation context, starts
  the first speech segment earlier, animates the orb from reply audio, and tolerates cold
  local speech workers. Spoken alerts can retry failed synthesis, with concurrent retries
  sharing one synthesis.
- `FDE_DEVTOOLS=1` opens the bundled inspector for diagnostics, with an opt-in idle memory
  probe. Windows installers use the FDE icon.
- Dependency upgrades with regression coverage: OpenAI SDK 7.8 on Node 22 with speech
  response bodies adapted to Node streams so playback cancellation releases the response;
  uuid 14 for daemon ID generation; sha2 0.11 for desktop checksum verification with bounded
  streaming reads; zip 8.6 for desktop extraction, raising the Rust minimum to 1.88.
  CodeMirror and React Query package identities aligned, and OpenCode's cancellation patch
  applied whether the SDK is hoisted or installed in the server workspace.
- Roadmap and engineering plans distinguish implemented work, deferred work and verification
  gaps.

## 0.2.0 — 2026-09-05

- **Companion: a real-time voice conversation that sits above projects and sessions.** You
  talk to it and it answers straight away; it never does the work itself. Anything needing
  real thought is handed to a headless subagent while it keeps talking to you, and it
  drives, starts and reports on the agents running in your sessions. A fast orchestrator
  model (`claude-haiku-4-5`) answers over the Messages API rather than the agent provider
  stack, which launches a CLI per turn and is far too slow for conversation.
- **The Companion never leaves a silence.** Text is cut into speakable segments and sent to
  TTS while the model is still generating, so it starts talking mid-sentence; if nothing has
  been said 700 ms after you stop, a pre-synthesised filler covers the gap. It keeps its own
  small notebook of topics and open tasks, which is what lets its context stay tiny — old
  turns are dropped rather than summarised.
- The Companion opens from a sidebar row, the command palette or a shortcut, as a sheet on
  compact layouts and a centred card on desktop: a mic orb, your live transcript, its reply
  as it speaks, and a strip of current topics you can tap to jump to the agent working on
  one. It reuses voice mode's audio stack wholesale — VAD, streaming speech-to-text and
  barge-in — and is advertised through `server_info.capabilities.companion`, so the control
  never appears when the daemon cannot honour it.
- **Streaming performance on Android and Windows.** Markdown block splitting no longer
  re-parses the whole message on every animation frame, code fences are not re-tokenized
  while a reply is still streaming, and the desktop transport coalesces inbound WebSocket
  frames instead of paying one IPC hop each.
- The open explorer sidebar has its own close button on every desktop layout, so dismissing
  it no longer takes a trip through the session menu. The control previously existed only on
  macOS.
- **Project skills and tooling**: build order and dev daemon, the thirteen-step session RPC
  checklist, the nine-locale i18n procedure, a `dev-tooling` agent definition,
  `scripts/dev/worktree-status.mjs`, and `scripts/ci/verify.mjs --changed`, which lints and
  tests only what you changed.
- Known limitation at the time: the Companion had not been run end to end, and stayed gated
  behind its capability flag.

## 0.1.19 — 2026-09-03

- Compact layouts no longer put a second agent in a worktree by accident. Inside a worktree
  "New agent" had quietly added one to that same checkout; it now opens New session with
  worktree isolation preselected, cut from the main repository, with "New agent in this
  worktree" as an explicit item.
- Settings: host settings sit above app settings, with the app group anchored to the bottom.
- Windows releases ship only as zips: the NSIS installer is published as
  `FDE-<ver>-x64-setup.zip` beside the portable zip, because GitHub rejects raw `.exe`
  release assets. Both updaters unpack the zip before running the installer, and the updater
  signature covers the zip.
- **The public pairing page deploys as a Cloudflare Worker** (`deploy/pair-worker`), so
  `pair.frogg.app` can run with no host, no origin and no reverse proxy. It shares every
  module that decides what a visitor sees with the daemon's own `GET /code/:code` route —
  the code decoder, both page renderers, the QR and the CSP — and reimplements only the
  transport; a test asserts the Worker and the express service return byte-identical HTML.
- **`https://frogg.app/install.sh`, `/uninstall.sh` and `/install-docker.sh` are live**,
  served by a Cloudflare Worker (`deploy/install-worker`) proxying the scripts out of
  `deploy/` in the public repository. It answers a fixed allowlist of three paths and fails
  closed with a 502 when the source is unreachable or does not look like a shell script, so
  `curl -f` pipes nothing to `bash`, and names the ref it served.
- `scripts/release/verify-install-routes.sh` smoke-tests those routes after a deploy,
  running a real install and uninstall against them in a throwaway container.

## 0.1.18 — 2026-09-03

- Tests no longer touch the developer's home: every worker gets its own throwaway FDE home.
  The suite had resolved the real `~/.fde` and could move a running daemon's state.
- Test and CI repairs that had kept the pipeline red: nine lint errors, a plugin test
  resolving a path outside the repository, a test requiring the Claude CLI, the relay test
  breaking on wrangler 4, a missing server build before the CLI tests, stale default-port
  expectations, and a claim timestamp assertion that failed whenever two writes shared a
  millisecond.

## 0.1.17 — 2026-09-03

- `install.sh` resolves the newest release even when every release is flagged as a
  pre-release. `/releases/latest` redirects to the releases index in that case, and the old
  resolver parsed the word `releases` as a version, so the piped install tried to download
  `fde-daemon-releases-<platform>.tar.gz`. It now validates what it parsed and falls back to
  the GitHub releases API.
- Releases carry `install.sh`, `uninstall.sh` and `install-docker.sh` as assets, so a
  release pins the installer that shipped with it.
- **Standalone pairing-page service** (`deploy/pair`, image `froggapp/fde-pair-page`): the
  `GET /code/:code` route a daemon serves, bundled into a stateless container that answers
  the public `pair.frogg.app`. A pairing code carries the whole offer, so one deployment
  serves every daemon's links without contacting any of them.

## 0.1.14 — 2026-09-03

- The daemon accepts WebSocket connections from the desktop app — Tauri origins
  (`tauri://localhost`, `http(s)://tauri.localhost`) had been rejected with 403, so direct
  TCP connections closed with code 1006.
- `/api/identity` sends `Access-Control-Allow-Origin: *` so the in-app LAN scan can see
  daemons.
- **Daemon self-update with automatic rollback**:
  `fde daemon self-update [--to <v>|--channel stable|beta] [--check] [--json]` installs a
  release beside the running version, and a detached supervisor flips `current`, restarts
  the service (systemd user unit, launchd agent, or the CLI's own stop/start), verifies
  `/api/identity` and `/api/health`, and reverts to `previous` when the new daemon does not
  come up. Outcome in `last-update.json`, steps in `self-update.log`; at most three versions
  are kept.
- From a client, every host's settings page gets a **Daemon updates** section — version,
  check, update with progress, applied or rolled-back outcome, auto-update toggle and
  channel — backed by the `daemon.update.check/start/get_status` RPCs and the
  `daemon.update.run.progress` broadcast. Dev checkouts, the desktop sidecar and Docker
  report why they cannot self-update.
- **Opt-in automatic updates**: `daemon.autoUpdate` in `config.json` or `FDE_AUTO_UPDATE=1`;
  checks on an interval, waits for agents to go idle, honours quiet hours.
- The installer writes `FDE_INSTALL_DIR` and `FDE_HOME` into the service environment and
  records `previous`; `install-docker.sh --update` swaps the container and restores the old
  one if the health check fails.
- Windows portable build published only as a zip.

## 0.1.13 — 2026-09-03

- Repository moved to its own GitHub organisation; update checks, install scripts, deploy
  defaults and docs point at the new address.

## 0.1.12 — 2026-09-03

- Default daemon port is now **9999** (explicit 6767 still works). Installer, Docker image,
  docs, CLI and app defaults all follow.
- Every icon, favicon, PWA icon and the startup splash use the frog mark; icons are larger
  with transparent backgrounds (dark surface on iOS); the window paints dark instead of
  white while loading.
- Window dragging on Windows and Linux via the title strip, with drag surfaces no longer
  selecting text.
- The direct connection field accepts `host:port`, `http(s)://`, `ws(s)://` and legacy
  `tcp://` forms, and shows the resolved WebSocket URL.
- **"Servers on your network"**: the app scans local /24 subnets for daemons on port 9999
  via `/api/identity`, resolves hostnames and offers one-click connect, flagging daemons
  that still need pairing.
- Remote SSH hosts gain a daemon password field, clearly labelled as the daemon's rather
  than ssh's, and ssh password authentication via askpass when a host offers it, remembered
  for the session only.
- Voice (dictation, voice mode, TTS) is on by default when the bundled speech runtime is
  present, with `features.voice.enabled=false` or `FDE_VOICE=0` to opt out. Daemon bundles
  include the sherpa-onnx runtime.
- **First-run pairing**: an unclaimed daemon reachable from the network serves a claim page
  with a single-use pairing link and QR until the first client pairs, plus
  `fde daemon claim-status` and `reset-claim`. Pairing links are
  `https://frogg.app/pair#offer=…` with a deep link; the app claims the daemon and stores
  the credential.
- **In-app updates**: the app checks GitHub releases every 6 hours and on demand, shows
  release notes, downloads the matching asset with checksum verification, and installs it —
  silent installer or portable swap on Windows, AppImage swap on Linux, DMG on macOS.
- `GET /api/identity` added to the daemon. Release assets carry `.sha256` sidecars, with a
  Windows signing hook for Azure Trusted Signing.

## 0.1.10 — 2026-09-03

- Legacy client version gates removed from the daemon. 0.1.x clients had been treated as
  legacy, which hid every provider except Claude, Codex and OpenCode and forced the legacy
  session restore path. All providers are visible again.
- Lockfile regenerated with every platform's optional binaries so macOS and Windows CI jobs
  install cleanly.
- Android APK (arm64-v8a) attached to releases.

## 0.1.9 — 2026-09-02

- **Android APK.** `apps/ui` builds as the Android app, with its own package id and a
  version code derived from the root `package.json`. `scripts/release/build-android-apk.mjs`
  runs `expo prebuild` and Gradle locally and in CI; the release workflow attaches the
  arm64-v8a APK, release-signed when the keystore secrets exist and debug-signed otherwise.
  Pull requests touching `apps/ui` assemble a debug APK.
- Playwright e2e re-baselined for the settings modal, fixing a cold deep-link into settings
  that could land on the wrong screen.
- CI: lefthook removed from the dependency tree for macOS and Windows runners, a conflicting
  apt package dropped, and already-uploaded release assets skipped on re-runs.

## 0.1.8 — 2026-09-02

- **Local daemon sidecar.** The desktop app can download the daemon bundle for its platform
  from the GitHub release, verify its checksum, unpack it into the app data directory, and
  start, stop and restart it through the bundled CLI — status polling, forced stop, and stop
  on quit unless "keep running after quit". No Node on the machine is needed, and thin
  clients without a bundle never try to start a daemon.
- Daemon bundle targets for `win-x64` and `win-arm64` (no symlinks, `bin/fde.cmd` launcher),
  cross-built from Linux and attached to releases.
- `install_local_daemon_bundle` and `local_daemon_bundle_status` desktop commands with a
  progress event.
- Settings opens as a large centred modal on wide layouts.

## 0.1.6 — 2026-09-02

- Settings opens as a large modal on wide layouts (VS Code style); the Help & Support menu is
  removed with Keyboard shortcuts moved into Settings; Schedules removed; Star, Sponsor and
  Community links removed.
- **Daemon install story**: a self-contained daemon bundle, `deploy/install.sh` (systemd or
  launchd service), `deploy/install-docker.sh`, and a Docker image built from the bundle.
- Accent colour changed from green to the logo cyan/blue; success colours stay green.
- **Remote SSH connections work again.** The Tauri bridge had forwarded its whole event
  object to `events.on` listeners instead of the payload, so the local-daemon transport shim
  never saw its `open` event and every SSH connect ended in "Connection timed out".
- SSH failures are reported as ssh reports them: the Rust transport races the WebSocket
  handshake against `ssh` exiting and emits the error with ssh's stderr immediately
  (`Permission denied (publickey).`, `Host key verification failed.`), with timeouts tuned so
  that message wins over the generic one, and the Add host sheet shows it in full.
- Every SSH transport step is logged — argv, executable and pid, first bytes from the tunnel,
  handshake result, exit status and stderr, events emitted. `FDE_SSH=<path>` pins the ssh
  executable, and on Windows the system OpenSSH path is tried when `ssh` is not on `PATH`.
- Add Remote SSH host splits into two tabs: **SSH config** (hosts from `~/.ssh/config` with
  `user@hostname:port` details and an optional daemon port) and **Manual**
  (`ssh://user@host[:port][?daemonPort=]`).
- An integration test drives the SSH transport end to end with a fake `ssh` bridging stdio to
  a local daemon.
- **GitHub Actions**: `ci.yml` (format, lint, typecheck, unit tests, Linux deb build) on every
  push and pull request; `release.yml` on `v*` tags building Linux deb/AppImage, the Windows
  NSIS installer plus portable exe and zip, macOS aarch64/x86_64 DMGs, daemon bundles, the
  updater manifest and the Docker image.
- Dependabot (npm, cargo, actions; weekly, grouped) and a pull request template.
- About credits the upstream project.

## 0.1.4 — 2026-09-02

- The desktop shell answers every daemon, CLI, log, update and legacy-skill command the UI
  invokes, with "not bundled" values instead of `Unknown desktop command`, fixing the
  "unable to load desktop daemon" toasts on startup. It writes `fde.log` in the app log
  directory, served by `desktop_app_logs`.
- **Remote SSH and unix-socket/named-pipe hosts** work from the Tauri shell: Rust spawns the
  system `ssh -W` or connects the local socket and bridges WebSocket frames to the webview.
- The Remote SSH page offers concrete `Host` entries from `~/.ssh/config` (one level of
  `Include`) as one-click targets.
- Portable Windows zip built beside the NSIS installer.
- The sidebar Help & Support menu is removed.

## 0.1.3 — 2026-09-02

- **Rebrand from Paseo to FDE** (Frogg Development Environment): the `@fde/*` package scope,
  a new origami frog logo and icons, the `fde` binary and CLI alias, desktop product name and
  window title, and the bundle identifier. Wire-level names are kept for daemon
  compatibility.
- Portable Windows zip published alongside the installer.
- `ROADMAP.md` added.

## 0.1.0 – 0.1.2 — 2026-09-02

- **Fork from Paseo v0.7.2** (`77aff0f`) into a new repository, with its own licence and
  attribution.
- The repository is reorganised into `apps/` and `packages/`, and upstream's Electron shell
  and website are dropped.
- **A new Tauri v2 desktop shell** (`apps/desktop`): window, bridge, settings, attachments,
  dialogs, notifications and deep links. Remote hosts only; no local daemon yet.
