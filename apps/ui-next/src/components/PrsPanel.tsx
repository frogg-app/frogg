import { ExternalLink, GitPullRequest, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View, type TextStyle } from "react-native";
import { create } from "zustand";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { agoText } from "../util";
import { Cut } from "./Cut";
import { GroupHead, PanelHead } from "./PanelHead";
import { useActiveCwd } from "./ScmPanel";
import { Brackets } from "./SessionList";
import { PrMergeButton } from "./tools/PrMerge";
import { StreamList, useStreams } from "./tools/Streams";
import { Tabs } from "./tools/Tabs";
import { T } from "./Text";

type Client = NonNullable<ReturnType<typeof getClient>>;
type Pr = Awaited<ReturnType<Client["checkoutPrStatus"]>>;
type Ci = Awaited<ReturnType<Client["checkoutCiListRuns"]>>;
type Run = Ci["runs"][number];
type Job = Run["jobs"][number];
type Check = NonNullable<Pr["status"]>["checks"][number];
type State = "ok" | "fail" | "run" | "wait" | "skip";

/** Runs of the last listing, shared with the run detail pane. */
const useRuns = create<{ runs: Run[]; open: string | null }>(() => ({
  runs: [],
  open: null,
}));
export const useOpenRun = () => useRuns((st) => st.open);
export const closeRun = () => useRuns.setState({ open: null });

/** Collapses forge-specific check and run states onto the five the design has glyphs for. */
export function stateOf(status: string): State {
  const v = status.toLowerCase();
  if (/skip|neutral/.test(v)) return "skip";
  if (/success|pass|completed/.test(v)) return "ok";
  if (/fail|error|cancel|timed_out|action_required/.test(v)) return "fail";
  if (/progress|running|in_progress/.test(v)) return "run";
  return "wait";
}

function Dot({ status }: { status: string }) {
  return <View style={dots[stateOf(status)]} />;
}

const authHint: Record<string, string> = {
  unauthenticated: "Sign the host's gh CLI in to see pull requests.",
  cli_missing: "Install the GitHub CLI (gh) on this host to see pull requests.",
  no_remote: "This checkout has no forge remote.",
};

type Tab = "pr" | "ci" | "streams";

export function PrsPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((st) => st.conn);
  const [tab, setTab] = useState<Tab>("pr");
  const [pr, setPr] = useState<Pr | null>(null);
  const [ci, setCi] = useState<Ci | null>(null);
  const load = useCallback(() => {
    const client = getClient();
    if (!cwd || !client) return;
    client.checkoutPrStatus(cwd).then(setPr, () => {});
    const listRuns = async () => {
      const res = await client.checkoutCiListRuns(cwd);
      setCi(res);
      useRuns.setState({ runs: res.runs });
    };
    listRuns().catch(() => {});
  }, [cwd]);
  useEffect(() => {
    if (conn === "online") load();
  }, [conn, load]);
  const openRun = useOpenRun();
  const status = pr?.status;
  const runs = ci?.runs ?? [];
  const streams = useStreams(cwd, tab === "streams");
  const tabs = useMemo(
    () => [
      { id: "pr" as const, label: "Pull request", count: status ? 1 : null },
      { id: "ci" as const, label: "CI runs", count: ci ? runs.length : null },
      { id: "streams" as const, label: "Streams" },
    ],
    [status, runs.length, ci],
  );
  const refresh = useCallback(() => {
    load();
    if (tab === "streams") streams.load();
  }, [load, tab, streams]);
  return (
    <View style={s.root}>
      <PanelHead title="PRs & CI">
        <Pressable onPress={refresh} accessibilityLabel="Refresh">
          <RefreshCw size={14} color={color.faint} />
        </Pressable>
      </PanelHead>
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      <ScrollView contentContainerStyle={s.scroll}>
        {tab === "pr" && <PullRequest pr={pr} cwd={cwd} onChanged={load} />}
        {tab === "ci" && <RunList ci={ci} openRun={openRun} />}
        {tab === "streams" && <StreamList graph={streams.graph} error={streams.error} />}
      </ScrollView>
    </View>
  );
}

function PullRequest({
  pr,
  cwd,
  onChanged,
}: {
  pr: Pr | null;
  cwd: string | null;
  onChanged: () => void;
}) {
  const status = pr?.status;
  const openPr = useCallback(() => {
    if (status) void Linking.openURL(status.url);
  }, [status]);
  if (!pr)
    return (
      <T v="label" style={s.pad}>
        loading…
      </T>
    );
  if (!status)
    return (
      <View style={s.empty}>
        <GitPullRequest size={18} color={color.faint} />
        <T style={s.muted}>
          {authHint[String(pr.authState)] ??
            pr.error?.message ??
            "No pull request for this branch yet."}
        </T>
      </View>
    );
  let badge = status.state.toUpperCase();
  let badgeStyle: TextStyle = s.badgeOpen;
  if (status.isMerged) {
    badge = "MERGED";
    badgeStyle = s.badgeMerged;
  } else if (status.isDraft) {
    badge = "DRAFT";
    badgeStyle = s.badgeDraft;
  }
  return (
    <>
      <GroupHead label="This session" />
      <Cut size={10} flip style={s.prCard}>
        <View style={s.prHead}>
          <T v="mono" style={[s.badge, badgeStyle]}>
            {badge}
          </T>
          <T numberOfLines={2} style={s.prTitle}>
            {status.title}
          </T>
          <Pressable onPress={openPr} accessibilityLabel="Open pull request">
            <ExternalLink size={13} color={color.faint} />
          </Pressable>
        </View>
        <T v="mono" style={s.small}>
          {status.number ? `#${status.number} · ` : ""}
          {status.headRefName} → {status.baseRefName}
        </T>
        <T v="mono" style={s.small}>
          {reviewText(status.reviewDecision)}
          {status.github?.autoMergeRequest ? " · auto-merge on" : " · auto-merge off"}
        </T>
        {cwd && !status.isMerged && <PrMergeButton cwd={cwd} pr={status} onDone={onChanged} />}
      </Cut>
      <GroupHead label="Checks" count={status.checks.length} />
      {status.checks.map((c) => (
        <CheckRow key={`${c.workflow ?? ""}:${c.name}`} check={c} />
      ))}
    </>
  );
}

function reviewText(decision: string | null | undefined): string {
  if (decision === "APPROVED") return "approved";
  if (decision === "CHANGES_REQUESTED") return "changes requested";
  if (decision === "REVIEW_REQUIRED") return "review required";
  return "no review decision";
}

function CheckRow({ check }: { check: Check }) {
  return (
    <View style={s.check}>
      <Dot status={check.status} />
      <T numberOfLines={1} style={s.grow}>
        {check.name}
      </T>
      {check.duration && (
        <T v="mono" style={s.small}>
          {check.duration}
        </T>
      )}
    </View>
  );
}

function RunList({ ci, openRun }: { ci: Ci | null; openRun: string | null }) {
  const runs = ci?.runs ?? [];
  return (
    <>
      {ci?.providerErrors.map((e) => (
        <T key={e.provider} v="mono" style={s.providerError}>
          {e.provider}: {e.message}
        </T>
      ))}
      {runs.length === 0 && (
        <T style={[s.pad, s.muted]}>{ci ? "No CI runs for this repository." : "loading…"}</T>
      )}
      {runs.map((r) => (
        <RunRow key={r.id} run={r} on={openRun === r.id} />
      ))}
    </>
  );
}

function RunRow({ run, on }: { run: Run; on: boolean }) {
  const open = useCallback(() => useRuns.setState({ open: run.id }), [run.id]);
  return (
    <Pressable onPress={open}>
      {({ hovered }) => (
        <View style={[s.run, hovered && s.hover, on && s.runOn]}>
          {on && <Brackets />}
          <View style={s.runHead}>
            <Dot status={run.status} />
            <T numberOfLines={1} style={s.grow}>
              {run.pipeline}
              {run.number ? ` #${run.number}` : ""}
            </T>
            <T v="mono" style={s.tiny}>
              {agoText(run.startedAt)}
            </T>
          </View>
          <T v="mono" numberOfLines={1} style={s.runMeta}>
            {[run.branch, run.trigger, `${run.jobs.length} jobs`].filter(Boolean).join(" · ")}
          </T>
        </View>
      )}
    </Pressable>
  );
}

const duration = (a: string | null, b: string | null) => {
  if (!a) return "";
  const sec = Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 1000);
  if (sec <= 0) return "";
  return sec < 60 ? `${sec}s` : `${Math.floor(sec / 60)}m ${String(sec % 60).padStart(2, "0")}s`;
};

const ORDER: State[] = ["fail", "run", "wait", "ok", "skip"];
const FORGE: Record<string, string> = {
  githubActions: "GitHub Actions",
  gitlab: "GitLab CI",
  buildkite: "Buildkite",
};

export function CiRunDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const run = useRuns((st) => st.runs.find((r) => r.id === id));
  const [expanded, setExpanded] = useState<string | null>(null);
  const jobs = useMemo(
    () =>
      [...(run?.jobs ?? [])].sort(
        (a, b) => ORDER.indexOf(stateOf(a.status)) - ORDER.indexOf(stateOf(b.status)),
      ),
    [run],
  );
  const toggle = useCallback(
    (jobId: string) => setExpanded((cur) => (cur === jobId ? null : jobId)),
    [],
  );
  const openUrl = useCallback(() => {
    if (run?.url) void Linking.openURL(run.url);
  }, [run?.url]);
  if (!run) return <View style={s.root} />;
  const failed = run.jobs.filter((j) => stateOf(j.status) === "fail").length;
  return (
    <View style={s.root}>
      <View style={s.detailHead}>
        <View style={s.detailTitleBox}>
          <T v="label">
            ci run · {FORGE[run.provider] ?? run.provider} · {run.trigger ?? "run"}
          </T>
          <View style={s.detailTitleRow}>
            {onBack && (
              <Pressable onPress={onBack} accessibilityLabel="Back">
                <T style={s.back}>←</T>
              </Pressable>
            )}
            <Dot status={run.status} />
            <T v="display" style={s.detailTitle}>
              {run.pipeline}
              {run.number ? ` #${run.number}` : ""}
            </T>
          </View>
          <T v="mono" style={s.detailMeta}>
            {[
              run.branch,
              `${run.jobs.length} jobs`,
              failed ? `${failed} failed` : null,
              duration(run.startedAt, run.completedAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </T>
        </View>
        {run.url && (
          <Pressable onPress={openUrl} style={s.openOut}>
            <T style={s.muted}>
              Open on {run.provider === "githubActions" ? "GitHub" : run.provider}
            </T>
            <ExternalLink size={13} color={color.muted} />
          </Pressable>
        )}
      </View>
      <ScrollView contentContainerStyle={s.jobs}>
        {jobs.map((j) => (
          <JobCard key={j.id} job={j} open={expanded === j.id} onToggle={toggle} />
        ))}
      </ScrollView>
    </View>
  );
}

function JobCard({
  job,
  open,
  onToggle,
}: {
  job: Job;
  open: boolean;
  onToggle: (id: string) => void;
}) {
  const press = useCallback(() => onToggle(job.id), [job.id, onToggle]);
  const steps = useMemo(
    () => job.steps.map((st, n) => ({ ...st, key: `${n}:${st.name}` })),
    [job.steps],
  );
  const skipped = stateOf(job.status) === "skip";
  return (
    <Cut size={8} style={s.job}>
      <Pressable onPress={press}>
        <View style={s.jobHead}>
          <Dot status={job.status} />
          <T numberOfLines={1} style={[s.jobName, skipped && s.faint]}>
            {job.name}
          </T>
          {job.runner && (
            <T v="mono" style={s.tiny}>
              {job.runner.hosted ? "hosted" : job.runner.name}
            </T>
          )}
          <T v="mono" style={s.jobTime}>
            {duration(job.startedAt, job.completedAt)}
          </T>
        </View>
      </Pressable>
      {open && (
        <View style={s.steps}>
          {steps.map((st) => (
            <View key={st.key} style={s.step}>
              <Dot status={st.status} />
              <T v="mono" style={stateOf(st.status) === "fail" ? s.stepFail : s.stepText}>
                {st.name}
              </T>
            </View>
          ))}
        </View>
      )}
    </Cut>
  );
}

const dots = StyleSheet.create({
  ok: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: color.mint,
    borderWidth: 1,
    borderColor: color.mint,
  },
  wait: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: color.faint,
  },
  skip: { width: 8, height: 1.5, backgroundColor: color.faint },
  fail: { width: 8, height: 8, backgroundColor: color.coral },
  run: {
    width: 0,
    height: 0,
    borderTopWidth: 4,
    borderBottomWidth: 4,
    borderLeftWidth: 8,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: color.cyan,
  },
});

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  tabs: { paddingHorizontal: 12, paddingBottom: 6 },
  scroll: { paddingBottom: 16 },
  pad: { padding: 16 },
  muted: { color: color.muted },
  faint: { color: color.faint },
  grow: { flex: 1 },
  small: { fontSize: 11 },
  tiny: { fontSize: 10.5 },
  hover: { backgroundColor: color.wash },
  empty: { padding: 16, gap: 8 },
  prCard: {
    marginHorizontal: 12,
    padding: 14,
    backgroundColor: color.panel,
    gap: 8,
  },
  prHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  prTitle: { flex: 1, fontWeight: "600" },
  badge: {
    fontSize: 10,
    paddingHorizontal: 5,
    borderWidth: 1,
    borderColor: color.line2,
  },
  badgeOpen: { color: color.mint },
  badgeDraft: { color: color.muted },
  badgeMerged: { color: color.violet },
  check: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 7,
  },
  providerError: {
    color: color.coral,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  run: {
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  runOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  runHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  runMeta: { marginLeft: 16, marginTop: 3, fontSize: 11 },
  detailHead: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  detailTitleBox: { flex: 1, minWidth: 220 },
  detailTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  detailTitle: { fontSize: 20 },
  detailMeta: { marginTop: 6 },
  back: { color: color.cyan2, fontSize: 18 },
  openOut: { flexDirection: "row", gap: 6, alignItems: "center" },
  jobs: { padding: 24, gap: 8, maxWidth: 900 },
  job: { backgroundColor: color.panel },
  jobHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  jobName: { flex: 1, fontWeight: "500", color: color.text },
  jobTime: { width: 64, textAlign: "right" },
  steps: { paddingHorizontal: 12, paddingBottom: 12, paddingLeft: 30, gap: 5 },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepText: { color: color.muted },
  stepFail: { color: color.coral },
});
