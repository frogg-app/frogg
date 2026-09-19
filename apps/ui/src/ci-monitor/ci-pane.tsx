import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight, RotateCw } from "lucide-react-native";
import {
  PaneContentToolbar,
  PaneToolbarAccessory,
  paneContentToolbarIconSize,
} from "@/components/ui/pane-content-toolbar";
import { useTranslation } from "react-i18next";
import {
  Section,
  foregroundMutedColorMapping,
  sectionKitStyles,
} from "@/git/pull-request-panel/section-kit";
import { ICON_SIZE } from "@/styles/theme";
import {
  CiProgressBar,
  CiProviderIcon,
  CiRunPercent,
  CiSegmentedBar,
  CiStatusGlyph,
} from "./ci-progress";
import {
  formatCiDuration,
  useMockCiRuns,
  type CiJob,
  type CiRun,
  type CiRunner,
} from "./mock-runs";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedRotateCw = withUnistyles(RotateCw);

/**
 * DESIGN PROTOTYPE. The explorer's CI tab: every run for this workspace's branch, its jobs and
 * the machines they landed on. Built from the PR pane's section kit so it reads as the same
 * product as the checks list one tab over.
 */
export function CiPane({ workspaceId }: { workspaceId: string | null | undefined }) {
  const { t } = useTranslation();
  const runs = useMockCiRuns(workspaceId);
  const [runnersOpen, setRunnersOpen] = useState(true);
  const toggleRunners = useCallback(() => setRunnersOpen((open) => !open), []);
  const runnerSummary = useMemo(() => <RunnerSummary runs={runs} />, [runs]);

  const running = runs.filter((run) => run.status === "running").length;
  const toolbar = (
    <PaneContentToolbar style={styles.toolbar} testID="ci-pane-toolbar">
      <Text style={styles.toolbarText} numberOfLines={1}>
        {t("ciMonitor.runCount", { count: runs.length })}
        {running > 0 ? ` · ${t("ciMonitor.runningCount", { count: running })}` : ""}
      </Text>
      <View style={styles.toolbarActions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("ciMonitor.refresh")}
          style={refreshButtonStyle}
          hitSlop={8}
        >
          <ThemedRotateCw
            size={paneContentToolbarIconSize(false)}
            uniProps={foregroundMutedColorMapping}
          />
        </Pressable>
        <PaneToolbarAccessory />
      </View>
    </PaneContentToolbar>
  );

  if (runs.length === 0) {
    return (
      <View style={styles.root}>
        {toolbar}
        <View style={styles.empty} testID="ci-pane-empty">
          <Text style={styles.emptyTitle}>{t("ciMonitor.emptyTitle")}</Text>
          <Text style={styles.emptyDescription}>{t("ciMonitor.emptyDescription")}</Text>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} testID="ci-pane">
      {toolbar}
      {runs.map((run) => (
        <RunBlock key={run.id} run={run} />
      ))}
      <View style={styles.divider} />
      <Section
        title={t("ciMonitor.runners")}
        open={runnersOpen}
        onToggle={toggleRunners}
        summary={runnerSummary}
      >
        <RunnerList runs={runs} />
      </Section>
    </ScrollView>
  );
}

function RunBlock({ run }: { run: CiRun }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(run.status !== "success");
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const providerLabel = t(`ciMonitor.provider.${run.provider}`);
  return (
    <View style={styles.run} testID={`ci-run-${run.id}`}>
      <Pressable onPress={toggle} style={hoverable(styles.runHeader)} accessibilityRole="button">
        <CiStatusGlyph status={run.status} progress={run.progress} size={ICON_SIZE.lg} />
        <View style={styles.runText}>
          <Text style={styles.runTitle} numberOfLines={1}>
            {run.pipeline} <Text style={styles.runNumber}>#{run.number}</Text>
          </Text>
          <View style={styles.runMeta}>
            <CiProviderIcon provider={run.provider} size={ICON_SIZE.xs} />
            <Text style={styles.runMetaText} numberOfLines={1}>
              {providerLabel} · {run.trigger} · {formatCiDuration(run.elapsedMs)}
            </Text>
          </View>
        </View>
        <CiRunPercent run={run} />
        {open ? (
          <ThemedChevronDown size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        ) : (
          <ThemedChevronRight size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        )}
      </Pressable>
      <View style={styles.runBar}>
        <CiSegmentedBar jobs={run.jobs} />
      </View>
      {open ? run.jobs.map((job) => <JobRow key={job.id} job={job} />) : null}
    </View>
  );
}

function JobRow({ job }: { job: CiJob }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  let trailing = formatCiDuration(job.elapsedMs);
  if (job.status === "queued") trailing = t("ciMonitor.status.queued");
  else if (job.status === "running") trailing = `${Math.round(job.progress * 100)}%`;
  return (
    <View>
      <Pressable onPress={toggle} style={hoverable(sectionKitStyles.checkRow)} testID="ci-job-row">
        <CiStatusGlyph status={job.status} progress={job.progress} size={ICON_SIZE.sm} />
        <Text style={sectionKitStyles.checkName} numberOfLines={1}>
          {job.name}
        </Text>
        <Text style={sectionKitStyles.checkWorkflow} numberOfLines={1}>
          {job.runner?.name ?? t("ciMonitor.waitingForRunner")}
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
          {job.steps.map((step) => (
            <View key={step.name} style={styles.step}>
              <CiStatusGlyph status={step.status} progress={0} size={ICON_SIZE.xs} />
              <Text
                style={[styles.stepText, step.status === "queued" && styles.stepTextPending]}
                numberOfLines={1}
              >
                {step.name}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface RunnerUse {
  runner: CiRunner;
  job: CiJob | null;
}

function collectRunners(runs: CiRun[]): RunnerUse[] {
  const byName = new Map<string, RunnerUse>();
  for (const run of runs) {
    for (const job of run.jobs) {
      if (!job.runner) continue;
      const existing = byName.get(job.runner.name);
      if (job.status === "running") byName.set(job.runner.name, { runner: job.runner, job });
      else if (!existing) byName.set(job.runner.name, { runner: job.runner, job: null });
    }
  }
  return [...byName.values()];
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
          <View style={[styles.runnerDot, job ? styles.runnerDotBusy : styles.runnerDotIdle]} />
          <View style={styles.runnerText}>
            <Text style={sectionKitStyles.checkName} numberOfLines={1}>
              {runner.name}
            </Text>
            <Text style={sectionKitStyles.checkWorkflow} numberOfLines={1}>
              {runner.hosted ? t("ciMonitor.hosted") : t("ciMonitor.selfHosted")} ·{" "}
              {runner.labels.join(", ")}
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
  return [styles.refreshButton, Boolean(hovered) && styles.hover];
}

function hoverable(base: object) {
  return ({ hovered }: { hovered?: boolean }) => [base, Boolean(hovered) && styles.hover];
}

const styles = StyleSheet.create((theme) => ({
  root: {
    flex: 1,
  },
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
  refreshButton: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  scroll: {
    flex: 1,
  },
  content: {
    paddingBottom: theme.spacing[4],
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
  runnerDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  runnerDotBusy: {
    backgroundColor: theme.colors.statusDotWarning,
  },
  runnerDotIdle: {
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
