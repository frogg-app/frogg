# Frogg roadmap

Pruned against `main` at 1.5.41 (2026-09-24). [Changelog](CHANGELOG.md) records
completed work. Unchecked items are open; "acceptance" items need a device or
deployment run, not more code.

## Engineering

- [ ] **Port daemon auth to `apps/daemon-rs`.** It has claim state and the brand
      `trustLan` default, but not 401 on unknown bearer, the last-owner guard, home
      deny, viewer roots or security posture. Excluded from releases; port before it ships.
- [ ] **Tighten the Electron CSP.** The shell sets no Content-Security-Policy.
      Enumerate required origins and verify direct, relay, SSH and local connections.
- [ ] **Branding workflow fails on every branch** (`brands/example` jobs in
      `branding.yml`). Fix or drop so it stops hiding real failures.
- [ ] **`historical_frogg_names_remain_addressable` (daemon-rs) fails:** expects
      `Frogg-0.2.16-…`, gets `frogg-0.2.16-…`.
- [ ] **Session decomposition.** Next slice is workspace request handling, then
      agent lifecycle (`git show 70767eda:docs/refactors/session-decomposition-plan.md`).
- [ ] **Browser E2E baseline.** Run the settings Playwright specs (updated, never run)
      and the plugin-removal e2e.
- [ ] **Provider toggles re-enable after updates.** Writer unidentified; next time
      capture `~/.frogg/config.json` and the time before re-toggling.
- [ ] **Remove the `pluginsEnabled`/plugin route compat shims** after 2027-09-13.

## Features

- [ ] **Schedules rewrite.** The old system was removed in 1.5.41.
- [ ] **LAN discovery in Add host.** Discover candidates and show their
      `/api/identity` without typing an address.
- [ ] **Browser automation.** Daemon-driven Playwright; define workflow and permissions first.
- [ ] **Frogg-managed skills.** Decide whether to drop the orchestration skills the
      daemon installs into `~/.claude/skills` / `~/.codex/skills` or make them read-only.
- [ ] **Provider agent folders.** Verify Codex/Copilot/OpenCode paths against real
      installs; add Cursor, Kiro, Kimi, Trae, Pi and OMP. "Open in editor" only works
      with a local daemon.
- [ ] **Companion settings.** Group into Voice/Conversation/Appearance; interrupt-delay
      presets; model picker (new RPC + `server_info.features` gate).
- [ ] **Companion gaps.** Correlate native voice results with durable jobs (no repeats
      after reconnect), word-level playback reconciliation, workspace creation before
      `create_agent`. "Reload agent" can start a second writer before closing the first.
- [ ] **iOS delivery.** Signing, distribution and device acceptance.

## Distribution and ops

- [ ] **Signing.** Android release key (breaks in-place updates for existing installs:
      owner decision), Windows Authenticode, macOS Developer ID/notarization, updater signing.
- [ ] **Docker Hub.** `froggapp/frogg` has no tags; publish or remove the docs reference.
- [ ] **Website deploys.** Add `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`);
      `website.yml` skips deploys without it. frogg.app is serving.
- [ ] **Custom-brand release run.** No full `release.yml` run for a non-Frogg brand yet.
- [ ] **Docs screenshots.** Pairing (relay endpoint card), import dialog, sidebar draft row
      (`scripts/docs/capture-screenshots.mjs`).
- [ ] **Dangling design-doc references** in `apps/ui` comments and `.oxlintrc.json`.
- [ ] **Leftover i18n keys** `hostSections.connections` / `hostSections.metadata`: delete if unused.

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
