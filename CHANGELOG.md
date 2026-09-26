# Changelog

## 1.6.0-beta.1 — 2026-09-26

- **frogg beta installs beside frogg.** Betas are now their own build of the brand: app
  `frogg beta` (`app.frogg.frogg.beta`), daemon `frogg-beta-daemon` on port 9998 with state in
  `~/.frogg-beta`, CLI `frogg-beta`, scheme `frogg-beta://`, `FROGG_BETA_*` environment, and
  icons with an amber BETA ribbon. Each build updates within its own channel, so the Stable/Beta
  switches in desktop, Android and host settings are gone; Settings → Updates shows which build
  it is. Any brand gets the same with `channels.beta` (all optional) in `brand.json`, selected by
  `FROGG_BRAND_CHANNEL=beta`, which the release workflow sets for `-beta.N` tags.
- A branded daemon started from another install's shell ignores that install's inherited
  `FROGG_*` settings, and commands its agents run no longer see its own internal copies.
- **Release streams.** `main` cuts betas and `stable` cuts releases (`frogg.json` `streams`).
  New `release:beta`, `release:promote` (copies `main` onto `stable` and cuts `X.Y.0`),
  `release:backport`, and for forks `release:sync-upstream` and `release:contribute`;
  `npm run streams` prints where each stream is. The version scripts refuse a cut on the wrong
  branch, and `release.yml` fails a tag that is not on its stream's branch. `release:minor` and
  `release:major` are removed: a stable minor arrives by promotion.
- **Release streams tab** (new-tab menu): a stream graph with one lane per stream, releases in
  time order and connectors for promotions, backports, upstream syncs and contributions; what is
  waiting on each flow with the command that moves it; and every recent feature and fix with
  the streams and first release that have it. New `checkout.streams.get_graph` RPC, gated on
  `features.releaseStreams`.
- The desktop app never offers an older build than the one installed, and the Apple Silicon
  download link points at the real `-mac-arm64.dmg`. Android uses the shared version ordering.
  `install.sh`'s fallback resolves only stable releases. GitHub Latest never moves backwards
  when two release runs finish out of order.
- Removed unused Paseo-era release scripts.
## 1.5.55 — 2026-09-26

- Desktop update checks no longer loop until GitHub rate-limits them. Since 1.5.37 each
  check re-announced the same update to every window, which started another check at
  once, so any client with an update waiting hammered the release feed until GitHub
  answered 429. The shell now tells windows only when the update's state changes. A
  rate-limited check now reads "GitHub is rate-limiting update checks from this network"
  rather than showing GitHub's HTML error page.

## 1.5.53 — 2026-09-26

- The presence row is pinned inside the agent composer (the box grows for it), so the
  pills above the composer no longer shift.
- "Is typing" now means the composer text was edited in the last 5 seconds, shown with an
  animated ellipsis; text left sitting in the box no longer counts.
- Default device names: the signed-in username on Windows and macOS desktops, the hostname
  on Linux, and the phone name on mobile, replacing "Frogg Desktop" / "Frogg (Android) on …".
  Nicknames and a chosen **Your name** still take precedence.

## 1.5.52 — 2026-09-26

- **Connected now** (Host settings → Devices) lists every client connected to a host —
  paired or loopback/trusted-network — with the sessions each is in and when it connected.
  Every role can see it. New `presence.list_connections` RPC, gated on
  `features.connectedClients`.
- **Your name**: each device picks the name others see. It rides the hello and every
  presence report, so a rename applies without reconnecting. Paired devices keep their
  credential name.
- **Nicknames**: give any other client a private nickname from its row. It replaces that
  client's name everywhere presence names someone and never leaves the device. Nicknames
  are keyed by `clientKey`, a one-way hash of the other app's install id.
- The daemon no longer falls back to a client's raw client id (a session-resume key) as its
  presence name, which leaked it to everyone on the session as `cid_…`.
- The presence row is redesigned: an avatar stack and one sentence ("Paz is typing · 1 more
  here") aligned with the composer column. The amber in-composer warning is replaced by a
  quiet accent edge on the composer.
- **Hide projects and sessions** per device: from the project and session ⋯ menus, the
  hold-Ctrl quick-action rail, and the command center. Hiding offers Undo; **Show hidden (N)**
  in the sidebar display menu (and the command center) reveals them to unhide. Nothing
  changes on the daemon or for other users.

## 1.5.49 — 2026-09-26

- A **viewer** device now only sees the work: sessions, timelines, terminal output, and
  files inside registered workspaces. It no longer receives the daemon's configuration or
  diagnostics (including the broadcast sent when configuration changes), and its directory
  search must start inside a registered workspace instead of the daemon user's home
  directory. Daemon configuration and diagnostics now need an operator.

## 1.5.46 — 2026-09-26

- The desktop app now opens `<scheme>://pair/direct?…` links, from argv on a cold start,
  from a second instance, and from `open-url`. The Electron shell only accepted
  `pair#offer=` and `host/add` links, so a direct pairing link brought the window forward
  and did nothing.
- A direct pairing link's server ID is read from `sid` or `serverId`. Before, a link that
  spelled it `serverId` lost it, which skipped the server ID cross-check on redemption.
- A brand can set `pairing.autoConfirmLocal` so a `pair/direct` link pairs with no click
  when its host is loopback, it carries a pairing code, and the daemon proves the key
  behind `fp`. Any other link, or any failure, shows the confirmation screen as before.
  Off for stock Frogg. The app reports the role the daemon granted.
- `GET /api/identity` adds `credentialRequired`: whether this requester must present a
  credential. `pairingRequired` stays false on a password-protected or claimed daemon, so
  it could not answer that.
- `pair` and other CLI commands reach a daemon whose pid file records an unbracketed IPv6
  wildcard (`:::9999`); it is dialled as `[::1]` like `[::]` and `0.0.0.0` already were.

## 1.5.45 — 2026-09-25

- Docker docs no longer tell you to pull `froggapp/frogg`, which has no published tags:
  every Docker path builds the image from source and installs with `FROGG_NO_PULL=1`.
- New docs screenshots for the relay endpoint card, the import dialog and the sidebar draft
  row; the docs now say **Import conversation**, and describe when a draft row shows its
  project name.
- Fixes three autoArchive e2e cases that created agents in an unregistered project.
- Removes dead references to deleted design docs and two unused i18n keys.

## 1.5.44 — 2026-09-24

- The "cache expired" composer warning now survives a daemon restart. The daemon records
  when a conversation last went to the model (`lastUsageAt`), keeps it on disk with the
  last usage figures, and the warning times from that instead of the agent's
  last-updated time, which restarts and renames reset.
- Every completed turn logs its context size, input and cached-input tokens and
  timestamp (`agent.manager.turn.usage`).
- Fixes the 1.5.43 CI failure: a relay reconnect test passed a stale argument.

## 1.5.43 — 2026-09-24

- **Removed:** the daemon no longer installs its skills into `~/.agents`, `~/.claude`
  and `~/.codex`. On start it removes the copies older daemons left, but only folders
  that are exactly as installed; anything edited keeps its folder. The Orchestration
  skills host setting and `agents.skills` config key (dropped on load) are gone.
- Companion settings are grouped into Voice, Conversation and Appearance. New: **Interrupt
  after** (how long you must speak before it stops talking) and **Conversation model**,
  which sets the host's `features.companion.model`.
- The Companion can create a worktree workspace for new work before starting an agent.
- Codex native voice no longer repeats finished task results after a reconnect.
- Reloading an agent closes its old provider session before starting the new one, so two
  sessions never write to the same transcript.
- The desktop app sends a Content-Security-Policy: scripts only from the bundle; no
  plugins, framing or form posts.
- `daemon-rs` gains the daemon lock-down: unknown credentials get 401, device roles,
  the claim latch and `claimMode` apply, revocations take effect without a restart, and
  the client's credential is forwarded so Node enforces roles for every forwarded message.
- English copy says "a frogg", not "an frogg".
- The Branding acceptance workflow passes again.

## 1.5.42 — 2026-09-24

- The right sidebar toggle now always sits in the workspace header, whether the sidebar is open
  or closed, instead of moving into the sidebar's own toolbar.
- The sidebar's Files/Changes/CI tabs animate down to icons when their labels no longer fit and
  expand again once there's room. The sidebar never gets narrower than the icon-only tabs, so
  every tab stays visible and clickable.

## 1.5.41 — 2026-09-24

- Settings > Updates shows the app update's download progress as it happens. A found release
  takes over the Check for updates row, and Download & install enables as soon as the
  download lands.
- **Removed:** schedules and heartbeats (the daemon service, RPCs, MCP tools, and the
  `frogg schedule` / `frogg agent heartbeat` commands). They are being rewritten; existing
  `~/.frogg/schedules` data is left on disk.
- **Removed:** Frogg agent profiles. Providers manage their own agents. Configs that still
  carry `daemon.agentProfiles` keep loading; the key is dropped.
- Non-Frogg brands now fall back to their `brand.json` `trustLan` default (off) in the Node
  and Rust daemons and the CLI, instead of a hardcoded `true`.
- Old `/settings/plugins` and plugin deep links redirect to settings; removed plugin config
  keys are dropped on load. Install and Docker hints name the current commands.

## 1.5.40 — 2026-09-24

- Branded builds can lock providers and models in `brand.json`. `providers.allowed` removes
  every other provider: the daemon never loads it and ignores its `config.json` entry, and the
  app's add-provider catalog leaves it out. `providers.models` takes allow/deny patterns per
  provider (`"opencode": { "allow": ["ollama/*"] }`); rejected models are hidden from the picker
  and refused when an agent is created, resumed or switched.
- Every brand other than `frogg` now ships OpenCode's hosted `opencode/*` models (free ones
  included) off. Naming an `opencode` model policy in `brand.json` replaces that default.

## 1.5.39 — 2026-09-24

- CI pane no longer trips GitHub's secondary rate limit (which also broke app update checks):
  jobs of finished runs are cached, jobs requests are capped at four at once, panes polling
  the same repo share one fetch, and a rate-limit response pauses GitHub refreshes for five
  minutes while the last result stays on screen. Active polling is now every 15 seconds.

## 1.5.38 — 2026-09-24

- Sessions auto-resume after a provider usage limit: the daemon queues a resume prompt a
  minute after the reset. The composer shows a countdown that can be cancelled; turn it off
  with the host setting (`daemon.autoResumeOnUsageLimit`, on by default).
- Sidebar drafts are listed inside the project they target.
- Host security: critical findings can now be marked **This is intended**, so a sandboxed
  host that is deliberately reachable without a password no longer shows a red dot.

## 1.5.37 — 2026-09-24

- CI pane: expanding a finished GitHub Actions job offers **Add to chat**, which saves the
  job's log on the daemon (timestamps and colour codes removed) and attaches it to the focused
  chat as a file the agent reads on demand.
- Desktop updates: a card that found an update while it was still downloading stayed
  disabled until settings was reopened. The shell now tells the window when the download
  starts and finishes (the Electron port had dropped those events), so **Download & install**
  enables on its own, and the card says the download is under way instead of "No download is
  published for this platform yet".

## 1.5.36 — 2026-09-24

- Security moves out of **Overview** into its own host settings section, second in the
  list, which carries the notification dot and says when a host has no issues. Brands
  cannot hide it. A warning that describes a deliberate setup can be marked **This is
  intended**: it stays listed, muted, but raises no dot on any owner device (**Warn me
  again** undoes it). The choice is stored in `config.json` as
  `daemon.security.acknowledgedFindings`; 1.5.35 and earlier refuse a file containing it.
  Critical findings cannot be dismissed. See
  [security posture](https://frogg.app/docs/self-hosting/security/#in-the-app).
- Usage refreshes when you mean it to: hovering a usage ring, an agent's reply and
  **Refresh** now fetch fresh figures instead of the daemon's five-minute cache (a provider
  is read at most every five seconds). Usage figures ease to new values instead of jumping.
- The **Usage** host section is folded into **Providers**, which now ends with the
  whole-host usage list. Old links go to Providers; `usage` in `hiddenSections` is ignored.
- Branded builds no longer show "Frogg" in process names (supervisor, voice worker) or in
  daemon, desktop, CLI and app messages. Attribution text uses lowercase "frogg".

## 1.5.35 — 2026-09-24

- Daemon lock-down follow-ups:
  - Host settings **Overview** has a **Security** card listing the daemon's security
    findings (unclaimed, reachable without a password, LAN trust, bind address or claim
    mode differing from the build's defaults) with a fix for each, including setting the
    daemon password from the app. A dot on **Hosts** and **Overview** flags a host with
    findings. Owners also get them from `frogg auth claim-status`, which now asks the
    running daemon first and says whether it read the daemon or `config.json`. A daemon
    bound only to loopback is never reported as reachable without a password. See
    [security posture](https://frogg.app/docs/self-hosting/security/#security-posture).
  - An unknown or revoked credential is refused with HTTP 401 / close code 4401, even on
    loopback. The app and CLI drop the stale credential and ask you to pair again instead of
    reconnecting in a loop; Remote SSH hosts do the same. Minting a pairing offer or code
    over the WebSocket needs the same local credential as the HTTP route.
  - Claiming: setting a password counts as claiming the daemon, a claim stays latched
    until `frogg auth reset-claim`, the last owner device can't be revoked or demoted, and
    the daemon warns at startup when claim mode is on, it is unclaimed and it listens off
    loopback. New `frogg auth claim` claims a daemon from its own machine.
  - The CLI reads the daemon's local token for loopback calls and honours
    `<PREFIX>_PASSWORD` on branded builds; `frogg daemon pair` reports a 401 instead of
    "no direct offer" and respects `--home`; `frogg pair --json` includes `serverId`.
  - No role can read or download files inside the daemon's home directory, and viewers
    only browse files inside registered workspaces and worktrees.
  - SSH deploy fails when pairing over the tunnel fails and pairs the desktop as owner.
  - Branded builds: the service plan and `install.sh` use the brand's listen variable and
    bind host; the brand manifest gains `daemon.trustLan`, `daemon.claimScope` and
    `daemon.providerUpdateChecks` (`<PREFIX>_CLAIM_SCOPE` overrides the scope).
    `install-docker.sh` no longer puts the password on the `docker run` command line.
- The daemon keeps a copy of a version 1 `principals.json` as `principals.v1.bak.json`
  before it first rewrites the file as version 2. The format change in 1.5.29 is one-way:
  1.5.28 and earlier can't read the new file. To roll back, restore the copy first. See
  [updates](https://frogg.app/docs/self-hosting/updates/#rolling-back-to-1528-or-earlier).

## 1.5.34 — 2026-09-24

- The daemon restart button in host settings showed a raw translation key
  instead of its label. The key it asked for belonged to a confirmation step
  the button no longer has, and no locale ever defined it.
- Signing a provider account in is no longer blocked on hosts that have a
  workspace with no directory. Sign-in runs the provider's own login in a
  terminal, which needs a workspace directory to start in; it looked only at
  the host's first workspace, so one directoryless workspace at the front
  disabled sign-in for every account on that host.
- Release notes are generated again for 1.5.x releases. The changelog parser
  only recognised a hyphen between a version and its date, so every heading
  written with an em dash was skipped.

- Pressing a provider in Settings opens the provider sheet, not the old model
  list. The row and the cog led to two different surfaces: the cog opened the
  provider sheet with its accounts, version and model catalogue, while the row
  itself opened an older, thinner sheet that the newer one had replaced. Both
  now open the same sheet, and the parts of the old one worth keeping — adding
  and removing a model id by hand, refreshing the catalogue, and the diagnostic
  report — sit on the provider's own tab inside it.
- A provider update no longer fails outright when the global npm directory is
  not yours to write to. A root-owned `node_modules` made every update end in a
  permissions error, even for CLIs that can update themselves into your home
  directory. Frogg now falls back to the CLI's own updater when the install
  cannot proceed.

- Remote SSH hosts now have a dedicated Deploy settings section. Redeploying
  keeps the SSH tunnel's loopback listener as its default instead of exposing
  the daemon on every network interface, and failed tunnel connections now say
  so explicitly.

- Codex usage no longer labels its sole weekly allowance as a session limit.

- An update whose download is still building shows how far off it is. When a
  release is tagged, each platform's installer is published as its runner
  finishes, so Settings could offer a new version and then say only "No
  download is published for this platform yet" — with no way to tell whether that meant ten
  more minutes or a failed build. The update card now shows the progress of the
  CI job building your platform's installer, the step it is on, and a link to
  the job itself, and says plainly when that build has failed.

- The Claude model list is generated from the Claude Code you have installed
  rather than maintained in Frogg. It used to be a hand-written list of fifteen
  models, so a model Anthropic shipped only reached you on a Frogg release, and
  every release had to restate each model's label, effort levels and fast-mode
  support. Frogg now asks the installed CLI what it supports, the way it already
  asked Codex. New models appear when you update Claude Code; retired ones stop
  being offered. Models named in Claude's `settings.json`, and models added
  through `additionalModels`, are still listed as before.
- Updating a provider uses the channel it was installed from. Codex and Claude
  Code ship their own native installers, which put the binary outside npm's
  reach, so `npm install -g` quietly installed a second copy that nothing ran:
  the update reported success and the version never moved. Frogg now runs the
  CLI's own updater when the binary on your `PATH` did not come from npm.
- Menus and pickers on an Android tablet are worked with a thumb again. A tablet
  is wide enough that Frogg treated it as a desktop and gave it mouse-sized rows
  and anchored popovers that opened off to one side, so the model picker in
  portrait was awkward to hit. Presentation now follows the input device rather
  than the screen width, while a tablet keeps the wider desktop layout. Menus
  opened from a short label no longer collapse to the width of that label and
  truncate every row.

- Deploying over SSH now secures the host it deploys to. A freshly installed
  daemon still trusted its own local network, so the Network posture handed
  every machine on the remote subnet ownership without pairing — and the
  pairing step did not take that back, because it adds a credential rather
  than requiring one. The deploy now turns that trust off before any pairing
  code exists, on a first deploy only, so hosts that already had a daemon keep
  their existing LAN clients. The SSH tunnel stays the default and the Network
  option says what it exposes.
- A tunnel deploy pairs for real instead of trusting loopback. It used to skip
  pairing and report the host unverified, on the grounds that SSH had already
  authenticated it; SSH authenticates the shell, but the app was then talking
  to the daemon over an unauthenticated socket with no device identity, so
  there was no principal to give a role, show as present or revoke. The
  pairing code is now redeemed through a short-lived loopback forward and the
  credential is stored on the connection. "Verified" now means the daemon
  issued this device a credential.
- The daemon's key is recorded against a host on first deploy, and a later
  deploy that finds a different key for the same daemon is refused instead of
  pairing again.
- A key file can be used with the SSH tunnel. The Remote SSH transport carries
  an `IdentityFile`, so a host deployed with an explicit key reconnects with
  it instead of falling back to ssh-agent.

- Per-device access for the daemon. Every paired device now holds its own
  credential with a role (`owner`, `operator` or `viewer`) instead of one
  undifferentiated claim, and a device can be listed, renamed or revoked on its
  own; revoking drops that device's live connections rather than waiting for its
  next reconnect. Devices reach a credential four ways: a short `XXXX-XXXX`
  pairing code, the older single-use offer link, an owner approving a request the
  device posted, or the daemon password. Passwords are hashed with scrypt (bcrypt
  hashes from older daemons still verify), and repeated failures from one address
  are throttled.
- `frogg pair` mints a pairing code from the running daemon. On a terminal it
  prints the code, the daemon's address and key fingerprint, the role, the expiry,
  a `frogg://pair/direct` deep link and a QR; `--code-only` prints the bare code,
  `--json` prints one object for deployment scripts, and neither ever puts a QR
  into a pipe. A brand that ships no mobile app hides the QR unless `--qr` asks.
- Claim mode, off by default for Frogg and on by default for any other brand.
  With it on the LAN is never trusted, every client needs a credential, and the
  first client to reach an unclaimed daemon claims it as owner. Pairing is
  two-way: the device verifies the daemon's key fingerprint against a signed
  nonce before it sends its code. `brand.json` gained `daemon.bind` and
  `daemon.claimMode` so a fork starts locked down; the Frogg distribution keeps
  binding `0.0.0.0`.
- Withdrawing LAN trust, or turning claim mode on, now disconnects the sessions
  that were relying on it.
- A brand's `daemon.bind` actually decides where a daemon listens. A new
  `config.json` no longer pins `daemon.listen` to `0.0.0.0`, so a brand asking
  for a loopback bind gets one; an address in `config.json`, the environment or
  `--listen` still wins. `--port` and the login service keep the brand's bind
  host, and the daemon reads its listen, trusted-LAN and claim-mode environment
  overrides under the brand's own prefix.
- `frogg auth claim-mode [on|off]` reports or changes claim mode and applies it
  to a running daemon without a restart. Loopback stays trusted in claim mode,
  so it is the way back in when claim mode locks an owner out.
- Security fixes. The Agent MCP endpoint has no unauthenticated case left: it
  always requires a credential whatever the caller's locality, reads the calling
  agent from that credential rather than a `?callerAgentId=` anyone could write,
  and rejects a `viewer`. `/api/setup/offer` mints a credential, so it needs one
  — LAN trust no longer buys a pairing offer. A client forwarded by a trusted
  proxy is never classified as loopback, so an `X-Forwarded-For: 127.0.0.1` can
  no longer claim the daemon's most trusted locality. A relay connection always
  requires a device credential.
- Daemon-wide session presence, so clients can see who else is looking at a
  workspace. Entries expire, and clients re-report while they are watching.
- A Devices section in a host's settings, so per-device access is managed where
  it is used rather than only over the wire. It shows this device's own role and
  what it may do, the devices waiting for an owner to let them in (approve with a
  role, or deny), the paired devices with their role, last seen and which one is
  you, and an owner-only pairing code with a countdown, a QR of the pairing link
  and the daemon's key fingerprint to read out. An operator or a viewer sees the
  list read-only with a line naming the role an action needs, instead of a button
  the daemon would refuse. Revoking your own device is confirmed separately
  because it ends the session, and revoking or demoting the last owner warns
  first — the daemon has no last-owner guard. `hostSettings.hiddenSections`
  accepts `devices`, in `config.json` and in `brand.json`.
- Enter a pairing code when adding a host. Type the host address and the
  eight-character code; the app makes the daemon prove it holds its key and shows
  the fingerprint to compare against the owner's screen before anything is
  redeemed.
- Pairing links ask before they pair. The pairing screen used to start pairing
  the moment an external link opened it, so a link in a message or on a web page
  could pair silently — and for a claim, silently take ownership of a machine. It
  is now a confirmation showing the address, name, key fingerprint, expiry and
  the role granted, with a prominent warning when the link would claim ownership.
  It offers no Pair button at all when the daemon's key does not match the link,
  when the daemon cannot prove it holds its key, or when a known server presents
  a different key. `<scheme>://pair/direct?…` links are handled everywhere, and
  the web build accepts the same parameters as a `#pair/direct?…` fragment.
- An agent chat and a terminal show who else is on them, by device name and what
  they are doing. When someone else is active the composer outlines itself in
  amber and names them — a warning, not a block: the composer stays usable.

## 1.5.28 — 2026-09-23

- Nothing user-facing: this release carries the test-infrastructure repair that
  brought CI back to green. The browser test project had been failing since a
  mobile Back fix first pulled expo-router into its dependency graph, and the
  providers settings tests broke when that section started reading provider
  versions. Both are fixed, so the suite guards releases again rather than
  being carried red through each one.

## 1.5.27 — 2026-09-23

- The provider Version card is visible when the sheet opens. It was placed on
  the provider's own tab, but the sheet opens on an account, and the header row
  that switches to the provider tab does not look like a control — so the card
  shipped effectively invisible. A provider's version is not an account-scoped
  setting, so it now sits above the account chips and shows whichever tab is
  selected. The Providers list also badges any provider with a newer release
  published, so an available update is visible without opening anything.

## 1.5.26 — 2026-09-23

- Providers can be updated from Frogg, and kept updated. Each provider's own tab
  in host settings gains a Version card showing the installed version against the
  latest published one, with an Update button for the providers Frogg
  distributes — Claude, Codex, Copilot and OpenCode, all npm packages — and a
  link to the vendor's instructions for the ones it does not. `frogg provider
update` reports the same versions and installs by name or `--all`. The daemon
  checks for new releases in the background on its own schedule; turning on
  `providerUpdates.autoUpdate` (the Update automatically switch, or `frogg
provider update-settings --auto-update true`) lets it install them too, which
  is off by default because replacing a provider binary under a running session
  should be the user's decision.

## 1.5.25 — 2026-09-22

- On phones, the account is picked from the composer toolbar rather than from
  inside the model sheet. When a provider has more than one sign-in registered,
  choosing which account a new conversation starts as is a decision made about
  as often as the model, so it now sits beside the model pill instead of two
  taps deep behind Select model. Providers with a single account keep the row in
  the sheet, and a launched agent's account is still named by its own pill above
  the composer.

## 1.5.24 — 2026-09-21

- Back from a screen the sidebar opened returns to the sidebar. Every sidebar row
  closes the sidebar before it navigates, so by the time Back popped the pushed
  route the columns had forgotten where the press came from: Settings and New
  session both came back to the previous conversation rather than to the list
  they were opened from. The compact sidebar now records the route it left, and a
  Back press that pops a route reopens the sidebar on arriving there. Only a Back
  press arms this, so navigating forward to that conversation later does not pop
  the sidebar open behind you.

## 1.5.23 — 2026-09-21

- Android's Back button walks back through the app instead of quitting it. The
  whole app had one Back listener, on the workspace explorer overlay; everywhere
  else the press fell through to the activity. Because the conversation sits at
  the bottom of the route stack, Back from a conversation closed the app rather
  than revealing the session list, and bottom sheets — the model picker, the
  action sheets, every adaptive modal — closed it from underneath an open menu,
  since the sheet library ships no Back handling at all. Back is now decided in
  one place: an open sheet or menu closes first, the right sidebar returns to the
  conversation, the conversation returns to the session list, and only the
  session list leaves the app. Anywhere off a workspace route — settings, an
  agent's detail, an opened attachment — it returns to whatever opened it.

## 1.5.22 — 2026-09-21

- Each meter ring's letter is centred on the ring it labels. Centring a text box
  does not centre the character inside it, so every glyph sat about half a pixel
  off — visible because the three rings sit side by side, where the error reads as
  a wobble along the row. The nudge is now measured from whichever font the app is
  actually drawing in, rather than assumed, which matters because the UI font is a
  system stack the user can override. The context ring and the quota rings also
  share one glyph component now, so they cannot drift apart.

## 1.5.21 — 2026-09-21

- The composer's window rings are lettered S and W. They read "5" and "7" — the
  windows' lengths rather than their names, and a digit in a 16px ring reads as a
  count of something. Each ring now carries the first letter of what it measures,
  matching the M and D the monthly and daily windows already used and the C on the
  context ring.

## 1.5.20 — 2026-09-21

- Daemon and self-update overrides reach the process they were meant for on a
  branded build. Env overrides live in two namespaces — the external
  `<PREFIX>_FOO` a brand reads and the internal `FROGG_FOO` it maps onto — and
  three spawn sites wrote the internal name where the child only ever reads the
  external one. `daemon start --port`, `--listen`, `--hostnames`,
  `--relay-use-tls` and `--web-ui` were discarded before the daemon read its
  config, so the daemon came up on the default port with nothing saying the flag
  had been ignored; self-update installed to the default directory rather than
  the one the daemon runs from; and the execution worker kept whatever home it
  inherited. None of it is visible under the stock brand, where the two names are
  the same string, so a contract test now states the pairing rule against a brand
  whose prefix differs.
- The daemon bundle smoke test runs against any brand. It invoked the launcher as
  `bin/frogg`, which a branded bundle does not ship, so it failed before starting
  anything; it now discovers the launcher from the bundle's `bin/`.

## 1.5.19 — 2026-09-20

- Frogg updates itself on Android. A new version used to mean finding the APK and
  installing it by hand; Settings > About > Updates now checks the published releases,
  picks the package built for this device, downloads it and hands it to Android's own
  installer, and a callout offers the update at startup rather than waiting to be found.
  Stable and Beta channels, and the automatic check can be turned off. The choice of
  package follows the installed app's own signing key, so an install is only ever offered
  a build that can actually replace it, and says so plainly when the published one is
  signed differently. The F-Droid build keeps neither the permission nor the updater: its
  client owns those updates.

## 1.5.11 — 2026-09-20

- A session now starts on the account you picked. Typing into the new session
  screen does not create the agent there: it hands the draft to a tab in the new
  workspace, and that tab launched with an account it resolved for itself, so a
  session started as one sign-in came up signed in as another. The pick now
  travels with the draft and wins over the tab's own resolution.
- Plan usage is read per account. Every sign-in has its own plan and its own
  limits, so one card per provider could only describe whichever account the
  daemon happened to have active, with nothing on screen saying which. A
  provider with more than one account now carries the same account tabs the
  provider settings sheet uses, and the figures follow the open tab. Refreshing
  reaches each account's figures rather than only the unscoped list.
- A daemon self-update reports what it is doing. The run sends download byte
  counts, so the settings section shows a determinate progress bar, the phase it
  is in, an explicit note when it moves to installing and disconnects, and a
  countdown of how long the app will wait for the daemon to check back in.
  Failing to reconnect now says what the timeout was. Older daemons keep the
  text-only phases.
- The account picker's usage figures line up. Each account's window usage was a
  ragged inline string; the figures are now fixed-width cells anchored to the
  right of the row, reading as a grid down the list.
- Session rows use the full width of the sidebar. Two reserved columns held a
  band of dead space open on the right of every row, truncating titles early.
  The kebab's actions are an overlay pinned to the row's edge, and the agent
  disclosure no longer holds an empty column open on rows with no subagents.
- The Explorer dock keeps clear of the window controls. It sat underneath them
  without knowing it, running its tabs beneath the controls and putting its
  close button off the window; while it is open it owns that corner. The
  header's remote button also opens the repo's home page rather than the
  checked-out branch, which 404s whenever that branch has never been pushed.
- Copying a path from the Changes surface says so, with the same toast the rest
  of the app uses, naming which of the two was copied.

## 1.5.10 — 2026-09-20

- Holding the workspace-jump modifier no longer makes the sidebar jump. The
  number badges waited 150ms before appearing while the quick action rail
  appeared at once, so the rail drew against the row's right edge and was then
  shoved left the moment the badge arrived. The badges now follow the modifier
  with no delay and fade in on the rail's own curve. Sidebar rows also lost the
  extra right-hand padding that left a band of dead space down the panel's edge.
- The Explorer sidebar's tabs stay reachable at any width. Changes, Files, the
  pull request and CI drop their labels for icons with tooltips once the strip
  no longer fits, instead of the last tabs running off the header and out of
  reach. The desktop window now also has a minimum size, below which even the
  icon-only strip would be clipped.
- The Explorer sidebar is an application panel rather than session state: its
  width and its open state are shared by every workspace, so jumping between
  sessions no longer opens, closes and resizes it underneath you. Which tab is
  selected still follows the checkout.

## 1.5.9 — 2026-09-20

- A Claude Code Workflow run now lists the agents it fans out beneath its own
  row in the subagents track, indented one level. Each child shows its label,
  phase, model and token use, updates from running to finished while the run is
  still going, and opens its own timeline. Previously only the Workflow itself
  was visible and every child's transcript was replayed onto that one row,
  interleaving agents that had run in parallel.
- Upgrading from a terminal the daemon hosts no longer leaves the host with no
  daemon. `systemctl --user stop` kills the whole service cgroup, which held
  the installer, its shell and the `systemctl` that issued the stop, so the
  `start` that should have followed never ran. The restart now goes to a
  transient `systemd-run --user` unit that outlives the stop. The terminal it
  was typed in still ends with the daemon, and the installer says so before
  handing over.
- `frogg start` and `frogg restart` keep the daemon under the service that
  owns it. Both used to start a loose detached daemon even where a systemd
  unit or launch agent was installed, leaving the unit inactive while the
  daemon held the port, so the next upgrade or reboot failed with
  `EADDRINUSE` and nothing reported it. Explicit overrides (`--home`,
  `--listen`, `--foreground`, and the rest) still start a daemon by hand,
  since a unit cannot honour them.
- `frogg status` reports the registered service and who is running the daemon
  (`Service`, `Managed By`), and names the command that repairs a daemon that
  has drifted out from under its service.
- Automatic update checks are logged even when they find nothing, with the
  time of the next check, so a host sitting on an old version can be told
  apart from one whose auto-updater has stopped running.
- The FDE compatibility warning no longer fires for an `fde-daemon` service
  that has already been disabled, and tells you how to retire one that has
  not.
- Cutting a release refreshes `deploy/nix/npm-deps.hash`. `npm version` reinstalls
  and so rewrites `package-lock.json`, which invalidated the hash and left the
  `nix` CI job failing on every pull request until someone regenerated it by
  hand. The hash is now part of npm's `version` hook (`npm run nix:hash`), and
  `update-nix.sh` computes it through the `nixos/nix` container when Nix is not
  installed, so the machine cutting the release does not need Nix.

## 1.5.8 — 2026-09-19

- A **CI** tab in the right-hand pane, after Files and Changes, shows the CI
  runs for the session's branch: GitHub Actions for GitHub repositories, and
  Jenkins when the project's `frogg.json` names a Jenkins job. Each run shows
  its status, progress, when it started and how long it has taken, with a bar
  per job; jobs list their steps and the runner they are on, and a Runners
  section shows which machines are busy. Jenkins credentials come from
  `FROGG_JENKINS_USER` and `FROGG_JENKINS_TOKEN` on the daemon host.
- The sidebar opens with the brand mark, which links home, above icon-only
  navigation.
- The sidebar's Show menu can hide or show the account on session rows.

- An agent started without choosing a provider account now stays on the
  account that was active when it started. Previously it followed the
  daemon-wide active account at every launch, so switching accounts and then
  reopening an old conversation silently ran it on the new account and re-sent
  its whole context uncached, while the account pill named the wrong account.
  Existing agents are pinned to the active account the next time they launch.
- A provider sheet's account tab shows that account's own usage, read from its
  own config directory, instead of showing the account in use's figures on
  every tab and nothing at all on the others.
- A renamed default sign-in no longer appears twice in the composer's account
  picker, once under its new name and once as "Default".
- The account pill above the composer can now move a running conversation to
  another of the provider's accounts. It says what the move costs first: the
  account it moves to has never sent this conversation upstream, so the whole
  context is re-sent as fresh input with no cache read, and charged as soon as
  the next message goes out. The conversation itself, its timeline and its
  place in the workspace all survive the move, and the account it came from
  keeps its own copy so it can be moved back.
- Typing into a Claude conversation that has been sitting for more than an
  hour outlines the composer in amber and says, in its corner, how many input
  tokens the next message re-bills. Past that hour the prompt cache is gone,
  so the message is not the cheap continuation it looks like.
- Provider accounts are managed only inside their provider's settings sheet,
  which is now one tab per sign-in. The tab you are on scopes the page: its
  sign-in state, usage, new-agent defaults, model access, system prompt,
  nickname, colour, moving it to another host, and deleting it. The provider
  row is its own tab and keeps the model catalogue and uninstalling the
  provider. The separate "Provider sign-ins" list on the host page is gone.
- An account can set a default model and thinking level for new agents, a
  colour and nickname, and a system prompt the daemon appends to every agent
  launched as that account.
- Daemon self-update no longer fails, or rolls back a healthy release, when a
  leftover pre-rename `fde-daemon` service on the same port wins the restart
  race. The updater now recognises another daemon answering on its address,
  stops and disables a legacy FDE service on that port, and retries; if the
  port stays foreign it restores the version that was running instead of
  blaming the new bundle. A failed or rolled-back record for the version that
  is now running reports as applied.
- The daemon's foreground start forwards the service manager's stop signal and
  waits for its supervisor, so stopping or restarting the service shuts the
  worker down gracefully instead of killing everything at once.
- When the daemon cannot bind its port, the log names who holds it (daemon
  product, version and server id, and pid and process name where available),
  and worker crash restarts back off from 1 s to 30 s.
- Automatic updates back off per version: after a failed attempt the next try
  waits one check interval, doubling after each further failure up to seven
  days, and the count survives the restarts each attempt causes. It resets
  when a newer release appears or the update succeeds. **Update now** is never
  held back.
- The app refuses a different daemon answering on a saved host's address and
  keeps retrying until the host's own daemon is back. The host page shows why,
  in the app's language, right under the host's status. A local placeholder
  host now only adopts the server id of a daemon of this app's own product.
- The pull request panel's checks list is no longer capped at eight rows with a
  scroll area of its own. Checks and activity each take the height their content
  needs and the panel scrolls as one, so on a phone the checks are readable
  instead of clipped above an activity section holding the empty rest of the
  screen. Collapsing either section gives its space back to the other.

## 1.5.7 — 2026-09-19

- Holding Alt over the sidebar expands a session's menu into quick action
  icons — rename, pin, labels, copy session ID, archive — so several sessions
  can be archived or renamed without opening a menu each time. Only the
  selected row and the row under the cursor expand; releasing Alt collapses
  them back to the kebab.
- Every session now has a short session ID, `s_` followed by eight characters,
  shown in the session menus, the hover card and on subagents. Subagents get
  their own even while attached to a parent. It identifies a session that has
  no git branch, which a branch name cannot.
- Archived sessions can be browsed per project from the project menu, instead
  of only in the app-wide History list.
- Confirmation dialogs are now drawn by Frogg itself rather than by Windows,
  macOS or the browser, so they match the app on every platform.
- Reversible actions no longer ask first. Archiving a session only prompts when
  the worktree has uncommitted changes or unpushed commits; updating or
  restarting a daemon, and updating skills, do not prompt at all — what they
  do to running agents is written in the row instead. Restoring a branch's
  stash is now an offer in a toast rather than a dialog.
- The account a session runs as sits at the right end of its row with its name.
  A session with subagents or several tabs shows the account on each of those
  instead, and keeps the change count at session level.
- "Copy path" is gone from the session menus.

## 1.5.6 — 2026-09-19

- Provider accounts are managed inside their provider's settings sheet, one
  tab per sign-in. The selected tab scopes sign-in state and usage, new-agent
  defaults, model access, a per-account system prompt, nickname and colour,
  moving the account to another host, and deleting it. The separate
  "Provider sign-ins" list on the host page is gone.
- A new agent starts on its account's default model and thinking level, and
  the account's system prompt is appended when the agent launches.
- The New session composer always opens on Chat. Picking a terminal profile
  no longer sticks to later sessions, which had hidden the provider and
  account chips and disabled image paste.

## 1.5.5 — 2026-09-19

- A new session now starts on the account its picker shows. With a second
  provider account signed in, an untouched picker resolved to the
  daemon-wide active account while still reading "Default"; it now shows the
  account the agent will really launch as. Picking Default explicitly still
  pins the default config directory.
- The context-window usage popover reports the quota of the account the
  session is running on, instead of always reading the default account's.

## 1.5.4 — 2026-09-19

- The sidebar list is headed "Projects", translated in every bundled
  language, since each row is a project with its sessions nested underneath.
- Workspaces are called sessions everywhere they are shown: the sidebar's
  "New session", menus, the command center, settings and the docs. The
  projects-and-workspaces docs page is now projects-and-sessions, with a
  redirect from the old address. Importing history from CLI tools now talks
  about conversations. Routes, config keys, the daemon protocol and CLI flags
  keep the old names, so links and stored state are unaffected.
- The pill row above the composer lines up with the composer's left edge on
  wide panes.
- A running agent's account is shown as a pill above the composer instead of
  a greyed-out control in the toolbar, including when the provider has only
  one account.
- The desktop top bar is draggable across its whole width, not only by the
  title.
- Contributors can run `npm run preview` for a hot-reloading UI with demo data
  and `npm run shot` to screenshot any screen of it.

## 1.5.3 — 2026-09-18

- Carries everything listed under 1.5.1 and 1.5.2, neither of which was
  published because desktop builds failed in the release workflow. The brand
  fingerprint no longer depends on line endings or path separators, so a
  Windows runner accepts the web UI export built once on Linux.

## 1.5.2 — 2026-09-18

- Carries everything listed under 1.5.1, whose desktop builds failed in the
  release workflow so it was never published. Building the desktop app from a
  prebuilt web UI export now builds the protocol package first.

## 1.5.1 — 2026-09-18

- A `frogg://host/add?type=directTcp&host=…&port=…` link registers a direct
  host, so provisioning tooling can introduce a daemon that does not require
  pairing without writing the app's private host registry.
- Add project starts browsing where the brand says (`projects.defaultDirectory`,
  `~` unless set) and shows an editable path bar. A host missing that directory
  falls back to the home directory.
- A brand can hide host settings sections (`hostSettings.hiddenSections`). The
  daemon seeds its own config from the brand default, and an admin can turn a
  section back on for the host they run without a new build.
- A downstream build can report its own version in Settings > About by setting
  `<PREFIX>_RELEASE_VERSION` at brand:prepare time. Unset, nothing changes.
- The provider settings modal lists the default account among the Models
  account tabs so it can be restricted like any other, and a + button beside
  the tabs adds an account. Usage in the Accounts section is padded and spaced
  like the other sections, and the modal has more room at the bottom.

## 1.5.0 — 2026-09-18

- Each installed provider now has a settings cog in Settings > Providers that
  opens a per-provider modal. The leading chevron is gone: it implied a
  disclosure that never expanded. Uninstalling a provider moved out of the row's
  overflow menu into the modal's danger zone.
- Provider accounts can be managed from that modal. An account can be renamed,
  signed out, removed, and its usage inspected. Renaming the default account is
  a label change only and never moves its config directory.
- Accounts can be exported and imported, so a set of accounts can be moved to
  another daemon or server. An export bundle contains live credentials in plain
  text (base64 is encoding, not encryption) — handle it like a password. The
  daemon never writes a bundle to disk, and imported credential files are
  written 0600.
- Models can be restricted per account, so a plan that should not reach a
  particular model cannot select it. An account is unrestricted by default. The
  daemon enforces the list when an agent starts and when one resumes, so the
  restriction holds regardless of what a client sends.
- Codex now supports multiple accounts. CODEX_HOME redirects the config
  directory, auth.json holds the credential and prompts/ stays shared.
- Gemini CLI supports multiple accounts behind an opt-in switch. Gemini has no
  environment variable that redirects its config directory — it reads $HOME and
  a hardcoded .gemini — so an account is a synthetic HOME with .npm, .npmrc,
  .cache, .gitconfig, .ssh and .config/gcloud symlinked back to the real home.
  Anything else Gemini reads from home will not be there, so it ships disabled;
  enable it per provider in config.json.
- The pill row above the composer scrolls horizontally instead of squeezing its
  pills, and a running agent's account appears there as its own pill rather than
  greyed out in the controls, shown only when the provider has several accounts.

## 1.4.1 — 2026-09-17

- Sidebar workspace rows now carry a small account glyph when the workspace's
  agent runs under a provider you have signed into more than once. It is icon
  only so the diff stat and timestamp keep the trailing slot, and hovering it
  names the account.
- Self-update now reconciles who owns the running daemon before restarting a
  registered service. If the systemd unit or launchd agent is inactive while a
  hand-started daemon is running, that daemon is stopped first so the unit's
  restart actually brings up the newly installed version instead of hitting the
  running daemon's idempotent start.

## 1.4.0 — 2026-09-17

- Keep the provider account pill in the chat composer once an agent is running.
  It shows the account the agent actually runs as — including the active account
  a launch without an explicit pick resolved to — but is greyed out and does not
  open, since the account is fixed when the agent starts. The daemon now echoes
  the agent's `providerAccountId` on its snapshot; older daemons simply show the
  provider's active account.

## 1.3.6 — 2026-09-17

- Add provider accounts (multi-sign-in). A provider can be signed in as several
  accounts, each backed by its own CLI config directory with selected folders
  symlinked from the primary one, so commands, skills, agents, projects and
  sessions stay shared while credentials stay separate. Manage them under
  Settings > Providers > Provider sign-ins; signing in opens a terminal running
  the provider's own login command. Choose an account per agent from the picker
  beside the model selector, which appears only for providers that have
  accounts. Claude is enabled; other providers are declared but disabled pending
  verification of their config directories and credential files.
- Mark the disabled provider account manifests as unverified. Their config
  directory, environment variable and credential filenames are best-known
  guesses rather than tested values, so they now carry a `verified: false` flag
  and a note saying what was never confirmed. The settings UI shows the note,
  the daemon warns at startup when a `config.json` override enables one, and
  account creation returns the same warning.
- **Breaking:** remove the `params.claudeAccount` provider mechanism added in
  1.3.0, superseded by provider accounts. Existing `providers.*` entries using it
  still parse and are ignored; the daemon logs a startup warning naming them.
  There is no automatic migration — recreate those accounts under Provider
  sign-ins and delete the stale entries from `config.json`.
- Report a daemon's full version, including any downstream build suffix, and rank
  a downstream rebuild above the release it rebuilds when checking for updates.
  Daemon bundles record the full version in their manifest, so rebuilds no longer
  install over each other.
- Apply that same ordering to the desktop app's update check, which previously
  used plain semver and so reported one downstream rebuild as already up to date
  when a newer one was published. The rule now lives in one shared module used by
  the CLI and the desktop app. The desktop app also accepts a bundled daemon
  whose manifest carries a rebuild suffix the app's own version does not, instead
  of refusing to start.
- Fix `daemon status` reporting a healthy daemon as unresponsive when it binds a
  wildcard address: the listen target is now normalised to a connectable host
  before probing. This also restores the `Daemon Version` field, which was blank
  whenever the probe failed.
- Remove the unused Tauri desktop shell (`apps/desktop-tauri`), its build and
  packaging entry points, and the Electron settings migration that imported
  preferences from a Tauri install. The Electron app in `apps/desktop` is the
  desktop client; no workflow built or released the Tauri shell.

## 1.3.5 — 2026-09-16

- Complete merge-target workspace handover so successful merges activate the target workspace and archive the clean source workspace.
- Improve Claude account setup, authentication entry points, provider configuration and related workspace/UI behavior.

## 1.3.4 — 2026-09-16

- Show the workspace directory and checked-out branch in separate composer context pills.
  For Frogg-managed worktrees, the directory pill now identifies the source project checkout,
  rather than Frogg's internal worktree directory.
- Remove confirmation dialogs for sidebar-only project removal and ordinary workspace archiving.
  Frogg retains the confirmation before archiving a managed worktree because that cleanup can
  remove the worktree directory.

## 1.3.3 — 2026-09-16

- Show the active workspace directory and checked-out branch continuously beside the composer.
  The workspace change badge now reports only uncommitted tracked and untracked changes, rather
  than committed differences between the current branch and its base.
- Credit Frogg, rather than its upstream predecessor, in branded app About screens.
- Read the signed product manifest in daemon bundles so branded daemon status reports the same
  downstream version suffix as the client, including versions such as `1.3.3-xx.1`.

## 1.3.2 — 2026-09-16

- Report the live authenticated client count in `frogg daemon claim-status --json` under
  `daemon.connectedClients`, and keep the live daemon pairing decision only under `daemon`.

## 1.3.1 — 2026-09-16

- Write daemon service environment settings using each brand's environment namespace, so custom
  installations retain their configured listen address, web UI and execution-service mode.
- Allow a branded Electron renderer's `<brand-scheme>://app` WebSocket origin while retaining
  stock `frogg://app` compatibility and the existing restrictive origin allowlist.

## 1.3.0 — 2026-09-15

- Stop automatic project registration when agents, workspaces, terminals or scripts use a new
  directory. Projects are added only through an explicit project action; worktrees stay under
  their main checkout's project.
- Add isolated Claude account provider profiles. Each profile launches with its own
  `CLAUDE_CONFIG_DIR` and may share only selected content directories; credentials and settings
  remain private to that account.

## 1.2.0 — 2026-09-15

- **Custom-brand environment migration:** a branded daemon and desktop now use the
  brand's `envPrefix` for all Frogg settings. Replace inherited `FROGG_*` entries
  in branded service units and `.env` files with the equivalent `<BRAND>_*` entry
  (for example, `ACME_LISTEN` and `ACME_HOME`). Branded builds deliberately ignore
  `FROGG_*` settings to prevent an upstream deployment's configuration leaking into
  the branded product. This affects custom brands only; official Frogg continues to
  use `FROGG_*`.
- Register and handle the configured brand deep-link scheme for desktop agent links;
  branded desktop apps continue to accept existing `frogg://` agent links.

## 1.1.3 — 2026-09-15

- Show the Electron updater's installer progress so the app continues to report what is happening after download and verification.

## 1.1.2 — 2026-09-15

- Keep the native Skia Companion Nebula out of web and Electron bundles, so the desktop renderer starts normally.
- Restore Android CI and release setup with the supported SDK package, and remove the stale Companion artwork browser assertion.

## 1.1.1 — 2026-09-15

- Restore the standard AudioLines Companion launcher icon in the composer.
- Render the Companion Nebula with the transparent live shader used on frogg.app, replacing the layered static image and opaque background.
- Keep the local speech preview stable while a user speaks; submit the final sentence after endpointing.

## 1.1.0 — 2026-09-14

- Bring the approved purple/cyan Companion Nebula identity into the app. The composer launcher and Companion presence now use the same Nebula artwork instead of the legacy squiggle mark and layered blue orb.
- Keep Companion available as an opt-in voice preview, with its existing local-speech readiness checks and conversation controls.

## 1.0.1 — 2026-09-14

- Add a **Sort** option to the sidebar display menu: recent activity (the default), date
  created, name, needs attention first, or manual drag order, with a reverse toggle. Dragging
  while sorted keeps the on-screen order and switches to manual. Every sidebar starts on
  recent activity after updating; the saved drag order is kept for manual.
- Send workspace and project creation times from the daemon (`createdAt` and
  `projectCreatedAt` on descriptors, advertised as `server_info.features.workspaceCreatedAt`).
  **Date created** sorting stays unavailable until every connected host reports them.
- Hide dot-prefixed folders in the folder browser and directory suggestions by default, with
  a **Show hidden folders** setting under Settings > General. Typed paths into hidden folders
  still open. Older daemons ignore the new `includeHiddenDirectories` request field.

Installed-client upgrade and physical-device validation remain separate from artifact
build checks. The Android APK is still debug-signed.

## 1.0.0 — 2026-09-13

First major Frogg release, with independently installed Node daemons and an app-only
Electron desktop client for Windows, macOS and Linux, plus Android and web clients.

- Keep window headers draggable with both sidebars open, exclude settings-modal
  headers from dragging, and place the explorer close toggle in its panel toolbar.
- Use Windows separators for generated NSIS includes and installer bitmap paths.

- Enlarge the home-screen logo 2.5× and remove excess padding from desktop taskbar
  and dock icons, keeping a small transparent margin to prevent clipping.

- Rename the product from FDE to Frogg everywhere: the `frogg` binary and daemon commands,
  `@frogg/*` packages, `FROGG_*` environment variables, `~/.frogg` home, `frogg.json`,
  the `frogg://` scheme, the `app.frogg.frogg` application id and all artifact names.
  On first start the daemon moves `~/.fde` to `~/.frogg`, rewriting stored paths, repairing
  moved git worktrees and moving their Claude Code sessions. `FDE_*` variables are no longer
  read; the daemon lists any it finds with their `FROGG_*` names. Desktop and mobile apps need
  a fresh install.
- Replace the Windows installer wizard with a one-click, per-user installer in a small
  branded window. An older all-users install is removed once, with administrator approval
  and app data kept, so updates never leave two copies. The window's copy, colours and
  artwork come from the new optional `installer` block in `brand.json`.

Installed-client upgrade and physical-device validation remain separate from artifact
build checks. See the [migration notes](website/src/content/docs/docs/self-hosting/updates.mdx#moving-from-fde)
for the coordinated FDE-to-Frogg transition.

## 0.7.0 — 2026-09-13

- Fold host Connections, Metadata and Workspaces settings into Overview. The Agents tab
  and project settings list provider agent definition files (Claude Code, Codex,
  OpenCode, Copilot) found on the host.
- Remove the plugin system: the `@fde/plugin` package, the `fde plugin` CLI, plugin
  RPCs and all plugin UI. Existing plugin folders on disk are left untouched, and a
  saved plugin theme falls back to auto.

- Check website deployment credentials from the runner workspace before checkout,
  so an unset Cloudflare token skips deployment as intended.

- Fix Nix installation collisions from redundant self-links and inspect macOS
  branded executables through their actual bundle metadata.
- Restore unfinished workspace forms from the sidebar with their project, prompt,
  attachments, provider selections, isolation and starting reference. Keep pending
  submissions locked across navigation and retain failed launches for retry.
- Add project and conversation import from client files or the selected daemon,
  with preview, canonical project merging, persistent session/history deduplication,
  bounded transfer and explicit native-session versus text-history presentation.

- Preserve exact prior Linux/macOS desktop update payloads in selected development
  releases, with independent platform versions and strict continuity verification.
- Record development release target defaults and rename-safe update requirements.

## 0.6.21 — 2026-09-13

- Synchronize internal dependency lockfile pins and regenerate the Nix dependency
  hash for the attachment pre-read safeguards.

## 0.6.20 — 2026-09-13

- Reject oversized attachment selections before browser/Expo byte reads and Electron
  managed-file copies or reads, retaining the existing localized 50MB error.
  Bound native reads when files grow and remove incomplete managed copies.
- Verify selection preflight and sparse-file rejection; native device picker
  acceptance remains separate from automated coverage.

## 0.6.19 — 2026-09-13

- Verify draft release assets through paginated release discovery, including on
  older GitHub CLI versions, so completed drafts can pass the publication gate.

## 0.6.18 — 2026-09-13

- Add an asynchronous build-monitor skill covering targeted CI repairs, persistent
  monitoring, and isolated local/hosted build scheduling.

## 0.6.17 — 2026-09-13

- Preserve LF shell templates on Windows checkouts and allow individual Windows,
  Linux daemon, or Android artifact builds when retrying a platform-specific fix.

## 0.6.16 — 2026-09-13

- Limit main CI artifacts to Windows x64 desktop, Linux x64 daemon, and bundled
  Android arm64 clients; limit desktop PR builds to Windows.

## 0.6.15 — 2026-09-13

- Align daemon configuration tests with all-interface listen defaults and explicit
  generated settings; verify transactional rollback restores the full persisted config.

## 0.6.14 — 2026-09-13

- Remove committed relay runtime databases and ignore Wrangler state. Audit the
  repository namespace so upstream names remain only in attribution and licensing.

- Default daemon startup, port-only listen targets, service installation, Nix and
  SSH deployment to `0.0.0.0`, preserving explicitly configured addresses.
  Expand generated daemon configuration with editable defaults and provide
  explicit formatting for existing `config.json` files.
- Start directory browsing at the daemon home and list immediate subdirectories.
  Keep directory selection and parent navigation pinned above the folder list,
  distinguish navigation from adding a project, and fix `~` navigation.
- Add network-scan cancellation, retain discovered servers when cancelled, and
  simplify scan status and spacing. Remove per-address probe diagnostics from
  the main connection flow.
- Validate the server build, full workspace typecheck, focused regression suites,
  and real-browser directory navigation/selection/retry. Add an artifact-only
  workflow for Windows x64, Android arm64 and Linux x64 daemon builds. Installed
  client validation and release publication remain separate checks.

- Align workspace cards consistently with disclosure chevrons on the right, and make
  subagent cards compact single-line rows with a small additional indent.

- Add mobile Companion Call/Media audio routing, preserving Call as the default.
  Media uses Android media volume/routing and iOS non-voice-processing capture;
  native rebuild and physical-device routing qualification are required.
- Crossfade Companion artwork to monochrome on mute and back to colour on unmute
  over 150 ms, including the minimized presence and independent playback motion.

- Add a Companion voice-speed selector (0.75×–2×), defaulting to 1.3×. Apply it
  during synthesis from the next conversation, without changing pitch or other
  clients’ speech settings.

- Refine Companion into animated cyan/violet light ribbons with a matching launcher,
  compact live presence and distinct microphone/playback feedback. Add a device
  motion preference and larger labelled controls. Keep the app preview off by
  default; default daemon availability on independently of model readiness.
- Default local speech to Kitten nano FP32 Rosie, retain explicit Piper/Kokoro
  overrides, fix native inference-thread configuration and strip presentation
  markdown before synthesis. Add reproducible audio benchmarks and an interactive
  design harness. See [measurements and platform limits](https://github.com/frogg-app/fde/blob/70767eda/docs/companion-polish-plan.md).

- Integrate main through 0.4.1 into the Companion preview, preserving its voice
  controls alongside sidebar/subagent updates, branding and shared build tooling.
  Rebuild Android and the Linux x64 daemon from the merged source. Scope Android
  packaging to the app target to avoid unnecessary standalone dependency builds.

- Give Companion an animated glass sphere with flowing cyan/violet light and
  independent microphone/playback feedback. Keep Listening visible during
  thinking and speaking; show muted/reconnecting states honestly and honor
  reduced-motion preferences. Isolate audio-level renders from task/transcript rows.
- Verify that opening Companion against a running Claude or Codex worker observes
  it without reloading, resuming or cancelling its thread. Older clients' legacy
  Voice mode action can still cause Codex active-writer conflicts; use the updated
  Companion preview client and its separate conversation launcher.

- Replace the composer Voice mode action with a host/project-bound Companion
  launcher and remove its sidebar entry. Dismissing or minimizing keeps the
  conversation running, with a host/project indicator and explicit End control.
  Track an already-running selected worker so its result can be announced without
  dispatching the task again.
- Add quiet task dispatch, concise replies, completion/failure announcement
  preferences, optional acknowledgements, adjustable pauses and interruption.
  Read completed workers directly instead of spawning another summarization job.
- Keep microphone/VAD processing independent of response generation and playback;
  isolate VAD from STT/TTS, publish incremental Parakeet transcripts, preserve
  speech across overlapping finalization, and avoid decoding idle silence.
- Make Companion optional and off by default on each device. Add explicit Start,
  Mute, End and Minimize controls with a persistent active indicator; disabling it
  removes launch controls and releases audio without stopping coding tasks.
- Add Codex subscription orchestration alongside Claude, with explicit API opt-in,
  live authentication/readiness checks and bounded conversation context.
- Use Piper LJSpeech as the default local English voice, separate recognition and
  synthesis workers, and prepare the next segment during playback. Preserve
  explicitly selected Kokoro voices.
- Fix startup/stop races, typed-message acknowledgement and retry deduplication,
  backend cancellation, stale audio and playback-based conversation history.
- Resume active Companion conversations after daemon reconnection, retaining local
  foreground capture and mute state. End during an outage or pending reconnect
  cancels resumption. Bound Codex control requests and reject native voice startup
  after cancellation.
- Persist delegated job receipts/results and follow worker/permission events across
  reconnects. Add voice access to existing permission decisions and conversation End.
- Keep unheard local Companion results pending after model, synthesis, playback or
  receipt-write failure. Retry on user input or reconnect without rerunning workers
  or continuously consuming subscription allowance.
- Reject outstanding Codex RPCs and clear their timers when disposing the transport,
  so an interrupted request cannot keep a completed Companion process alive.
- Add an explicit Codex WebRTC voice preview and reproducible subscription probes.
  Immediate and delayed Claude worker results returned spoken audio on the tested
  Linux account. Native delivery receipts and broader account/device qualification
  remain open.
- Add iOS background-audio configuration and Android microphone foreground service
  with an End notification action. Native app rebuilds and physical-device validation
  are required; this does not establish phone-in-pocket reliability.
- Record implementation, measurements and remaining release gates in
  [Companion validation](https://github.com/frogg-app/fde/blob/70767eda/docs/companion-validation.md).
- Add an Android low-memory test build option and independent development app ID
  for a standalone APK that can coexist with production. Preserve license and
  speech-model notices in standalone daemon bundles.

## 0.6.13 - 2026-09-13

- Allow `fde start --no-relay` to override invalid saved relay settings by
  keeping its already-running check independent of startup validation and applying
  worker flags before validating configuration, including independent execution.
- Keep `fde status` usable with invalid relay settings or malformed configuration:
  show process information and a diagnostic note, with unknown configuration
  values represented explicitly.
- Print real host interface addresses in native installer web UI URLs,
  preserving explicit listeners and IPv6 URL brackets. Report unavailable network
  addresses and Unix sockets without a placeholder URL.

- Repair daemon lifecycle and script-install updates: stop no longer
  requires valid startup configuration, and matching systemd/launchd services
  stop through their owner. Installer activation stops the old same-home daemon
  and verifies the running version and health before reporting success.
- Route older update requests for versioned installations through the release
  updater, and hide the duplicate npm update control for those installations.
- Explain pre-0.6 daemon incompatibility in network discovery and failed direct
  connections; include relay configuration recovery in startup errors.
  Automated checks cover these paths; native installed-update acceptance remains
  separate from source validation.

- Normalize generated deployment shell scripts to LF and tolerate verified
  concurrent bundle staging on Windows.
- Include product-level release discovery and verified update manifests from main.
  Linux packaged daemon startup, web UI, Electron-origin WebSocket connectivity,
  invalid-config diagnostics and repeated shutdown passed. Native installed-update
  and physical-device acceptance remain unverified.

## 0.6.11 - 2026-09-13

- Replace the unpublished runtime-specific discovery proposal with product-level
  `release.json`, protocol adapters, and explicit automatic/manual update paths.
  Keep shipped compatibility manifests and block removal of previously declared
  update protocols without a migration path. Correct the release skill accordingly.

## 0.6.10 - 2026-09-13

- Add the FDE release skill, versioned JSON update discovery, explicit runtime and
  minimum-client compatibility, and a publication gate verifying exact payload
  names, platform coverage, sizes and both hashes against downloaded binaries.
- Add repeatable local build timing reports and document measured Linux versus CI
  performance; native Windows comparison and installed-update acceptance remain
  unverified. Local Wine cross-packaging failed before producing an installer.

## 0.6.8 - 2026-09-13

- Match the actual Linux `x86_64.AppImage` filename when generating Electron
  updater metadata, allowing complete releases to pass the publication gate.

## 0.6.7 - 2026-09-13

- Continue Android process and foreground checks when the system activity-display
  wait times out. Preserve the timeout in evidence and still reject process exits,
  restarts and foreground loss; rendered content requires screenshot inspection.

## 0.6.6 - 2026-09-13

- Correct the roadmap to record the Android launch repair and successful emulator
  cold launches while retaining the physical-device validation gap.

## 0.6.5 - 2026-09-13

- Keep Companion provider selection in its backend factory instead of generic
  server startup, restoring the architecture check that was already failing on
  main. Backend selection and the validated Android startup fix are unchanged.

## 0.6.4 - 2026-09-13

- Integrate the latest main-branch Companion work with the Android startup fix,
  preserving its voice controls, mobile routing, preferences and build tooling.
  Companion physical-device qualification remains documented separately.

## 0.6.3 - 2026-09-12

- Initialize native runtime polyfills before importing the router and application
  modules. Android previously loaded xterm before navigator.userAgent existed,
  causing an immediate JavaScript exception during launch.
- Cover the entry ordering with the real xterm bundle in a React Native-like
  runtime, and build the selected source in the Android startup diagnostic.

## 0.6.2 - 2026-09-12

- Add an explicit-device Android APK startup check that observes two cold launches
  and retains crash logs, screenshots, process and foreground-activity evidence.
- Add a hardware-accelerated Android diagnostic workflow for existing build
  artifacts. Android launch-crash investigation is ongoing; this tooling change
  does not claim a runtime fix.

## 0.6.1 - 2026-09-12

- Isolate native dependency caches by operating system, OS image version and
  architecture. The first 0.6.0 release attempt exposed an inherited cache key
  collision that restored Linux dependencies on Intel macOS.
- Repair clean-build helper paths so renamed protocol outputs can be removed
  before local repackaging. The Electron app and FDE namespace migration remain
  unchanged from 0.6.0.

## 0.6.0 - 2026-09-12

- Make Electron the production app-only desktop on Windows, macOS and Linux.
  Retire the previous native shell and experimental Rust backend from active builds;
  their sources remain inactive references. Desktop downloads contain no local
  daemon, CLI, separate Node runtime or provider binaries.
- Keep Node daemon packages independent, retain remote SSH deployment, and leave
  connected daemons running when the desktop app closes or updates. Preserve the
  0.5 opt-in independent execution service and its documented validation limits.
- Standardize environment, wire, storage, plugin, skill and desktop names on FDE:
  `FDE_*`, `fde://`, `window.fdeDesktop`, and `FDE` client symbols. This requires
  coordinated client/server upgrades; legacy naming is not transparently supported.
- Use production FDE application/artifact identity while retaining the tested
  FDE Electron profile for 0.4.x continuity. Users of the retired shell must
  manually install the new app and add or pair hosts.
- Remove the default hosted relay endpoint. Configure a relay you operate or use
  direct/SSH connections; existing relay-dependent pairing needs reconfiguration.
- Replace obsolete native/Rust migration and upstream release instructions with
  current architecture, distribution and [upgrade notes](https://github.com/frogg-app/fde/blob/70767eda/docs/upgrade-0.6.md).
  Default daemon port remains 9999. Android remains a separate release target;
  no iOS store release pipeline is present.
- Keep platform installation, signing, sustained memory/voice and actual updater
  acceptance distinct from automated build and test results. Independent execution
  remains opt-in; real-provider background work, Windows/macOS lifecycle and full
  installed-update acceptance remain unverified.

## 0.5.0 - 2026-09-12

- Show Connecting while sidebar agent hosts are reconnecting or not yet initialized,
  reserving Offline for disconnected or failed connections. Cached activity keeps
  live indicators hidden until the connection returns.
- Preserve the existing host runtime during development hot reloads so active
  connections are not abandoned in favor of an empty connection store.
- Use the selected product name for the execution process and refresh Nix dependencies.
- Add opt-in independent execution (`FDE_EXECUTION_SERVICE=1`): the supervised
  daemon becomes a restartable HTTP/WebSocket gateway while the execution service
  retains agents, provider turns, permissions, MCP tools, and orchestration.
- Add `execution-status` and `stop --all`, preserve execution during normal and
  forced gateway shutdown, and reconnect to a retained runtime even when a later
  launcher omits the opt-in flag. Idle agents prevent automatic runtime replacement.
- Preserve original client authorization through the gateway, stream requests and
  upgrades, and safely recover crash-left Unix sockets. Keep public service URLs
  separate from private execution/MCP endpoints.
- Verify updates against the installed gateway version, reconcile completed update
  handoffs in retained execution, and retain release directories for running code.
  Linux opt-in service definitions avoid descendant cleanup during gateway stop.
- Real isolated-process tests prove turn and permission continuity and supervisor
  reattachment; an isolated Linux systemd restart/stop also preserves execution.
  Real-provider background work, Windows/macOS lifecycle, and complete installed-update
  acceptance remain unverified. The feature is not enabled by default or deployed.

- Specify the independent execution boundary, compatibility and lifecycle contracts,
  rollout, and acceptance criteria in the [implementation spec](https://github.com/frogg-app/fde/blob/70767eda/docs/plans/independent-execution-service.md).

## 0.4.3 - 2026-09-12

- Package Electron as the FDE app only, removing the bundled daemon, separate Node
  runtime, CLI and provider binaries from desktop downloads. Daemon packages and
  SSH deployment remain available independently.
- Hide local daemon setup and management in Electron, reject legacy local commands,
  and prevent migrated settings from starting a server. Preserve direct, relay,
  SSH and separately installed local server connections.
- Verify app-only startup and relaunch without building or starting a server.

## 0.4.2 - 2026-09-12

- Restore the Electron desktop shell alongside Tauri using the current UI and
  bridge contract, isolated app profiles, native integrations, SSH transports and
  an independently bundled Node daemon. Preserve ownership during daemon shutdown.
- Add branded Electron packaging, development commands, comparison artifact CI,
  and a real renderer/daemon close-and-relaunch smoke runner. Keep the Tauri
  commands available for parallel investigation.
- Restrict desktop IPC to trusted app frames and adapt clipboard and network
  permissions to Electron 44. Update comparison builds only through an explicitly
  configured Electron feed. See the migration guide for validation evidence and
  outstanding device acceptance.

## 0.4.1 - 2026-09-12

- Build daemon packages independently of Android and desktop releases. Compile the
  server and package the exported web UI once, then share that output across all
  six daemon targets.
- Add `npm run build:local` for Windows/Linux desktop iteration with preserved
  compiler caches, bounded concurrency, package checksums, and per-stage timings.
- Refresh the Nix dependency hash for the synchronized package lockfile.

## 0.4.0 - 2026-09-12

- Merge fork-friendly branding across desktop, web, mobile, CLI, daemon,
  installers, and deployment tooling. Forks can supply a manifest and artwork
  while retaining shared sources and independently owned product distributions.

## 0.3.2 - 2026-09-12

- Integrate upstream active-agent sidebar visibility and workspace controls,
  preserving the completed branding implementation and synchronized versions.

## 0.3.1 - 2026-09-12

- Integrate upstream sidebar subagent runtime while retaining modular branding,
  release compatibility, and synchronized product versions.
- Represent single-agent workspaces with one selectable workspace row. Put the
  disclosure control on the workspace for multiple agents or active subagents,
  and omit chevrons when there are no visible children.
- Remove finished subagents from the sidebar automatically while preserving their
  transcript history. Keep running descendants and permission-waiting agents reachable.
  Automated layout and lifecycle checks cover this; device visual acceptance remains pending.

## 0.3.0 - 2026-09-12

- Show agents and expandable subagents beneath workspace rows in the sidebar.
  Click a child to open its existing interactive session or live provider-owned
  transcript, with cross-workspace navigation and the configured tab placement.
- Show provider-child discovery and transcript loading failures with retry actions,
  mark disconnected activity as saved, and refresh child data after reconnect.
  Automated behavior is covered; desktop/mobile visual acceptance remains pending.

## 0.2.30 - 2026-09-12

- Integrate upstream archive safety and Add host improvements, and reconcile
  explicit release asset names with branded distributions and FDE compatibility.

## 0.2.29 - 2026-09-12

- Integrate the upstream host-picker scope and translated Add host fix while
  preserving the branding implementation and synchronized distribution versions.

## 0.2.28 - 2026-09-12

- Complete the branding delivery record with two-product runtime, upgrade, fork,
  platform packaging, browser, and Nix evidence and explicit operator acceptance limits.

## 0.2.27 - 2026-09-12

- Escape generated skill descriptions for Unicode product names containing colons
  and quotation marks.
- Reject custom Tauri packaging without its generated configuration overlay,
  stale web branding in native release builds, and identity/version drift.
  Direct native checks remain supported.
- Link the rebranding workflow from the README and record native input checks
  and completed platform build evidence.

## 0.2.26 - 2026-09-12

- Make Linux desktop entries launch the installed GUI directly and forward
  pairing URLs, while keeping AppImage entries relocatable. Inspect actual
  native package identities in both-brand CI.
- Record successful fork-lifecycle, concurrent-daemon, Nix, browser, and
  simulator acceptance and retain test artifacts on the feature PR.

## 0.2.25 - 2026-09-12

- Verify concurrent products and cross-brand management rejection using real
  daemon archives; check cosmetic upgrades and foreign-asset rejection.
- Validate Nix distributions in CI, preserve required public configuration
  templates, and exclude actual environment files from Nix sources.
- Preserve Windows npm arguments without shell parsing, fix native build flag
  forwarding, and apply selected identities to Windows development and SSH defaults.

## 0.2.24 - 2026-09-12

- Add fork-owned build-time branding across the UI, desktop/mobile packaging,
  CLI, daemon, pairing pages, provider skills, installers, and deployment inputs.
  Custom products keep independent state and update sources; FDE retains its
  legacy identity and compatibility. See [the rebranding guide](https://github.com/frogg-app/fde/blob/70767eda/docs/branding.md).
- Add both-brand generation, browser, runtime, and native packaging CI. Platform
  compilation and device acceptance are recorded separately in the branding plan.

## 0.2.16 - 2026-09-12

- Keep workspace archival solely in each workspace's overflow menu, remove its
  keyboard shortcut, and require confirmation for every archive. Worktrees with
  uncommitted or unpushed work retain their additional risk warning.
- Open Add host directly from the sidebar instead of layering it over Settings,
  and add `Ctrl+H` as its global shortcut.
- Name release assets by product, version, platform, architecture, and package
  kind. Give Android and desktop builds priority over daemon bundle jobs, with
  Windows first in the desktop matrix.

## 0.2.15 - 2026-09-12

- Keep the Settings host picker focused on switching hosts. Host creation remains
  in the main sidebar, whose Add host action now renders its translated label
  instead of the missing translation key.

## 0.2.11 - 2026-09-11

- Fix local speech loading when npm hoists the native Sherpa library away from
  its JavaScript wrapper. Recover the wrapper API and reject incomplete exports
  instead of returning raw bindings that lack `OfflineRecognizer`.

## 0.2.10 - 2026-09-11

- Restore hidden compatibility for legacy `fde daemon` commands used by installed
  services, installers, and update supervisors. Existing services can start again
  without changing the concise top-level CLI.

- Fix an update notification feedback loop: reading a cached available update no longer
  emits another event that triggers another check. Missing assets and failed cache
  persistence cannot restart the loop; pending updates use the 30-minute schedule.
- When GitHub rate-limits an unauthenticated CLI update check, retry once using an
  existing GitHub login. Tokens stay in memory and are never sent to mirrors.

- Repeating `fde start` reports that the daemon is already running, with no error log dump.

Includes the previously unpublished 0.2.1–0.2.9 maintenance fixes.

- Desktop checks for updates on launch and every 30 minutes, announces available
  updates in a bottom-right toast, and shows download/install progress without
  an additional app confirmation. Repeated install requests are blocked.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project
  and Settings are stacked labeled footer buttons; new workspaces belong to projects.
- Voice cleanup releases Android recording effects, audio resources, callbacks,
  and worker threads. Stopped microphone/playback operations cannot start late,
  and canceled speech connections release their sessions. Android needs the rebuilt APK.
- Desktop transport bounds pending writes and cancels stalled writes, MCP waits
  release abort listeners, and terminal output pauses when its parser falls behind.
  Desktop exit bounds daemon cleanup and records lifecycle events.
- Companion retains interrupted conversation context, starts speech earlier, and
  tolerates cold local speech workers. Windows installers use the FDE icon.
- Refresh compatible editor, provider, protocol, browser-test, and build dependencies.
  Align CodeMirror and React Query package identities and apply OpenCode's cancellation
  patch whether the SDK is hoisted or installed in the server workspace. Keep native
  speech, terminal beta, prompt, and lint-tool migrations separate from routine updates.
- Upgrade desktop ZIP and SHA-2 handling with archive/checksum regression coverage,
  and update server UUID/OpenAI SDK integrations. Desktop source builds require Rust 1.88.
- The proposed settings redesign separates app host profiles from daemon settings;
  it is documented, not implemented. CI/release guidance now identifies actual FDE
  workflows and their platform coverage. Full typecheck builds native-audio types
  first, so local checks work from a clean checkout too.
- Device validation remains open for the reported memory growth, 10–15 second
  installer/hover delays, and surviving Windows WebView2 processes. Automated checks
  establish specific repairs, not a confirmed cause or resolution of every device symptom.

## 0.2.9 - 2026-09-11

- Fix an update notification feedback loop: reading a cached available update no longer
  emits another event that triggers another check. Missing assets and failed cache
  persistence cannot restart the loop; pending updates use the 30-minute schedule.
- When GitHub rate-limits an unauthenticated CLI update check, retry once using an
  existing GitHub login. Tokens stay in memory and are never sent to mirrors.

- Repeating `fde start` reports that the daemon is already running, with no error log dump.

Includes the previously unpublished 0.2.1–0.2.8 maintenance fixes.

- Desktop checks for updates on launch and every 30 minutes, announces available
  updates in a bottom-right toast, and shows download/install progress without
  an additional app confirmation. Repeated install requests are blocked.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project
  and Settings are stacked labeled footer buttons; new workspaces belong to projects.
- Voice cleanup releases Android recording effects, audio resources, callbacks,
  and worker threads. Stopped microphone/playback operations cannot start late,
  and canceled speech connections release their sessions. Android needs the rebuilt APK.
- Desktop transport bounds pending writes and cancels stalled writes, MCP waits
  release abort listeners, and terminal output pauses when its parser falls behind.
  Desktop exit bounds daemon cleanup and records lifecycle events.
- Companion retains interrupted conversation context, starts speech earlier, and
  tolerates cold local speech workers. Windows installers use the FDE icon.
- Refresh compatible editor, provider, protocol, browser-test, and build dependencies.
  Align CodeMirror and React Query package identities and apply OpenCode's cancellation
  patch whether the SDK is hoisted or installed in the server workspace. Keep native
  speech, terminal beta, prompt, and lint-tool migrations separate from routine updates.
- Upgrade desktop ZIP and SHA-2 handling with archive/checksum regression coverage,
  and update server UUID/OpenAI SDK integrations. Desktop source builds require Rust 1.88.
- The proposed settings redesign separates app host profiles from daemon settings;
  it is documented, not implemented. CI/release guidance now identifies actual FDE
  workflows and their platform coverage. Full typecheck builds native-audio types
  first, so local checks work from a clean checkout too.
- Device validation remains open for the reported memory growth, 10–15 second
  installer/hover delays, and surviving Windows WebView2 processes. Automated checks
  establish specific repairs, not a confirmed cause or resolution of every device symptom.

## 0.2.8 - 2026-09-11

- Repeating `fde start` reports that the daemon is already running, with no error log dump.

Includes the previously unpublished 0.2.1–0.2.6 maintenance fixes.

- Desktop checks for updates on launch and every 30 minutes, announces available
  updates in a bottom-right toast, and shows download/install progress without
  an additional app confirmation. Repeated install requests are blocked.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project
  and Settings are stacked labeled footer buttons; new workspaces belong to projects.
- Voice cleanup releases Android recording effects, audio resources, callbacks,
  and worker threads. Stopped microphone/playback operations cannot start late,
  and canceled speech connections release their sessions. Android needs the rebuilt APK.
- Desktop transport bounds pending writes and cancels stalled writes, MCP waits
  release abort listeners, and terminal output pauses when its parser falls behind.
  Desktop exit bounds daemon cleanup and records lifecycle events.
- Companion retains interrupted conversation context, starts speech earlier, and
  tolerates cold local speech workers. Windows installers use the FDE icon.
- Refresh compatible editor, provider, protocol, browser-test, and build dependencies.
  Align CodeMirror and React Query package identities and apply OpenCode's cancellation
  patch whether the SDK is hoisted or installed in the server workspace. Keep native
  speech, terminal beta, prompt, and lint-tool migrations separate from routine updates.
- Upgrade desktop ZIP and SHA-2 handling with archive/checksum regression coverage,
  and update server UUID/OpenAI SDK integrations. Desktop source builds require Rust 1.88.
- The proposed settings redesign separates app host profiles from daemon settings;
  it is documented, not implemented. CI/release guidance now identifies actual FDE
  workflows and their platform coverage. Full typecheck builds native-audio types
  first, so local checks work from a clean checkout too.
- Device validation remains open for the reported memory growth, 10–15 second
  installer/hover delays, and surviving Windows WebView2 processes. Automated checks
  establish specific repairs, not a confirmed cause or resolution of every device symptom.

## 0.2.7 - 2026-09-11

Includes the previously unpublished 0.2.1–0.2.6 maintenance fixes.

- Desktop checks for updates on launch and every 30 minutes, announces available
  updates in a bottom-right toast, and shows download/install progress without
  an additional app confirmation. Repeated install requests are blocked.
- Sidebar navigation defaults to Home, Search, History, then Companion. Add project
  and Settings are stacked labeled footer buttons; new workspaces belong to projects.
- Voice cleanup releases Android recording effects, audio resources, callbacks,
  and worker threads. Stopped microphone/playback operations cannot start late,
  and canceled speech connections release their sessions. Android needs the rebuilt APK.
- Desktop transport bounds pending writes and cancels stalled writes, MCP waits
  release abort listeners, and terminal output pauses when its parser falls behind.
  Desktop exit bounds daemon cleanup and records lifecycle events.
- Companion retains interrupted conversation context, starts speech earlier, and
  tolerates cold local speech workers. Windows installers use the FDE icon.
- Refresh compatible editor, provider, protocol, browser-test, and build dependencies.
  Align CodeMirror and React Query package identities and apply OpenCode's cancellation
  patch whether the SDK is hoisted or installed in the server workspace. Keep native
  speech, terminal beta, prompt, and lint-tool migrations separate from routine updates.
- Upgrade desktop ZIP and SHA-2 handling with archive/checksum regression coverage,
  and update server UUID/OpenAI SDK integrations. Desktop source builds require Rust 1.88.
- The proposed settings redesign separates app host profiles from daemon settings;
  it is documented, not implemented. CI/release guidance now identifies actual FDE
  workflows and their platform coverage. Full typecheck builds native-audio types
  first, so local checks work from a clean checkout too.
- Device validation remains open for the reported memory growth, 10–15 second
  installer/hover delays, and surviving Windows WebView2 processes. Automated checks
  establish specific repairs, not a confirmed cause or resolution of every device symptom.

## 0.2.6 - 2026-09-11

- Upgrade the OpenAI SDK to 7.8 on the supported Node 22 runtime. Adapt speech
  response bodies to Node streams so playback cancellation releases the response;
  verify speech requests and dictation uploads through the real SDK transport.

## 0.2.5 - 2026-09-11

- Upgrade daemon UUID generation to uuid 14 and verify the production ID path
  against the Node 22 crypto APIs used by the bundled runtime.

## 0.2.4 - 2026-09-11

- Upgrade desktop SHA-256 verification to sha2 0.11, replacing its removed I/O
  writer adapter with bounded streaming reads. Cover empty files and multi-buffer
  payloads to preserve installer checksum verification.

## 0.2.3 - 2026-09-11

- Upgrade desktop ZIP extraction to zip 8.6.0 and align the declared Rust minimum
  and development toolchain with its Rust 1.88 requirement.

## 0.2.2 - 2026-09-11

- Native desktop update checks run on launch and every 30 minutes, matching the UI
  polling interval, with available updates shown in a bottom-right toast. Download and install starts directly with in-app busy/progress
  feedback; the extra confirmation dialog is removed and duplicate installs are blocked. Reported Download and install stalls and delayed hover feedback remain
  open for reproduction; this schedule change does not establish a responsiveness fix.

- Desktop exit bounds the daemon cleanup helper to 15 seconds and records lifecycle
  events. Reported surviving WebView2 processes and blocked relaunch remain under investigation.
- Sidebar defaults to Home, Search, History, followed by Companion. Add project
  and Settings are stacked labeled footer rows; workspace creation stays with
  each project. Existing default navigation preferences migrate to the new order.
- Desktop transport bounds pending writes and cancels or times out stalled socket
  writes. MCP agent waits release caller abort listeners. Terminal output pauses
  PTY reads when the headless parser falls behind. Regression tests cover these
  defects; confirmation of the reported device memory growth remains open in the
  [investigation](https://github.com/frogg-app/fde/blob/70767eda/docs/memory-lockup-investigation.md).
- Voice lifecycle fixes release Android recording effects, device callbacks,
  AudioTrack and executors, prevent delayed microphone/playback startup after Stop,
  and close speech sessions canceled during connection. Native Android fixes require
  a rebuilt APK; device memory verification remains open.
- Proposed [settings layout](https://github.com/frogg-app/fde/blob/70767eda/docs/settings-layout-plan.md) separates App settings
  and saved host profiles from daemon configuration; the settings redesign is not
  implemented yet.

## 0.2.1 - 2026-09-11

- Companion interrupts on voice activity, retains interrupted conversation context,
  starts the first speech segment earlier, and animates the orb from reply audio.
  Full-loop device validation and backend cancellation remain open.
- Spoken alerts tolerate cold local model startup and can retry failed synthesis;
  concurrent retry requests share one synthesis.
- Windows installers use the FDE icon. `FDE_DEVTOOLS=1` opens the bundled inspector
  for diagnostics; an opt-in idle memory probe is included.
- Roadmap and engineering plans now distinguish implemented work, deferred work,
  and verification gaps.

## 0.2.0

- **Companion: a real-time voice conversation that sits above projects and workspaces.** You talk to it and it answers straight away; it never does the work itself. Anything that needs real thought is handed to a headless subagent while it keeps talking to you, and it drives, starts and reports on the agents running in your workspaces. A fast orchestrator model (`claude-haiku-4-5`) answers over the Messages API rather than the agent provider stack, which launches a CLI per turn and is far too slow for conversation.
- The Companion never leaves a silence. Text is cut into speakable segments and sent to TTS while the model is still generating, so it starts talking mid-sentence; if nothing has been said 700 ms after you stop, a pre-synthesised filler covers the gap. It keeps its own small notebook of topics and open tasks, which is what lets its context stay tiny — old turns are dropped rather than summarised.
- The Companion opens from a sidebar row, the command palette or a shortcut, as a sheet on compact layouts and a centred card on desktop: a mic orb, your live transcript, its reply as it speaks, and a strip of current topics you can tap to jump to the agent working on one. It reuses voice mode's audio stack wholesale — VAD, streaming speech-to-text and barge-in — and is advertised through `server_info.capabilities.companion`, so the control never appears when the daemon cannot honour it. Enable with an Anthropic API key; see [docs/companion.md](https://github.com/frogg-app/fde/blob/70767eda/docs/companion.md).
- Project skills and tooling for working in this repository: `skills/fde-dev` (build order, dev daemon, the fast verification loop), `skills/fde-rpc` (the thirteen-step checklist for adding a session RPC, including the outbound permission record that is easy to miss), `skills/fde-i18n` (the nine-locale procedure), a `dev-tooling` agent definition, `scripts/dev/worktree-status.mjs`, and `scripts/ci/verify.mjs --changed`, which lints and tests only what you changed.
- Plugin scaffold tests no longer leak generated directories into the working tree.
- **Streaming performance on Android and Windows.** Markdown block splitting no longer re-parses the whole message on every animation frame, code fences are not re-tokenized while a reply is still streaming, and the desktop transport coalesces inbound WebSocket frames instead of paying one IPC hop each. The invariants these rely on are written down in [docs/agent-stream-performance.md](https://github.com/frogg-app/fde/blob/70767eda/docs/agent-stream-performance.md), and the investigation behind them in `docs/performance-investigation-2026-09.html`. Correctness is covered by tests; the size of the win is not — the severity ranking is source-level analysis, with no profiler attached to real Android or Windows hardware.
- The open explorer sidebar has its own close button on every desktop layout, so it no longer takes a trip through the workspace menu to dismiss. This control previously existed only on macOS, so Windows and Linux gain a close affordance inside the open panel that they did not have before; mobile is unchanged. It is covered by unit tests but has not been eyeballed on Windows.
- **Known limitation for this release: the Companion has not been run end to end.** Its unit and browser tests pass and it is gated behind `server_info.capabilities.companion`, so it stays invisible when the daemon cannot honour it — but no one has held a spoken conversation with it. The microphone-to-speaker path is unexercised, and the latency figures in [docs/companion.md](https://github.com/frogg-app/fde/blob/70767eda/docs/companion.md) measure the model call in isolation rather than the full audio loop. Known follow-ups, none of which affect anything outside the Companion: barge-in does not cancel the in-flight model request, the capability is resolved once at daemon construction so an API-key or flag change needs a restart, and `create_agent` requires an existing workspace id.

## 0.1.19

- Compact layouts no longer put a second agent in a worktree by accident. The workspace menu is the only way to start an agent there, and inside a worktree "New agent" quietly added one to that same checkout; it now opens New workspace with worktree isolation preselected, cut from the main repository. Adding an agent to the current worktree is still one tap away, as an explicit "New agent in this worktree" item.
- Settings: host settings sit above app settings, and the app group is anchored to the bottom.
- Windows releases ship only as zips: the NSIS installer is published as `FDE-<ver>-x64-setup.zip` next to `FDE-<ver>-x64-portable.zip`. GitHub rejects raw `.exe` release assets, so the installer upload used to fail. Both updaters unpack the zip before running the installer, and the updater signature now covers the zip.
- The public pairing page also deploys as a Cloudflare Worker (`deploy/pair-worker`), so `pair.frogg.app` can run with no host, no origin and no reverse proxy. It shares every module that decides what a visitor sees with the daemon's own `GET /code/:code` route — the code decoder, both page renderers, the QR and the CSP — and reimplements only the transport; a test asserts the Worker and the express service return byte-identical HTML. Deployment notes in [deploy/pair-worker/README.md](deploy/pair-worker/README.md).
- `https://frogg.app/install.sh`, `/uninstall.sh` and `/install-docker.sh` are live, served by a Cloudflare Worker (`deploy/install-worker`) that proxies the scripts out of `deploy/` in the public repository. It answers a fixed allowlist of three paths, fails closed with a 502 when the source is unreachable or does not look like a shell script (so `curl -f` pipes nothing to `bash`), and names the ref it served in `X-FDE-Source`.
- `scripts/release/verify-install-routes.sh` smoke-tests those routes after a deploy: it checks all three, then runs a real install and uninstall against them in a throwaway container and asserts the result.

## 0.1.18

- Tests no longer touch the developer's home: every worker gets its own throwaway FDE home.
  Previously the suite resolved the real `~/.fde` and could move a running daemon's state.
- Test and CI repairs that had kept the pipeline red: nine lint errors, a plugin test resolving
  a path outside the repository, a test requiring the Claude CLI, the relay test breaking on
  wrangler 4, a missing server build before the CLI tests, stale default-port expectations, and
  a claim timestamp assertion that failed whenever two writes shared a millisecond.

## 0.1.17

- `install.sh` resolves the newest release even when every release is flagged as a pre-release: `/releases/latest` redirects to the releases index in that case, and the old resolver parsed the word `releases` as a version, so `curl -fsSL https://frogg.app/install.sh | bash` tried to download `fde-daemon-releases-<platform>.tar.gz`. It now validates what it parsed and falls back to the GitHub releases API.
- Releases carry `install.sh`, `uninstall.sh`, and `install-docker.sh` as assets, so a release pins the installer that shipped with it.
- New standalone pairing-page service (`deploy/pair`, image `froggapp/fde-pair-page`): the `GET /code/:code` route a daemon serves, bundled with esbuild into a stateless container that answers the public `pair.frogg.app`. A pairing code carries the whole offer, so one deployment serves every daemon's links without contacting any of them. Deployment runbook in [docs/pairing-service.md](https://github.com/frogg-app/fde/blob/70767eda/docs/pairing-service.md).

## 0.1.14

- Daemon accepts WebSocket connections from the FDE desktop app (Tauri origins `tauri://localhost` and `http(s)://tauri.localhost` were rejected with 403, so direct TCP connections closed with code 1006).
- `/api/identity` sends `Access-Control-Allow-Origin: *` so the in-app LAN scan can see daemons.
- Windows portable build is published only as a zip.
- Daemon self-update with automatic rollback: `fde daemon self-update [--to <v>|--channel stable|beta] [--check] [--json]` installs a release from the GitHub releases next to the running version and a detached supervisor flips `current`, restarts the service (systemd user unit, launchd agent, or the CLI's own stop/start), verifies `/api/identity` and `/api/health`, and reverts to `previous` when the new daemon does not come up. Outcome in `<install dir>/last-update.json`, steps in `self-update.log`; at most three versions are kept.
- From a client: every host's settings page has a "Daemon updates" section (version, check, update with progress, applied/rolled-back outcome, auto-update toggle and channel) backed by the `daemon.update.check/start/get_status` RPCs (`daemon.manage`) and the `daemon.update.run.progress` broadcast. Dev checkouts, the desktop sidecar, and Docker report why they cannot self-update.
- Opt-in automatic updates: `daemon.autoUpdate` in `config.json` or `FDE_AUTO_UPDATE=1`; checks on an interval, waits for agents to go idle, honours quiet hours.
- Installer writes `FDE_INSTALL_DIR` and `FDE_HOME` into the service environment and records `previous`; `install-docker.sh --update` swaps the container and restores the old one if the health check fails.

## 0.1.13

- Repository moved to `github.com/frogg-app/fde`; update checks, install scripts, deploy defaults, and docs point at the new address.

## 0.1.12

- Default daemon port is now 9999 (explicit 6767 still works). Installer, Docker image, docs, CLI, and the app defaults all follow.
- No more FDE marks: every icon, favicon, PWA icon, and the startup splash use the FDE frog; icons are larger with transparent backgrounds (dark surface on iOS); the window paints dark instead of white while loading.
- Window dragging on Windows/Linux via the title strip; drag surfaces no longer select text.
- Direct connection field accepts `host:port`, `http(s)://`, `ws(s)://`, and legacy `tcp://` forms and shows the resolved WebSocket URL.
- "Servers on your network": the app scans local /24 subnets for daemons on port 9999 (`/api/identity`), resolves hostnames, and offers one-click connect; daemons that still need pairing are flagged.
- Remote SSH hosts: daemon password field (clearly labelled as the daemon's, not ssh's); ssh password authentication via askpass when a host offers it, remembered for the session only.
- Voice (dictation, voice mode, TTS) is on by default when the bundled speech runtime is present; opt out with `features.voice.enabled=false` or `FDE_VOICE=0`. Daemon bundles now include the sherpa-onnx runtime.
- First-run pairing: an unclaimed daemon reachable from the network serves a "Claim this FDE daemon" page with a single-use pairing link and QR until the first client pairs; `fde daemon claim-status` / `reset-claim`. Pairing links are `https://frogg.app/pair#offer=…` with a `fde://pair` deep link; the app claims the daemon and stores the credential.
- Updates: the app checks GitHub releases (every 6 h and on demand), shows release notes, downloads the matching asset with checksum verification, and installs it (silent installer or portable swap on Windows, AppImage swap on Linux, DMG on macOS). Signed Tauri updates take over automatically once a signing key is configured.
- Daemon: `GET /api/identity`; FDE-era client version gates removed.
- Release assets carry `.sha256` sidecars; Windows signing hook for Azure Trusted Signing; `frogg.de` links renamed to `frogg.app`.

## 0.1.10

- Daemon: removed the FDE-era client version gates. FDE clients (version 0.1.x) were treated as
  legacy FDE clients, which hid every provider except Claude, Codex, and OpenCode and forced the
  legacy workspace restore path. All providers are visible again.
- Lockfile regenerated with every platform's optional binaries so macOS and Windows CI jobs install
  cleanly.
- Android APK (arm64-v8a) attached to releases; built locally for 0.1.8.

## 0.1.9

- Android APK: `app.frogg.fde` identity, version code derived from the package version, `scripts/release/build-android-apk.mjs`, CI jobs, docs.
- Playwright e2e re-baselined for the settings modal; fixed a cold deep-link into settings that could land on the wrong screen.
- CI: lefthook removed from the dependency tree (macOS/Windows runners), conflicting apt package dropped, already-uploaded release assets are skipped on re-runs.
- Android APK. `apps/ui` builds as the Android app (name "FDE", package id `app.frogg.fde`,
  version code derived from the root `package.json`). `scripts/release/build-android-apk.mjs`
  runs `expo prebuild` + Gradle locally and in CI; `release.yml` attaches
  `FDE-<version>-android-arm64-v8a.apk` to the release, release-signed when the
  `FDE_ANDROID_KEYSTORE_*` secrets exist and `-unsigned` (debug key) otherwise. `ci.yml`
  assembles a debug APK on pull requests that touch `apps/ui`. See docs/android.md.

## 0.1.8

- Local daemon sidecar (milestone 3). The desktop app can download the FDE daemon bundle for
  its platform from the GitHub release (`Install local daemon (~180 MB)` in the daemon settings,
  or "Run agents on this machine" on the welcome screen), verify its checksum, unpack it into
  the app data dir, and start/stop/restart it through the bundled CLI exactly as Electron
  managed its packaged daemon (`FDE_DESKTOP_MANAGED=1`, status polling, forced stop, stop on
  quit unless "keep running after quit"). No Node on the machine is needed. Thin clients
  without a bundle never try to start a daemon.
- Daemon bundle targets `win-x64` and `win-arm64` (`fde-daemon-<v>-win-<arch>.zip`, no
  symlinks, `bin/fde.cmd` launcher), cross-built from Linux and attached to releases.
- `install_local_daemon_bundle` / `local_daemon_bundle_status` desktop commands and the
  `local-daemon-install-event` progress event.

## 0.1.6

- Settings opens as a large modal on wide layouts (VS Code style); Help & Support menu removed, Keyboard shortcuts live in Settings; Schedules removed; Star/Sponsor/Community links removed; About credits FDE.
- Daemon install story: self-contained daemon bundle, `deploy/install.sh` (systemd/launchd service), `deploy/install-docker.sh`, Docker image built from the bundle. See docs/install.md.

- Accent colour changed from green to the logo cyan/blue; success colours stay green.
- Copy: "an FDE" everywhere (F.D.E.).

- Remote SSH connections work again. The Tauri bridge forwarded its whole event object to
  `events.on` listeners instead of the payload (Electron passed the payload alone), so the
  local-daemon transport shim never saw its `open` event and every SSH connect ended in
  "Connection timed out". `bridge.ts` now unwraps the payload and the UI listener tolerates
  either shape.
- SSH failures are reported as ssh reports them: the Rust transport races the WebSocket
  handshake against `ssh` exiting and emits an `error` event with ssh's stderr immediately
  (`Permission denied (publickey).`, `Host key verification failed.`, `connect_to … failed`),
  the SSH setup window is 18 s and the UI's connect timer 20 s so that message wins over the
  generic timeout, and the Add host sheet shows it in full.
- Every SSH transport step (argv, executable and pid, first bytes from the tunnel, handshake
  result, exit status and stderr, events emitted) is logged to `fde.log`. `FDE_SSH=<path>`
  pins the ssh executable; on Windows `%SystemRoot%\System32\OpenSSH\ssh.exe` is tried when
  `ssh` is not on the app's `PATH`.
- Add Remote SSH host is split into two tabs: **SSH config** (hosts from `~/.ssh/config` as a
  list with `user@hostname:port` details, an optional daemon port, and a note that it connects
  with `ssh <alias>`) and **Manual** (the `ssh://user@host[:port][?daemonPort=]` field).
- Integration test drives the SSH transport end to end with a fake `ssh` that bridges stdio to
  a local daemon, and covers the exit-with-stderr path.
- GitHub Actions: `ci.yml` (format, lint, typecheck, unit tests, Linux deb build) on
  every push and pull request; `release.yml` on `v*` tags builds Linux deb/AppImage,
  Windows NSIS installer + portable exe/zip, macOS aarch64/x86_64 DMGs (ad-hoc signed),
  daemon bundles, the updater `latest.json` (when a signing key is configured) and the
  `froggapp/fde` Docker image (when Docker Hub credentials are configured). Release assets
  are named `FDE-<version>-<arch>.<ext>`. See `docs/ci.md`.
- `scripts/release/collect-desktop-bundles.mjs` renames Tauri bundles to the release asset
  names; `scripts/release/build-updater-manifest.mjs` writes `latest.json` from `.sig`
  files; `package-portable-win.mjs` accepts `--release-dir` / `FDE_WINDOWS_RELEASE_DIR`
  for native Windows builds.
- Dependabot (npm, cargo, actions; weekly, grouped) and a pull request template.
- `bundle.macOS` config (minimum macOS 10.15, hardened runtime) in `tauri.conf.json`.

## 0.1.4

- Desktop shell answers every daemon, CLI, log, update and legacy-skill command the UI
  invokes, with "not bundled" values instead of `Unknown desktop command` (fixes the
  "unable to load desktop daemon" toasts on startup). The shell now writes `fde.log` in the
  app log dir, served by `desktop_app_logs`.
- Milestone 2: Remote SSH and unix-socket/named-pipe hosts work from the Tauri shell. Rust
  spawns the system `ssh -W` (same argv as Electron) or connects the local socket and
  bridges WebSocket frames to the webview over `local-daemon-transport-event`.
- Remote SSH page offers the concrete `Host` entries of `~/.ssh/config` (one level of
  `Include`) as one-click targets; picking one fills `ssh://<alias>`.
- Portable Windows zip (`FDE-<version>-x64-portable.zip`) is built by
  `npm run build:desktop:win` next to the NSIS installer.
- CLI `onboard`/`open` prose says FDE; `fde open` also looks for the FDE desktop app.

## 0.1.3

- Rebrand to FDE (Frogg Development Environment): `@fde/*` package scope, new origami frog logo and icons, `fde` binary and CLI alias. Wire-level FDE names kept for compatibility.
- Portable Windows zip published alongside the installer.
- ROADMAP.md added.

- Rebranded the product to FDE (Frogg Development Environment): npm scope `@fde/*`, desktop productName/window title "FDE", bundle identifier `app.frogg.fde`, binary `fde`, new logo, `fde` CLI alias. Wire-level names (`fde://`, `FDE_*`, `~/.fde`, the `fde` CLI) are unchanged for daemon compatibility.
- Fork from Paseo v0.7.2 (commit 77aff0f). New repository, Tauri desktop shell rewrite begins.
- Repo reorganised into apps/ and packages/; Electron shell and website dropped.
- New Tauri v2 desktop shell (apps/desktop): window, bridge, settings, attachments, dialogs, notifications, deep links. Remote hosts only; no local daemon yet.
