import { memo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { formatCompactTimeAgo } from "@/utils/time";
import { mostUrgentStatus, softStatusLabel, type SoftProject, type SoftRecent } from "./soft-data";
import { SoftStatusIcon } from "./soft-status-icon";
import { softEdge, softRaised } from "./soft-surface";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

// preview copy
const VIEW_CHAT = "View chat";
const OPEN = "Open";

/**
 * The wide home's grid of recents (Notion iOS "Recents" cards): each chat a raised rounded card
 * with its status badge, title, place and a teal link. The sidebar card already carries the
 * dense list, so the home shows the same chats as something to pick up rather than to scan.
 */
export function SoftRecentCards({ recents }: { recents: SoftRecent[] }) {
  const { t } = useTranslation();
  if (recents.length === 0) return <Text style={styles.empty}>{t("sidebar.chats.empty")}</Text>;
  return (
    <View style={styles.grid}>
      {recents.map((recent) => (
        <RecentCard key={recent.key} recent={recent} />
      ))}
    </View>
  );
}

const RecentCard = memo(function RecentCard({ recent }: { recent: SoftRecent }) {
  const open = useCallback(
    () => navigateToWorkspace({ serverId: recent.serverId, workspaceId: recent.workspaceId }),
    [recent.serverId, recent.workspaceId],
  );
  const place = recent.projectName ?? "Chat"; // preview copy
  return (
    <Pressable
      onPress={open}
      style={cardStyle}
      accessibilityRole="button"
      accessibilityLabel={recent.title}
      testID={`soft-card-${recent.workspaceId}`}
    >
      <View style={styles.cardTop}>
        <SoftStatusIcon status={recent.status} />
        <Text style={styles.time}>{formatCompactTimeAgo(new Date(recent.sortTime))}</Text>
      </View>
      <Text style={styles.title} numberOfLines={2}>
        {recent.title}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {recent.status === "done" ? place : `${softStatusLabel(recent.status)} · ${place}`}
      </Text>
      <Text style={styles.link}>{VIEW_CHAT}</Text>
    </Pressable>
  );
});

/** Projects as cards on the wide home: letter tile, name, session count and live status. */
export function SoftProjectCards({ projects }: { projects: SoftProject[] }) {
  return (
    <View style={styles.grid}>
      {projects.map((project) => (
        <ProjectCard key={project.key} project={project} />
      ))}
    </View>
  );
}

const ProjectCard = memo(function ProjectCard({ project }: { project: SoftProject }) {
  const latest = project.recents[0];
  const open = useCallback(() => {
    if (latest) navigateToWorkspace({ serverId: latest.serverId, workspaceId: latest.workspaceId });
  }, [latest]);
  const active = project.recents.filter((recent) => recent.status !== "done");
  const status = mostUrgentStatus(active.map((recent) => recent.status));
  // preview copy
  const count = `${project.recents.length} ${project.recents.length === 1 ? "session" : "sessions"}`;
  return (
    <Pressable
      onPress={open}
      style={cardStyle}
      accessibilityRole="button"
      accessibilityLabel={project.name}
    >
      <View style={styles.cardTop}>
        <View style={styles.tile}>
          <Text style={styles.tileLetter}>{project.name.slice(0, 1).toUpperCase()}</Text>
        </View>
        {active.length > 0 ? <SoftStatusIcon status={status} size={24} /> : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {project.name}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {active.length > 0 ? `${count} · ${softStatusLabel(status)}` : count}
      </Text>
      <Text style={styles.link}>{OPEN}</Text>
    </Pressable>
  );
});

function cardStyle({ hovered, pressed }: HoverState) {
  return [styles.card, (Boolean(hovered) || pressed) && styles.cardHovered];
}

const styles = StyleSheet.create((theme, rt) => ({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  card: {
    flexBasis: 200,
    flexGrow: 1,
    maxWidth: 328,
    minHeight: 148,
    padding: 16,
    gap: 6,
    borderRadius: 22,
    ...softRaised(rt.themeName, "sm"),
    ...softEdge(rt.themeName),
  },
  cardHovered: {
    ...softRaised(rt.themeName, "md"),
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  time: {
    fontSize: 12,
    color: theme.colors.foregroundExtraMuted,
  },
  title: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  meta: {
    fontSize: 12.5,
    color: theme.colors.foregroundMuted,
  },
  link: {
    marginTop: "auto",
    paddingTop: 6,
    fontSize: 12.5,
    fontWeight: "600",
    color: theme.colors.accent,
  },
  tile: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  tileLetter: {
    fontSize: 14,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  empty: {
    fontSize: 13,
    color: theme.colors.foregroundMuted,
    paddingHorizontal: 4,
  },
}));
