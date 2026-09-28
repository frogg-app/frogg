# Daemons crash-loop on an empty `frogg.pid`

## Symptom

- `frogg start` fails: `Daemon failed to start in background (exit code 1)`.
- The "recent daemon logs" it prints are stale output from the last healthy daemon, not the failure.
- `frogg status` shows `Local Daemon stopped` and `Connected Daemon unreachable`.
- `journalctl --user -u frogg-daemon` / `-u frogg-beta-daemon` loops every ~6s:

```
frogg[9391]: Failed to acquire PID lock due to race condition
frogg-daemon.service: Main process exited, code=exited, status=1/FAILURE
frogg-daemon.service: Scheduled restart job, restart counter is at 44.
```

## Cause

Stable 1.6.5 (`frogg-daemon.service`) and 1.6.6-beta.2 (`frogg-beta-daemon.service`) were both
running on the host.

- **They did not share a home.** The first write-up said they did; that was wrong. The beta unit
  sets `FROGG_BETA_*` env, and the beta brand defaults to `~/.frogg-beta`. Each daemon had its own
  `frogg.pid`: `~/.frogg/frogg.pid` for stable and `~/.frogg-beta/frogg.pid` for beta.
- **Each home held a 0-byte `frogg.pid`.** `acquirePidLock` created the lock with `open(wx)`
  and then wrote the JSON as a second step. A daemon that died between those two steps left an
  empty file.
- **An empty lock wedged the daemon permanently.** On the next start, the unparseable file read
  as "no lock", so nothing cleared it. `open(wx)` then hit `EEXIST`, the re-read was still
  unparseable, and the daemon exited with `race condition`. `Restart=on-failure` repeated this
  forever (stable reached restart #45, beta #89).
- `frogg start` spawned the daemon with stderr ignored, so the real error never reached the user,
  and it showed the old `daemon.log` instead.

## Resolution applied

```
systemctl --user disable --now frogg-beta-daemon
rm -f ~/.frogg/frogg.pid ~/.frogg-beta/frogg.pid
systemctl --user restart frogg-daemon
```

## Fixes

- `pid-lock.ts`: the lock is written to a temp file and published with `link()`, which is atomic
  and fails with `EEXIST` if another daemon got there first. A crash can no longer leave an empty
  lock.
- `pid-lock.ts`: a lock file that stays unreadable across the read retries is treated as
  abandoned and removed, so homes already wedged by older builds recover by themselves.
- `pid-lock.ts`: when two daemons race, exactly one wins. The loser reports the holder's PID and
  start time.
- `frogg start`: the detached daemon's stderr goes to `daemon-startup.err`, and it is shown as
  "Startup errors" when the daemon exits early.
