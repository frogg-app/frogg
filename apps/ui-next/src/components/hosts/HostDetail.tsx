import type { DeviceCredential, PendingPairingRequest } from "@frogg/protocol/device-access";
import { ArrowLeft, Laptop, Smartphone } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { isRelayHost, useHostLink, useHosts, type Host } from "../../daemon/hosts";
import { connect, getClient, useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { Button } from "../Button";
import { Cut } from "../Cut";
import { Meter } from "../Meter";
import { Pill } from "../settings/controls";
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

/** "12m ago" style age for an ISO time. */
export function ago(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return null;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/** Why the active host is not connected, in one line. */
export function offlineReason(link: ReturnType<typeof useHostLink.getState>): string {
  const code = link.error?.code;
  if (code === "pairing_required")
    return "This device isn't paired with the host, or its credential was revoked. Pair again.";
  if (link.error && "message" in link.error && typeof link.error.message === "string")
    return link.error.message;
  if (link.reason) return link.reason;
  return "No answer from the daemon";
}

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
  const eyebrow = ["Host", hostKind(host), version ? `v${version}` : null]
    .filter(Boolean)
    .join(" · ");

  if (conn !== "online") return <Offline host={host} link={link} conn={conn} onBack={onBack} />;

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
        {owner && <HereNow />}
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
            {role ? `This device is ${role === "owner" ? "an" : "a"} ${role}.` : ""}
          </T>
        </Card>
      </View>
    </>
  );
}

function Offline({
  host,
  link,
  conn,
  onBack,
}: {
  host: Host;
  link: ReturnType<typeof useHostLink.getState>;
  conn: string;
  onBack?: () => void;
}) {
  const retry = useCallback(() => void connect(host), [host]);
  const remove = useCallback(() => openSheet({ kind: "remove", hostId: host.id }), [host.id]);
  const addHost = useCallback(() => openSheet({ kind: "add" }), []);
  const edit = useCallback(() => openSheet({ kind: "edit", hostId: host.id }), [host.id]);
  const retryBtn = useMemo(() => <Button kind="primary" label="Retry" onPress={retry} />, [retry]);
  const pairing = link.error?.code === "pairing_required";
  const last = ago(host.lastOnlineAt);
  const connecting = conn === "connecting";
  const attempt = link.attempt > 0 ? ` · attempt ${link.attempt + 1}` : "";
  return (
    <>
      <Head host={host} eyebrow={`Host · ${hostKind(host)}`} onBack={onBack} actions={retryBtn} />
      <View style={[s.banner, connecting && s.bannerWait]}>
        <View style={s.bannerHead}>
          <View style={[s.flag, connecting && s.flagWait]} />
          <T style={s.strong}>
            {connecting && !link.droppedAt
              ? `Connecting to ${host.name}…`
              : `Can't reach ${host.name}`}
          </T>
        </View>
        <T style={s.bannerBody}>
          {connecting && !link.droppedAt
            ? `${host.endpoint}${attempt}`
            : `${offlineReason(link)}.${last ? ` Last connected ${last}.` : ""} Sessions on this host are paused here and come back when it does. ${pairing ? "Pair again to reconnect." : `Frogg keeps retrying${attempt}.`}`}
        </T>
        <View style={s.bannerActs}>
          {pairing ? (
            <Button kind="primary" label="Pair again" onPress={addHost} />
          ) : (
            <Button kind="primary" label="Retry now" onPress={retry} />
          )}
          <Button label="Edit host…" onPress={edit} />
          <Button kind="danger" label="Remove host…" onPress={remove} />
        </View>
      </View>
    </>
  );
}

function SavedHost({ host, onBack }: { host: Host; onBack?: () => void }) {
  const go = useCallback(() => {
    viewHost(null, false);
    void connect(host);
  }, [host]);
  const remove = useCallback(() => openSheet({ kind: "remove", hostId: host.id }), [host.id]);
  const edit = useCallback(() => openSheet({ kind: "edit", hostId: host.id }), [host.id]);
  const last = ago(host.lastOnlineAt);
  const switchBtn = useMemo(
    () => <Button kind="primary" label="Switch to this host" onPress={go} />,
    [go],
  );
  return (
    <>
      <Head host={host} eyebrow={`Host · ${hostKind(host)}`} onBack={onBack} actions={switchBtn} />
      <View style={s.grid}>
        <Card title="Connections">
          <Routes host={host} />
          <T style={s.muted}>{last ? `Last connected ${last}.` : "Not connected yet."}</T>
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

function HereNow() {
  const [devices, setDevices] = useState<DeviceCredential[]>([]);
  const [requests, setRequests] = useState<PendingPairingRequest[]>([]);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const client = getClient();
    if (!client) return;
    let live = true;
    const load = () => {
      void client
        .listDevices()
        .then((r) => live && setDevices(r.devices))
        .catch(() => {});
      void client
        .listPairingRequests()
        .then((r) => live && setRequests(r.requests))
        .catch(() => {});
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const sorted = [...devices].sort((a, b) => Number(b.connected) - Number(a.connected));
  return (
    <Card title="Here now" count={`${devices.filter((d) => d.connected).length} connected`}>
      {sorted.slice(0, 6).map((d) => (
        <DeviceRow key={d.id} d={d} />
      ))}
      {!devices.length && <T style={s.muted}>No paired devices.</T>}
      {requests.map((r) => (
        <RequestRow key={r.id} r={r} done={refresh} />
      ))}
    </Card>
  );
}

function DeviceRow({ d }: { d: DeviceCredential }) {
  const Icon = /pixel|phone|android|ios/i.test(d.name) ? Smartphone : Laptop;
  const seen = d.connected ? "connected" : `last seen ${ago(d.lastSeenAt) ?? "never"}`;
  return (
    <View style={s.device}>
      <Icon size={14} color={color.muted} />
      <T numberOfLines={1} style={s.deviceName}>
        {d.name}
        {d.current ? " (this device)" : ""}
      </T>
      <T style={s.faintSmall}>{seen}</T>
      <Pill text={d.role} />
    </View>
  );
}

function RequestRow({ r, done }: { r: PendingPairingRequest; done: () => void }) {
  const decide = useCallback(
    (decision: "approve" | "deny") =>
      void getClient()
        ?.decidePairingRequest({ pairingRequestId: r.id, decision, role: "operator" })
        .finally(done),
    [r.id, done],
  );
  const approve = useCallback(() => decide("approve"), [decide]);
  const deny = useCallback(() => decide("deny"), [decide]);
  return (
    <View style={s.request}>
      <View style={s.diamond} />
      <View style={s.flex}>
        <T style={s.strong}>{r.deviceName} wants Operator access</T>
        <T style={s.muted}>
          Match code{" "}
          <T v="mono" style={s.code}>
            {r.matchCode}
          </T>{" "}
          on that device
          {r.remoteAddress ? ` · ${r.remoteAddress}` : ""}
        </T>
      </View>
      <Button label="Deny" onPress={deny} />
      <Button kind="primary" label="Approve" onPress={approve} />
    </View>
  );
}

function Card({ title, count, children }: { title: string; count?: string; children: ReactNode }) {
  return (
    <Cut size={10} flip style={s.card}>
      <View style={s.cardHead}>
        <T style={s.strong}>{title}</T>
        {count && <T style={s.faintSmall}>{count}</T>}
      </View>
      {children}
    </Cut>
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
  card: {
    flexGrow: 1,
    flexBasis: 340,
    padding: 16,
    gap: 12,
    backgroundColor: color.panel,
  },
  cardHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  strong: { fontWeight: "600", fontSize: 13.5 },
  muted: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  faint: { color: color.faint, fontSize: 10.5 },
  faintSmall: { color: color.faint, fontSize: 12 },
  flex: { flex: 1 },
  device: { flexDirection: "row", alignItems: "center", gap: 10 },
  deviceName: { flexShrink: 1, fontSize: 13 },
  request: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: "rgba(245,184,74,0.06)",
  },
  diamond: {
    width: 8,
    height: 8,
    backgroundColor: color.amber,
    transform: [{ rotate: "45deg" }],
  },
  code: { color: color.cyan2 },
  banner: {
    maxWidth: 720,
    padding: 18,
    gap: 10,
    borderLeftWidth: 2,
    borderLeftColor: color.coral,
    backgroundColor: "rgba(255,107,107,0.06)",
  },
  bannerWait: { borderLeftColor: color.amber, backgroundColor: "rgba(245,184,74,0.05)" },
  bannerHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  flag: { width: 10, height: 10, backgroundColor: color.coral },
  flagWait: { backgroundColor: color.amber },
  bannerBody: { color: color.muted, fontSize: 13.5, lineHeight: 21 },
  bannerActs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});
