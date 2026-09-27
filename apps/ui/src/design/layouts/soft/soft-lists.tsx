import { ChevronRight, FolderPlus } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import { mostUrgentStatus, softStatusLabel, type SoftProject, type SoftRecent } from "./soft-data";
import { SoftRecentRow } from "./soft-recent-row";
import { SoftStatusIcon } from "./soft-status-icon";
import { SOFT_ROW_RADIUS } from "./soft-surface";

type HoverState = PressableStateCallbackType & { hovered?: boolean };
type GroupKey = "today" | "yesterday" | "previous7Days" | "older";

const ThemedChevron = withUnistyles(ChevronRight);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const extraMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const accentMapping = (theme: Theme) => ({ color: theme.colors.accent });

const DAY_MS = 24 * 60 * 60 * 1000;

function groupByDay(recents: SoftRecent[], now: Date): { key: GroupKey; items: SoftRecent[] }[] {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const today = start.getTime();
  const buckets: Record<GroupKey, SoftRecent[]> = {
    today: [],
    yesterday: [],
    previous7Days: [],
    older: [],
  };
  for (const recent of recents) {
    if (recent.sortTime >= today) buckets.today.push(recent);
    else if (recent.sortTime >= today - DAY_MS) buckets.yesterday.push(recent);
    else if (recent.sortTime >= today - 7 * DAY_MS) buckets.previous7Days.push(recent);
    else buckets.older.push(recent);
  }
  return (Object.keys(buckets) as GroupKey[])
    .filter((key) => buckets[key].length > 0)
    .map((key) => ({ key, items: buckets[key] }));
}

/** Recent conversations grouped Today / Yesterday / Previous 7 days / Older. */
export function SoftChatList({
  recents,
  activeKey = null,
  dense = false,
  onBeforeNavigate,
}: {
  recents: SoftRecent[];
  activeKey?: string | null;
  dense?: boolean;
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const groups = useMemo(() => groupByDay(recents, new Date()), [recents]);
  if (groups.length === 0) {
    return <Text style={styles.empty}>{t("sidebar.chats.empty")}</Text>;
  }
  return (
    <View style={styles.list}>
      {groups.map((group) => (
        <View key={group.key} style={styles.group}>
          <Text style={dense ? styles.groupLabelDense : styles.groupLabel}>
            {t(`sidebar.chats.groups.${group.key}`)}
          </Text>
          {group.items.map((recent) => (
            <SoftRecentRow
              key={recent.key}
              recent={recent}
              dense={dense}
              active={recent.key === activeKey}
              onBeforeNavigate={onBeforeNavigate}
            />
          ))}
        </View>
      ))}
    </View>
  );
}

/** Projects as soft rows: letter avatar, session count and the most urgent status. */
export function SoftProjectList({
  projects,
  dense = false,
  onBeforeNavigate,
}: {
  projects: SoftProject[];
  dense?: boolean;
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const openAddProject = useOpenAddProject();
  const addProject = useCallback(() => {
    onBeforeNavigate?.();
    void openAddProject();
  }, [onBeforeNavigate, openAddProject]);
  return (
    <View style={styles.list}>
      {projects.length === 0 ? (
        <View style={styles.emptyBlock}>
          <Text style={styles.emptyTitle}>{t("sidebar.project.empty.title")}</Text>
          <Text style={styles.empty}>{t("sidebar.project.empty.description")}</Text>
        </View>
      ) : null}
      {projects.map((project) => (
        <SoftProjectRow
          key={project.key}
          project={project}
          dense={dense}
          onBeforeNavigate={onBeforeNavigate}
        />
      ))}
      <Pressable
        onPress={addProject}
        style={addRowStyle}
        accessibilityRole="button"
        testID="soft-add-project"
      >
        <View style={styles.addIcon}>
          <ThemedFolderPlus size={16} uniProps={accentMapping} />
        </View>
        <Text style={styles.addLabel}>{t("sidebar.actions.addProject")}</Text>
      </Pressable>
    </View>
  );
}

function SoftProjectRow({
  project,
  dense,
  onBeforeNavigate,
}: {
  project: SoftProject;
  dense: boolean;
  onBeforeNavigate?: () => void;
}) {
  const latest = project.recents[0];
  const open = useCallback(() => {
    if (!latest) return;
    onBeforeNavigate?.();
    navigateToWorkspace({ serverId: latest.serverId, workspaceId: latest.workspaceId });
  }, [latest, onBeforeNavigate]);
  const active = project.recents.filter((recent) => recent.status !== "done");
  const status = mostUrgentStatus(active.map((recent) => recent.status));
  // preview copy
  const count = `${project.recents.length} ${project.recents.length === 1 ? "session" : "sessions"}`;
  const summary = active.length > 0 ? `${count} · ${softStatusLabel(status)}` : count;
  return (
    <Pressable
      onPress={open}
      style={dense ? projectRowDenseStyle : projectRowStyle}
      accessibilityRole="button"
      accessibilityLabel={project.name}
    >
      <View style={styles.avatar}>
        <Text style={styles.avatarLetter}>{project.name.slice(0, 1).toUpperCase()}</Text>
      </View>
      <View style={styles.projectBody}>
        <Text style={styles.projectName} numberOfLines={1}>
          {project.name}
        </Text>
        <Text style={styles.projectMeta} numberOfLines={1}>
          {summary}
        </Text>
      </View>
      {active.length > 0 ? <SoftStatusIcon status={status} size={24} /> : null}
      <ThemedChevron size={16} uniProps={extraMutedMapping} />
    </Pressable>
  );
}

function projectRowStyle({ hovered, pressed }: HoverState) {
  return [styles.projectRow, (Boolean(hovered) || pressed) && styles.hovered];
}
function projectRowDenseStyle({ hovered, pressed }: HoverState) {
  return [styles.projectRowDense, (Boolean(hovered) || pressed) && styles.hovered];
}
function addRowStyle({ hovered, pressed }: HoverState) {
  return [styles.addRow, (Boolean(hovered) || pressed) && styles.hovered];
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: 2,
  },
  group: {
    gap: 2,
    marginBottom: 10,
  },
  groupLabel: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.foregroundMuted,
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 4,
  },
  groupLabelDense: {
    fontSize: 12,
    fontWeight: "600",
    color: theme.colors.foregroundExtraMuted,
    paddingHorizontal: 10,
    paddingTop: 6,
    paddingBottom: 2,
  },
  emptyBlock: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 2,
  },
  emptyTitle: {
    fontSize: 15,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  empty: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  projectRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: SOFT_ROW_RADIUS,
  },
  projectRowDense: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
  },
  hovered: {
    backgroundColor: theme.colors.surface1,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  avatarLetter: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  projectBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  projectName: {
    fontSize: 14.5,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
  projectMeta: {
    fontSize: 12.5,
    color: theme.colors.foregroundMuted,
  },
  addRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: SOFT_ROW_RADIUS,
  },
  addIcon: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.colors.border,
  },
  addLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.accent,
  },
}));
