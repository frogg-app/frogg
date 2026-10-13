import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { isRelayHost, useHostLink, useHosts, type Host } from "../../daemon/hosts";
import {
  connect,
  getClient,
  useDaemon,
  useFleet,
  useHostConn,
  useHostError,
} from "../../daemon/store";
import { color } from "../../theme/tokens";
import { authRefusal, identityMismatch } from "./access";
import { Button } from "../Button";
import { Meter } from "../Meter";
import { Card } from "./Card";
import { HereNow } from "./HereNow";
import { HostUpdate } from "./HostUpdate";
import { ago, MismatchBanner, Offline } from "./Offline";
import { Routes } from "./Routes";
import { T } from "../Text";
import { openSheet, useHostView, viewHost } from "./state";

type Metrics = NonNullable<
  Awaited<ReturnType<NonNullable<ReturnType<typeof getClient>>["getHostMetrics"]>>["metrics"]
>;

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GiB`;
export const uptime = (s: number) =>
  s > 86400
    ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
    : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

export const hostKind = (h: Host) => (isRelayHost(h) ? "Relay" : "Direct");

/** Main pane of the Hosts tool: the viewed host (the active one by default). */
export function HostDetail({ onBack }: { onBack?: () => void }) {
  const viewId = useHostView((s) => s.viewId);
  const host = useHosts((s) => s.hosts.find((h) => h.id === (viewId ?? s.activeId)));
  const activeId = useHosts((s) => s.activeId);
  if (!host)
    return (
      <View style={s.empty}>
        <T style={s.muted}>No host selected.</T>
      </View>
    );
  const active = host.id === activeId;
  return (
    <ScrollView style={s.fill} contentContainerStyle={s.scroll}>
      {active ? (
        <ActiveHost host={host} onBack={onBack} />
      ) : (
        <SavedHost host={host} onBack={onBack} />
      )}
    </ScrollView>
  );
}

function Back({ onBack }: { onBack?: () => void }) {
  if (!onBack) return null;
  return (
    <Pressable onPress={onBack} hitSlop={12} accessibilityLabel="Back" style={s.back}>
      <ArrowLeft size={18} color={color.muted} />
    </Pressable>
  );
}

function Head({
  host,
  eyebrow,
  status,
  actions,
  onBack,
}: {
  host: Host;
  eyebrow: string;
  status?: string;
  actions?: ReactNode;
  onBack?: () => void;
}) {
  return (
    <View style={s.head}>
      <Back onBack={onBack} />
      <View style={s.headMain}>
        <T v="label">{eyebrow}</T>
        <T v="display" style={s.title}>
          {host.name}
        </T>
        {status && (
          <View style={s.status}>
            <View style={[s.dot, s.dotOn]} />
            <T style={s.muted}>{status}</T>
          </View>
        )}
      </View>
      {actions && <View style={s.headActs}>{actions}</View>}
    </View>
  );
}

function ActiveHost({ host, onBack }: { host: Host; onBack?: () => void }) {
  const conn = useDaemon((st) => st.conn);
  const url = useDaemon((st) => st.url);
  const sessions = useDaemon((st) => Object.keys(st.sessions).length);
  const link = useHostLink();
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    setM(null);
    if (conn !== "online") return;
    let live = true;
    const tick = () =>
      void getClient()
        ?.getHostMetrics()
        .then((r) => {
          if (live) setM(r.metrics);
          return undefined;
        })
        .catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [conn, url]);
  const info = conn === "online" ? (getClient()?.getLastServerInfoMessage() ?? null) : null;
  const version = (info as { version?: string | null } | null)?.version ?? null;
  const role = (info as { callerRole?: string } | null)?.callerRole ?? host.role ?? null;
  const owner = role === "owner" || !role;
  const pairDevice = useCallback(() => openSheet({ kind: "pair-device" }), []);
  const restart = useCallback(() => void getClient()?.restartServer("Restart from Hosts"), []);
  const edit = useCallback(() => openSheet({ kind: "edit", hostId: host.id }), [host.id]);
  const retry = useCallback(() => void connect(host), [host]);
  const retryBtn = useMemo(
    () => (
      <Button
        kind="primary"
        label={conn === "connecting" ? "Retrying…" : "Retry"}
        onPress={retry}
      />
    ),
    [retry, conn],
  );
  const eyebrow = ["Host", hostKind(host), version ? `v${version}` : null]
    .filter(Boolean)
    .join(" · ");

  if (conn !== "online")
    return (
      <>
        <Head
          host={host}
          eyebrow={`Host · ${hostKind(host)}`}
          onBack={onBack}
          // A refusal or the wrong daemon is not fixed by retrying; the banner offers the fix.
          actions={authRefusal(link.error) || identityMismatch(link.error) ? undefined : retryBtn}
        />
        <Offline host={host} link={link} conn={conn} />
      </>
    );

  const status = `${isRelayHost(host) ? "Connected via relay" : "Connected directly"}${
    m ? ` · ${m.platform} · ${m.arch} · up ${uptime(m.uptimeSeconds)}` : ""
  }`;
  return (
    <>
      <Head
        host={host}
        eyebrow={eyebrow}
        status={status}
        onBack={onBack}
        actions={
          <>
            {owner && <Button label="Pair a device" onPress={pairDevice} />}
            {owner && <Button label="Restart daemon" onPress={restart} />}
            <Button label="Edit" onPress={edit} />
          </>
        }
      />
      <View style={s.grid}>
        <Card title="Load">
          {m ? (
            <>
              <Meter label="CPU" pct={m.cpu.usagePercent} detail={`${m.cpu.cores} cores`} />
              <Meter
                label="Memory"
                pct={(m.memory.usedBytes / m.memory.totalBytes) * 100}
                detail={`${gb(m.memory.usedBytes)} / ${gb(m.memory.totalBytes)}`}
              />
              {m.disk && (
                <Meter
                  label="Disk"
                  pct={(m.disk.usedBytes / m.disk.totalBytes) * 100}
                  detail={`${gb(m.disk.usedBytes)} / ${gb(m.disk.totalBytes)}`}
                />
              )}
              <T v="mono" style={s.faint}>
                daemon pid {m.daemon.pid} · {Math.round(m.daemon.rssBytes / 1024 ** 2)} MiB ·{" "}
                {sessions} sessions
              </T>
            </>
          ) : (
            <T style={s.muted}>Reading host metrics…</T>
          )}
        </Card>
        {owner && <HereNow key={url} owner={owner} role={role} />}
        <Card title="Connections">
          <Routes host={host} />
          {host.fingerprint && (
            <T v="mono" style={s.faint}>
              key {host.fingerprint.slice(0, 20)}…
            </T>
          )}
        </Card>
        <Card title="Daemon">
          <T style={s.strong}>{version ?? "unknown version"}</T>
          <T style={s.muted}>
            {role ? `This device is ${/^[aeiou]/.test(role) ? "an" : "a"} ${role}.` : ""}
          </T>
          {owner && <HostUpdate version={version} />}
        </Card>
      </View>
    </>
  );
}

/** One line on a background host's link; every saved host stays connected, not just the active one. */
function backgroundStatus(conn: string | null, count: number | null, last: string | null): string {
  if (conn === "online")
    return `Connected in the background${count === null ? "" : ` · ${count} sessions`}.`;
  if (conn === "connecting") return "Connecting…";
  if (conn === "offline")
    return `Can't reach it right now${last ? `; last connected ${last}` : ""}. Frogg keeps retrying.`;
  return last ? `Last connected ${last}.` : "Not connected yet.";
}

function SavedHost({ host, onBack }: { host: Host; onBack?: () => void }) {
  const conn = useHostConn(host.id);
  const count = useFleet((st) => {
    const list = st.sessions[host.id];
    return list ? Object.keys(list).length : null;
  });
  const go = useCallback(() => {
    viewHost(null, false);
    void connect(host);
  }, [host]);
  const remove = useCallback(() => openSheet({ kind: "remove", hostId: host.id }), [host.id]);
  const edit = useCallback(() => openSheet({ kind: "edit", hostId: host.id }), [host.id]);
  const wrongDaemon = identityMismatch(useHostError(host.id));
  const last = ago(host.lastOnlineAt);
  const switchBtn = useMemo(
    () => <Button kind="primary" label="Switch to this host" onPress={go} />,
    [go],
  );
  return (
    <>
      <Head host={host} eyebrow={`Host · ${hostKind(host)}`} onBack={onBack} actions={switchBtn} />
      {wrongDaemon && <MismatchBanner host={host} id={wrongDaemon} />}
      <View style={s.grid}>
        <Card title="Connections">
          <Routes host={host} />
          {!wrongDaemon && <T style={s.muted}>{backgroundStatus(conn, count, last)}</T>}
          {host.role && <T style={s.muted}>Paired as {host.role}.</T>}
          <View style={s.bannerActs}>
            <Button label="Edit host…" onPress={edit} />
            <Button kind="danger" label="Remove host…" onPress={remove} />
          </View>
        </Card>
      </View>
    </>
  );
}

const s = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg },
  scroll: { padding: 24, gap: 18 },
  empty: { flex: 1, alignItems: "center", justifyContent: "center" },
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-start", gap: 12 },
  headMain: { flex: 1, minWidth: 200, gap: 4 },
  headActs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  back: { paddingTop: 2 },
  title: { fontSize: 22 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.faint },
  dotOn: { backgroundColor: color.mint },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 14 },
  strong: { fontWeight: "600", fontSize: 13.5 },
  muted: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  faint: { color: color.faint, fontSize: 10.5 },
  bannerActs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});
