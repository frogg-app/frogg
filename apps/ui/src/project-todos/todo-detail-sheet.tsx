import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  PROJECT_TODO_STATUSES,
  type ProjectTodoStatus,
  type ProjectTodoSummary,
} from "@frogg/protocol/todos/schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { PlanCard } from "@/components/plan-card";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { toErrorMessage } from "@/utils/error-messages";
import { formatTimeAgo } from "@/utils/time";
import { formValuesFromTodo } from "./model";
import { TodoClaimBadge, TodoParallelBadge, TodoPriorityBadge } from "./todo-badges";
import { TodoFormSheet, TodoPlanSheet } from "./todo-form-sheet";
import { TodoStatusMenu } from "./todo-status-menu";
import type { useProjectTodoActions } from "./use-project-todo-actions";
import { useProjectTodoDetail } from "./use-project-todos";

type Actions = ReturnType<typeof useProjectTodoActions>;

/**
 * One to-do: fields, rendered plan, progress log and claims, with every user
 * action. `summary` (from the live list) renders immediately; the detail query
 * adds the plan and full progress log.
 */
export function TodoDetailSheet({
  serverId,
  projectId,
  summary,
  actions,
  onClose,
}: {
  serverId: string;
  projectId: string;
  summary: ProjectTodoSummary;
  actions: Actions;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const detail = useProjectTodoDetail(serverId, projectId, summary.id);
  const [editing, setEditing] = useState<"fields" | "plan" | null>(null);
  const item = detail.data ?? null;

  const statusOptions = useMemo(
    () =>
      PROJECT_TODO_STATUSES.map((status) => ({
        value: status,
        label: t(`projectTodos.status.${status}`),
      })),
    [t],
  );
  const handleStatus = useCallback(
    (status: ProjectTodoStatus) => {
      if (status !== summary.status) void actions.setStatus(summary.id, status);
    },
    [actions, summary.id, summary.status],
  );
  const handleRelease = useCallback(
    () => void actions.releaseAll(summary.id, summary.title),
    [actions, summary.id, summary.title],
  );
  const handleDelete = useCallback(async () => {
    if (await actions.remove(summary.id, summary.title)) onClose();
  }, [actions, onClose, summary.id, summary.title]);
  const refetchDetail = detail.refetch;
  const handleRetry = useCallback(() => void refetchDetail(), [refetchDetail]);
  const closeEditor = useCallback(() => setEditing(null), []);
  const openFields = useCallback(() => setEditing("fields"), []);
  const openPlan = useCallback(() => setEditing("plan"), []);
  const submitFields = useCallback(
    (fields: Parameters<Actions["update"]>[1]) => actions.update(summary.id, fields),
    [actions, summary.id],
  );
  const submitPlan = useCallback(
    (plan: string) => actions.updatePlan(summary.id, plan),
    [actions, summary.id],
  );

  const header = useMemo<SheetHeader>(() => ({ title: summary.title }), [summary.title]);

  return (
    <>
      <AdaptiveModalSheet
        header={header}
        visible={editing === null}
        onClose={onClose}
        desktopMaxWidth={760}
        testID="project-todo-detail"
      >
        <View style={styles.metaRow}>
          <TodoStatusMenu
            value={summary.status}
            options={statusOptions}
            onChange={handleStatus}
            title={t("projectTodos.detail.status")}
            disabled={actions.pending === "status"}
            testID="project-todo-detail-status"
          />
          <TodoPriorityBadge priority={summary.priority} />
          {summary.allowParallel ? <TodoParallelBadge /> : null}
          {summary.category ? (
            <Text style={styles.muted}>
              {t("projectTodos.detail.category")}: {summary.category}
            </Text>
          ) : null}
        </View>

        <View style={styles.actionsRow}>
          <Button size="sm" variant="secondary" onPress={openFields} testID="project-todo-edit">
            {t("projectTodos.actions.edit")}
          </Button>
          <Button size="sm" variant="secondary" onPress={openPlan} testID="project-todo-edit-plan">
            {t("projectTodos.actions.editPlan")}
          </Button>
          {summary.claims.length > 0 ? (
            <Button
              size="sm"
              variant="outline"
              onPress={handleRelease}
              loading={actions.pending === "release"}
              testID="project-todo-release"
            >
              {t("projectTodos.actions.release")}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="destructive"
            onPress={handleDelete}
            loading={actions.pending === "delete"}
            testID="project-todo-delete"
          >
            {t("projectTodos.actions.delete")}
          </Button>
        </View>

        {summary.description ? (
          <Section title={t("projectTodos.detail.description")}>
            <Text style={styles.body} selectable>
              {summary.description}
            </Text>
          </Section>
        ) : null}

        <Section title={t("projectTodos.detail.claims")}>
          {summary.claims.length === 0 ? (
            <Text style={styles.muted}>{t("projectTodos.detail.noClaims")}</Text>
          ) : (
            summary.claims.map((claim) => (
              <View key={claim.agentId} style={styles.claimRow}>
                <TodoClaimBadge serverId={serverId} claim={claim} />
                <Text style={styles.muted}>
                  {t("projectTodos.detail.claimedAt", {
                    time: formatTimeAgo(new Date(claim.claimedAt)),
                  })}
                </Text>
              </View>
            ))
          )}
        </Section>

        {detail.isPending ? (
          <View style={styles.loading}>
            <ThemedSpinner />
          </View>
        ) : null}
        {detail.isError ? (
          <View style={styles.errorRow}>
            <Text style={styles.error}>
              {t("projectTodos.detail.loadFailed", { message: toErrorMessage(detail.error) })}
            </Text>
            <Button size="sm" variant="ghost" onPress={handleRetry}>
              {t("projectTodos.actions.retry")}
            </Button>
          </View>
        ) : null}
        {detail.isSuccess && !item ? (
          <Text style={styles.muted}>{t("projectTodos.detail.gone")}</Text>
        ) : null}

        {item ? (
          <>
            {item.plan ? (
              <PlanCard
                title={t("projectTodos.detail.plan")}
                text={item.plan}
                disableOuterSpacing
                testID="project-todo-plan"
              />
            ) : (
              <Section title={t("projectTodos.detail.plan")}>
                <Text style={styles.muted}>{t("projectTodos.detail.noPlan")}</Text>
              </Section>
            )}
            <Section title={t("projectTodos.detail.progress")}>
              {item.progress.length === 0 ? (
                <Text style={styles.muted}>{t("projectTodos.detail.noProgress")}</Text>
              ) : (
                item.progress.toReversed().map((entry) => (
                  <View
                    key={`${entry.at}-${entry.agentId ?? ""}-${entry.note.length}`}
                    style={styles.progressRow}
                  >
                    <Text style={styles.muted}>
                      {formatTimeAgo(new Date(entry.at))}
                      {entry.agentId ? ` · ${entry.agentId.slice(0, 8)}` : ""}
                    </Text>
                    <Text style={styles.body} selectable>
                      {entry.note}
                    </Text>
                  </View>
                ))
              )}
            </Section>
          </>
        ) : null}
      </AdaptiveModalSheet>
      {editing === "fields" ? (
        <TodoFormSheet
          mode="edit"
          initial={formValuesFromTodo(summary)}
          pending={actions.pending === "update"}
          onSubmit={submitFields}
          onClose={closeEditor}
        />
      ) : null}
      {editing === "plan" ? (
        <TodoPlanSheet
          initialPlan={item?.plan ?? ""}
          pending={actions.pending === "plan"}
          onSubmit={submitPlan}
          onClose={closeEditor}
        />
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

const ThemedSpinner = withUnistyles(LoadingSpinner, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

const styles = StyleSheet.create((theme) => ({
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  actionsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginTop: theme.spacing[3],
  },
  section: {
    marginTop: theme.spacing[4],
    gap: theme.spacing[2],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  body: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  claimRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexWrap: "wrap",
  },
  progressRow: {
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
  },
  loading: {
    paddingVertical: theme.spacing[4],
    alignItems: "center",
  },
  errorRow: {
    marginTop: theme.spacing[4],
    gap: theme.spacing[2],
    alignItems: "flex-start",
  },
  error: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));
