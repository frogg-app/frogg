import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import {
  PROJECT_TODO_PRIORITIES,
  PROJECT_TODO_TITLE_MAX,
  type ProjectTodoPriority,
} from "@frogg/protocol/todos/schemas";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { SettingsTextArea } from "@/components/settings-textarea";
import { Button } from "@/components/ui/button";
import type { FieldControlSize } from "@/components/ui/control-geometry";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Switch } from "@/components/ui/switch";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  EMPTY_PROJECT_TODO_FORM,
  normalizeProjectTodoForm,
  type ProjectTodoFormValues,
} from "./model";

type NormalizedFields = NonNullable<ReturnType<typeof normalizeProjectTodoForm>>;

/**
 * Create or edit a to-do's fields. Input survives a failed save: the sheet only
 * closes when `onSubmit` resolves true.
 */
export function TodoFormSheet({
  mode,
  initial,
  pending,
  onSubmit,
  onClose,
}: {
  mode: "create" | "edit";
  initial?: ProjectTodoFormValues;
  pending: boolean;
  onSubmit: (fields: NormalizedFields) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const size: FieldControlSize = useIsCompactFormFactor() ? "md" : "sm";
  const [values, setValues] = useState<ProjectTodoFormValues>(
    () => initial ?? EMPTY_PROJECT_TODO_FORM,
  );
  const [showTitleError, setShowTitleError] = useState(false);
  const set = useCallback(
    <K extends keyof ProjectTodoFormValues>(key: K, value: ProjectTodoFormValues[K]) =>
      setValues((prev) => ({ ...prev, [key]: value })),
    [],
  );
  const setTitle = useCallback((value: string) => set("title", value), [set]);
  const setDescription = useCallback((value: string) => set("description", value), [set]);
  const setCategory = useCallback((value: string) => set("category", value), [set]);
  const setPriority = useCallback((value: ProjectTodoPriority) => set("priority", value), [set]);
  const setParallel = useCallback((value: boolean) => set("allowParallel", value), [set]);

  const handleSubmit = useCallback(async () => {
    const fields = normalizeProjectTodoForm(values);
    if (!fields) {
      setShowTitleError(true);
      return;
    }
    if (await onSubmit(fields)) onClose();
  }, [onClose, onSubmit, values]);

  const priorityOptions = useMemo(
    () =>
      PROJECT_TODO_PRIORITIES.map((priority) => ({
        value: priority,
        label: t(`projectTodos.priority.${priority}`),
        testID: `project-todo-form-priority-${priority}`,
      })),
    [t],
  );
  const header = useMemo<SheetHeader>(
    () => ({
      title:
        mode === "create" ? t("projectTodos.form.createTitle") : t("projectTodos.form.editTitle"),
    }),
    [mode, t],
  );
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="secondary"
          style={styles.footerButton}
          onPress={onClose}
          disabled={pending}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          style={styles.footerButton}
          onPress={handleSubmit}
          loading={pending}
          testID="project-todo-form-save"
        >
          {mode === "create" ? t("projectTodos.actions.create") : t("projectTodos.actions.save")}
        </Button>
      </View>
    ),
    [handleSubmit, mode, onClose, pending, t],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={520}
      sizeContentToCurrentSnapPoint
      testID="project-todo-form"
    >
      <Field
        label={t("projectTodos.form.title")}
        error={showTitleError && !values.title.trim() ? t("projectTodos.form.titleRequired") : null}
      >
        <FormTextInput
          size={size}
          testID="project-todo-form-title"
          initialValue={values.title}
          onChangeText={setTitle}
          placeholder={t("projectTodos.form.titlePlaceholder")}
          maxLength={PROJECT_TODO_TITLE_MAX}
          editable={!pending}
          autoFocus={mode === "create"}
        />
      </Field>
      <Field label={t("projectTodos.form.description")}>
        <SettingsTextArea
          accessibilityLabel={t("projectTodos.form.description")}
          value={values.description}
          onChangeText={setDescription}
          testID="project-todo-form-description"
        />
      </Field>
      <Field label={t("projectTodos.form.category")}>
        <FormTextInput
          size={size}
          testID="project-todo-form-category"
          initialValue={values.category}
          onChangeText={setCategory}
          placeholder={t("projectTodos.form.categoryPlaceholder")}
          editable={!pending}
          autoCapitalize="none"
        />
      </Field>
      <Field label={t("projectTodos.form.priority")}>
        <SegmentedControl
          options={priorityOptions}
          value={values.priority}
          onValueChange={setPriority}
          testID="project-todo-form-priority"
        />
      </Field>
      <Field
        label={t("projectTodos.form.allowParallel")}
        hint={t("projectTodos.form.allowParallelHint")}
      >
        <Switch
          value={values.allowParallel}
          onValueChange={setParallel}
          accessibilityLabel={t("projectTodos.form.allowParallel")}
          testID="project-todo-form-parallel"
        />
      </Field>
    </AdaptiveModalSheet>
  );
}

/** Edit the markdown plan. Kept separate: plans are long and saved on their own RPC. */
export function TodoPlanSheet({
  initialPlan,
  pending,
  onSubmit,
  onClose,
}: {
  initialPlan: string;
  pending: boolean;
  onSubmit: (plan: string) => Promise<boolean>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [plan, setPlan] = useState(initialPlan);
  const handleSubmit = useCallback(async () => {
    if (await onSubmit(plan)) onClose();
  }, [onClose, onSubmit, plan]);
  const header = useMemo<SheetHeader>(() => ({ title: t("projectTodos.plan.title") }), [t]);
  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="secondary"
          style={styles.footerButton}
          onPress={onClose}
          disabled={pending}
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          variant="default"
          style={styles.footerButton}
          onPress={handleSubmit}
          loading={pending}
          testID="project-todo-plan-save"
        >
          {t("projectTodos.actions.save")}
        </Button>
      </View>
    ),
    [handleSubmit, onClose, pending, t],
  );
  return (
    <AdaptiveModalSheet
      header={header}
      visible
      onClose={onClose}
      footer={footer}
      desktopMaxWidth={720}
      sizeContentToCurrentSnapPoint
      testID="project-todo-plan-form"
    >
      <Field label={t("projectTodos.plan.label")}>
        <SettingsTextArea
          accessibilityLabel={t("projectTodos.plan.label")}
          value={plan}
          onChangeText={setPlan}
          placeholder={t("projectTodos.plan.placeholder")}
          style={styles.planInput}
          testID="project-todo-plan-input"
        />
      </Field>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
  footerButton: {
    flex: 1,
  },
  planInput: {
    minHeight: 320,
    fontFamily: theme.fontFamily.mono,
  },
}));
