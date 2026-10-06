import { Plus, Server, Trash2 } from "lucide-react-native";
import { useEffect, useState } from "react";
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

type Metrics = NonNullable<Awaited<ReturnType<NonNullable<ReturnType<typeof getClient>>["getHostMetrics"]>>["metrics"]>;

const gb = (n: number) => `${(n / 1024 ** 3).toFixed(1)} GiB`;
const uptime = (s: number) => (s > 86400 ? `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`);

export function HostsPanel() {
  const { conn, url, serverName } = useDaemon();
  const active = useHosts((s) => s.hosts.find((h) => h.id === s.activeId));
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    setM(null);
    if (conn !== "online") return;
    const tick = () => void getClient()?.getHostMetrics().then((r) => setM(r.metrics)).catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [conn, url]);
  const tint = conn === "online" ? color.mint : conn === "connecting" ? color.amber : color.coral;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Hosts" />
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <GroupHead label={conn === "online" ? "Connected" : "Active"} />
        <Cut size={10} flip style={{ marginHorizontal: 12, backgroundColor: color.panel, padding: 14, gap: 12 }}>
          <Brackets c={color.cyan2} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Server size={16} color={color.cyan2} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: "600" }}>{active?.name ?? serverName ?? "host"}</T>
              <T v="mono" numberOfLines={1} style={{ fontSize: 10.5 }}>{url.replace(/^ws:\/\//, "").replace(/\/ws$/, "")}</T>
            </View>
            <Pill text={conn} tint={tint} />
          </View>
          {conn !== "online" && (
            <T style={{ color: color.muted, fontSize: 12.5, lineHeight: 18 }}>
              {conn === "connecting" ? "Connecting…" : "Can't reach this host. Check the address and that its daemon is running; Frogg keeps retrying."}
            </T>
          )}
          {m && conn === "online" && (
            <>
              <T v="mono" style={{ fontSize: 11 }}>{m.platform}/{m.arch} · {m.cpu.cores} cores · up {uptime(m.uptimeSeconds)}</T>
              <Meter label="CPU" pct={m.cpu.usagePercent} detail={m.cpu.loadAverage ? `load ${m.cpu.loadAverage.map((l) => l.toFixed(2)).join(" ")}` : undefined} />
              <Meter label="Memory" pct={(m.memory.usedBytes / m.memory.totalBytes) * 100} detail={`${gb(m.memory.usedBytes)} of ${gb(m.memory.totalBytes)}`} />
              {m.disk && <Meter label="Disk" pct={(m.disk.usedBytes / m.disk.totalBytes) * 100} detail={`${gb(m.disk.freeBytes)} free on ${m.disk.path}`} />}
              <T v="mono" style={{ fontSize: 10.5, color: color.faint }}>
                daemon pid {m.daemon.pid} · {Math.round(m.daemon.rssBytes / 1024 ** 2)} MiB · up {uptime(m.daemon.uptimeSeconds)}
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
        <Pressable key={h.id} onPress={() => void connect(h)}>
          {({ hovered }) => (
            <View style={[st.row, hovered && { backgroundColor: color.wash }]}>
              <Server size={14} color={color.muted} />
              <View style={{ flex: 1 }}>
                <T>{h.name}</T>
                <T v="mono" style={{ fontSize: 10.5 }}>{h.endpoint}{h.tls ? " · tls" : ""}</T>
              </View>
              {hovered && <T style={{ color: color.cyan2, fontSize: 12 }}>Switch</T>}
              <Pressable onPress={() => removeHost(h.id)} accessibilityLabel={`Remove ${h.name}`} hitSlop={8}>
                <Trash2 size={13} color={color.faint} />
              </Pressable>
            </View>
          )}
        </Pressable>
      ))}
    </>
  );
}

function AddHost() {
  const [open, setOpen] = useState(false);
  const [endpoint, setEndpoint] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [tls, setTls] = useState(false);
  if (!open)
    return (
      <View style={{ padding: 12, alignItems: "flex-start" }}>
        <Button label="Add a host" icon={<Plus size={13} color={color.text} />} onPress={() => setOpen(true)} />
      </View>
    );
  const valid = /^[\w.-]+:\d{2,5}$/.test(endpoint.trim());
  const save = () => {
    const host: Omit<Host, "id"> = { endpoint: endpoint.trim(), name: name.trim() || endpoint.split(":")[0] || "host", tls, ...(password ? { password } : {}) };
    void connect(addHost(host));
    setOpen(false);
    setEndpoint("");
    setName("");
    setPassword("");
  };
  return (
    <Cut size={10} flip style={{ margin: 12, padding: 14, gap: 10, backgroundColor: color.panel }}>
      <T style={{ fontWeight: "600" }}>Add a host</T>
      <TextInput value={endpoint} onChangeText={setEndpoint} placeholder="host:port  e.g. devbox.lan:6767" placeholderTextColor={color.faint} style={st.input} autoCapitalize="none" />
      <TextInput value={name} onChangeText={setName} placeholder="Name (optional)" placeholderTextColor={color.faint} style={st.input} />
      <TextInput value={password} onChangeText={setPassword} placeholder="Password (if the daemon has one)" placeholderTextColor={color.faint} style={st.input} secureTextEntry />
      <Pressable onPress={() => setTls(!tls)} style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={[st.box, tls && { backgroundColor: color.cyan }]} />
        <T style={{ color: color.muted, fontSize: 12.5 }}>Use TLS (wss://)</T>
      </Pressable>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Button kind="primary" label="Connect" disabled={!valid} onPress={save} />
        <Button label="Cancel" onPress={() => setOpen(false)} />
      </View>
    </Cut>
  );
}

const st = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 8, paddingHorizontal: 10, paddingVertical: 9 },
  input: {
    paddingHorizontal: 10, paddingVertical: 8, backgroundColor: color.bg, borderWidth: 1, borderColor: color.line,
    color: color.text, fontFamily: font.mono, fontSize: 12.5, ...web({ outlineStyle: "none" }),
  },
  box: { width: 12, height: 12, borderWidth: 1, borderColor: color.line2 },
});
