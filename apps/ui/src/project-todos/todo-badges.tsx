import { useCallback, useMemo } from "react";
import { Pressable, Text, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type {
  ProjectTodoClaimView,
  ProjectTodoPriority,
  ProjectTodoStatus,
} from "@frogg/protocol/todos/schemas";
import { useSessionStore } from "@/stores/session-store";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";

export function TodoPriorityBadge({ priority }: { priority: ProjectTodoPriority }) {
  const { t } = useTranslation();
  const label = t(`projectTodos.priority.${priority}`);
  const dotStyle = useMemo(() => [styles.priorityDot, priorityDotStyles[priority]], [priority]);
  return (
    <View
      style={styles.inline}
      accessibilityLabel={t("projectTodos.priorityLabel", { priority: label })}
      testID={`project-todo-priority-${priority}`}
    >
      <View style={dotStyle} />
      <Text style={styles.metaText}>{label}</Text>
    </View>
  );
}

export function TodoStatusPill({ status }: { status: ProjectTodoStatus }) {
  const { t } = useTranslation();
  const textStyle = useMemo(
    () => [styles.pillText, status === "blocked" && styles.pillTextDanger],
    [status],
  );
  return (
    <View style={styles.pill}>
      <Text style={textStyle}>{t(`projectTodos.status.${status}`)}</Text>
    </View>
  );
}

export function TodoParallelBadge() {
  const { t } = useTranslation();
  return (
    <View style={styles.pill} accessibilityHint={t("projectTodos.form.allowParallelHint")}>
      <Text style={styles.pillText}>{t("projectTodos.parallel")}</Text>
    </View>
  );
}

/**
 * Who holds the item. Links to the claiming agent when this host's directory
 * knows it; a stale claim (agent no longer running) is marked, never hidden.
 */
export function TodoClaimBadge({
  serverId,
  claim,
}: {
  serverId: string;
  claim: ProjectTodoClaimView;
}) {
  const { t } = useTranslation();
  const agentTitle = useSessionStore(
    useCallback(
      (state) => {
        const agent = state.sessions[serverId]?.agents.get(claim.agentId);
        if (!agent) return null;
        return agent.title ?? claim.agentId.slice(0, 8);
      },
      [claim.agentId, serverId],
    ),
  );
  const label = agentTitle ?? claim.agentId.slice(0, 8);
  const handlePress = useCallback(() => {
    router.navigate(
      buildHostAgentDetailRoute(serverId, claim.agentId, claim.workspaceId ?? undefined),
    );
  }, [claim.agentId, claim.workspaceId, serverId]);
  const containerStyle = useMemo(
    () => [styles.claim, claim.stale && styles.claimStale],
    [claim.stale],
  );
  const content = (
    <>
      <Text style={styles.claimText} numberOfLines={1}>
        {label}
      </Text>
      {claim.branch ? (
        <Text style={styles.metaText} numberOfLines={1}>
          {t("projectTodos.onBranch", { branch: claim.branch })}
        </Text>
      ) : null}
      {claim.stale ? (
        <Text style={styles.staleText} accessibilityHint={t("projectTodos.staleHint")}>
          {t("projectTodos.stale")}
        </Text>
      ) : null}
    </>
  );
  if (!agentTitle) {
    return (
      <View style={containerStyle} testID={`project-todo-claim-${claim.agentId}`}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      style={containerStyle}
      onPress={handlePress}
      accessibilityRole="link"
      accessibilityLabel={t("projectTodos.openAgent", { agent: label })}
      testID={`project-todo-claim-${claim.agentId}`}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  priorityDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  pill: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.full,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  pillText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  pillTextDanger: {
    color: theme.colors.statusDanger,
  },
  claim: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    maxWidth: 280,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: 1,
  },
  claimStale: {
    opacity: 0.7,
  },
  claimText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    flexShrink: 1,
  },
  staleText: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
}));

const priorityDotStyles = StyleSheet.create((theme) => ({
  low: { backgroundColor: theme.colors.foregroundMuted },
  medium: { backgroundColor: theme.colors.statusSuccess },
  high: { backgroundColor: theme.colors.statusWarning },
  urgent: { backgroundColor: theme.colors.statusDanger },
}));
