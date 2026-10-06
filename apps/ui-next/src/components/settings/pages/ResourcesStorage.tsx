import { patchHostConfig as patchConfig } from "./host-state";
import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import type { MutableStorageAlertsConfig } from "@frogg/protocol/messages";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useConfig } from "../../../daemon/config";
import { color } from "../../../theme/tokens";
import { Button } from "../../Button";
import { T } from "../../Text";
import { NumField, Row, Section, Toggle } from "../controls";
import { need } from "./hostkit";
import { Confirm, ErrorLine, Meter, Status, Value, fmtBytes, fmtUptime, useFeature } from "./kit";

type Category = Awaited<ReturnType<DaemonClient["listOwnedStorage"]>>["categories"][number];

const GIB = 1024 ** 3;
const loadMetrics = (c: DaemonClient) => c.getHostMetrics();
const loadStorage = (c: DaemonClient) => c.listOwnedStorage();

const NAMES: Record<string, string> = {
  worktrees: "Worktrees",
  agent_worktrees: "Agent worktrees",
  agents: "Agent state",
  logs: "Logs",
  provider_accounts: "Provider accounts",
  uploads: "Uploads",
  tts_cache: "Speech cache",
  models: "Speech models",
  daemon_versions: "Daemon versions",
  temp: "Temp",
  projects: "Projects",
  project_import_staging: "Import staging",
};
const nameOf = (id: string) => NAMES[id] ?? id.replace(/_/g, " ");
const pct = (used: number, total: number) => (total > 0 ? (used / total) * 100 : null);

export function ResourcesStorage() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const supported = useFeature("hostResources");
  const metrics = useRpc(loadMetrics, { enabled: supported !== false, pollMs: 5000 });
  const storage = useRpc(loadStorage, { enabled: supported !== false });
  if (supported === false)
    return <T style={s.muted}>This daemon is too old to report resources. Update it first.</T>;
  const m = metrics.data?.metrics ?? null;
  const cats = (storage.data?.categories ?? []).filter((c) => c.exists && c.bytes > 0);
  const total = cats.reduce((n, c) => n + c.bytes, 0);
  const storageTitle = storage.data
    ? `Storage owned by Frogg · ${fmtBytes(total)}`
    : "Storage owned by Frogg";
  return (
    <>
      <Section title="Now">
        <Status rpc={metrics} what="host metrics">
          {m && (
            <>
              <Row
                label="CPU"
                hint={`${m.cpu.cores} cores${m.cpu.model ? ` · ${m.cpu.model}` : ""}`}
              >
                <Meter pct={m.cpu.usagePercent} />
              </Row>
              <Row
                label="Memory"
                hint={`${fmtBytes(m.memory.usedBytes)} / ${fmtBytes(m.memory.totalBytes)}`}
              >
                <Meter pct={pct(m.memory.usedBytes, m.memory.totalBytes)} />
              </Row>
              {m.disk && (
                <Row
                  label="Disk"
                  hint={`${fmtBytes(m.disk.usedBytes)} / ${fmtBytes(m.disk.totalBytes)} · ${m.disk.path}`}
                >
                  <Meter pct={pct(m.disk.usedBytes, m.disk.totalBytes)} />
                </Row>
              )}
              <Row
                label="Uptime"
                hint={`Daemon ${fmtUptime(m.daemon.uptimeSeconds)} · ${fmtBytes(m.daemon.rssBytes)} resident`}
                last
              >
                <Value>
                  {fmtUptime(m.uptimeSeconds)} · daemon pid {m.daemon.pid}
                </Value>
              </Row>
            </>
          )}
        </Status>
      </Section>
      <Section title={storageTitle}>
        <Status rpc={storage} what="storage">
          {storage.data && cats.length === 0 && <Row label="No owned storage found" last />}
          {cats.map((c) => (
            <CategoryRow
              key={c.id}
              cat={c}
              last={c.id === cats.at(-1)?.id}
              onCleaned={storage.reload}
            />
          ))}
        </Status>
      </Section>
      {storage.data?.computedAt ? (
        <View style={s.measured}>
          <T style={s.faint}>Measured {new Date(storage.data.computedAt).toLocaleString()}</T>
          <RefreshStorage onDone={storage.reload} />
        </View>
      ) : null}
      <StorageAlerts />
    </>
  );
}

function CategoryRow({
  cat,
  last,
  onCleaned,
}: {
  cat: Category;
  last: boolean;
  onCleaned: () => void;
}) {
  const act = useAction();
  const clean = useCallback(() => {
    void act.run("clean", () => need().cleanOwnedStorage(cat.id)).then((ok) => ok && onCleaned());
  }, [act, cat.id, onCleaned]);
  const free = cat.reclaimableBytes ? `Frees ${fmtBytes(cat.reclaimableBytes)}` : undefined;
  return (
    <Row label={nameOf(cat.id)} hint={act.error ?? cat.path ?? undefined} last={last}>
      <Value>
        {cat.truncated ? "≥ " : ""}
        {fmtBytes(cat.bytes)}
      </Value>
      {cat.cleanable && (
        <Confirm
          label="Clean…"
          confirm={free ?? "Clean"}
          onConfirm={clean}
          pending={act.pending === "clean"}
          disabled={!cat.reclaimableBytes}
        />
      )}
    </Row>
  );
}

function setAlerts(patch: Partial<MutableStorageAlertsConfig>) {
  void patchConfig({ storage: { alerts: patch } });
}
const setEnabled = (v: boolean) => setAlerts({ enabled: v });
const setNotifyCritical = (v: boolean) => setAlerts({ notifyAt: v ? "critical" : "warn" });
const toBytes = (gib: number | null) => Math.max(1, gib ?? 1) * GIB;
const setWarn = (v: number | null) => setAlerts({ warnBytes: toBytes(v) });
const setCritical = (v: number | null) => setAlerts({ criticalBytes: toBytes(v) });

function StorageAlerts() {
  const alerts = useConfig((st) => st.config?.storage?.alerts);
  const supported = useFeature("storageAlerts");
  if (!supported || !alerts) return null;
  return (
    <Section title="Storage alerts">
      <Row label="Alerts" hint="Notify when Frogg-owned storage grows past a threshold">
        <Toggle value={alerts.enabled} onChange={setEnabled} />
      </Row>
      <Row label="Warning at">
        <NumField
          value={Math.round(alerts.warnBytes / GIB)}
          onChange={setWarn}
          unit="GiB"
          min={1}
        />
      </Row>
      <Row label="Critical at">
        <NumField
          value={Math.round(alerts.criticalBytes / GIB)}
          onChange={setCritical}
          unit="GiB"
          min={1}
        />
      </Row>
      <Row label="Notify only at critical" last>
        <Toggle value={alerts.notifyAt === "critical"} onChange={setNotifyCritical} />
      </Row>
    </Section>
  );
}

function RefreshStorage({ onDone }: { onDone: () => void }) {
  const act = useAction();
  const run = useCallback(() => {
    void act
      .run("r", () => need().listOwnedStorage({ refresh: true }))
      .then((ok) => ok && onDone());
  }, [act, onDone]);
  return (
    <>
      <Button label={act.pending ? "Measuring…" : "Measure again"} onPress={run} />
      <ErrorLine text={act.error} />
    </>
  );
}

const s = StyleSheet.create({
  muted: { color: color.muted },
  faint: { color: color.faint, fontSize: 12 },
  measured: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    marginTop: -14,
    marginBottom: 26,
  },
});
