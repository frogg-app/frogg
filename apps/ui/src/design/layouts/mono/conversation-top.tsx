import { ChevronDown, ChevronRight, FileDiff, Folder, GitBranch } from "lucide-react-native";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import type { Theme } from "@/styles/theme";
import { formatDuration, formatTimeAgo } from "@/utils/time";
import { turnDurationMs, useMonoChatRow, useNow, type MonoChatRow } from "./mono-data";
import { DiffStat, MonoText, StatusLabel } from "./mono-parts";
import { useOpenChanges } from "./use-mono-route";

// Mono's strip above a conversation: Vercel's "Deployment Details" card for the chat. A header
// with the short id and a changes action, then a grid of labelled facts. Collapses to its
// header so the conversation keeps the room; the choice is shared across chats.

const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedDown = withUnistyles(ChevronDown);
const ThemedRight = withUnistyles(ChevronRight);
const ThemedBranch = withUnistyles(GitBranch);
const ThemedDiff = withUnistyles(FileDiff);
const ThemedFolder = withUnistyles(Folder);
const DOWN_ICON = <ThemedDown size={14} uniProps={mutedIcon} />;
const RIGHT_ICON = <ThemedRight size={14} uniProps={mutedIcon} />;
const BRANCH_ICON = <ThemedBranch size={13} uniProps={mutedIcon} />;
const DIFF_ICON = <ThemedDiff size={14} uniProps={mutedIcon} />;
const FOLDER_ICON = <ThemedFolder size={13} uniProps={mutedIcon} />;

// preview copy
const COPY = {
  title: "Chat details",
  status: "Status",
  duration: "Duration",
  created: "Created",
  source: "Source",
  model: "Model",
  host: "Host",
  changes: "Changes",
  noBranch: "no branch",
  expand: "Show chat details",
  collapse: "Hide chat details",
};

const EXPANDED = { expanded: true } as const;
const COLLAPSED = { expanded: false } as const;

let rememberedOpen: boolean | null = null;

export function MonoConversationTop({ serverId, agentId }: { serverId: string; agentId: string }) {
  const row = useMonoChatRow(serverId, agentId);
  const compact = useIsCompactFormFactor();
  const [open, setOpen] = useState(() => rememberedOpen ?? !compact);
  const toggle = useCallback(() => {
    setOpen((value) => {
      rememberedOpen = !value;
      return !value;
    });
  }, []);
  if (!row) return null;
  return (
    <View style={styles.wrap} testID="mono-conversation-top">
      <View style={styles.card}>
        <Header row={row} open={open} onToggle={toggle} compact={compact} />
        {open ? <Details row={row} /> : null}
      </View>
    </View>
  );
}

function toggleStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.headerToggle, hovered && styles.headerHovered];
}

function Header({
  row,
  open,
  onToggle,
  compact,
}: {
  row: MonoChatRow;
  open: boolean;
  onToggle: () => void;
  compact: boolean;
}) {
  const openChanges = useOpenChanges();
  return (
    <View style={styles.header}>
      <Pressable
        onPress={onToggle}
        style={toggleStyle}
        accessibilityRole="button"
        accessibilityLabel={open ? COPY.collapse : COPY.expand}
        accessibilityState={open ? EXPANDED : COLLAPSED}
        testID="mono-details-toggle"
      >
        {open ? DOWN_ICON : RIGHT_ICON}
        {compact ? null : <Text style={styles.headerTitle}>{COPY.title}</Text>}
        <MonoText tone="faint">{row.shortId}</MonoText>
        {open ? null : <StatusLabel bucket={row.bucket} />}
      </Pressable>
      {row.workspaceId && row.projectName ? (
        <Pressable onPress={openChanges} style={styles.action} testID="mono-details-changes">
          {DIFF_ICON}
          <Text style={styles.actionText}>{COPY.changes}</Text>
          <DiffStat stat={row.diffStat} />
        </Pressable>
      ) : null}
    </View>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.value}>{children}</View>
    </View>
  );
}

function Details({ row }: { row: MonoChatRow }) {
  const now = useNow(row.bucket === "running");
  const duration = turnDurationMs(row, now);
  return (
    <View style={styles.grid}>
      <Field label={COPY.status}>
        <StatusLabel bucket={row.bucket} />
      </Field>
      <Field label={COPY.duration}>
        <MonoText tone="strong">{duration === null ? "—" : formatDuration(duration)}</MonoText>
        <Text style={styles.muted}>{formatTimeAgo(row.lastActivityAt, new Date(now))}</Text>
      </Field>
      <Field label={COPY.model}>
        <MonoText tone="strong" numberOfLines={1}>
          {row.model ?? row.provider}
        </MonoText>
        <Text style={styles.muted}>{row.provider}</Text>
      </Field>
      <Field label={COPY.created}>
        <Text style={styles.strong}>{formatTimeAgo(row.createdAt, new Date(now))}</Text>
        <Text style={styles.muted}>{row.hostLabel}</Text>
      </Field>
      <View style={styles.fieldWide}>
        <Text style={styles.label}>{COPY.source}</Text>
        <View style={styles.value}>
          {BRANCH_ICON}
          <MonoText tone="strong" numberOfLines={1}>
            {row.branch ?? row.workspaceName ?? COPY.noBranch}
          </MonoText>
          <DiffStat stat={row.diffStat} />
        </View>
        <View style={styles.value}>
          {FOLDER_ICON}
          <View style={styles.shrink}>
            <MonoText tone="muted" numberOfLines={1} selectable>
              {row.cwd}
            </MonoText>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    paddingHorizontal: { xs: 8, md: 16 },
    paddingTop: { xs: 8, md: 12 },
    paddingBottom: 4,
    backgroundColor: theme.colors.surface0,
  },
  card: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
    alignSelf: "center",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    minHeight: 44,
    paddingRight: 8,
  },
  headerToggle: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "stretch",
    paddingHorizontal: 12,
    minWidth: 0,
  },
  headerHovered: {
    backgroundColor: theme.colors.surface1,
  },
  headerTitle: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: -0.2,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  actionText: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "500",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: 24,
    rowGap: 14,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 16,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  field: {
    gap: 6,
    minWidth: { xs: 130, md: 150 },
    flexGrow: 1,
    flexBasis: { xs: "40%", md: 0 },
  },
  shrink: {
    flexShrink: 1,
    minWidth: 0,
  },
  fieldWide: {
    gap: 6,
    width: "100%",
    minWidth: 0,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
  value: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  },
  strong: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: "500",
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
  },
}));
