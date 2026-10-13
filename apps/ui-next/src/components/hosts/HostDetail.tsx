import { ArrowLeft } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { isRelayHost, updateHost, useHostLink, useHosts, type Host } from "../../daemon/hosts";
import { connect, getClient, useDaemon, useFleet, useHostConn } from "../../daemon/store";
import { color, motion, stateMotion } from "../../theme/tokens";
import { authRefusal } from "./access";
import { Button } from "../Button";
import { Meter } from "../Meter";
import { Card } from "./Card";
import { HereNow } from "./HereNow";
import { HostUpdate } from "./HostUpdate";
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
  const refusal = authRefusal(link.error);
  if (refusal) return refusal.title;
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

/**
 * When a direct host keeps failing, asks /api/identity over the other scheme: a daemon that only
 * answers there means the saved TLS setting is wrong (the usual cause of a bare 1006).
 */
function useTlsMismatch(host: Host, down: boolean): boolean {
  const [wrong, setWrong] = useState(false);
  const { endpoint, tls } = host;
  const relay = isRelayHost(host);
  useEffect(() => {
    setWrong(false);
    if (!down || relay) return;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 4000);
    fetch(`${tls ? "http" : "https"}://${endpoint}/api/identity`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((b: { serverId?: string } | null) => {
        if (b?.serverId) setWrong(true);
        return undefined;
      })
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    return () => ctl.abort();
  }, [endpoint, tls, relay, down]);
  return wrong;
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
  const pairApp = useCallback(() => openSheet({ kind: "add", method: "pair" }), []);
  const edit = useCallback(() => openSheet({ kind: "edit", hostId: host.id }), [host.id]);
  const refusal = authRefusal(link.error);
  const last = ago(host.lastOnlineAt);
  const connecting = conn === "connecting";
  // First connect (never dropped this run) reads as a wait; a reconnect reads as a failure.
  const first = connecting && !link.droppedAt;
  const tlsWrong = useTlsMismatch(host, !first && !refusal);
  const fixTls = useCallback(() => {
    const next = updateHost(host.id, { tls: !host.tls });
    if (next) void connect(next);
  }, [host.id, host.tls]);
  const retryBtn = useMemo(
    () => <Button kind="primary" label={connecting ? "Retrying…" : "Retry"} onPress={retry} />,
    [retry, connecting],
  );
  const attempt = link.attempt + 1;
  let title = `Can't reach ${host.name}`;
  if (first) title = `Connecting to ${host.name}…`;
  else if (refusal) title = refusal.title;
  let body = `${offlineReason(link)}.${last ? ` Last connected ${last}.` : ""} Sessions on this host are paused here and come back when it does.`;
  if (first) body = host.endpoint;
  else if (refusal) body = refusal.body;
  let primary = <Button kind="primary" label="Retry now" onPress={retry} />;
  if (refusal) primary = <Button kind="primary" label="Pair this app…" onPress={pairApp} />;
  else if (tlsWrong)
    primary = (
      <Button kind="primary" label={host.tls ? "Turn off TLS" : "Turn on TLS"} onPress={fixTls} />
    );
  return (
    <>
      <Head
        host={host}
        eyebrow={`Host · ${hostKind(host)}`}
        onBack={onBack}
        actions={refusal ? undefined : retryBtn}
      />
      <View style={[s.banner, first && s.bannerWait]}>
        <View style={s.bannerHead}>
          <View style={[s.flag, first && s.flagWait, !refusal && s.flagLive]} />
          <T style={s.strong}>{title}</T>
        </View>
        <T style={s.bannerBody}>{body}</T>
        {tlsWrong && (
          <T style={s.hintLine}>
            {host.tls
              ? `${host.endpoint} answers without TLS. Turn TLS off for this host to connect.`
              : `${host.endpoint} only answers over TLS. Turn TLS on for this host to connect.`}
          </T>
        )}
        {!refusal && !first && (
          <View style={s.retryRow}>
            <View style={s.track}>{connecting && <View style={s.scan} />}</View>
            <T v="mono" style={connecting ? s.retryOn : s.retryIdle}>
              {connecting
                ? `retrying · attempt ${attempt}`
                : `waiting to retry · ${attempt - 1} tried`}
            </T>
          </View>
        )}
        <View style={s.bannerActs}>
          {primary}
          <Button label={refusal ? "Add the password…" : "Edit host…"} onPress={edit} />
          <Button kind="danger" label="Remove host…" onPress={remove} />
        </View>
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
          <T style={s.muted}>{backgroundStatus(conn, count, last)}</T>
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
  flagLive: motion.breathe,
  hintLine: { color: color.text, fontSize: 13, lineHeight: 19 },
  retryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: { width: 120, height: 2, backgroundColor: color.line, overflow: "hidden" },
  scan: { width: "25%", height: 2, backgroundColor: color.coral, ...stateMotion.beam },
  retryOn: { color: color.coral, fontSize: 11.5 },
  retryIdle: { color: color.faint, fontSize: 11.5 },
  bannerBody: { color: color.muted, fontSize: 13.5, lineHeight: 21 },
  bannerActs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});
