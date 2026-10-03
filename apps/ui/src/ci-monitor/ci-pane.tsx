import { createContext, useCallback, useContext, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronDown,
  ChevronRight,
  ExternalLink,
  GitBranch,
  MessageSquarePlus,
  RotateCw,
} from "lucide-react-native";
import { useTranslation } from "react-i18next";
import {
  PaneContentToolbar,
  PaneToolbarAccessory,
  paneContentToolbarIconSize,
} from "@/components/ui/pane-content-toolbar";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Section,
  foregroundMutedColorMapping,
  sectionKitStyles,
} from "@/git/pull-request-panel/section-kit";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { openExternalUrl } from "@/utils/open-external-url";
import {
  CiProgressBar,
  CiProviderIcon,
  CiRunPercent,
  CiSegmentedBar,
  CiStatusGlyph,
} from "./ci-progress";
import {
  collectRunners,
  filterCiRunsByBranch,
  elapsedMs,
  formatCiDuration,
  formatRunStart,
  isCiActive,
  type CiJob,
  type CiRun,
} from "./model";
import { useCiNow, useCiRuns, type CiRunsState } from "./use-ci-runs";
import { useCiJobLogToChat, type CiJobLogToChat } from "./use-ci-job-log-to-chat";

/** How a job row attaches its log to the focused chat; null where that is not possible. */
const CiJobLogContext = createContext<CiJobLogToChat | null>(null);

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedGitBranch = withUnistyles(GitBranch);

/** The branch filter's icon when the filter is on; muted is "available", full is "applied". */
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedMessageSquarePlus = withUnistyles(MessageSquarePlus);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

/**
 * The CI tab: every run in the project from GitHub Actions and Jenkins, its jobs and the machines
 * they landed on. Built from the PR pane's section kit so it reads as the same product as the
 * checks list.
 *
 * The project, not the branch, is the default view: a run worth looking at is usually one
 * somebody else pushed, and a pane scoped to the checkout's own branch is empty exactly when CI
 * is busiest. The toolbar's branch toggle narrows it to the current branch on demand.
 */
export function CiPane({
  serverId,
  workspaceId,
  cwd,
  isOpen = true,
}: {
  serverId: string;
  /** Where "Add to chat" sends a job's log; without it the button is not offered. */
  workspaceId?: string | null;
  cwd: string;
  isOpen?: boolean;
}) {
  const jobLogToChat = useCiJobLogToChat({ serverId, workspaceId, cwd });
  const state = useCiRuns({ serverId, cwd, enabled: isOpen });
  // Off by default: the pane opens on the whole project.
  const [branchOnly, setBranchOnly] = useState(false);
  const toggleBranchOnly = useCallback(() => setBranchOnly((value) => !value), []);
  const runs = useMemo(
    () => filterCiRunsByBranch(state.runs, branchOnly ? state.branch : null),
    [state.runs, branchOnly, state.branch],
  );
  const now = useCiNow(runs.some((run) => isCiActive(run.status)));
  return (
    <CiJobLogContext.Provider value={jobLogToChat}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="ci-pane">
        <CiToolbar
          state={state}
          runs={runs}
          branchOnly={branchOnly}
          onToggleBranchOnly={toggleBranchOnly}
        />
        <CiPaneBody state={state} runs={runs} branchOnly={branchOnly} now={now} />
      </ScrollView>
    </CiJobLogContext.Provider>
  );
}

function CiToolbar({
  state,
  runs,
  branchOnly,
  onToggleBranchOnly,
}: {
  state: CiRunsState;
  runs: CiRun[];
  branchOnly: boolean;
  onToggleBranchOnly: () => void;
}) {
  const { t } = useTranslation();
  const branchFilterState = useMemo(() => ({ selected: branchOnly }), [branchOnly]);
  const running = runs.filter((run) => isCiActive(run.status)).length;
  let summary = state.branch ?? "";
  if (runs.length > 0) {
    summary = t("ciMonitor.runCount", { count: runs.length });
    if (running > 0) summary += ` · ${t("ciMonitor.runningCount", { count: running })}`;
  }
  return (
    <PaneContentToolbar style={styles.toolbar} testID="ci-pane-toolbar">
      <Text style={styles.toolbarText} numberOfLines={1}>
        {summary}
      </Text>
      <View style={styles.toolbarActions}>
        {state.supported && state.branch !== null ? (
          <Pressable
            accessibilityRole="button"
            accessibilityState={branchFilterState}
            accessibilityLabel={t(
              branchOnly ? "ciMonitor.showAllBranches" : "ciMonitor.showThisBranchOnly",
              { branch: state.branch },
            )}
            style={branchOnly ? activeIconButtonStyle : refreshButtonStyle}
            hitSlop={8}
            onPress={onToggleBranchOnly}
            testID="ci-pane-branch-filter"
          >
            <ThemedGitBranch
              size={paneContentToolbarIconSize(false)}
              uniProps={branchOnly ? foregroundColorMapping : foregroundMutedColorMapping}
            />
          </Pressable>
        ) : null}
        {state.supported ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("ciMonitor.refresh")}
            style={refreshButtonStyle}
            hitSlop={8}
            onPress={state.refetch}
            disabled={state.isFetching}
            testID="ci-pane-refresh"
          >
            {state.isFetching ? (
              <ThemedLoadingSpinner
                size={paneContentToolbarIconSize(false)}
                uniProps={foregroundMutedColorMapping}
              />
            ) : (
              <ThemedRotateCw
                size={paneContentToolbarIconSize(false)}
                uniProps={foregroundMutedColorMapping}
              />
            )}
          </Pressable>
        ) : null}
        <PaneToolbarAccessory />
      </View>
    </PaneContentToolbar>
  );
}

function CiPaneBody({
  state,
  runs,
  branchOnly,
  now,
}: {
  state: CiRunsState;
  runs: CiRun[];
  branchOnly: boolean;
  now: number;
}) {
  const { t } = useTranslation();
  const [runnersOpen, setRunnersOpen] = useState(true);
  const toggleRunners = useCallback(() => setRunnersOpen((open) => !open), []);
  const runnerSummary = useMemo(() => <RunnerSummary runs={runs} />, [runs]);
  // Idle hosted runners are not listed, so between runs there is often nothing to show.
  const hasRunners = useMemo(() => collectRunners(runs).length > 0, [runs]);

  if (!state.supported) {
    return (
      <EmptyState
        title={t("ciMonitor.unsupportedTitle")}
        description={t("ciMonitor.unsupportedDescription")}
      />
    );
  }
  if (state.isLoading) {
    return (
      <View style={styles.loading}>
        <ThemedLoadingSpinner size={ICON_SIZE.md} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }
  if (state.error) {
    return <EmptyState title={t("ciMonitor.errorTitle")} description={state.error} />;
  }
  if (state.providers.length === 0) {
    return (
      <EmptyState
        title={t("ciMonitor.notConfiguredTitle")}
        description={t("ciMonitor.notConfiguredDescription")}
      />
    );
  }

  return (
    <>
      {state.providerErrors.map((entry) => (
        <View key={entry.provider} style={styles.providerError} testID="ci-provider-error">
          <CiStatusGlyph status="failure" progress={null} size={ICON_SIZE.sm} />
          <Text style={styles.providerErrorText}>
            {t(`ciMonitor.provider.${entry.provider}`, { defaultValue: entry.provider })}:{" "}
            {entry.message}
          </Text>
        </View>
      ))}
      {runs.length === 0 ? (
        <EmptyState
          title={t("ciMonitor.emptyTitle")}
          description={
            branchOnly && state.branch !== null
              ? t("ciMonitor.emptyBranchDescription", { branch: state.branch })
              : t("ciMonitor.emptyDescription")
          }
        />
      ) : (
        <>
          {runs.map((run) => (
            <RunBlock key={run.id} run={run} now={now} />
          ))}
          {hasRunners ? <View style={styles.divider} /> : null}
          {hasRunners ? (
            <Section
              title={t("ciMonitor.runners")}
              open={runnersOpen}
              onToggle={toggleRunners}
              summary={runnerSummary}
            >
              <RunnerList runs={runs} />
            </Section>
          ) : null}
        </>
      )}
    </>
  );
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <View style={styles.empty} testID="ci-pane-empty">
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDescription}>{description}</Text>
    </View>
  );
}

function RunBlock({ run, now }: { run: CiRun; now: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(run.status !== "success");
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const openUrl = useCallback(() => void openExternalUrl(run.url), [run.url]);
  const providerLabel = t(`ciMonitor.provider.${run.provider}`);
  const elapsed = elapsedMs(run, now);
  // The provider is already the icon beside this line; its name only costs width the start time
  // needs, so it stays in the accessibility label.
  // Duration first: when the line runs out of room it is the trigger that truncates.
  const meta = [elapsed === null ? null : formatCiDuration(elapsed), run.branch, run.trigger]
    .filter(Boolean)
    .join(" · ");
  const started = run.startedAt === null ? null : formatRunStart(run.startedAt, now);
  return (
    <View style={styles.run} testID="ci-run">
      <Pressable onPress={toggle} style={runHeaderStyle} accessibilityRole="button">
        <CiStatusGlyph status={run.status} progress={run.progress} size={ICON_SIZE.lg} />
        <View style={styles.runText}>
          <Text style={styles.runTitle} numberOfLines={1}>
            {run.pipeline}
            {run.number !== null ? <Text style={styles.runNumber}> #{run.number}</Text> : null}
          </Text>
          <View
            style={styles.runMeta}
            accessibilityLabel={[providerLabel, meta, started].filter(Boolean).join(", ")}
          >
            <View style={styles.runMetaIcon}>
              <CiProviderIcon provider={run.provider} size={ICON_SIZE.xs} />
            </View>
            <Text style={styles.runMetaText} numberOfLines={1}>
              {meta}
            </Text>
            {started ? (
              <Text style={styles.runStarted} numberOfLines={1} testID="ci-run-started">
                {started}
              </Text>
            ) : null}
          </View>
        </View>
        <CiRunPercent run={run} />
        {run.url ? (
          <Pressable
            onPress={openUrl}
            hitSlop={6}
            accessibilityRole="link"
            accessibilityLabel={t("ciMonitor.openRun")}
            style={iconButtonStyle}
          >
            <ThemedExternalLink size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
          </Pressable>
        ) : null}
        {open ? (
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedChevronRight size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        )}
      </Pressable>
      {run.jobs.length > 0 ? (
        <View style={styles.runBar}>
          <CiSegmentedBar jobs={run.jobs} />
        </View>
      ) : null}
      {open ? run.jobs.map((job) => <JobRow key={job.id} job={job} now={now} />) : null}
    </View>
  );
}

function JobRow({ job, now }: { job: CiJob; now: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const hasSteps = job.steps.length > 0;
  const handlePress = useCallback(() => {
    // Nothing to expand into means the only useful thing to do is go to the job itself.
    if (hasSteps) setOpen((value) => !value);
    else void openExternalUrl(job.url);
  }, [hasSteps, job.url]);
  const openJobUrl = useCallback(() => void openExternalUrl(job.url), [job.url]);
  const elapsed = elapsedMs(job, now);
  let trailing = elapsed === null ? "" : formatCiDuration(elapsed);
  if (job.status === "queued") trailing = t("ciMonitor.status.queued");
  else if (job.status === "running" && job.progress !== null) {
    trailing = `${Math.round(job.progress * 100)}%`;
  }
  return (
    <View>
      <Pressable onPress={handlePress} style={jobRowStyle} testID="ci-job-row">
        <CiStatusGlyph status={job.status} progress={job.progress} size={ICON_SIZE.sm} />
        <Text style={sectionKitStyles.checkName} numberOfLines={1}>
          {job.name}
        </Text>
        <Text style={sectionKitStyles.checkWorkflow} numberOfLines={1}>
          {job.runner?.name ?? (job.status === "queued" ? t("ciMonitor.waitingForRunner") : "")}
        </Text>
        <View style={sectionKitStyles.checkTrailing}>
          <Text style={sectionKitStyles.checkDuration}>{trailing}</Text>
        </View>
      </Pressable>
      {job.status === "running" ? (
        <View style={styles.jobBar}>
          <CiProgressBar status={job.status} progress={job.progress} />
        </View>
      ) : null}
      {open ? (
        <View style={styles.steps}>
          {job.steps.map((step, index) => (
            // Step names repeat across a job (two "Run" steps), so position is part of identity.
            // oxlint-disable-next-line react/no-array-index-key
            <View key={`${index}:${step.name}`} style={styles.step}>
              <CiStatusGlyph status={step.status} progress={0} size={ICON_SIZE.xs} />
              <Text
                style={step.status === "queued" ? styles.stepTextPending : styles.stepText}
                numberOfLines={1}
              >
                {step.name}
              </Text>
            </View>
          ))}
          {job.url ? (
            <Pressable onPress={openJobUrl} style={styles.step}>
              <ThemedExternalLink size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
              <Text style={styles.stepLink}>{t("ciMonitor.openLogs")}</Text>
            </Pressable>
          ) : null}
          <AddJobLogToChat job={job} />
        </View>
      ) : null}
    </View>
  );
}

/**
 * Saves the job's log on the daemon and attaches it to the focused chat as a file,
 * so the agent reads it from disk rather than having it pasted into the prompt.
 */
function AddJobLogToChat({ job }: { job: CiJob }) {
  const { t } = useTranslation();
  const jobLogToChat = useContext(CiJobLogContext);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = useCallback(async () => {
    if (!jobLogToChat) return;
    setPending(true);
    setError(null);
    try {
      await jobLogToChat.add(job);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  }, [job, jobLogToChat]);
  const handlePress = useCallback(() => void add(), [add]);

  if (!jobLogToChat || !jobLogToChat.canAdd(job)) return null;
  return (
    <View>
      <Pressable
        onPress={handlePress}
        disabled={pending}
        style={styles.step}
        accessibilityRole="button"
        testID="ci-job-add-log-to-chat"
      >
        {pending ? (
          <ThemedLoadingSpinner size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedMessageSquarePlus size={ICON_SIZE.xs} uniProps={foregroundMutedColorMapping} />
        )}
        <Text style={styles.stepLink}>
          {pending ? t("ciMonitor.addingLogToChat") : t("ciMonitor.addLogToChat")}
        </Text>
      </Pressable>
      {error ? (
        <Text style={styles.stepError}>
          {t("ciMonitor.addLogToChatFailed", { message: error })}
        </Text>
      ) : null}
    </View>
  );
}

function RunnerSummary({ runs }: { runs: CiRun[] }) {
  const { t } = useTranslation();
  const runners = useMemo(() => collectRunners(runs), [runs]);
  const busy = runners.filter((use) => use.job).length;
  const queued = runs.flatMap((run) => run.jobs).filter((job) => job.status === "queued").length;
  return (
    <Text style={sectionKitStyles.checkDuration}>
      {t("ciMonitor.runnerSummary", { busy, total: runners.length })}
      {queued > 0 ? ` · ${t("ciMonitor.queuedCount", { count: queued })}` : ""}
    </Text>
  );
}

function RunnerList({ runs }: { runs: CiRun[] }) {
  const { t } = useTranslation();
  const runners = useMemo(() => collectRunners(runs), [runs]);
  if (runners.length === 0) {
    return <Text style={sectionKitStyles.emptyText}>{t("ciMonitor.noRunners")}</Text>;
  }
  return (
    <>
      {runners.map(({ runner, job }) => (
        <View key={job ? job.id : runner.name} style={styles.runnerRow} testID="ci-runner-row">
          <View style={job ? styles.runnerDotBusy : styles.runnerDotIdle} />
          <View style={styles.runnerText}>
            <Text style={sectionKitStyles.checkName} numberOfLines={1}>
              {runner.name}
            </Text>
            <Text style={sectionKitStyles.checkWorkflow} numberOfLines={1}>
              {[
                runner.hosted ? t("ciMonitor.hosted") : t("ciMonitor.selfHosted"),
                runner.hosted ? null : runner.labels.join(", "),
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          </View>
          <Text style={sectionKitStyles.checkDuration} numberOfLines={1}>
            {job ? job.name : t("ciMonitor.idle")}
          </Text>
        </View>
      ))}
    </>
  );
}

function refreshButtonStyle({ hovered }: { hovered?: boolean }) {
  return [styles.iconButton, Boolean(hovered) && styles.hover];
}

function activeIconButtonStyle({ hovered }: { hovered?: boolean }) {
  return [styles.iconButton, styles.iconButtonActive, Boolean(hovered) && styles.hover];
}
const iconButtonStyle = refreshButtonStyle;

function runHeaderStyle({ hovered }: { hovered?: boolean }) {
  return [styles.runHeader, Boolean(hovered) && styles.hover];
}

function jobRowStyle({ hovered }: { hovered?: boolean }) {
  return [sectionKitStyles.checkRow, Boolean(hovered) && styles.hover];
}

const RUNNER_DOT = { width: 6, height: 6, borderRadius: 3 } as const;

const styles = StyleSheet.create((theme) => ({
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
  },
  toolbarText: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  toolbarActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  iconButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  iconButtonActive: {
    backgroundColor: theme.colors.surface2,
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingBottom: theme.spacing[4],
  },
  loading: {
    padding: theme.spacing[6],
    alignItems: "center",
  },
  providerError: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  providerErrorText: {
    flex: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.statusDanger,
  },
  run: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
    paddingBottom: theme.spacing[2],
  },
  runHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  runText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[0.5],
  },
  runTitle: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
  runNumber: {
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foregroundMuted,
  },
  runMeta: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  runMetaIcon: {
    flexShrink: 0,
  },
  runStarted: {
    marginLeft: "auto",
    paddingLeft: theme.spacing[2],
    flexShrink: 0,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  runMetaText: {
    flexShrink: 1,
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  runBar: {
    paddingHorizontal: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  jobBar: {
    // Under the job name, not the glyph: the bar belongs to the text it measures.
    paddingLeft: theme.spacing[3] + ICON_SIZE.sm + theme.spacing[2],
    paddingRight: theme.spacing[3],
    marginTop: -theme.spacing[1],
    marginBottom: theme.spacing[1],
  },
  steps: {
    paddingLeft: theme.spacing[3] + ICON_SIZE.sm + theme.spacing[2],
    paddingRight: theme.spacing[3],
    paddingBottom: theme.spacing[1],
    gap: theme.spacing[1],
  },
  step: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  stepText: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foreground,
  },
  stepTextPending: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fontFamily.mono,
    color: theme.colors.foregroundMuted,
  },
  stepLink: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  stepError: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.destructive,
  },
  divider: {
    height: theme.spacing[1],
  },
  runnerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[1.5],
  },
  runnerText: {
    flex: 1,
    minWidth: 0,
  },
  runnerDotBusy: {
    ...RUNNER_DOT,
    backgroundColor: theme.colors.statusDotWarning,
  },
  runnerDotIdle: {
    ...RUNNER_DOT,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  hover: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    padding: 24,
  },
  emptyTitle: {
    color: theme.colors.foreground,
  },
  emptyDescription: {
    color: theme.colors.foregroundMuted,
    textAlign: "center",
  },
}));
