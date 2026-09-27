import type { ReactNode } from "react";
import { Text, View, type TextProps } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";

// Small shared pieces of the Mono layouts: the status dot and label, mono metadata text and
// the diff stat. Mono runs only while the Mono direction is active, so these read colours and
// fonts straight from the theme (CSS variables on web).

// preview copy — Vercel's deployment states, mapped onto agent state buckets.
export const MONO_STATUS_LABEL: Record<SidebarStateBucket, string> = {
  running: "Running",
  needs_input: "Needs input",
  failed: "Error",
  attention: "Ready",
  done: "Idle",
};

export const MONO_STATUS_ORDER: readonly SidebarStateBucket[] = [
  "running",
  "needs_input",
  "failed",
  "attention",
  "done",
];

export function StatusDot({ bucket, size = "sm" }: { bucket: SidebarStateBucket; size?: "sm" | "lg" }) {
  styles.useVariants({ bucket, size });
  return <View style={styles.dot} />;
}

export function StatusLabel({ bucket }: { bucket: SidebarStateBucket }) {
  return (
    <View style={styles.statusRow}>
      <StatusDot bucket={bucket} />
      <Text style={styles.statusText} numberOfLines={1}>
        {MONO_STATUS_LABEL[bucket]}
      </Text>
    </View>
  );
}

/** Metadata in the mono face: ids, branches, durations, paths, counts. */
export function MonoText({
  children,
  tone = "muted",
  ...props
}: Omit<TextProps, "style"> & { children: ReactNode; tone?: "strong" | "muted" | "faint" }) {
  styles.useVariants({ tone });
  return (
    <Text {...props} style={styles.mono} dataSet={CODE_SURFACE_DATASET}>
      {children}
    </Text>
  );
}

export function DiffStat({ stat }: { stat: { additions: number; deletions: number } | null }) {
  if (!stat || (stat.additions === 0 && stat.deletions === 0)) return null;
  return (
    <View style={styles.diffRow}>
      <Text style={styles.diffAdd} dataSet={CODE_SURFACE_DATASET}>
        +{stat.additions}
      </Text>
      <Text style={styles.diffDel} dataSet={CODE_SURFACE_DATASET}>
        −{stat.deletions}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  dot: {
    borderRadius: 999,
    variants: {
      size: {
        sm: { width: 8, height: 8 },
        lg: { width: 10, height: 10 },
      },
      bucket: {
        running: { backgroundColor: theme.colors.statusDotRunning },
        needs_input: { backgroundColor: theme.colors.statusDotWarning },
        failed: { backgroundColor: theme.colors.statusDotDanger },
        attention: { backgroundColor: theme.colors.statusDotSuccess },
        done: { backgroundColor: theme.colors.foregroundExtraMuted },
      },
    },
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  statusText: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "500",
  },
  mono: {
    fontFamily: theme.fontFamily.mono,
    fontSize: 12,
    variants: {
      tone: {
        strong: { color: theme.colors.foreground, fontWeight: "500" },
        muted: { color: theme.colors.foregroundMuted },
        faint: { color: theme.colors.foregroundExtraMuted },
      },
    },
  },
  diffRow: {
    flexDirection: "row",
    gap: 6,
  },
  diffAdd: {
    fontFamily: theme.fontFamily.mono,
    fontSize: 12,
    color: theme.colors.statusSuccess,
  },
  diffDel: {
    fontFamily: theme.fontFamily.mono,
    fontSize: 12,
    color: theme.colors.statusDanger,
  },
}));
