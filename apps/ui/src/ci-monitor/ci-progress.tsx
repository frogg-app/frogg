import { useMemo } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CheckIndicator } from "@/components/sidebar/workspace-meta-row/check-indicator";
import type { CheckSummary } from "@/components/sidebar/workspace-meta-row/check-summary";
import { GitHubIcon } from "@/components/icons/github-icon";
import { withUnistyles } from "react-native-unistyles";
import { Hammer } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import type { CiJob, CiProvider, CiRun, CiStatus } from "./mock-runs";

const ThemedGitHubIcon = withUnistyles(GitHubIcon);
const ThemedHammer = withUnistyles(Hammer);
const mutedColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The same circle the sidebar and PR pane already use for CI: check, cross, or a pie that
 * fills while the work runs. Queued is an empty pie — the circle is there, nothing has moved.
 */
export function CiStatusGlyph({
  status,
  progress,
  size,
}: {
  status: CiStatus;
  progress: number;
  size: number;
}) {
  const completed = Math.round(progress * 100);
  const summary = useMemo(() => toCheckSummary(status, completed), [status, completed]);
  return <CheckIndicator summary={summary} size={size} />;
}

function toCheckSummary(status: CiStatus, completedPercent: number): CheckSummary {
  if (status === "success") return { state: "passed", completed: 1, total: 1 };
  if (status === "failure") return { state: "failed", completed: 1, total: 1 };
  return { state: "running", completed: completedPercent, total: 100 };
}

export function CiProviderIcon({ provider, size }: { provider: CiProvider; size: number }) {
  return provider === "githubActions" ? (
    <ThemedGitHubIcon size={size} uniProps={mutedColor} />
  ) : (
    <ThemedHammer size={size} uniProps={mutedColor} />
  );
}

/**
 * A hairline track with the status color filling it. Colour is the status token and nothing
 * else, so a bar under a row reads exactly as the check glyph beside the PR number does.
 */
export function CiProgressBar({
  status,
  progress,
  height = 2,
  testID,
}: {
  status: CiStatus;
  progress: number;
  height?: number;
  testID?: string;
}) {
  const width = `${Math.round((status === "queued" ? 0 : progress) * 100)}%` as const;
  return (
    <View style={[styles.track, { height, borderRadius: height }]} testID={testID}>
      <View style={[styles.fill, fillStyles[status], { width, borderRadius: height }]} />
    </View>
  );
}

/** One bar per job, side by side, so a run shows where it is stuck rather than an average. */
export function CiSegmentedBar({ jobs, height = 3 }: { jobs: CiJob[]; height?: number }) {
  return (
    <View style={styles.segments}>
      {jobs.map((job) => (
        <View key={job.id} style={styles.segment}>
          <CiProgressBar status={job.status} progress={job.progress} height={height} />
        </View>
      ))}
    </View>
  );
}

export function CiRunPercent({ run }: { run: CiRun }) {
  if (run.status !== "running") return null;
  return <Text style={styles.percent}>{Math.round(run.progress * 100)}%</Text>;
}

const styles = StyleSheet.create((theme) => ({
  track: {
    width: "100%",
    overflow: "hidden",
    backgroundColor: theme.colors.surface2,
  },
  fill: {
    height: "100%",
  },
  segments: {
    flexDirection: "row",
    gap: 2,
  },
  segment: {
    flex: 1,
  },
  percent: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
}));

const fillStyles = StyleSheet.create((theme) => ({
  queued: { backgroundColor: theme.colors.foregroundMuted },
  running: { backgroundColor: theme.colors.statusWarning },
  success: { backgroundColor: theme.colors.statusSuccess },
  failure: { backgroundColor: theme.colors.statusDanger },
}));
