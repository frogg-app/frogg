import { Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import {
  dropPrimaryRoute,
  primaryRoute,
  promoteRoute,
  removeRoute,
  useHosts,
  type Host,
  type HostRoute,
} from "../../daemon/hosts";
import { connect, getClient, useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";

type Probe = { ms: number } | { down: true } | null;

const PROBE_TIMEOUT = 4000;

function openSocket(url: string): WebSocket | null {
  try {
    return new WebSocket(url);
  } catch {
    return null;
  }
}

/** Time to open a WebSocket to a direct route; relays are not probed. */
function probeRoute(r: HostRoute): Promise<Probe> {
  if (r.relay) return Promise.resolve(null);
  const ws = openSocket(`${r.tls ? "wss" : "ws"}://${r.endpoint}/ws`);
  if (!ws) return Promise.resolve({ down: true });
  const started = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<Probe>((resolve) => {
    timer = setTimeout(() => resolve({ down: true }), PROBE_TIMEOUT);
    ws.addEventListener("open", () => resolve({ ms: Date.now() - started }));
    ws.addEventListener("error", () => resolve({ down: true }));
    ws.addEventListener("close", () => resolve({ down: true }));
  }).finally(() => {
    clearTimeout(timer);
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  });
}

const routeKind = (r: HostRoute) => (r.relay ? "Relay" : "Direct");

/** Every saved route to a host, with latency, switching and removal. */
export function Routes({ host }: { host: Host }) {
  const active = useHosts((s) => s.activeId === host.id);
  const online = useDaemon((s) => s.conn === "online");
  const [rtt, setRtt] = useState<number | null>(null);
  // The route in use: ping the live client while connected.
  useEffect(() => {
    setRtt(null);
    if (!active || !online) return;
    let live = true;
    const tick = () =>
      void getClient()
        ?.ping()
        .then((r) => {
          if (live) setRtt(Math.round(r.rttMs));
          return undefined;
        })
        .catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [active, online]);
  const primary = primaryRoute(host);
  const alts = host.routes ?? [];
  const primaryProbe: Probe = rtt === null ? null : { ms: rtt };
  return (
    <View style={s.list}>
      <RouteRow
        host={host}
        r={primary}
        inUse
        probe={active && online ? primaryProbe : undefined}
        removable={alts.length > 0}
      />
      {alts.map((r) => (
        <RouteRow key={r.id} host={host} r={r} inUse={false} removable />
      ))}
    </View>
  );
}

function RouteRow({
  host,
  r,
  inUse,
  probe,
  removable,
}: {
  host: Host;
  r: HostRoute;
  inUse: boolean;
  /** Supplied for the live route; undefined means probe it here. */
  probe?: Probe;
  removable: boolean;
}) {
  const [own, setOwn] = useState<Probe>(null);
  const [confirm, setConfirm] = useState(false);
  const selfProbe = probe === undefined;
  const { endpoint, tls } = r;
  const relayed = Boolean(r.relay);
  useEffect(() => {
    if (!selfProbe) return;
    let live = true;
    setOwn(null);
    void probeRoute({
      id: "",
      endpoint,
      tls,
      ...(relayed ? { relay: { daemonPublicKeyB64: "" } } : {}),
    }).then((p) => {
      if (live) setOwn(p);
      return undefined;
    });
    return () => {
      live = false;
    };
  }, [selfProbe, endpoint, tls, relayed]);
  const shown = selfProbe ? own : probe;
  const reconnectIfActive = useCallback(
    (next: Host | null) => {
      if (next && useHosts.getState().activeId === host.id) void connect(next);
    },
    [host.id],
  );
  const use = useCallback(
    () => reconnectIfActive(promoteRoute(host.id, r.id)),
    [host.id, r.id, reconnectIfActive],
  );
  const ask = useCallback(() => setConfirm(true), []);
  const cancel = useCallback(() => setConfirm(false), []);
  const remove = useCallback(() => {
    setConfirm(false);
    if (inUse) reconnectIfActive(dropPrimaryRoute(host.id));
    else removeRoute(host.id, r.id);
  }, [inUse, host.id, r.id, reconnectIfActive]);
  return (
    <View style={s.row}>
      <View style={[s.dot, latencyTint(shown)]} />
      <T style={s.kind}>{routeKind(r)}</T>
      <T v="mono" numberOfLines={1} style={s.endpoint}>
        {r.endpoint}
        {r.tls ? " · TLS" : ""}
      </T>
      <T v="mono" style={s.latency}>
        {latencyLabel(shown, r)}
      </T>
      {inUse && (
        <View style={s.badge}>
          <T v="mono" style={s.badgeT}>
            in use
          </T>
        </View>
      )}
      {!inUse && !confirm && <Button label="Use" onPress={use} />}
      {removable && !confirm && (
        <Pressable
          onPress={ask}
          hitSlop={8}
          accessibilityLabel={`Remove route ${r.endpoint}`}
          style={s.bin}
        >
          <Trash2 size={13} color={color.faint} />
        </Pressable>
      )}
      {confirm && (
        <>
          <Button label="Keep" onPress={cancel} />
          <Button kind="danger" label="Remove" onPress={remove} />
        </>
      )}
    </View>
  );
}

function latencyLabel(p: Probe | undefined, r: HostRoute): string {
  if (p && "ms" in p) return `${p.ms} ms`;
  if (p && "down" in p) return "unreachable";
  if (r.relay) return "via relay";
  return "…";
}

function latencyTint(p: Probe | undefined) {
  if (p && "ms" in p) return s.up;
  if (p && "down" in p) return s.down;
  return null;
}

const s = StyleSheet.create({
  list: { gap: 8 },
  row: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 28 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: color.faint },
  up: { backgroundColor: color.mint },
  down: { backgroundColor: color.coral },
  kind: { fontWeight: "600", fontSize: 13 },
  endpoint: { flex: 1, fontSize: 12 },
  latency: { color: color.faint, fontSize: 11 },
  badge: { paddingHorizontal: 5, paddingVertical: 1, backgroundColor: color.raise },
  badgeT: { fontSize: 10 },
  bin: { padding: 2 },
});
