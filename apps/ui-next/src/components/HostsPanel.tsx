import { Plus, Server } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ScrollView, View } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
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
  const [m, setM] = useState<Metrics | null>(null);
  useEffect(() => {
    if (conn !== "online") return;
    const tick = () => void getClient()?.getHostMetrics().then((r) => setM(r.metrics)).catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => clearInterval(id);
  }, [conn]);
  const tint = conn === "online" ? color.mint : conn === "connecting" ? color.amber : color.coral;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Hosts" />
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        <GroupHead label="Connected" count={1} />
        <Cut size={10} flip style={{ marginHorizontal: 12, backgroundColor: color.panel, padding: 14, gap: 12 }}>
          <Brackets c={color.cyan2} />
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Server size={16} color={color.cyan2} />
            <View style={{ flex: 1 }}>
              <T style={{ fontWeight: "600" }}>{serverName ?? m?.hostname ?? "host"}</T>
              <T v="mono" numberOfLines={1} style={{ fontSize: 10.5 }}>{url.replace(/^ws:\/\//, "").replace(/\/ws$/, "")}</T>
            </View>
            <Pill text={conn} tint={tint} />
          </View>
          {m && (
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
        <View style={{ padding: 12, alignItems: "flex-start" }}>
          <Button label="Add a host" icon={<Plus size={13} color={color.text} />} />
        </View>
      </ScrollView>
    </View>
  );
}
