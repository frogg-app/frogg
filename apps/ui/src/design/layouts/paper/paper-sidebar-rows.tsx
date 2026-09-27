import { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { getStatusDotColor } from "@/utils/status-dot-color";
import { PaperIcon, paperForeground, paperMuted, type PaperIconName } from "./paper-icons";
import type { PaperRecent } from "./use-paper-recents";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

interface PaperNavRowProps {
  icon: PaperIconName;
  label: string;
  onPress: () => void;
  /** Rail mode: the icon alone, its label in a tooltip. */
  collapsed?: boolean;
  active?: boolean;
  /** Claude's New chat: the icon sits in a filled circle. */
  prominent?: boolean;
  large?: boolean;
  disabled?: boolean;
  testID?: string;
}

/** A Claude-style sidebar link: quiet icon + label, a soft tint on hover and when current. */
export function PaperNavRow({
  icon,
  label,
  onPress,
  collapsed = false,
  active = false,
  prominent = false,
  large = false,
  disabled = false,
  testID,
}: PaperNavRowProps) {
  const Icon = PaperIcon[icon];
  const rowStyle = useCallback(
    ({ hovered }: HoverState) => [
      large ? styles.navRowLarge : styles.navRow,
      collapsed && styles.navRowRail,
      active && styles.navRowActive,
      !active && Boolean(hovered) && styles.navRowHovered,
      disabled && styles.disabled,
    ],
    [active, collapsed, disabled, large],
  );
  const glyph = prominent ? (
    <View style={styles.prominentIcon}>
      <Icon size={14} strokeWidth={2} uniProps={paperForeground} />
    </View>
  ) : (
    <Icon
      size={large ? 20 : 16}
      strokeWidth={1.6}
      uniProps={active ? paperForeground : paperMuted}
    />
  );
  const row = (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={rowStyle}
    >
      <View style={styles.iconSlot}>{glyph}</View>
      {collapsed ? null : (
        <Text numberOfLines={1} style={large ? styles.navLabelLarge : styles.navLabel}>
          {label}
        </Text>
      )}
    </Pressable>
  );
  if (!collapsed) return row;
  return (
    <Tooltip delayDuration={200}>
      <TooltipTrigger asChild>{row}</TooltipTrigger>
      <TooltipContent side="right" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

export function PaperSectionLabel({ label }: { label: string }) {
  return <Text style={styles.sectionLabel}>{label}</Text>;
}

function statusDotStyle(status: PaperRecent["status"]) {
  switch (status) {
    case "running":
      return styles.dotRunning;
    case "failed":
      return styles.dotFailed;
    case "needs_input":
      return styles.dotNeedsInput;
    case "attention":
      return styles.dotAttention;
    default:
      return null;
  }
}

/**
 * One Recents entry: the session title on a single line. Only a session that wants something
 * (running, waiting on you, failed) earns a dot, so a quiet list reads like Claude's.
 */
export const PaperRecentRow = memo(function PaperRecentRow({
  item,
  isActive,
  large = false,
  onOpen,
}: {
  item: PaperRecent;
  isActive: boolean;
  large?: boolean;
  onOpen: (item: PaperRecent) => void;
}) {
  const handlePress = useCallback(() => onOpen(item), [item, onOpen]);
  const dot = statusDotStyle(item.status);
  const rowStyle = useCallback(
    ({ hovered }: HoverState) => [
      large ? styles.recentRowLarge : styles.recentRow,
      isActive && styles.navRowActive,
      !isActive && Boolean(hovered) && styles.navRowHovered,
    ],
    [isActive, large],
  );
  const accessibilityLabel = item.projectName ? `${item.title}, ${item.projectName}` : item.title;
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={`paper-recent-${item.workspaceId}`}
      style={rowStyle}
    >
      <Text
        numberOfLines={1}
        style={[
          large ? styles.recentLabelLarge : styles.recentLabel,
          isActive && styles.recentLabelActive,
        ]}
      >
        {item.title}
        {item.projectName ? (
          <Text style={styles.recentProject}>{`  ${item.projectName}`}</Text>
        ) : null}
      </Text>
      {dot ? <View style={[styles.dot, dot]} /> : null}
    </Pressable>
  );
});

export function PaperWordmark({ label }: { label: string }) {
  return (
    <Text numberOfLines={1} style={styles.wordmark} dataSet={DESIGN_FONT_DATASET}>
      {label}
    </Text>
  );
}

const styles = StyleSheet.create((theme) => ({
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    height: 34,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  navRowLarge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    height: 46,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  navRowRail: {
    width: 36,
    height: 36,
    paddingHorizontal: 0,
    justifyContent: "center",
  },
  navRowHovered: {
    backgroundColor: theme.colors.surface3,
  },
  navRowActive: {
    backgroundColor: theme.colors.surface3,
  },
  disabled: {
    opacity: 0.5,
  },
  iconSlot: {
    width: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
  },
  prominentIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface4,
  },
  navLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 14,
    lineHeight: 20,
  },
  navLabelLarge: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 17,
    lineHeight: 24,
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
    lineHeight: 16,
    paddingHorizontal: 8,
    paddingTop: 18,
    paddingBottom: 6,
  },
  recentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 8,
  },
  recentRowLarge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  recentLabel: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 13.5,
    lineHeight: 18,
    opacity: 0.86,
  },
  recentLabelLarge: {
    flex: 1,
    minWidth: 0,
    color: theme.colors.foreground,
    fontSize: 16,
    lineHeight: 22,
  },
  recentLabelActive: {
    opacity: 1,
  },
  recentProject: {
    color: theme.colors.foregroundExtraMuted,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  dotRunning: {
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
  },
  dotFailed: {
    backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
  },
  dotNeedsInput: {
    backgroundColor: theme.colors.accent,
  },
  dotAttention: {
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  wordmark: {
    color: theme.colors.foreground,
    fontFamily: theme.design.headingFontFamily,
    fontSize: 20,
    lineHeight: 26,
    letterSpacing: -0.3,
    fontWeight: "500",
  },
  tooltipText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.popoverForeground,
  },
}));
