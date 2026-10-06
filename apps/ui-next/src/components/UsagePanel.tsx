import { RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
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
  if (m < 60) return `resets in ${m}m`;
  if (m < 2880) return `resets in ${Math.round(m / 60)}h`;
  return `resets in ${Math.round(m / 1440)}d`;
};

type Window = Usage["providers"][number]["windows"][number];

function toneOf(tone: Window["tone"]): string | undefined {
  if (tone === "danger") return color.coral;
  if (tone === "warning") return color.amber;
  return undefined;
}

export function UsagePanel() {
  const conn = useDaemon((s) => s.conn);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(
    (maxAgeMs?: number) =>
      getClient()
        ?.listProviderUsage({ maxAgeMs })
        .then(setUsage, (e: unknown) => setError(e instanceof Error ? e.message : String(e))),
    [],
  );
  const refresh = useCallback(() => void load(0), [load]);
  useEffect(() => {
    if (conn === "online") void load();
  }, [conn, load]);
  return (
    <View style={st.fill}>
      <PanelHead title="Usage">
        <Pressable onPress={refresh} accessibilityLabel="Refresh usage">
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
      </PanelHead>
      <ScrollView contentContainerStyle={st.content}>
        {error && (
          <T v="mono" style={st.error}>
            {error}
          </T>
        )}
        {!usage && !error && <T v="label">loading…</T>}
        {usage?.providers.length === 0 && (
          <T style={st.faint}>No provider reports usage on this host.</T>
        )}
        {usage?.providers
          .filter((p) => p.status !== "unavailable")
          .map((p) => (
            <Cut key={p.providerId} size={10} flip style={st.card}>
              <View style={st.head}>
                <T style={st.name}>{p.displayName}</T>
                {p.planLabel && <Pill text={p.planLabel} tint={color.violet} />}
              </View>
              {p.error && (
                <T v="mono" style={st.pError}>
                  {p.error}
                </T>
              )}
              {p.windows.map((w) => (
                <Meter
                  key={w.id}
                  label={w.label}
                  pct={w.usedPct ?? (w.remainingPct != null ? 100 - w.remainingPct : null)}
                  detail={
                    [
                      until(w.resetsAt),
                      w.runsOutAt ? `runs out ${agoText(w.runsOutAt).replace(" ago", "")}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  tone={toneOf(w.tone)}
                />
              ))}
              {p.balances?.map((b) => (
                <View key={b.id} style={st.balance}>
                  <T style={st.balanceLabel}>{b.label}</T>
                  <T v="mono" style={st.balanceValue}>
                    {b.remaining ?? "—"}
                    {b.limit != null ? ` / ${b.limit}` : ""}
                  </T>
                </View>
              ))}
              <T v="mono" style={st.source}>
                {p.sourceLabel ?? p.status}
                {p.fetchedAt ? ` · ${agoText(p.fetchedAt)}` : ""}
              </T>
            </Cut>
          ))}
        {!!usage?.providers.some((p) => p.status === "unavailable") && (
          <T v="mono" style={st.unset}>
            not set up:{" "}
            {usage.providers
              .filter((p) => p.status === "unavailable")
              .map((p) => p.displayName)
              .join(", ")}
          </T>
        )}
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  content: { padding: 12, gap: 10 },
  error: { color: color.coral },
  faint: { color: color.faint },
  card: { backgroundColor: color.panel, padding: 14, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, fontWeight: "600" },
  pError: { color: color.coral, fontSize: 11 },
  balance: { flexDirection: "row" },
  balanceLabel: { flex: 1, fontSize: 12.5 },
  balanceValue: { color: color.text },
  source: { fontSize: 10.5, color: color.faint },
  unset: {
    fontSize: 11,
    color: color.faint,
    paddingHorizontal: 4,
    lineHeight: 17,
  },
});
