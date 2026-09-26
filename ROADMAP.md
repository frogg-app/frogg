# Frogg roadmap

Pruned against `main` at 1.5.45 (2026-09-25). [Changelog](CHANGELOG.md) records
completed work. Unchecked items are open; "acceptance" items need a device or
deployment run, not more code.

## Engineering

- [ ] **Session decomposition.** Workspace labels, title/pin and agent delete/archive/
      detach are extracted. Next: workspace create/archive, then agent create/resume/refresh
      (`git show 70767eda:docs/refactors/session-decomposition-plan.md`).
- [ ] **`daemon-rs` follow-ups.** Auth rate limiting is not ported. Behind the Rust
      front, Node needs loopback in `daemon.trustedProxies` so X-Forwarded-For locality
      applies to the claim/login routes.
- [ ] **Known failing test outside CI's set:** `websocket-server.liveness.e2e` "a resumed
      stale socket is bounded and removed without disrupting its replacement" times out.
- [ ] **Browser E2E baseline.** Run the settings Playwright specs (updated, never run)
      and the plugin-removal e2e.
- [ ] **Provider toggles re-enable after updates.** Writer unidentified; next time
      capture `~/.frogg/config.json` and the time before re-toggling.
- [ ] **Remove the `pluginsEnabled`/plugin route compat shims** after 2027-09-13.

## Features

- [ ] **Schedules rewrite.** The old system was removed in 1.5.41.
- [ ] **Provider agent folders.** Verify Codex/Copilot/OpenCode paths against real
      installs; add Cursor, Kiro, Kimi, Trae, Pi and OMP. "Open in editor" only works
      with a local daemon.
- [ ] **Companion word-level playback.** Interrupted replies are recorded per finished
      sentence (never claiming unheard text). Word-level needs word timings the local
      speech engines do not report.
- [ ] **iOS delivery.** Signing, distribution and device acceptance.
- [ ] **Chats beyond Claude.** Chats enforce isolation only for Claude. Codex needs its
      skill discovery and user `config.toml` MCP servers verifiably off (read-only sandbox
      and web search are native); then add it to `CHAT_SUPPORTED_PROVIDERS`. Also: "Move to
      project" for a chat.

## Distribution and ops

- [ ] **Signing.** Android release key (breaks in-place updates for existing installs:
      owner decision), Windows Authenticode, macOS Developer ID/notarization, updater signing.
- [ ] **Docker Hub.** `froggapp/frogg` has no tags; the docs now build from source. Publish,
      or make `deploy/install-docker.sh` skip the pull when a local image exists (its
      `--update` hint omits `FROGG_NO_PULL=1`). The landing page still lists Docker uncaveated.
- [ ] **Website deploys.** Add `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`);
      `website.yml` skips deploys without it. frogg.app is serving.
- [ ] **Release streams go-live.** Create `stable` from v1.5.52 (`npm run streams -- init --push`)
      and move branch protection/rules to cover it; cut the first
      `1.6.0-beta.1` and check the frogg beta desktop, APK and daemon install beside frogg
      and update beta-to-beta. iOS beta needs its own App Store Connect app (the beta
      build drops `iosStoreId`). The frogg.app installer Worker serves stable only; beta
      installs use the `install.sh` on a beta release.
- [ ] **Custom-brand release run.** No full `release.yml` run for a non-Frogg brand yet.
- [ ] **Docs screenshots.** `app/home.png` predates the "Import conversation" action and the
      icon sidebar; recapture and update its alt text in `first-agent.mdx`.
- [ ] **Import dialog copy.** The directory hint offers "a new directory" for the daemon
      source, which needs an existing one.

## Acceptance (needs devices or live deployments)

- [ ] Electron on Windows/macOS/Linux: memory growth and lockups, update-install UI
      stalls, shutdown/relaunch under voice and streaming load, installers, updater handoff
      and rollback. Also the new inline app-update progress (1.5.41).
- [ ] Companion full loop on devices: Claude/Codex, interruption, reconnect, headphones
      vs. speakers (echo), missing speech models, latency. Native preview qualification.
- [ ] Android: physical-device startup, in-app updater, push notifications in the APK.
- [ ] Daemon: native systemd/launchd and old-to-new installed updates; independent
      execution service on Windows/macOS; restart resume mid-Shell (#61).
- [ ] Workspace diff stats live (#65); Workflow nested rows with a real provider;
      sidebar agent trees on desktop/mobile.
- [ ] Security card: saving a password, LAN-trust and claim-mode fixes from the app,
      mobile layout. Relay endpoint setting against a real relay.
- [ ] Import: interrupted transfer, corrupt cleanup, cross-machine.
- [ ] Unattended local pairing (`pairing.autoConfirmLocal`): branded desktop build against
      a password-protected loopback daemon, opening `pair --json --role owner`'s deep link
      with no clicks; LAN host, stock brand and wrong `fp` still ask or refuse; re-pair
      replaces the credential. Also `pair` against a daemon bound to `[::]`.

## Deferred deliberately

- **Triggers:** disabled until a service we control or a self-hostable replacement exists.
- **Remaining Frogg wire/env/deep-link renames:** keep compatibility until a migration policy exists.

## Dismissed

CLI open-agent and GitHub-clone commands; old mobile roadmap (M1–M8); persistent
diagnostics and profiling tooling; retired native-window/transport/updater experiments.

## Keeping this current

Update the item in the same PR as the implementation, and the docs site pages in
`website/src/content/docs/docs/`. Move completed work to the changelog; leave only a
concrete verification gap when testing is incomplete.
