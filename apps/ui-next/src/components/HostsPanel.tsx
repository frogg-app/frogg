import { Plus, Server, Trash2 } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { addHost, removeHost, useHosts, type Host } from "../daemon/hosts";
import { connect, getClient, useDaemon } from "../daemon/store";
import { color, font, web } from "../theme/tokens";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { Meter } from "./Meter";
import { GroupHead, PanelHead } from "./PanelHead";
import { Brackets } from "./SessionList";
import { Pill } from "./settings/controls";
import { T } from "./Text";

type Metrics = NonNullable<
  Awaited<ReturnType<NonNullable<ReturnType<typeof getClient>>["getHostMetrics"]>>["metrics"]
>;

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GiB`;
const uptime = (s: number) =>
  s > 86400
    ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
    : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;

export function HostsPanel() {
  const { conn, url, serverName } = useDaemon();
  const active = useHosts((s) => s.hosts.find((h) => h.id === s.activeId));
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    setM(null);
    if (conn !== "online") return;
    const tick = () =>
      void getClient()
        ?.getHostMetrics()
        .then((r) => setM(r.metrics))
        .catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [conn, url]);
  const tint = TINT[conn] ?? color.coral;
  return (
    <View style={st.fill}>
      <PanelHead title="Hosts" />
      <ScrollView contentContainerStyle={st.scroll}>
        <GroupHead label={conn === "online" ? "Connected" : "Active"} />
        <Cut size={10} flip style={st.card}>
          <Brackets c={color.cyan2} />
          <View style={st.head}>
            <Server size={16} color={color.cyan2} />
            <View style={st.flex}>
              <T style={st.strong}>{active?.name ?? serverName ?? "host"}</T>
              <T v="mono" numberOfLines={1} style={st.small}>
                {url.replace(/^ws:\/\//, "").replace(/\/ws$/, "")}
              </T>
            </View>
            <Pill text={conn} tint={tint} />
          </View>
          {conn !== "online" && (
            <T style={st.note}>
              {conn === "connecting"
                ? "Connecting…"
                : "Can't reach this host. Check the address and that its daemon is running; Frogg keeps retrying."}
            </T>
          )}
          {m && conn === "online" && (
            <>
              <T v="mono" style={st.meta}>
                {m.platform}/{m.arch} · {m.cpu.cores} cores · up {uptime(m.uptimeSeconds)}
              </T>
              <Meter
                label="CPU"
                pct={m.cpu.usagePercent}
                detail={
                  m.cpu.loadAverage
                    ? `load ${m.cpu.loadAverage.map((l) => l.toFixed(2)).join(" ")}`
                    : undefined
                }
              />
              <Meter
                label="Memory"
                pct={(m.memory.usedBytes / m.memory.totalBytes) * 100}
                detail={`${gb(m.memory.usedBytes)} of ${gb(m.memory.totalBytes)}`}
              />
              {m.disk && (
                <Meter
                  label="Disk"
                  pct={(m.disk.usedBytes / m.disk.totalBytes) * 100}
                  detail={`${gb(m.disk.freeBytes)} free on ${m.disk.path}`}
                />
              )}
              <T v="mono" style={st.daemon}>
                daemon pid {m.daemon.pid} · {Math.round(m.daemon.rssBytes / 1024 ** 2)} MiB · up{" "}
                {uptime(m.daemon.uptimeSeconds)}
              </T>
            </>
          )}
        </Cut>
        <OtherHosts />
        <AddHost />
      </ScrollView>
    </View>
  );
}

function OtherHosts() {
  const { hosts, activeId } = useHosts();
  const others = hosts.filter((h) => h.id !== activeId);
  if (!others.length) return null;
  return (
    <>
      <GroupHead label="Saved" count={others.length} />
      {others.map((h) => (
        <HostRow key={h.id} h={h} />
      ))}
    </>
  );
}

function HostRow({ h }: { h: Host }) {
  const press = useCallback(() => void connect(h), [h]);
  const remove = useCallback(() => removeHost(h.id), [h.id]);
  return (
    <Pressable onPress={press}>
      {({ hovered }) => (
        <View style={[st.row, hovered && st.rowHover]}>
          <Server size={14} color={color.muted} />
          <View style={st.flex}>
            <T>{h.name}</T>
            <T v="mono" style={st.small}>
              {h.endpoint}
              {h.tls ? " · tls" : ""}
            </T>
          </View>
          {hovered && <T style={st.switch}>Switch</T>}
          <Pressable onPress={remove} accessibilityLabel={`Remove ${h.name}`} hitSlop={8}>
            <Trash2 size={13} color={color.faint} />
          </Pressable>
        </View>
      )}
    </Pressable>
  );
}

function AddHost() {
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);
  const toggleTls = useCallback(() => setTls((v) => !v), []);
  const save = useCallback(() => {
    const host: Omit<Host, "id"> = {
      endpoint: endpoint.trim(),
      name: name.trim() || endpoint.split(":")[0] || "host",
      tls,
      ...(password ? { password } : {}),
    };
    void connect(addHost(host));
    setOpen(false);
    setEndpoint("");
    setName("");
    setPassword("");
  }, [endpoint, name, password, tls]);
  if (!open)
    return (
      <View style={st.addWrap}>
        <Button label="Add a host" icon={Plus} onPress={show} />
      </View>
    );
  const valid = /^[\w.-]+:\d{2,5}$/.test(endpoint.trim());
  return (
    <Cut size={10} flip style={st.form}>
      <T style={st.strong}>Add a host</T>
      <TextInput
        value={endpoint}
        onChangeText={setEndpoint}
        placeholder="host:port  e.g. devbox.lan:6767"
        placeholderTextColor={color.faint}
        style={st.input}
        autoCapitalize="none"
      />
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Name (optional)"
        placeholderTextColor={color.faint}
        style={st.input}
      />
      <TextInput
        value={password}
        onChangeText={setPassword}
        placeholder="Password (if the daemon has one)"
        placeholderTextColor={color.faint}
        style={st.input}
        secureTextEntry
      />
      <Pressable onPress={toggleTls} style={st.check}>
        <View style={[st.box, tls && st.boxOn]} />
        <T style={st.checkLabel}>Use TLS (wss://)</T>
      </Pressable>
      <View style={st.actions}>
        <Button kind="primary" label="Connect" disabled={!valid} onPress={save} />
        <Button label="Cancel" onPress={hide} />
      </View>
    </Cut>
  );
}

const TINT: Partial<Record<string, string>> = {
  online: color.mint,
  connecting: color.amber,
};

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  scroll: { paddingBottom: 16 },
  card: {
    marginHorizontal: 12,
    backgroundColor: color.panel,
    padding: 14,
    gap: 12,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 10 },
  flex: { flex: 1 },
  strong: { fontWeight: "600" },
  small: { fontSize: 10.5 },
  note: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  meta: { fontSize: 11 },
  daemon: { fontSize: 10.5, color: color.faint },
  rowHover: { backgroundColor: color.wash },
  switch: { color: color.cyan2, fontSize: 12 },
  addWrap: { padding: 12, alignItems: "flex-start" },
  form: { margin: 12, padding: 14, gap: 10, backgroundColor: color.panel },
  check: { flexDirection: "row", alignItems: "center", gap: 8 },
  boxOn: { backgroundColor: color.cyan },
  checkLabel: { color: color.muted, fontSize: 12.5 },
  actions: { flexDirection: "row", gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  input: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    ...web({ outlineStyle: "none" }),
  },
  box: { width: 12, height: 12, borderWidth: 1, borderColor: color.line2 },
});
