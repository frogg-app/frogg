import { Box, ChevronDown, ChevronRight, GitBranch, Plus } from "lucide-react-native";
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";
import { formatCompactTimeAgo } from "@/utils/time";
import type { InsetGroup, InsetRow } from "./inset-data";
import { InsetStatusGlyph } from "./status-glyph";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedDown = withUnistyles(ChevronDown);
const ThemedRight = withUnistyles(ChevronRight);
const ThemedPlus = withUnistyles(Plus);
const ThemedBranch = withUnistyles(GitBranch);
const ThemedBox = withUnistyles(Box);
const DOWN_ICON = <ThemedDown size={12} uniProps={mutedMapping} />;
const RIGHT_ICON = <ThemedRight size={12} uniProps={mutedMapping} />;
const PLUS_ICON = <ThemedPlus size={14} uniProps={mutedMapping} />;
const BRANCH_ICON = <ThemedBranch size={11} uniProps={mutedMapping} />;
const PROJECT_ICON = <ThemedBox size={11} uniProps={mutedMapping} />;

interface ListActions {
  onOpen: (serverId: string, workspaceId: string) => void;
  onNewSession: () => void;
}

/** Linear's grouped list: a tinted header bar per status, dense rows beneath it. */
export function InsetGroupedList({
  groups,
  compact,
  onOpen,
  onNewSession,
}: ListActions & { groups: InsetGroup[]; compact: boolean }) {
  return (
    <View>
      {groups.map((group) => (
        <StatusGroup
          key={group.bucket}
          group={group}
          compact={compact}
          onOpen={onOpen}
          onNewSession={onNewSession}
        />
      ))}
    </View>
  );
}

function groupHeaderStyle({ hovered }: HoverState) {
  return [styles.groupHeader, Boolean(hovered) && styles.groupHeaderHovered];
}
function addButtonStyle({ hovered }: HoverState) {
  return [styles.groupAdd, Boolean(hovered) && styles.groupAddHovered];
}

const StatusGroup = memo(function StatusGroup({
  group,
  compact,
  onOpen,
  onNewSession,
}: ListActions & { group: InsetGroup; compact: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return (
    <View testID={`inset-group-${group.bucket}`}>
      <View style={styles.groupHeaderRow}>
        <Pressable
          onPress={toggle}
          style={groupHeaderStyle}
          accessibilityRole="button"
          accessibilityState={open ? EXPANDED : COLLAPSED}
        >
          {open ? DOWN_ICON : RIGHT_ICON}
          <InsetStatusGlyph bucket={group.bucket} />
          <Text style={styles.groupLabel}>{group.label}</Text>
          <Text style={styles.groupCount}>{group.rows.length}</Text>
        </Pressable>
        <Pressable
          onPress={onNewSession}
          style={addButtonStyle}
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.actions.newWorkspace")}
        >
          {PLUS_ICON}
        </Pressable>
      </View>
      {open
        ? group.rows.map((row) => (
            <ListRow key={row.key} row={row} compact={compact} onOpen={onOpen} />
          ))
        : null}
    </View>
  );
});

const EXPANDED = { expanded: true } as const;
const COLLAPSED = { expanded: false } as const;

function rowStyle({ hovered, pressed }: HoverState) {
  return [styles.row, (Boolean(hovered) || pressed) && styles.rowHovered];
}
function compactRowStyle({ pressed }: HoverState) {
  return [styles.compactRow, pressed && styles.rowHovered];
}

const ListRow = memo(function ListRow({
  row,
  compact,
  onOpen,
}: {
  row: InsetRow;
  compact: boolean;
  onOpen: ListActions["onOpen"];
}) {
  const handlePress = useCallback(
    () => onOpen(row.serverId, row.workspaceId),
    [onOpen, row.serverId, row.workspaceId],
  );
  const time = row.at ? formatCompactTimeAgo(row.at) : null;
  if (compact) {
    const branch = row.branch !== row.title ? row.branch : null;
    const subtitle = [row.projectName, branch].filter(Boolean).join(" · ");
    return (
      <Pressable
        onPress={handlePress}
        style={compactRowStyle}
        accessibilityRole="button"
        testID={`inset-row-${row.key}`}
      >
        <View style={styles.compactGlyph}>
          <InsetStatusGlyph bucket={row.bucket} />
        </View>
        <View style={styles.compactText}>
          <Text style={styles.title} numberOfLines={1}>
            {row.title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <View style={styles.compactMeta}>
          {time ? <Text style={styles.time}>{time}</Text> : null}
          <DiffStat diffStat={row.diffStat} />
        </View>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={handlePress}
      style={rowStyle}
      accessibilityRole="button"
      testID={`inset-row-${row.key}`}
    >
      <InsetStatusGlyph bucket={row.bucket} />
      <Text style={styles.title} numberOfLines={1}>
        {row.title}
      </Text>
      <View style={styles.trailing}>
        <DiffStat diffStat={row.diffStat} />
        {row.branch && row.branch !== row.title ? (
          <View style={styles.chip}>
            {BRANCH_ICON}
            <Text style={styles.chipMono} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
              {row.branch}
            </Text>
          </View>
        ) : null}
        {row.projectName ? (
          <View style={styles.chip}>
            {PROJECT_ICON}
            <Text style={styles.chipText} numberOfLines={1}>
              {row.projectName}
            </Text>
          </View>
        ) : null}
        <Text style={styles.timeColumn}>{time ?? ""}</Text>
      </View>
    </Pressable>
  );
});

function DiffStat({ diffStat }: { diffStat: InsetRow["diffStat"] }) {
  if (!diffStat || (diffStat.additions === 0 && diffStat.deletions === 0)) return null;
  return (
    <View style={styles.diff}>
      <Text style={styles.diffAdd}>+{diffStat.additions}</Text>
      <Text style={styles.diffDel}>−{diffStat.deletions}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  groupHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    height: 34,
    marginTop: 2,
    paddingRight: 6,
    borderRadius: 6,
    backgroundColor: theme.colors.surface2,
  },
  groupHeader: {
    flex: 1,
    height: 34,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
  },
  groupHeaderHovered: {
    backgroundColor: theme.colors.surface3,
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  groupCount: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  groupAdd: {
    width: 24,
    height: 24,
    borderRadius: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  groupAddHovered: {
    backgroundColor: theme.colors.surface3,
  },
  row: {
    height: 38,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 32,
    paddingRight: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderAccent,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  compactRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.borderAccent,
  },
  compactGlyph: {
    width: 16,
    alignItems: "center",
  },
  compactText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  compactMeta: {
    alignItems: "flex-end",
    gap: 2,
  },
  title: {
    flex: 1,
    minWidth: 0,
    fontSize: 13,
    fontWeight: "500",
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  trailing: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexShrink: 1,
  },
  chip: {
    maxWidth: 180,
    height: 22,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipText: {
    flexShrink: 1,
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  chipMono: {
    flexShrink: 1,
    fontSize: 11,
    fontFamily: theme.design.monoFontFamily,
    color: theme.colors.foregroundMuted,
  },
  diff: {
    flexDirection: "row",
    gap: 4,
  },
  diffAdd: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    color: theme.colors.diffAddition,
  },
  diffDel: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    color: theme.colors.diffDeletion,
  },
  time: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  timeColumn: {
    width: 44,
    textAlign: "right",
    fontSize: 12,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
}));
