import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { DaemonUpdateChannel } from "@frogg/protocol/messages";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getClient, useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { agoText } from "../../util";
import { Button } from "../Button";
import { Seg } from "../settings/controls";
import { ErrorLine, Field, fmtBytes, useAction, useFeature } from "../settings/pages/kit";
import { T } from "../Text";

type Check = Awaited<ReturnType<DaemonClient["checkDaemonUpdate"]>>;
type Status = Awaited<ReturnType<DaemonClient["getDaemonUpdateStatus"]>>;
type Legacy = Awaited<ReturnType<DaemonClient["updateDaemon"]>>;

const CHANNELS: Array<[DaemonUpdateChannel, string]> = [
  ["stable", "Stable"],
  ["beta", "Beta"],
];

function need(): DaemonClient {
  const c = getClient();
  if (!c) throw new Error("Host offline. Reconnect first.");
  return c;
}

/** A beta build stays on the beta channel unless the user picks otherwise. */
const channelOf = (version: string | null): DaemonUpdateChannel =>
  version && /-beta/i.test(version) ? "beta" : "stable";

function checkLine(c: Check): string {
  if (c.error) return c.error;
  if (!c.updatable) return c.reason ?? "This install can't update itself.";
  if (c.updateAvailable && c.latestVersion) return `${c.latestVersion} available on ${c.channel}`;
  return c.latestVersion ? `Up to date on ${c.channel} (${c.latestVersion})` : "Up to date";
}

function runLine(run: NonNullable<Status["run"]>): string {
  const bytes =
    run.receivedBytes !== undefined
      ? ` · ${fmtBytes(run.receivedBytes)}${run.totalBytes ? ` of ${fmtBytes(run.totalBytes)}` : ""}`
      : "";
  return `${run.from ?? "?"} → ${run.to} · ${run.message ?? run.phase}${bytes}`;
}

function lastLine(r: NonNullable<Status["lastResult"]>): string {
  const what = { applied: "Updated", rolled_back: "Rolled back", failed: "Failed" }[r.status];
  return `${what} to ${r.to} ${agoText(r.at)}${r.reason ? ` · ${r.reason}` : ""}`;
}

/**
 * Update the active host's daemon: pick a channel (or type an exact version), check, then
 * install. Daemons with versioned self-update run it with live progress; older npm installs
 * get the npm-era update RPC. Either way failures are shown, never swallowed.
 */
export function HostUpdate({ version }: { version: string | null }) {
  const runs = useFeature("daemonUpdateRuns");
  const url = useDaemon((st) => st.url);
  const [channel, setChannel] = useState<DaemonUpdateChannel>(() => channelOf(version));
  const [pin, setPin] = useState("");
  const [check, setCheck] = useState<Check | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const act = useAction();

  // Another host, or a new channel, makes the last answer meaningless.
  useEffect(() => {
    setCheck(null);
  }, [url, channel]);

  const running = !!status?.run;
  useEffect(() => {
    if (runs !== true) {
      setStatus(null);
      return;
    }
    let live = true;
    const read = () =>
      void getClient()
        ?.getDaemonUpdateStatus()
        .then((s) => live && setStatus(s))
        .catch(() => {});
    read();
    // Poll fast only while a run is in flight; the daemon restarts at the end of one.
    const id = setInterval(read, running ? 1500 : 15000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [runs, url, running]);

  const runCheck = useCallback(() => {
    void act.run("check", async () => setCheck(await need().checkDaemonUpdate({ channel })));
  }, [act, channel]);
  const target = pin.trim() || check?.latestVersion || null;
  const start = useCallback(() => {
    void act.run("start", async () => {
      const res = await need().startDaemonUpdate({
        channel,
        ...(target ? { version: target.replace(/^v/, "") } : {}),
      });
      if (!res.accepted) throw new Error(res.error ?? "The host refused the update.");
      setStatus(await need().getDaemonUpdateStatus());
      return null;
    });
  }, [act, channel, target]);
  if (runs === undefined) return null;
  if (runs === false) return <NpmUpdate />;

  const canStart =
    !running &&
    !act.pending &&
    status?.updatable !== false &&
    (!!pin.trim() || !!check?.updateAvailable);
  return (
    <View style={s.wrap}>
      <View style={s.line}>
        <T style={s.label}>Channel</T>
        <Seg options={CHANNELS} value={channel} onChange={setChannel} />
      </View>
      <View style={s.line}>
        <T style={s.label}>Version</T>
        <Field value={pin} onChangeText={setPin} placeholder="latest" mono />
      </View>
      <View style={s.acts}>
        <Button
          label={act.pending === "check" ? "Checking…" : "Check for updates"}
          onPress={runCheck}
          disabled={!!act.pending || running}
        />
        <Button
          kind="primary"
          label={act.pending === "start" ? "Starting…" : `Update to ${target ?? "…"}`}
          onPress={start}
          disabled={!canStart}
        />
      </View>
      {check && <T style={check.error ? s.err : s.muted}>{checkLine(check)}</T>}
      {status && <RunStatus status={status} />}
      <ErrorLine text={act.error} />
    </View>
  );
}

function RunStatus({ status }: { status: Status }) {
  if (status.run)
    return (
      <T v="mono" style={s.run}>
        {runLine(status.run)}
      </T>
    );
  if (status.updatable === false)
    return <T style={s.muted}>{status.reason ?? "This install can't update itself."}</T>;
  if (!status.lastResult) return null;
  return (
    <T style={status.lastResult.status === "applied" ? s.muted : s.err}>
      {lastLine(status.lastResult)}
    </T>
  );
}

/** Older npm installs: the npm-era update RPC, which answers once the update is done. */
function NpmUpdate() {
  const [legacy, setLegacy] = useState<Legacy | null>(null);
  const act = useAction();
  const npmUpdate = useCallback(() => {
    void act.run("npm", async () => {
      const res = await need().updateDaemon();
      setLegacy(res);
      return res;
    });
  }, [act]);
  return (
    <View style={s.wrap}>
      <T style={s.muted}>
        This daemon has no versioned self-update. Frogg can run its npm update instead; the host
        restarts when it finishes.
      </T>
      <View style={s.acts}>
        <Button
          kind="primary"
          label={act.pending === "npm" ? "Updating…" : "Update host"}
          onPress={npmUpdate}
          disabled={!!act.pending}
        />
      </View>
      {legacy?.success && (
        <T style={s.ok}>
          Updated {legacy.previousVersion ?? ""} → {legacy.newVersion ?? "latest"}. Reconnecting…
        </T>
      )}
      <ErrorLine text={act.error} />
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { gap: 10 },
  line: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 12 },
  label: { width: 64, color: color.muted, fontSize: 12.5 },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  muted: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  ok: { color: color.mint, fontSize: 12.5 },
  err: { color: color.coral, fontSize: 12.5 },
  run: { color: color.cyan2, fontSize: 11.5 },
});
