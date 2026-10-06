import { RefreshCw } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { agoText } from "../util";
import { Cut } from "./Cut";
import { Meter } from "./Meter";
import { PanelHead } from "./PanelHead";
import { Pill } from "./settings/controls";
import { T } from "./Text";

type Usage = Awaited<ReturnType<NonNullable<ReturnType<typeof getClient>>["listProviderUsage"]>>;

const until = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (m <= 0) return "resets now";
  return m < 60 ? `resets in ${m}m` : m < 2880 ? `resets in ${Math.round(m / 60)}h` : `resets in ${Math.round(m / 1440)}d`;
};

export function UsagePanel() {
  const conn = useDaemon((s) => s.conn);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = (maxAgeMs?: number) =>
    getClient()?.listProviderUsage({ maxAgeMs }).then(setUsage, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  useEffect(() => {
    if (conn === "online") void load();
  }, [conn]);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Usage">
        <Pressable onPress={() => void load(0)} accessibilityLabel="Refresh usage"><RefreshCw size={14} color={color.faint} /></Pressable>
      </PanelHead>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10 }}>
        {error && <T v="mono" style={{ color: color.coral }}>{error}</T>}
        {!usage && !error && <T v="label">loading…</T>}
        {usage?.providers.length === 0 && <T style={{ color: color.faint }}>No provider reports usage on this host.</T>}
        {usage?.providers.filter((p) => p.status !== "unavailable").map((p) => (
          <Cut key={p.providerId} size={10} flip style={{ backgroundColor: color.panel, padding: 14, gap: 12 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              <T style={{ flex: 1, fontWeight: "600" }}>{p.displayName}</T>
              {p.planLabel && <Pill text={p.planLabel} tint={color.violet} />}
            </View>
            {p.error && <T v="mono" style={{ color: color.coral, fontSize: 11 }}>{p.error}</T>}
            {p.windows.map((w) => (
              <Meter
                key={w.id}
                label={w.label}
                pct={w.usedPct ?? (w.remainingPct != null ? 100 - w.remainingPct : null)}
                detail={[until(w.resetsAt), w.runsOutAt ? `runs out ${agoText(w.runsOutAt).replace(" ago", "")}` : null].filter(Boolean).join(" · ") || undefined}
                tone={w.tone === "danger" ? color.coral : w.tone === "warning" ? color.amber : undefined}
              />
            ))}
            {p.balances?.map((b) => (
              <View key={b.id} style={{ flexDirection: "row" }}>
                <T style={{ flex: 1, fontSize: 12.5 }}>{b.label}</T>
                <T v="mono" style={{ color: color.text }}>{b.remaining ?? "—"}{b.limit != null ? ` / ${b.limit}` : ""}</T>
              </View>
            ))}
            <T v="mono" style={{ fontSize: 10.5, color: color.faint }}>{p.sourceLabel ?? p.status}{p.fetchedAt ? ` · ${agoText(p.fetchedAt)}` : ""}</T>
          </Cut>
        ))}
        {!!usage?.providers.some((p) => p.status === "unavailable") && (
          <T v="mono" style={{ fontSize: 11, color: color.faint, paddingHorizontal: 4, lineHeight: 17 }}>
            not set up: {usage.providers.filter((p) => p.status === "unavailable").map((p) => p.displayName).join(", ")}
          </T>
        )}
      </ScrollView>
    </View>
  );
}
