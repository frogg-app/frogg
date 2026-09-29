import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { ProjectTodoSummary } from "@frogg/protocol/todos/schemas";
import { MenuHeader } from "@/components/headers/menu-header";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import {
  groupProjectTodos,
  PROJECT_TODO_STATUS_FILTERS,
  type ProjectTodoStatusFilter,
} from "./model";
import {
  TodoClaimBadge,
  TodoParallelBadge,
  TodoPriorityBadge,
  TodoStatusPill,
} from "./todo-badges";
import { TodoDetailSheet } from "./todo-detail-sheet";
import { TodoFormSheet } from "./todo-form-sheet";
import { TodoStatusMenu } from "./todo-status-menu";
import { useProjectTodoActions } from "./use-project-todo-actions";
import { useProjectTodoList } from "./use-project-todos";

function useProjectName(serverId: string, projectId: string): string | null {
  return useSessionStore(
    useCallback(
      (state) => {
        const project = state.sessions[serverId]?.projects.get(projectId);
        return project ? (project.projectCustomName ?? project.projectDisplayName) : null;
      },
      [projectId, serverId],
    ),
  );
}

/** A project's to-do list: grouped by category, filtered by status, live. */
export function ProjectTodosScreen({
  serverId,
  projectId,
}: {
  serverId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const projectName = useProjectName(serverId, projectId);
  const { query, isConnected, supported } = useProjectTodoList(serverId, projectId);
  const actions = useProjectTodoActions(serverId, projectId);
  const [filter, setFilter] = useState<ProjectTodoStatusFilter>("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const items = query.data?.items;
  const groups = useMemo(() => groupProjectTodos(items ?? [], filter), [filter, items]);
  // The detail follows the live list; a remote delete closes it.
  const selected = selectedId ? (items?.find((item) => item.id === selectedId) ?? null) : null;

  const filterOptions = useMemo(
    () =>
      PROJECT_TODO_STATUS_FILTERS.map((value) => ({
        value,
        label:
          value === "open" || value === "all"
            ? t(`projectTodos.filters.${value}`)
            : t(`projectTodos.status.${value}`),
      })),
    [t],
  );
  const openCreate = useCallback(() => setCreating(true), []);
  const closeCreate = useCallback(() => setCreating(false), []);
  const closeDetail = useCallback(() => setSelectedId(null), []);
  const submitCreate = useCallback(
    async (fields: Parameters<typeof actions.create>[0]) => {
      const id = await actions.create(fields);
      if (id === null) return false;
      if (id) setSelectedId(id);
      return true;
    },
    [actions],
  );

  const title = projectName
    ? t("projectTodos.projectTitle", { project: projectName })
    : t("projectTodos.title");

  const headerRight = useMemo(
    () =>
      supported ? (
        <Button
          size="sm"
          variant="default"
          leftIcon={Plus}
          onPress={openCreate}
          disabled={!isConnected}
          testID="project-todos-create"
        >
          {t("projectTodos.actions.create")}
        </Button>
      ) : null,
    [isConnected, openCreate, supported, t],
  );

  return (
    <View style={styles.container} testID="project-todos-screen">
      <MenuHeader title={title} rightContent={headerRight} />
      {supported && !isConnected ? (
        <Text style={styles.banner} testID="project-todos-offline">
          {t("projectTodos.offline")}
        </Text>
      ) : null}
      <ScrollView contentContainerStyle={styles.content}>
        {supported ? (
          <View style={styles.toolbar}>
            <TodoStatusMenu
              value={filter}
              options={filterOptions}
              onChange={setFilter}
              title={t("projectTodos.statusFilter")}
              testID="project-todos-filter"
            />
          </View>
        ) : null}
        <ProjectTodosBody
          supported={supported}
          query={query}
          groups={groups}
          hasItems={(items?.length ?? 0) > 0}
          serverId={serverId}
          onOpen={setSelectedId}
        />
      </ScrollView>
      {selected ? (
        <TodoDetailSheet
          key={selected.id}
          serverId={serverId}
          projectId={projectId}
          summary={selected}
          actions={actions}
          onClose={closeDetail}
        />
      ) : null}
      {creating ? (
        <TodoFormSheet
          mode="create"
          pending={actions.pending === "create"}
          onSubmit={submitCreate}
          onClose={closeCreate}
        />
      ) : null}
    </View>
  );
}

function ProjectTodosBody({
  supported,
  query,
  groups,
  hasItems,
  serverId,
  onOpen,
}: {
  supported: boolean;
  query: ReturnType<typeof useProjectTodoList>["query"];
  groups: ReturnType<typeof groupProjectTodos>;
  hasItems: boolean;
  serverId: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const refetch = query.refetch;
  const handleRetry = useCallback(() => void refetch(), [refetch]);
  if (!supported) {
    return <Text style={styles.emptyText}>{t("projectTodos.unsupported")}</Text>;
  }
  if (query.isError && !query.data) {
    return (
      <View style={styles.empty} testID="project-todos-error">
        <Text style={styles.errorText}>
          {t("projectTodos.loadFailed", { message: toErrorMessage(query.error) })}
        </Text>
        <Button variant="ghost" onPress={handleRetry}>
          {t("projectTodos.actions.retry")}
        </Button>
      </View>
    );
  }
  if (!query.data) {
    return (
      <View style={styles.empty}>
        <ThemedSpinner />
        <Text style={styles.emptyText}>{t("projectTodos.loading")}</Text>
      </View>
    );
  }
  if (groups.length === 0) {
    return (
      <Text style={styles.emptyText} testID="project-todos-empty">
        {hasItems ? t("projectTodos.emptyFiltered") : t("projectTodos.empty")}
      </Text>
    );
  }
  return (
    <>
      {groups.map((group) => (
        <View key={group.category ?? "\u0000"} style={styles.group}>
          <Text style={styles.groupTitle}>{group.category ?? t("projectTodos.uncategorized")}</Text>
          {group.items.map((item) => (
            <TodoRow key={item.id} item={item} serverId={serverId} onOpen={onOpen} />
          ))}
        </View>
      ))}
    </>
  );
}

function TodoRow({
  item,
  serverId,
  onOpen,
}: {
  item: ProjectTodoSummary;
  serverId: string;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onOpen(item.id), [item.id, onOpen]);
  const titleStyle = useMemo(
    () => [styles.rowTitle, item.status === "done" && styles.rowTitleDone],
    [item.status],
  );
  return (
    <Pressable
      style={styles.row}
      onPress={handlePress}
      accessibilityRole="button"
      testID={`project-todo-row-${item.id}`}
    >
      <View style={styles.rowHeader}>
        <Text style={titleStyle} numberOfLines={2}>
          {item.title}
        </Text>
        <TodoStatusPill status={item.status} />
      </View>
      <View style={styles.rowMeta}>
        <TodoPriorityBadge priority={item.priority} />
        {item.allowParallel ? <TodoParallelBadge /> : null}
        {item.claims.map((claim) => (
          <TodoClaimBadge key={claim.agentId} serverId={serverId} claim={claim} />
        ))}
        {item.progressCount > 0 ? (
          <Text style={styles.metaText}>
            {t("projectTodos.progressCount", { count: item.progressCount })}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
  },

  banner: {
    marginHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    marginTop: theme.spacing[3],
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  content: {
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingVertical: theme.spacing[4],
    gap: theme.spacing[6],
    width: "100%",
    maxWidth: 960,
    alignSelf: "center",
  },
  group: {
    gap: theme.spacing[2],
  },
  groupTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.semibold,
    textTransform: "uppercase",
  },
  row: {
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface1,
    padding: theme.spacing[3],
    gap: theme.spacing[2],
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  rowTitle: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  rowTitleDone: {
    color: theme.colors.foregroundMuted,
    textDecorationLine: "line-through",
  },
  rowMeta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  metaText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  empty: {
    alignItems: "center",
    gap: theme.spacing[3],
    paddingVertical: theme.spacing[8],
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    textAlign: "center",
    paddingVertical: theme.spacing[8],
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
    textAlign: "center",
  },
}));
