import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useScm, watchCheckout } from "../daemon/scm";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { providerLabel } from "../util";
import { Logo } from "./Logo";
import { stateOf } from "./PrsPanel";
import { useActiveCwd } from "./ScmPanel";
import { useBuckets } from "./SessionList";
import { T } from "./Text";

type Checks = { done: number; total: number; failed: number } | null;

/** Checks on the active checkout's PR, refreshed when the checkout changes. */
function useChecks(cwd: string | null): Checks {
  const conn = useDaemon((s) => s.conn);
  const [checks, setChecks] = useState<Checks>(null);
  useEffect(() => {
    setChecks(null);
    if (!cwd || conn !== "online") return;
    void getClient()?.checkoutPrStatus(cwd).then((r) => {
      const list = r.status?.checks ?? [];
      if (!list.length) return;
      const states = list.map((c) => stateOf(c.status));
      setChecks({ total: list.length, done: states.filter((s) => s === "ok" || s === "skip").length, failed: states.filter((s) => s === "fail").length });
    }, () => {});
  }, [cwd, conn]);
  return checks;
}

export function StatusBar() {
  const conn = useDaemon((s) => s.conn);
  const host = useDaemon((s) => s.serverName);
  const selected = useUi((s) => s.selected);
  const agent = useDaemon((s) => (selected ? s.sessions[selected]?.agent : undefined));
  const cwd = useActiveCwd();
  const { status, files } = useScm();
  const checks = useChecks(cwd);
  const b = useBuckets();
  useEffect(() => {
    if (cwd && conn === "online") void watchCheckout(cwd);
  }, [cwd, conn]);
  const git = status?.isGit ? status : null;
  const add = files?.reduce((n, f) => n + f.additions, 0) ?? 0;
  const del = files?.reduce((n, f) => n + f.deletions, 0) ?? 0;
  const dot = conn === "online" ? color.mint : conn === "connecting" ? color.amber : color.coral;
  const go = (tool: Parameters<ReturnType<typeof useUi.getState>["setTool"]>[0]) => () => useUi.getState().setTool(tool);
  return (
    <View style={s.bar}>
      <View style={[s.seg, s.brand]}>
        <Logo size={12} />
        <T style={{ fontSize: 12, fontWeight: "600", color: color.cyan2 }}>frogg</T>
      </View>
      <Pressable style={s.seg} onPress={go("hosts")}>
        <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: dot }} />
        <T style={s.t}>{host ?? conn}</T>
      </Pressable>
      {git && (
        <Pressable style={s.seg} onPress={go("scm")}>
          <T v="mono" style={s.t}>⎇ {git.currentBranch ?? "detached"}{git.aheadBehind?.ahead ? ` ↑${git.aheadBehind.ahead}` : ""}</T>
        </Pressable>
      )}
      {git && (add > 0 || del > 0) && (
        <Pressable style={s.seg} onPress={go("scm")}>
          <T v="mono" style={[s.t, { color: color.mint }]}>+{add}</T>
          <T v="mono" style={[s.t, { color: color.coral }]}>-{del}</T>
        </Pressable>
      )}
      {checks && (
        <Pressable style={s.seg} onPress={go("prs")}>
          <T style={[s.t, checks.failed ? { color: color.coral } : null]}>
            {checks.failed ? "■" : "▸"} checks {checks.done}/{checks.total}
          </T>
        </Pressable>
      )}
      <View style={{ flex: 1 }} />
      {b.needs.length > 0 && (
        <Pressable style={[s.seg, { backgroundColor: "rgba(245,184,74,0.14)" }]} onPress={go("inbox")}>
          <T style={[s.t, { color: color.amber }]}>◆ {b.needs.length} need you</T>
        </Pressable>
      )}
      <View style={s.seg}><T style={s.t}>▸ {b.working.length} running</T></View>
      {agent && (
        <View style={s.seg}>
          <T style={s.t}>{providerLabel(agent.provider)} · {agent.runtimeInfo?.model ?? agent.model ?? "default"}</T>
        </View>
      )}
      <Pressable style={s.seg} onPress={() => useUi.getState().setPalette(true)}>
        <T v="mono" style={s.t}>⌘K</T>
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  bar: { height: 26, flexDirection: "row", alignItems: "stretch", backgroundColor: color.bg, borderTopWidth: 1, borderTopColor: color.line, overflow: "hidden" },
  seg: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10 },
  brand: { backgroundColor: "rgba(37,181,200,0.12)" },
  t: { fontSize: 11.5, color: color.muted },
});
