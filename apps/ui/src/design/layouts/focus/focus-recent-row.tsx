import { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { agentDisplayTitle, describeFocusStatus, type FocusTone } from "./focus-model";

interface FocusRecentRowProps {
  agent: Agent;
  workspace: WorkspaceDescriptor | undefined;
  selected: boolean;
  onOpen: (agent: Agent) => void;
}

/**
 * One chat in the Recent list, Devin-style: the title, a coloured status sub-line under it
 * ("Working…", "Changes ready · +2 −1"), and a blue unread dot on the right.
 */
export const FocusRecentRow = memo(function FocusRecentRow({
  agent,
  workspace,
  selected,
  onOpen,
}: FocusRecentRowProps) {
  const status = describeFocusStatus(agent, workspace?.diffStat);
  const handlePress = useCallback(() => onOpen(agent), [agent, onOpen]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (selected || hovered || pressed) && styles.rowActive,
    ],
    [selected],
  );
  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={SELECTED_STATE[selected ? 1 : 0]}
      testID={`focus-recent-${agent.id}`}
    >
      <View style={styles.text}>
        <Text style={styles.title} numberOfLines={1}>
          {agentDisplayTitle(agent)}
        </Text>
        <View style={styles.subline}>
          {status.showTime ? (
            <RelativeTime date={agent.lastActivityAt} />
          ) : (
            <Text style={toneStyle(status.tone)} numberOfLines={1}>
              {status.label}
            </Text>
          )}
          {status.diff ? (
            <Text style={styles.diffText} numberOfLines={1}>
              <Text style={styles.sep}>{"\u00A0·\u00A0"}</Text>
              <Text style={styles.additions}>{`+${status.diff.additions}`}</Text>
              {"\u00A0"}
              <Text style={styles.deletions}>{`−${status.diff.deletions}`}</Text>
            </Text>
          ) : null}
        </View>
      </View>
      {status.unread ? <View style={styles.unreadDot} testID="focus-recent-unread" /> : null}
    </Pressable>
  );
});

const SELECTED_STATE = [{ selected: false }, { selected: true }] as const;

function RelativeTime({ date }: { date: Date }) {
  const label = useCompactTimeAgo(date);
  return (
    <Text style={styles.time} numberOfLines={1}>
      {label}
    </Text>
  );
}

function toneStyle(tone: FocusTone) {
  if (tone === "running") return styles.toneRunning;
  if (tone === "warning") return styles.toneWarning;
  if (tone === "danger") return styles.toneDanger;
  if (tone === "success") return styles.toneSuccess;
  return styles.time;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 5,
    borderRadius: theme.borderRadius.md,
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  text: {
    flex: 1,
    minWidth: 0,
    gap: 1,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 13,
    lineHeight: 18,
  },
  subline: {
    flexDirection: "row",
    alignItems: "center",
    minWidth: 0,
  },
  time: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  toneRunning: {
    color: theme.colors.statusDotRunning,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  toneWarning: {
    color: theme.colors.statusDotWarning,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  toneDanger: {
    color: theme.colors.statusDotDanger,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  toneSuccess: {
    color: theme.colors.statusDotSuccess,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  diffText: {
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    flexShrink: 0,
  },
  sep: {
    color: theme.colors.foregroundMuted,
  },
  additions: {
    color: theme.colors.statusDotSuccess,
  },
  deletions: {
    color: theme.colors.statusDotDanger,
  },
  unreadDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
}));
