import { ChevronDown, ChevronRight, RefreshCw, Settings as Gear } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ViewStyle } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import {
  accountName,
  groupReports,
  isStale,
  loadUsage,
  peakWindow,
  usedPct,
  useUsage,
  type AccountUsage,
  type ProviderUsage,
  type UsageGroup,
} from "../daemon/usage";
import { usePrefs } from "../prefs";
import { color, labelTint } from "../theme/tokens";
import { useUi } from "../ui-store";
import { agoText } from "../util";
import { Cut } from "./Cut";
import { Meter } from "./Meter";
import { PanelHead } from "./PanelHead";
import { Pill } from "./settings/controls";
import { T } from "./Text";

/** "resets in 3h" for a window's reset time, or null when it has none. */
export const until = (iso: string | null | undefined) => {
  if (!iso) return null;
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (m <= 0) return "resets now";
  if (m < 60) return `resets in ${m}m`;
  if (m < 2880) return `resets in ${Math.round(m / 60)}h`;
  return `resets in ${Math.round(m / 1440)}d`;
};

const SWATCH = [color.cyan, color.violet, color.mint, color.amber, color.coral];

/** Meter colour from the device's warning and critical thresholds. */
export function useToneFor(): (pct: number | null) => string {
  const warn = usePrefs((p) => p.warnPct);
  const crit = usePrefs((p) => p.criticalPct);
  return useCallback(
    (pct: number | null) => {
      if (pct === null) return color.faint;
      if (pct >= crit) return color.coral;
      if (pct >= warn) return color.amber;
      return color.cyan;
    },
    [crit, warn],
  );
}

/** An account's identity colour: its own preference, else a stable slot by position. */
export function accountTint(a: AccountUsage["account"], index: number): string {
  const own = a.preferences?.color;
  return (own && labelTint[own]) || SWATCH[index % SWATCH.length];
}

const swatchCache = new Map<string, ViewStyle>();
export function swatchStyle(tint: string): ViewStyle {
  let st = swatchCache.get(tint);
  if (!st) {
    st = StyleSheet.create({ s: { backgroundColor: tint } }).s;
    swatchCache.set(tint, st);
  }
  return st;
}

const openUsageSettings = () => {
  useUi.getState().setTool("settings");
  useUi.getState().openSettings("usage");
};
const openAccounts = () => {
  useUi.getState().setTool("settings");
  useUi.getState().openSettings("accounts");
};

export function UsagePanel() {
  const conn = useDaemon((s) => s.conn);
  const { groups, error, loading } = useUsage();
  const refresh = useCallback(() => void loadUsage(0), []);
  useEffect(() => {
    if (conn === "online" && getClient()) void loadUsage();
  }, [conn]);
  const shown = groups?.filter(groupReports) ?? [];
  const unset = groups?.filter((g) => !groupReports(g)) ?? [];
  return (
    <View style={st.fill}>
      <PanelHead title="Usage">
        <Pressable onPress={refresh} accessibilityLabel="Refresh usage" disabled={loading}>
          <RefreshCw size={14} color={loading ? color.cyan : color.faint} />
        </Pressable>
        <Pressable onPress={openUsageSettings} accessibilityLabel="Meter settings">
          <Gear size={14} color={color.faint} />
        </Pressable>
      </PanelHead>
      <ScrollView contentContainerStyle={st.content}>
        {error && (
          <T v="mono" style={st.error}>
            {error}
          </T>
        )}
        {!groups && !error && <T v="label">loading…</T>}
        {groups?.length === 0 && <T style={st.faint}>No provider reports usage on this host.</T>}
        {shown.map((g) => (
          <ProviderCard key={g.providerId} group={g} />
        ))}
        {unset.length > 0 && (
          <T v="mono" style={st.unset}>
            not set up: {unset.map((g) => g.displayName).join(", ")}
          </T>
        )}
      </ScrollView>
    </View>
  );
}

function ProviderCard({ group: g }: { group: UsageGroup }) {
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  if (g.accounts.length === 0) {
    return (
      <Cut size={10} flip style={st.card}>
        <View style={st.head}>
          <View style={st.headText}>
            <T style={st.name}>{g.displayName}</T>
            {g.usage.accountEmail ? (
              <T v="mono" style={st.email} numberOfLines={1}>
                {g.usage.accountEmail}
              </T>
            ) : null}
          </View>
          {g.usage.planLabel && <Pill text={g.usage.planLabel} tint={color.violet} />}
        </View>
        <Figures usage={g.usage} />
      </Cut>
    );
  }
  return (
    <Cut size={10} flip style={st.card}>
      <Pressable
        onPress={toggle}
        style={st.head}
        accessibilityRole="button"
        accessibilityLabel={`${open ? "Collapse" : "Expand"} ${g.displayName}`}
      >
        {open ? (
          <ChevronDown size={13} color={color.faint} />
        ) : (
          <ChevronRight size={13} color={color.faint} />
        )}
        <T style={st.name}>{g.displayName}</T>
        <T v="mono" style={st.count}>
          {g.accounts.length} accounts
        </T>
      </Pressable>
      {open ? (
        g.accounts.map((a, i) => (
          <AccountBlock key={a.account.id} entry={a} tint={accountTint(a.account, i)} />
        ))
      ) : (
        <Summary group={g} />
      )}
      {open ? (
        <Pressable onPress={openAccounts} accessibilityRole="link">
          <T v="mono" style={st.link}>
            Manage accounts
          </T>
        </Pressable>
      ) : null}
    </Cut>
  );
}

/** The collapsed card: one line per account with its fullest window. */
function Summary({ group }: { group: UsageGroup }) {
  const toneFor = useToneFor();
  const peak = peakWindow(group);
  return (
    <View style={st.summary}>
      {group.accounts.map((a, i) => (
        <SummaryRow key={a.account.id} entry={a} tint={accountTint(a.account, i)} />
      ))}
      {peak ? (
        <T v="mono" style={st.source}>
          highest <T style={toneText(toneFor(peak.pct))}>{Math.round(peak.pct)}%</T> · {peak.label}
          {peak.account ? ` · ${peak.account}` : ""}
        </T>
      ) : null}
    </View>
  );
}

function SummaryRow({ entry, tint }: { entry: AccountUsage; tint: string }) {
  const toneFor = useToneFor();
  const top = Math.max(-1, ...(entry.usage?.windows ?? []).map((w) => usedPct(w) ?? -1));
  const pct = top < 0 ? null : top;
  return (
    <View style={st.sumRow}>
      <View style={[st.sw, swatchStyle(tint)]} />
      <T style={st.sumName} numberOfLines={1}>
        {accountName(entry.account)}
      </T>
      {entry.account.isActive ? <Pill text="new sessions" tint={color.cyan} /> : null}
      <T v="mono" style={toneText(toneFor(pct))}>
        {pct === null ? stateWord(entry) : `${Math.round(pct)}%`}
      </T>
    </View>
  );
}

function stateWord(entry: AccountUsage): string {
  if (!entry.account.authenticated) return "signed out";
  if (entry.error || entry.usage?.status === "error") return "error";
  return "—";
}

const toneCache = new Map<string, object>();
function toneText(tint: string) {
  let s = toneCache.get(tint);
  if (!s) {
    s = StyleSheet.create({ t: { color: tint } }).t;
    toneCache.set(tint, s);
  }
  return s;
}

/** One sign-in inside a provider card: who it is, whether it is in use, and its windows. */
export function AccountBlock({ entry, tint }: { entry: AccountUsage; tint: string }) {
  const { account: a, usage } = entry;
  return (
    <View style={st.acct}>
      <View style={st.acctHead}>
        <View style={[st.sw, swatchStyle(tint)]} />
        <T style={st.acctName} numberOfLines={1}>
          {accountName(a)}
        </T>
        {a.isActive ? <Pill text="new sessions" tint={color.cyan} /> : null}
        <View style={st.grow} />
        {usage?.planLabel ? (
          <T v="mono" style={st.plan}>
            {usage.planLabel}
          </T>
        ) : null}
      </View>
      {usage?.accountEmail ? (
        <T v="mono" style={st.acctEmail} numberOfLines={1}>
          {usage.accountEmail}
        </T>
      ) : null}
      {a.authenticated ? null : (
        <View style={st.stateRow}>
          <Pill text="signed out" tint={color.coral} />
          <T style={st.hint}>Sign in from a terminal with this account selected.</T>
        </View>
      )}
      {entry.error ? (
        <T v="mono" style={st.pError}>
          {entry.error}
        </T>
      ) : null}
      {usage && a.authenticated ? <Figures usage={usage} quietUnavailable={false} /> : null}
    </View>
  );
}

/** Windows, balances and freshness for one usage read. */
function Figures({
  usage,
  quietUnavailable = true,
}: {
  usage: ProviderUsage;
  quietUnavailable?: boolean;
}) {
  const toneFor = useToneFor();
  const stale = isStale(usage.fetchedAt);
  return (
    <>
      {usage.error && (
        <T v="mono" style={st.pError}>
          {usage.error}
        </T>
      )}
      {!quietUnavailable && usage.status === "unavailable" && !usage.error ? (
        <T style={st.hint}>No usage reported for this sign-in.</T>
      ) : null}
      {usage.windows.map((w) => {
        const pct = usedPct(w);
        return (
          <Meter
            key={w.id}
            label={w.label}
            pct={pct}
            detail={
              [
                until(w.resetsAt),
                w.runsOutAt ? `runs out ${agoText(w.runsOutAt).replace(" ago", "")}` : null,
              ]
                .filter(Boolean)
                .join(" · ") || undefined
            }
            tone={toneFor(pct)}
          />
        );
      })}
      {usage.balances?.map((b) => (
        <View key={b.id} style={st.balance}>
          <T style={st.balanceLabel}>{b.label}</T>
          <T v="mono" style={st.balanceValue}>
            {b.remaining ?? "—"}
            {b.limit != null ? ` / ${b.limit}` : ""}
          </T>
        </View>
      ))}
      {usage.status === "unavailable" ? null : (
        <T v="mono" style={stale ? st.stale : st.source}>
          {stale ? "stale · " : ""}
          {usage.sourceLabel ?? usage.status}
          {usage.fetchedAt ? ` · ${agoText(usage.fetchedAt)}` : ""}
        </T>
      )}
    </>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  content: { padding: 12, gap: 10 },
  error: { color: color.coral },
  faint: { color: color.faint },
  card: { backgroundColor: color.panel, padding: 14, gap: 12 },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  headText: { flex: 1, gap: 2 },
  name: { flex: 1, fontWeight: "600" },
  email: { fontSize: 10.5, color: color.faint },
  count: { fontSize: 10.5, color: color.faint },
  acct: { gap: 10, paddingTop: 12, borderTopWidth: 1, borderTopColor: color.line },
  acctHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  sw: { width: 8, height: 8, transform: [{ rotate: "45deg" }] },
  acctName: { fontWeight: "500", flexShrink: 1 },
  grow: { flex: 1 },
  plan: { fontSize: 10.5, color: color.faint },
  acctEmail: { fontSize: 10.5, color: color.faint, marginTop: -6, paddingLeft: 16 },
  stateRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  hint: { fontSize: 12, color: color.faint, flexShrink: 1 },
  pError: { color: color.coral, fontSize: 11 },
  balance: { flexDirection: "row" },
  balanceLabel: { flex: 1, fontSize: 12.5 },
  balanceValue: { color: color.text },
  source: { fontSize: 10.5, color: color.faint },
  stale: { fontSize: 10.5, color: color.amber },
  link: { fontSize: 10.5, color: color.cyan },
  summary: { gap: 8 },
  sumRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  sumName: { flex: 1, fontSize: 12.5 },
  unset: {
    fontSize: 11,
    color: color.faint,
    paddingHorizontal: 4,
    lineHeight: 17,
  },
});
