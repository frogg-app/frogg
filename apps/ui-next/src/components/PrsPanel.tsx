import { ExternalLink, GitPullRequest, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { create } from "zustand";
import { Linking, Pressable, ScrollView, View } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { agoText } from "../util";
import { Cut } from "./Cut";
import { GroupHead, PanelHead } from "./PanelHead";
import { useActiveCwd } from "./ScmPanel";
import { Brackets } from "./SessionList";
import { Seg } from "./settings/controls";
import { T } from "./Text";

type Client = NonNullable<ReturnType<typeof getClient>>;
type Pr = Awaited<ReturnType<Client["checkoutPrStatus"]>>;
type Ci = Awaited<ReturnType<Client["checkoutCiListRuns"]>>;
type Run = Ci["runs"][number];

/** Runs of the last listing, shared with the run detail pane. */
const useRuns = create<{ runs: Run[]; open: string | null }>(() => ({ runs: [], open: null }));
export const useOpenRun = () => useRuns((s) => s.open);
export const closeRun = () => useRuns.setState({ open: null });

/** Collapses forge-specific check and run states onto the four the design has glyphs for. */
export function stateOf(status: string): "ok" | "fail" | "run" | "wait" | "skip" {
  const s = status.toLowerCase();
  if (/skip|neutral/.test(s)) return "skip";
  if (/success|pass|completed/.test(s)) return "ok";
  if (/fail|error|cancel|timed_out|action_required/.test(s)) return "fail";
  if (/progress|running|in_progress/.test(s)) return "run";
  return "wait";
}

function Dot({ status }: { status: string }) {
  const st = stateOf(status);
  const c = { ok: color.mint, fail: color.coral, run: color.cyan, wait: color.faint, skip: color.faint }[st];
  if (st === "skip") return <View style={{ width: 8, height: 1.5, backgroundColor: c }} />;
  if (st === "fail") return <View style={{ width: 8, height: 8, backgroundColor: c }} />;
  if (st === "run")
    return <View style={{ width: 0, height: 0, borderTopWidth: 4, borderBottomWidth: 4, borderLeftWidth: 8, borderTopColor: "transparent", borderBottomColor: "transparent", borderLeftColor: c }} />;
  return <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: st === "ok" ? c : "transparent", borderWidth: 1, borderColor: c }} />;
}

const authHint: Record<string, string> = {
  unauthenticated: "Sign the host's gh CLI in to see pull requests.",
  cli_missing: "Install the GitHub CLI (gh) on this host to see pull requests.",
  no_remote: "This checkout has no forge remote.",
};

export function PrsPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((s) => s.conn);
  const [tab, setTab] = useState<"pr" | "ci">("pr");
  const [pr, setPr] = useState<Pr | null>(null);
  const [ci, setCi] = useState<Ci | null>(null);
  const load = useCallback(() => {
    const client = getClient();
    if (!cwd || !client) return;
    void client.checkoutPrStatus(cwd).then(setPr).catch(() => {});
    void client
      .checkoutCiListRuns(cwd)
      .then((res) => {
        setCi(res);
        useRuns.setState({ runs: res.runs });
      })
      .catch(() => {});
  }, [cwd]);
  useEffect(() => {
    if (conn === "online") load();
  }, [conn, load]);
  const openRun = useOpenRun();
  const status = pr?.status;
  const checks = status?.checks ?? [];
  const runs = ci?.runs ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="PRs & CI">
        <Pressable onPress={load} accessibilityLabel="Refresh"><RefreshCw size={14} color={color.faint} /></Pressable>
      </PanelHead>
      <View style={{ paddingHorizontal: 12, paddingBottom: 6 }}>
        <Seg options={[["pr", `Pull request${status ? " 1" : ""}`], ["ci", `CI runs ${runs.length}`]]} value={tab} onChange={setTab} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: 16 }}>
        {tab === "pr" && !pr && <T v="label" style={{ padding: 16 }}>loading…</T>}
        {tab === "pr" && pr && !status && (
          <View style={{ padding: 16, gap: 8 }}>
            <GitPullRequest size={18} color={color.faint} />
            <T style={{ color: color.muted }}>
              {authHint[String(pr.authState)] ?? pr.error?.message ?? "No pull request for this branch yet."}
            </T>
          </View>
        )}
        {tab === "pr" && status && (
          <>
            <GroupHead label="This session" />
            <Cut size={10} flip style={{ marginHorizontal: 12, padding: 14, backgroundColor: color.panel, gap: 8 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <T v="mono" style={{ fontSize: 10, paddingHorizontal: 5, color: status.isMerged ? color.violet : status.isDraft ? color.muted : color.mint, borderWidth: 1, borderColor: color.line2 }}>
                  {status.isMerged ? "MERGED" : status.isDraft ? "DRAFT" : status.state.toUpperCase()}
                </T>
                <T numberOfLines={2} style={{ flex: 1, fontWeight: "600" }}>{status.title}</T>
                <Pressable onPress={() => void Linking.openURL(status.url)}><ExternalLink size={13} color={color.faint} /></Pressable>
              </View>
              <T v="mono" style={{ fontSize: 11 }}>
                {status.number ? `#${status.number} · ` : ""}{status.headRefName} → {status.baseRefName}
              </T>
            </Cut>
            <GroupHead label="Checks" count={checks.length} />
            {checks.map((c) => (
              <View key={`${c.workflow ?? ""}${c.name}`} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 16, paddingVertical: 7 }}>
                <Dot status={c.status} />
                <T numberOfLines={1} style={{ flex: 1 }}>{c.name}</T>
                {c.duration && <T v="mono" style={{ fontSize: 11 }}>{c.duration}</T>}
              </View>
            ))}
          </>
        )}
        {tab === "ci" && (
          <>
            {ci?.providerErrors.map((e) => (
              <T key={e.provider} v="mono" style={{ color: color.coral, paddingHorizontal: 16, paddingVertical: 4 }}>{e.provider}: {e.message}</T>
            ))}
            {runs.length === 0 && <T style={{ padding: 16, color: color.muted }}>{ci ? "No CI runs for this repository." : "loading…"}</T>}
            {runs.map((r) => (
              <Pressable key={r.id} onPress={() => useRuns.setState({ open: r.id })}>
                {({ hovered }) => (
                  <View style={[{ marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: color.line }, hovered && { backgroundColor: color.wash }, openRun === r.id && { backgroundColor: "rgba(127,217,230,0.05)" }]}>
                    {openRun === r.id && <Brackets />}
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Dot status={r.status} />
                      <T numberOfLines={1} style={{ flex: 1 }}>{r.pipeline}{r.number ? ` #${r.number}` : ""}</T>
                      <T v="mono" style={{ fontSize: 10.5 }}>{agoText(r.startedAt)}</T>
                    </View>
                    <T v="mono" numberOfLines={1} style={{ marginLeft: 16, marginTop: 3, fontSize: 11 }}>
                      {[r.branch, r.trigger, `${r.jobs.length} jobs`].filter(Boolean).join(" · ")}
                    </T>
                  </View>
                )}
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const duration = (a: string | null, b: string | null) => {
  if (!a) return "";
  const sec = Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000);
  if (sec <= 0) return "";
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
};

const ORDER = ["fail", "run", "wait", "ok", "skip"];
const forge = (p: string) => ({ githubActions: "GitHub Actions", gitlab: "GitLab CI", buildkite: "Buildkite" })[p] ?? p;

export function CiRunDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const run = useRuns((s) => s.runs.find((r) => r.id === id));
  const [expanded, setExpanded] = useState<string | null>(null);
  if (!run) return <View style={{ flex: 1, backgroundColor: color.bg2 }} />;
  const failed = run.jobs.filter((j) => stateOf(j.status) === "fail").length;
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 12, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: color.line }}>
        <View style={{ flex: 1, minWidth: 220 }}>
          <T v="label">ci run · {forge(run.provider)} · {run.trigger ?? "run"}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
            {onBack && <Pressable onPress={onBack}><T style={{ color: color.cyan2, fontSize: 18 }}>←</T></Pressable>}
            <Dot status={run.status} />
            <T v="display" style={{ fontSize: 20 }}>{run.pipeline}{run.number ? ` #${run.number}` : ""}</T>
          </View>
          <T v="mono" style={{ marginTop: 6 }}>
            {[run.branch, `${run.jobs.length} jobs`, failed ? `${failed} failed` : null, duration(run.startedAt, run.completedAt)].filter(Boolean).join(" · ")}
          </T>
        </View>
        {run.url && (
          <Pressable onPress={() => void Linking.openURL(run.url!)} style={{ flexDirection: "row", gap: 6, alignItems: "center" }}>
            <T style={{ color: color.muted }}>Open on {run.provider === "githubActions" ? "GitHub" : run.provider}</T>
            <ExternalLink size={13} color={color.muted} />
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={{ padding: 24, gap: 8, maxWidth: 900 }}>
        {[...run.jobs].sort((a, b) => ORDER.indexOf(stateOf(a.status)) - ORDER.indexOf(stateOf(b.status))).map((j) => {
          const open = expanded === j.id;
          return (
            <Cut key={j.id} size={8} style={{ backgroundColor: color.panel }}>
              <Pressable onPress={() => setExpanded(open ? null : j.id)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, padding: 12 }}>
                  <Dot status={j.status} />
                  <T numberOfLines={1} style={{ flex: 1, fontWeight: "500", color: stateOf(j.status) === "skip" ? color.faint : color.text }}>{j.name}</T>
                  {j.runner && <T v="mono" style={{ fontSize: 10.5 }}>{j.runner.hosted ? "hosted" : j.runner.name}</T>}
                  <T v="mono" style={{ width: 64, textAlign: "right" }}>{duration(j.startedAt, j.completedAt)}</T>
                </View>
              </Pressable>
              {open && (
                <View style={{ paddingHorizontal: 12, paddingBottom: 12, paddingLeft: 30, gap: 5 }}>
                  {j.steps.map((st, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Dot status={st.status} />
                      <T v="mono" style={{ color: stateOf(st.status) === "fail" ? color.coral : color.muted }}>{st.name}</T>
                    </View>
                  ))}
                </View>
              )}
            </Cut>
          );
        })}
      </ScrollView>
    </View>
  );
}
