import { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { formatCompactTimeAgo } from "@/utils/time";
import { softStatusLabel, type SoftRecent } from "./soft-data";
import { SoftStatusIcon } from "./soft-status-icon";
import { SOFT_ROW_RADIUS } from "./soft-surface";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

// preview copy
const VIEW_CHAT = "View chat";

function subtitleOf(recent: SoftRecent): string {
  if (!recent.projectName) return "Chat"; // preview copy
  // A session is often titled by its branch; do not say it twice.
  const branch = recent.branch && recent.branch !== recent.title ? recent.branch : null;
  return branch ? `${recent.projectName} · ${branch}` : recent.projectName;
}

/**
 * One conversation: round status badge, bold title, a quiet project/branch line, the time and a
 * teal "View chat" link. `dense` is the sidebar card's tighter version (no link, smaller badge).
 */
export const SoftRecentRow = memo(function SoftRecentRow({
  recent,
  active = false,
  dense = false,
  onBeforeNavigate,
}: {
  recent: SoftRecent;
  active?: boolean;
  dense?: boolean;
  onBeforeNavigate?: () => void;
}) {
  const open = useCallback(() => {
    onBeforeNavigate?.();
    navigateToWorkspace({ serverId: recent.serverId, workspaceId: recent.workspaceId });
  }, [onBeforeNavigate, recent.serverId, recent.workspaceId]);
  const urgent = recent.status === "needs_input" || recent.status === "failed";
  const rowStyle = useCallback(
    ({ hovered, pressed }: HoverState) => [
      dense ? styles.rowDense : styles.row,
      (Boolean(hovered) || pressed) && styles.rowHovered,
      active && styles.rowActive,
    ],
    [active, dense],
  );
  return (
    <Pressable
      onPress={open}
      style={rowStyle}
      accessibilityRole="button"
      accessibilityLabel={recent.title}
      testID={`soft-recent-${recent.workspaceId}`}
    >
      <SoftStatusIcon status={recent.status} size={dense ? 28 : 32} />
      <View style={styles.body}>
        <View style={styles.line}>
          <Text style={dense ? styles.titleDense : styles.title} numberOfLines={1}>
            {recent.title}
          </Text>
          <Text style={styles.time}>{formatCompactTimeAgo(new Date(recent.sortTime))}</Text>
        </View>
        <View style={styles.line}>
          <Text style={urgent ? statusStyle(recent.status) : styles.subtitle} numberOfLines={1}>
            {urgent || recent.status === "running"
              ? `${softStatusLabel(recent.status)} · ${subtitleOf(recent)}`
              : subtitleOf(recent)}
          </Text>
          {!dense ? <Text style={styles.link}>{VIEW_CHAT}</Text> : null}
        </View>
      </View>
    </Pressable>
  );
});

function statusStyle(status: SoftRecent["status"]) {
  return status === "failed" ? styles.subtitleDanger : styles.subtitleWarning;
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: SOFT_ROW_RADIUS,
  },
  rowDense: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  body: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  line: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  titleDense: {
    flex: 1,
    minWidth: 0,
    fontSize: 13.5,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  time: {
    fontSize: 12,
    color: theme.colors.foregroundExtraMuted,
  },
  subtitle: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    color: theme.colors.foregroundMuted,
  },
  subtitleWarning: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: "500",
    color: theme.colors.statusWarning,
  },
  subtitleDanger: {
    flex: 1,
    minWidth: 0,
    fontSize: 12.5,
    fontWeight: "500",
    color: theme.colors.statusDanger,
  },
  link: {
    fontSize: 12.5,
    fontWeight: "600",
    color: theme.colors.accent,
  },
}));
