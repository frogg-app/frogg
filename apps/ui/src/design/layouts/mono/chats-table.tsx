import { GitBranch, GitCommitHorizontal } from "lucide-react-native";
import { memo, useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { formatCompactTimeAgo, formatDuration } from "@/utils/time";
import { turnDurationMs, type MonoChatRow } from "./mono-data";
import { DiffStat, MonoText, StatusDot, StatusLabel } from "./mono-parts";

// Mono's chats table, laid out like Vercel's deployments list: id and model, status and
// duration, chat and project, branch and change summary, then time and host.

const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedBranch = withUnistyles(GitBranch);
const ThemedCommit = withUnistyles(GitCommitHorizontal);
const BRANCH_ICON = <ThemedBranch size={13} uniProps={mutedIcon} />;
const COMMIT_ICON = <ThemedCommit size={13} uniProps={mutedIcon} />;

// preview copy
const COPY = { noProject: "Chat", noBranch: "no branch", by: "on" };

type PressState = PressableStateCallbackType & { hovered?: boolean };

function rowStyle({ hovered, pressed }: PressState) {
  return [styles.row, (hovered || pressed) && styles.rowHovered];
}

// The first row sits on the card's own border, so it draws no top hairline.
function firstRowStyle({ hovered, pressed }: PressState) {
  return [styles.row, styles.rowFirst, (hovered || pressed) && styles.rowHovered];
}

interface RowProps {
  row: MonoChatRow;
  now: number;
  first: boolean;
}

function useOpen(row: MonoChatRow) {
  return useCallback(
    () => navigateToAgent({ serverId: row.serverId, agentId: row.agentId, workspaceId: row.workspaceId }),
    [row.agentId, row.serverId, row.workspaceId],
  );
}

function durationLabel(row: MonoChatRow, now: number): string | null {
  const ms = turnDurationMs(row, now);
  return ms === null ? null : formatDuration(ms);
}

export const ChatsTableRow = memo(function ChatsTableRow({ row, now, first }: RowProps) {
  const open = useOpen(row);
  const duration = durationLabel(row, now);
  return (
    <Pressable onPress={open} style={first ? firstRowStyle : rowStyle} testID={`mono-chat-row-${row.agentId}`}>
      <View style={styles.colId}>
        <MonoText tone="strong" numberOfLines={1}>
          {row.shortId}
        </MonoText>
        <Text style={styles.sub} numberOfLines={1}>
          {row.model ? `${row.provider} · ${row.model}` : row.provider}
        </Text>
      </View>
      <View style={styles.colStatus}>
        <StatusLabel bucket={row.bucket} />
        <View style={styles.indent}>
          <MonoText tone="muted">{duration ?? "—"}</MonoText>
        </View>
      </View>
      <View style={styles.colChat}>
        <Text style={styles.title} numberOfLines={1}>
          {row.title}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {row.projectName ?? COPY.noProject}
        </Text>
      </View>
      <View style={styles.colSource}>
        <View style={styles.inline}>
          {BRANCH_ICON}
          <MonoText tone="strong" numberOfLines={1}>
            {row.branch ?? COPY.noBranch}
          </MonoText>
        </View>
        <View style={styles.inline}>
          {COMMIT_ICON}
          <DiffStat stat={row.diffStat} />
          <MonoText tone="muted" numberOfLines={1}>
            {row.workspaceName ?? row.cwd}
          </MonoText>
        </View>
      </View>
      <View style={styles.colTime}>
        <Text style={styles.sub} numberOfLines={1}>
          {formatCompactTimeAgo(row.lastActivityAt, new Date(now))} {COPY.by} {row.hostLabel}
        </Text>
      </View>
    </Pressable>
  );
});

/** The compact form of a row: two lines, status first, metadata in mono beneath. */
export const ChatsListRow = memo(function ChatsListRow({ row, now, first }: RowProps) {
  const open = useOpen(row);
  const duration = durationLabel(row, now);
  return (
    <Pressable onPress={open} style={first ? firstRowStyle : rowStyle} testID={`mono-chat-row-${row.agentId}`}>
      <View style={styles.stack}>
        <View style={styles.inline}>
          <StatusDot bucket={row.bucket} />
          <Text style={styles.titleFlex} numberOfLines={1}>
            {row.title}
          </Text>
          <Text style={styles.sub}>{formatCompactTimeAgo(row.lastActivityAt, new Date(now))}</Text>
        </View>
        <View style={styles.indentRow}>
          <MonoText tone="muted" numberOfLines={1}>
            {[row.shortId, row.branch ?? row.projectName ?? COPY.noProject, duration]
              .filter(Boolean)
              .join("  ·  ")}
          </MonoText>
          <DiffStat stat={row.diffStat} />
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
    minHeight: 64,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  rowFirst: {
    borderTopWidth: 0,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface1,
  },
  colId: { width: 170, gap: 4 },
  colStatus: { width: 130, gap: 4 },
  colChat: { flex: 1, minWidth: 0, gap: 4 },
  colSource: { flex: 1.2, minWidth: 0, gap: 4 },
  colTime: { width: 160, alignItems: "flex-end" },
  indent: { paddingLeft: 16 },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  indentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 16,
    minWidth: 0,
  },
  stack: { flex: 1, minWidth: 0, gap: 6 },
  title: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "500",
  },
  titleFlex: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "500",
  },
  sub: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
  },
}));
