import { ExternalLink, GitPullRequest, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, View, type TextStyle } from "react-native";
import { getClient, useDaemon } from "../daemon/store";
import { color } from "../theme/tokens";
import { CiGlyph, CiProgress, JobRow, LogExcerpt, RunActions, RunRow, RunTally } from "./ci/CiRuns";
import {
  ciState,
  dur,
  isDone,
  openCiRun,
  runProgress,
  seconds,
  stateOf,
  useCi,
  useNow,
  type CiJob,
  type CiList,
  type CiRun,
} from "./ci/model";
import { BracketScope } from "./Brackets";
import { Cut } from "./Cut";
import { GroupHead, PanelHead } from "./PanelHead";
import { useActiveCwd } from "./ScmPanel";
import { Seg } from "./settings/controls";
import { PrMergeButton } from "./tools/PrMerge";
import { StreamList, useStreams } from "./tools/Streams";
import { Tabs } from "./tools/Tabs";
import { T } from "./Text";

type Client = NonNullable<ReturnType<typeof getClient>>;
type Pr = Awaited<ReturnType<Client["checkoutPrStatus"]>>;
type Check = NonNullable<Pr["status"]>["checks"][number];

export { stateOf };
export const useOpenRun = () => useCi((st) => st.open);
export const closeRun = () => openCiRun(null);

function Dot({ status }: { status: string }) {
  return <CiGlyph state={ciState(status)} />;
}

/** While anything is queued or running, the listing refreshes on this interval. */
const POLL_MS = 15_000;

const authHint: Record<string, string> = {
  unauthenticated: "Sign the host's gh CLI in to see pull requests.",
  cli_missing: "Install the GitHub CLI (gh) on this host to see pull requests.",
  no_remote: "This checkout has no forge remote.",
};

type Tab = "pr" | "ci" | "streams";

export function PrsPanel({ initialTab = "pr" }: { initialTab?: Tab }) {
  const cwd = useActiveCwd();
  const conn = useDaemon((st) => st.conn);
  const [tab, setTab] = useState<Tab>(initialTab);
  const [pr, setPr] = useState<Pr | null>(null);
  const ci = useCi((st) => st.list);
  const runs = useCi((st) => st.runs);
  const load = useCallback(() => {
    const client = getClient();
    if (!cwd || !client) return;
    client.checkoutPrStatus(cwd).then(setPr, () => {});
    const listRuns = async () => {
      const { runs: next, ...list } = await client.checkoutCiListRuns(cwd);
      useCi.setState({ runs: next as CiRun[], list });
    };
    listRuns().catch(() => {});
  }, [cwd]);
  useEffect(() => {
    if (conn === "online") load();
  }, [conn, load]);
  const active = runs.some((r) => !isDone(ciState(r.status)));
  useEffect(() => {
    if (!active || conn !== "online") return undefined;
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [active, conn, load]);
  const openRun = useOpenRun();
  const status = pr?.status;
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
        {tab === "ci" && <RunList list={ci} runs={runs} openRun={openRun} />}
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

type Scope = "branch" | "all";

function RunList({
  list,
  runs,
  openRun,
}: {
  list: Omit<CiList, "runs"> | null;
  runs: CiRun[];
  openRun: string | null;
}) {
  const branch = list?.branch ?? null;
  const [scope, setScope] = useState<Scope>("all");
  const scopes = useMemo<Array<[Scope, string]>>(
    () => [
      ["branch", branch ?? "This branch"],
      ["all", "All branches"],
    ],
    [branch],
  );
  const shown = useMemo(
    () => (scope === "branch" && branch ? runs.filter((r) => r.branch === branch) : runs),
    [scope, branch, runs],
  );
  // Rows present on first paint stay put; later arrivals rise in.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null && runs.length) seen.current = new Set(runs.map((r) => r.id));
  const firstLive = shown.find((r) => ciState(r.status) === "run")?.id;
  return (
    <>
      {list?.providerErrors.map((e) => (
        <T key={e.provider} v="mono" style={s.providerError}>
          {e.provider}: {e.message}
        </T>
      ))}
      {list && runs.length > 0 && (
        <>
          {branch && (
            <View style={s.scope}>
              <Seg options={scopes} value={scope} onChange={setScope} />
            </View>
          )}
          <RunTally runs={shown} />
        </>
      )}
      {shown.length === 0 && (
        <T style={[s.pad, s.muted]}>{list ? "No CI runs for this repository." : "loading…"}</T>
      )}
      <BracketScope>
        {shown.map((r) => (
          <RunRow
            key={r.id}
            run={r}
            selected={openRun === r.id}
            onOpen={openCiRun}
            defaultOpen={r.id === firstLive}
            fresh={!!seen.current && !seen.current.has(r.id)}
          />
        ))}
      </BracketScope>
    </>
  );
}

const FORGE: Record<string, string> = {
  githubActions: "GitHub Actions",
  gitlab: "GitLab CI",
  buildkite: "Buildkite",
  jenkins: "Jenkins",
};

function headline(run: CiRun, now: number): string {
  const st = ciState(run.status);
  const took = seconds(run.startedAt, run.completedAt, now);
  const failed = run.jobs.filter((j) => ciState(j.status) === "fail").map((j) => j.name);
  if (st === "fail")
    return `Failed${took !== null ? ` in ${dur(took)}` : ""}${failed.length ? ` on ${failed.join(", ")}` : ""}`;
  if (st === "ok") return `Passed${took !== null ? ` in ${dur(took)}` : ""}`;
  if (st === "cancel") return "Cancelled";
  if (st === "wait") return "Queued, waiting for a runner";
  const done = run.jobs.filter((j) => isDone(ciState(j.status))).length;
  return `Running · ${done} of ${run.jobs.length} jobs done`;
}

/** The run pane: header with actions, the job list, and the picked job's steps and log. */
export function CiRunDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const run = useCi((st) => st.runs.find((r) => r.id === id));
  const [pick, setPick] = useState<string | null>(null);
  const now = useNow(!!run && !run.completedAt);
  if (!run) return <View style={s.root} />;
  const st = ciState(run.status);
  const fallback =
    run.jobs.find((j) => ciState(j.status) === "fail") ??
    run.jobs.find((j) => ciState(j.status) === "run") ??
    run.jobs[0];
  const job = run.jobs.find((j) => j.id === pick) ?? fallback;
  return (
    <View style={s.root}>
      <View style={s.detailHead}>
        <View style={s.detailTitleBox}>
          <T v="label">
            ci run{run.number ? ` #${run.number}` : ""} · {FORGE[run.provider] ?? run.provider}
          </T>
          <View style={s.detailTitleRow}>
            {onBack && (
              <Pressable onPress={onBack} accessibilityLabel="Back">
                <T style={s.back}>←</T>
              </Pressable>
            )}
            <T v="display" style={s.detailTitle} numberOfLines={2}>
              {run.pipeline}
              {run.branch ? ` · ${run.branch}` : ""}
            </T>
          </View>
          <View style={s.detailMetaRow}>
            <CiGlyph state={st} />
            <T style={[s.detailMeta, st === "fail" && s.failText]}>{headline(run, now)}</T>
            <T v="mono" style={s.small} numberOfLines={1}>
              {[run.trigger, run.actor, run.sha?.slice(0, 7)].filter(Boolean).join(" · ")}
            </T>
          </View>
          {run.title && (
            <T style={s.muted} numberOfLines={1}>
              {run.title}
            </T>
          )}
          {!isDone(st) && (
            <View style={s.detailBar}>
              <CiProgress value={runProgress(run)} state={st} />
            </View>
          )}
        </View>
        <RunActions run={run} />
      </View>
      <ScrollView contentContainerStyle={s.grid}>
        <View style={s.jobCol}>
          <BracketScope>
            {run.jobs.map((j) => (
              <JobRow
                key={j.id}
                job={j}
                selected={job?.id === j.id}
                onPress={setPick}
                excerpt={false}
              />
            ))}
          </BracketScope>
        </View>
        {job && <JobPane job={job} />}
      </ScrollView>
    </View>
  );
}

function runnerText(job: CiJob): string {
  if (!job.runner) return "";
  return job.runner.hosted ? job.runner.name : `self-hosted · ${job.runner.name}`;
}

function JobPane({ job }: { job: CiJob }) {
  const steps = useMemo(
    () => job.steps.map((st, n) => ({ ...st, key: `${n}:${st.name}` })),
    [job.steps],
  );
  return (
    <Cut size={8} style={s.pane}>
      <View style={s.paneHead}>
        <T style={s.paneName}>{job.name}</T>
        <T v="mono" style={s.small}>
          {runnerText(job)}
        </T>
      </View>
      <View style={s.steps}>
        {steps.map((st) => (
          <View key={st.key} style={s.step}>
            <Dot status={st.status} />
            <T
              v="mono"
              style={[
                s.stepText,
                ciState(st.status) === "fail" && s.failText,
                ciState(st.status) === "run" && s.stepRun,
              ]}
            >
              {st.name}
            </T>
          </View>
        ))}
      </View>
      <LogExcerpt job={job} tall />
    </Cut>
  );
}

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
  scope: { paddingHorizontal: 12, paddingTop: 4 },
  failText: { color: color.coral },
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
  detailTitleBox: { flex: 1, minWidth: 260, gap: 6 },
  detailTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  detailTitle: { fontSize: 20, flexShrink: 1 },
  detailMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" },
  detailMeta: { fontSize: 12.5, color: color.muted },
  detailBar: { maxWidth: 420, flexDirection: "row" },
  back: { color: color.cyan2, fontSize: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 16, padding: 16, alignItems: "flex-start" },
  jobCol: { width: 280, flexGrow: 1, maxWidth: 420 },
  pane: { flexGrow: 3, flexBasis: 320, backgroundColor: color.panel, padding: 14, gap: 10 },
  paneHead: { flexDirection: "row", alignItems: "baseline", gap: 10 },
  paneName: { fontWeight: "600", flex: 1 },
  steps: { gap: 6 },
  step: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepText: { color: color.muted },
  stepRun: { color: color.cyan2 },
});
