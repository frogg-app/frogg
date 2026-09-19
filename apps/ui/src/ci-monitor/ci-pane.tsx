import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, ExternalLink, RotateCw } from "lucide-react-native";
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
import { ICON_SIZE } from "@/styles/theme";
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
  elapsedMs,
  formatCiDuration,
  isCiActive,
  type CiJob,
  type CiRun,
} from "./model";
import { useCiNow, useCiRuns, type CiRunsState } from "./use-ci-runs";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedExternalLink = withUnistyles(ExternalLink);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);

/**
 * The CI tab: every run for this checkout's branch from GitHub Actions and Jenkins, its jobs and
 * the machines they landed on. Built from the PR pane's section kit so it reads as the same
 * product as the checks list.
 */
export function CiPane({
  serverId,
  cwd,
  isOpen = true,
}: {
  serverId: string;
  cwd: string;
  isOpen?: boolean;
}) {
  const state = useCiRuns({ serverId, cwd, enabled: isOpen });
  const now = useCiNow(state.runs.some((run) => isCiActive(run.status)));
  const body = <CiPaneBody state={state} now={now} />;
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="ci-pane">
      <CiToolbar state={state} />
      {body}
    </ScrollView>
  );
}

function CiToolbar({ state }: { state: CiRunsState }) {
  const { t } = useTranslation();
  const running = state.runs.filter((run) => isCiActive(run.status)).length;
  let summary = state.branch ?? "";
  if (state.runs.length > 0) {
    summary = t("ciMonitor.runCount", { count: state.runs.length });
    if (running > 0) summary += ` · ${t("ciMonitor.runningCount", { count: running })}`;
  }
  return (
    <PaneContentToolbar style={styles.toolbar} testID="ci-pane-toolbar">
      <Text style={styles.toolbarText} numberOfLines={1}>
        {summary}
      </Text>
      <View style={styles.toolbarActions}>
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

function CiPaneBody({ state, now }: { state: CiRunsState; now: number }) {
  const { t } = useTranslation();
  const [runnersOpen, setRunnersOpen] = useState(true);
  const toggleRunners = useCallback(() => setRunnersOpen((open) => !open), []);
  const runnerSummary = useMemo(() => <RunnerSummary runs={state.runs} />, [state.runs]);

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
  if (state.branch === null) {
    return (
      <EmptyState
        title={t("ciMonitor.noBranchTitle")}
        description={t("ciMonitor.noBranchDescription")}
      />
    );
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
      {state.runs.length === 0 ? (
        <EmptyState
          title={t("ciMonitor.emptyTitle")}
          description={t("ciMonitor.emptyDescription", { branch: state.branch })}
        />
      ) : (
        <>
          {state.runs.map((run) => (
            <RunBlock key={run.id} run={run} now={now} />
          ))}
          <View style={styles.divider} />
          <Section
            title={t("ciMonitor.runners")}
            open={runnersOpen}
            onToggle={toggleRunners}
            summary={runnerSummary}
          >
            <RunnerList runs={state.runs} />
          </Section>
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
  const meta = [providerLabel, run.trigger, elapsed === null ? null : formatCiDuration(elapsed)]
    .filter(Boolean)
    .join(" · ");
  return (
    <View style={styles.run} testID="ci-run">
      <Pressable onPress={toggle} style={runHeaderStyle} accessibilityRole="button">
        <CiStatusGlyph status={run.status} progress={run.progress} size={ICON_SIZE.lg} />
        <View style={styles.runText}>
          <Text style={styles.runTitle} numberOfLines={1}>
            {run.pipeline}
            {run.number !== null ? <Text style={styles.runNumber}> #{run.number}</Text> : null}
          </Text>
          <View style={styles.runMeta}>
            <CiProviderIcon provider={run.provider} size={ICON_SIZE.xs} />
            <Text style={styles.runMetaText} numberOfLines={1}>
              {meta}
            </Text>
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
        </View>
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
        <View key={runner.name} style={styles.runnerRow} testID="ci-runner-row">
          <View style={job ? styles.runnerDotBusy : styles.runnerDotIdle} />
          <View style={styles.runnerText}>
            <Text style={sectionKitStyles.checkName} numberOfLines={1}>
              {runner.name}
            </Text>
            <Text style={sectionKitStyles.checkWorkflow} numberOfLines={1}>
              {[
                runner.hosted ? t("ciMonitor.hosted") : t("ciMonitor.selfHosted"),
                runner.labels.join(", "),
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
