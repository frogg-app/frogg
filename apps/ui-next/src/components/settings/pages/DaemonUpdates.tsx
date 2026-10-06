import { patchHostConfig as patchConfig } from "./host-state";
import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { DaemonAutoUpdateConfig } from "@frogg/protocol/messages";
import { Upload } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useConfig } from "../../../daemon/config";
import { useDaemon } from "../../../daemon/store";
import { color } from "../../../theme/tokens";
import { agoText } from "../../../util";
import { Button } from "../../Button";
import { T } from "../../Text";
import { NumField, Row, Section, Seg, Toggle } from "../controls";
import { need } from "./hostkit";
import { Banner, Block, Confirm, ErrorLine, Status, Value, type Rpc, useFeature } from "./kit";

type Check = Awaited<ReturnType<DaemonClient["checkDaemonUpdate"]>>;
type Channel = DaemonAutoUpdateConfig["channel"];

const CHANNELS: Array<[Channel, string]> = [
  ["stable", "Stable"],
  ["beta", "Beta"],
];
const DEFAULT_AUTO: DaemonAutoUpdateConfig = {
  enabled: false,
  channel: "stable",
  checkIntervalHours: 24,
  quietHours: null,
};

const loadStatus = (c: DaemonClient) => c.getDaemonStatus();
const loadUpdate = (c: DaemonClient) => c.getDaemonUpdateStatus();

function setAuto(patch: Partial<DaemonAutoUpdateConfig>) {
  void patchConfig({ autoUpdate: patch });
}
const setEnabled = (v: boolean) => setAuto({ enabled: v });
const setChannel = (v: Channel) => setAuto({ channel: v });
const setInterval_ = (v: number | null) => setAuto({ checkIntervalHours: v ?? 24 });

export function DaemonUpdates() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const runs = useFeature("daemonUpdateRuns");
  const status = useRpc(loadStatus);
  const update = useRpc(loadUpdate, { enabled: runs === true, pollMs: 4000 });
  const auto = useConfig((st) => st.config?.autoUpdate);
  const host = useDaemon((st) => st.serverName) ?? "This host";
  const version = status.data?.version ?? update.data?.currentVersion ?? null;
  return (
    <>
      <VersionBanner host={host} version={version} canUpdate={runs === true} />
      <ErrorLine text={status.error ?? update.error} />
      {update.data?.run && (
        <Section title="Updating">
          <Row
            label={`${update.data.run.from ?? "?"} → ${update.data.run.to}`}
            hint={update.data.run.message ?? update.data.run.phase}
            last
          >
            <Value>{update.data.run.phase}</Value>
          </Row>
        </Section>
      )}
      <Section title="Updates">
        <AutoUpdate auto={auto} />
        <Row
          label="Method"
          hint={update.data?.updatable ? "Detected" : (update.data?.reason ?? "Detected")}
          last
        >
          <Value>{methodText(update.data)}</Value>
        </Row>
      </Section>
      <Section title="Service">
        <Restart />
        <FullStatus rpc={status} />
      </Section>
      {update.data?.lastResult && (
        <Section title="Recent updates">
          <Row label={update.data.lastResult.to} hint={lastText(update.data.lastResult)} last />
        </Section>
      )}
    </>
  );
}

type UpdateStatus = Awaited<ReturnType<DaemonClient["getDaemonUpdateStatus"]>>;

function methodText(u: UpdateStatus | null): string {
  if (!u) return "—";
  if (!u.updatable) return "manual install";
  return u.installDir ? `self-update · ${u.installDir}` : "self-update";
}

function lastText(r: NonNullable<UpdateStatus["lastResult"]>): string {
  const when = agoText(r.at);
  if (r.status === "applied") return `applied ${when}`;
  const what = r.status === "rolled_back" ? "rolled back" : "failed";
  return `${what}${r.reason ? ` · ${r.reason}` : ""} · ${when}`;
}

function VersionBanner({
  host,
  version,
  canUpdate,
}: {
  host: string;
  version: string | null;
  canUpdate: boolean;
}) {
  const [check, setCheck] = useState<Check | null>(null);
  const act = useAction();
  const runCheck = useCallback(() => {
    void act.run("check", async () => {
      const res = await need().checkDaemonUpdate();
      setCheck(res);
      return res;
    });
  }, [act]);
  const start = useCallback(() => {
    void act.run("start", () =>
      need().startDaemonUpdate(check?.latestVersion ? { version: check.latestVersion } : {}),
    );
  }, [act, check]);
  let state = "";
  if (check?.updateAvailable) state = ` · ${check.latestVersion} available`;
  else if (check && !check.error && check.latestVersion) state = " · up to date";
  return (
    <>
      <Banner
        icon={Upload}
        title={`${host} runs ${version ?? "an unknown version"}${state}`}
        body="Update this independently installed daemon here when self-update is supported. Other installations must be updated through their installer."
      >
        {canUpdate && (
          <Button
            label={act.pending === "check" ? "Checking…" : "Check now"}
            onPress={runCheck}
            disabled={!!act.pending}
          />
        )}
        {check?.updateAvailable && check.updatable && (
          <Button
            kind="primary"
            label={act.pending === "start" ? "Starting…" : `Update to ${check.latestVersion}`}
            onPress={start}
            disabled={!!act.pending}
          />
        )}
      </Banner>
      <ErrorLine
        text={act.error ?? check?.error ?? (check && !check.updatable ? check.reason : null)}
      />
    </>
  );
}

function AutoUpdate({ auto }: { auto: DaemonAutoUpdateConfig | undefined }) {
  const a = auto ?? DEFAULT_AUTO;
  const quiet = a.quietHours ?? null;
  const setFrom = useCallback(
    (v: number | null) =>
      setAuto({ quietHours: v === null ? null : [v, quiet?.[1] ?? (v + 3) % 24] }),
    [quiet],
  );
  const setTo = useCallback(
    (v: number | null) =>
      setAuto({ quietHours: v === null ? null : [quiet?.[0] ?? (v + 21) % 24, v] }),
    [quiet],
  );
  if (!auto) return <Row label="Automatic updates" hint="Configuration unavailable" />;
  return (
    <>
      <Row label="Update automatically" hint="When idle">
        <Toggle value={a.enabled} onChange={setEnabled} disabled={!auto} />
      </Row>
      <Row label="Channel" hint="Release channel for this daemon">
        <Seg options={CHANNELS} value={a.channel} onChange={setChannel} />
      </Row>
      <Row label="Quiet hours" hint="Never applied inside this window (host’s local hours)">
        <View style={s.pair}>
          <NumField
            value={quiet?.[0] ?? null}
            onChange={setFrom}
            min={0}
            max={23}
            unit="–"
            placeholder="hh"
            width={56}
          />
          <NumField
            value={quiet?.[1] ?? null}
            onChange={setTo}
            min={0}
            max={23}
            unit="h"
            placeholder="hh"
            width={56}
          />
        </View>
      </Row>
      <Row label="Check every">
        <NumField value={a.checkIntervalHours} onChange={setInterval_} min={1} max={168} unit="h" />
      </Row>
    </>
  );
}

function Restart() {
  const act = useAction();
  const restart = useCallback(() => {
    void act.run("restart", () => need().restartServer("settings"));
  }, [act]);
  return (
    <Row
      label="Restart daemon"
      hint={act.error ?? "Interrupts active work and briefly disconnects this host"}
    >
      <Confirm label="Restart" confirm="Restart now" onConfirm={restart} pending={!!act.pending} />
    </Row>
  );
}

type DaemonStatus = Awaited<ReturnType<DaemonClient["getDaemonStatus"]>>;

function FullStatus({ rpc }: { rpc: Rpc<DaemonStatus> }) {
  const [open, setOpen] = useState(false);
  const flip = useCallback(() => setOpen((o) => !o), []);
  const d = rpc.data;
  return (
    <>
      <Row label="Full status" last={!open}>
        <Button label={open ? "Hide" : "Show"} onPress={flip} />
      </Row>
      {open && (
        <Block last>
          <Status rpc={rpc} what="status">
            {d && (
              <>
                <Line k="Server id" v={d.serverId} />
                <Line k="Version" v={d.version ?? "—"} />
                <Line k="Process" v={`pid ${d.pid} · ${d.nodePath}`} />
                <Line k="Started" v={d.startedAt ? agoText(d.startedAt) : "—"} />
                <Line k="Listening" v={d.listen ?? "—"} />
                <Line
                  k="Relay"
                  v={
                    d.relay?.enabled
                      ? `${d.relay.publicEndpoint}${d.relay.publicUseTls ? " · TLS" : ""}`
                      : "off"
                  }
                />
                {d.providers.map((p) => (
                  <Line
                    key={p.provider}
                    k={p.provider}
                    v={p.available ? "available" : (p.error ?? "unavailable")}
                  />
                ))}
              </>
            )}
          </Status>
        </Block>
      )}
    </>
  );
}

function Line({ k, v }: { k: string; v: string }) {
  return (
    <T v="mono" style={s.line} selectable>
      <T v="mono" style={s.k}>
        {k.padEnd(12, " ")}
      </T>
      {v}
    </T>
  );
}

const s = StyleSheet.create({
  pair: { flexDirection: "row", alignItems: "center", gap: 8 },
  line: { color: color.text, fontSize: 12 },
  k: { color: color.faint, fontSize: 12 },
});
