# Daemon self-update investigation

Running log. Newest steps at the bottom.

## Symptom

`Update from 1.5.6 to 1.5.7 failed — timed out after 90s: daemon reports version 0.6.13,
expected 1.5.7; rollback to 1.5.6 also failed: … reports version 0.6.13, expected 1.5.6`.
Recovery needed: remove host, reinstall daemon, re-add host.

## Log

1. Read `~/.local/share/frogg/self-update.log`: apply started 12:38:16, restart issued, 90s
   of probes saw `0.6.13`, rollback to 1.5.6 also saw `0.6.13`. `current -> versions/1.5.7`
   now, `previous` = 1.5.6, daemon now serves 1.5.7 on `0.0.0.0:9999`.
2. Hypothesis from a prior pass: verifier reads the protocol version instead of the app
   version. Checked `apps/cli/src/commands/daemon/self-update/verify.ts`: `probeDaemon` reads
   `x-frogg-gateway-version` header, else `/api/identity` `version`. Both are the app version
   (`resolveDaemonVersion` / bundle `manifest.json`). `curl /api/identity` on the live
   daemon returns `"version":"1.5.7"`. **Hypothesis rejected** — the verifier reads the
   right field.
3. `0.6.13` is not a Frogg 1.x version at all; it was the product version before the
   FDE→Frogg rename (commit `99b0325e … prepare 0.6.14`). Found
   `~/.config/systemd/user/fde-daemon.service` still **enabled and running**
   (`~/.local/share/fde/current -> versions/0.6.13`), with `FDE_LISTEN=0.0.0.0:9999` —
   the same port as `frogg-daemon.service`.
4. `journalctl --user -u fde-daemon`: the FDE supervisor crash-loops its worker every
   ~1.5s on `EADDRINUSE 0.0.0.0:9999` while Frogg holds the port. At 12:38:16 Frogg's unit
   restarted; FDE worker pid 1805533 bound 9999 first and served the user's clients
   (192.168.1.17) until at least 12:42. `journalctl --user -u frogg-daemon`: Frogg 1.5.7
   worker then crash-looped on `EADDRINUSE` for the whole verify window and the whole
   rollback window.
5. **Root cause 1 (port race with the legacy FDE service).** Every restart of either unit
   hands the port to whichever supervisor's worker retries first. The verifier was
   correct: the process on the port really was 0.6.13. The mirror image is in
   `~/.local/share/fde/self-update.log`: FDE's own 0.6.13→0.7.0 updater failed three times
   with "daemon reports version 1.5.5 / 1.5.6 / 1.5.7" — each product blamed the other.
   The Frogg 1.x daemon already detects the leftover unit (prints "FDE settings are no
   longer read. Rename them and remove the old FDE service") but does nothing about it.
6. **Root cause 2 (rollback on a non-bundle failure).** `applyUpdate` rolls back on any
   verify failure. When the port belongs to a foreign daemon the new bundle is fine;
   rollback cannot help (same port, same foreign daemon), wastes another 90s, and flips
   `current` back to the old version, so a good update is reverted. The wrong-brand
   response was reported as a version mismatch, hiding the real cause.
7. **Why the client needs remove/re-add.** While FDE 0.6.13 held the port, the client was
   talking to a different product (different brand, server id, keypair home `~/.fde`). The
   client's saved host no longer matched, so it could not reconnect until the port owner
   changed; reinstalling Frogg happened to restart the units in the right order.
8. Also seen: on `systemctl restart`, systemd reported the 1.5.6 worker (pid 489806) and
   agent children "remain running after unit stopped" (`KillMode=mixed`, cgroup kill
   returned EINVAL). Not the port holder in this incident (FDE was), but a stale worker
   can hold the port the same way. Open item.
9. **Auto-update (delegated read of `daemon-auto-updater.ts`, journal, config).** Auto-update
   is enabled on this host (`daemon.autoUpdate.enabled: true`) and does fire: journal shows
   "auto-update starting" 1.4.0→1.5.0 (applied), 1.5.0→1.5.5, 1.5.5→1.5.6 at 08:46, 08:57,
   09:07, 09:17, and 1.5.6→1.5.7 at 12:37. The scheduling gates are correct. It _looks_
   broken because every apply loses the port race (step 5) and is reported failed/rolled
   back. **Root cause 3:** each failed attempt restarts the daemon, `DaemonAutoUpdater.start()`
   re-arms its 5-minute initial delay, and the next tick retries the same version — a
   ~10-minute restart loop that repeatedly disconnects clients.

## Fixes (this branch)

10. `verify.ts`: `probeDaemon` now flags a _foreign_ answer (identity `product` other than
    `frogg`, or a brand that does not match). `waitForDaemonVersion` returns
    `kind: "foreign_listener"` after 15 consecutive foreign polls instead of a 90s
    "version mismatch" timeout; transient foreign answers during the restart race are
    tolerated. Every failure now carries a `kind` (`unhealthy` / `not_running` /
    `foreign_listener`).
11. `service.ts`: `retireLegacyServices` stops and disables (`systemctl --user disable --now`,
    or `launchctl disable` + `bootout`) the pre-rename `fde-daemon` unit / launch agent when
    its `FDE_LISTEN` port equals ours, or unconditionally (`force`) once the verifier has
    seen a foreign daemon on the port. Unit files are left on disk. Wired into all three
    service managers as `retireConflictingServices`.
12. `apply.ts`: retires conflicting services before the restart; on `foreign_listener` retires
    with `force` and restarts once more; if the port is still foreign it records `failed`
    **without rolling back** and keeps `current` on the new version (the bundle is not at
    fault; rollback cannot win a port the foreign daemon holds). Rollback behaviour for a
    genuinely unhealthy/not-running new version is unchanged (atomic `current` relink,
    verified restart of `previous`).
13. `command.ts`: the apply step's listen address falls back to the persisted daemon config
    when `FROGG_LISTEN` is not in the environment, so port matching works for non-systemd
    installs too.
14. `daemon-auto-updater.ts` + `bootstrap.ts`: new `lastResult` input; a version whose last
    attempt did not apply is not retried until one `checkIntervalHours` has passed. A newer
    version is never blocked. Ends the restart loop from step 9.

## Tests

15. `npx vitest run apps/cli/src/commands/daemon/self-update` — 63 passed. New cases:
    FDE identity probed as foreign; fail-fast `foreign_listener`; transient foreign tolerated;
    incident replay (1.5.6→1.5.7 with FDE on :9999) ends `applied` after retiring the unit;
    persistent foreign listener → `failed`, no rollback, `current` stays 1.5.7; legacy unit
    retirement matches by port, `force` overrides, absent/inactive units untouched.
16. `npx vitest run packages/server/src/server/session/daemon/daemon-auto-updater.test.ts` —
    passed, including backoff and newer-version cases.
17. `npm run typecheck -w packages/server` and `-w apps/cli` — clean.

## Client reconnect

18. `serverId` is stable across versions (`srv_o6m67r7oPFat` before and after), and no
    reconnect path compares versions; only pairing checks `serverId`
    (`apps/ui/src/pairing/claim-offer.ts`). A same-product restart with a changed version is
    already tolerated. The remove/re-add was needed because a _different product_ (FDE,
    own `serverId`/keypair under `~/.fde`) held the port; steps 11–12 stop that from
    happening. No client change made.

## Open

19. Host remediation for this machine (not done by this branch, the user's call):
    `systemctl --user disable --now fde-daemon.service`. The next Frogg self-update will do
    it automatically.
20. `systemctl restart` left the old worker and agent children running ("remains running
    after unit stopped", cgroup kill EINVAL) under `KillMode=mixed`. A stale Frogg worker
    could hold the port the same way; the verifier would then see the _old_ Frogg version
    and roll back. Not reproduced; worth a separate look at the unit plan
    (`apps/cli/src/commands/daemon/service/plan.ts`).
21. `last-update.json` still says `failed` although the host now runs 1.5.7 (someone
    restarted it afterwards), so the settings banner stays stale. The status could reconcile
    `lastResult` against the running version.
22. The daemon supervisor restarts a worker indefinitely on `EADDRINUSE` (~1.5s). A bounded
    backoff or a clear "port held by <identity>" error at startup would make the conflict
    visible without the updater.
