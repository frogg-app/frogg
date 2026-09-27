import { useCallback, useMemo } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { CircleCheck, Circle, X } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import type { FocusChecklistStep, FocusChecklistStepId } from "./focus-model";

const ICON = 15;
const accentIcon = (theme: Theme) => ({ color: theme.colors.accent });
const faintIcon = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });
const ThemedCheck = withUnistyles(CircleCheck);
const ThemedCircle = withUnistyles(Circle);
const ThemedX = withUnistyles(X);

/**
 * Devin's "Get started" card: a progress count and bar, then one row per step. Finished steps are
 * checked and drawn as links; open ones run the action that would finish them.
 * preview copy
 */
export function FocusChecklist({
  steps,
  onStep,
  onDismiss,
}: {
  steps: FocusChecklistStep[];
  onStep: (id: FocusChecklistStepId) => void;
  onDismiss: () => void;
}) {
  const done = steps.filter((step) => step.done).length;
  const fillStyle = useMemo(
    () => [styles.progressFill, { width: `${(done / steps.length) * 100}%` as const }],
    [done, steps.length],
  );
  return (
    <View style={styles.card} testID="focus-checklist">
      <View style={styles.header}>
        <Text style={styles.title}>Get started</Text>
        <View style={styles.progressGroup}>
          <Text style={styles.progressText}>{`${done} of ${steps.length}`}</Text>
          <View style={styles.progressTrack}>
            <View style={fillStyle} />
          </View>
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss"
            hitSlop={6}
            style={styles.dismiss}
          >
            <ThemedX size={13} uniProps={faintIcon} />
          </Pressable>
        </View>
      </View>
      <View style={styles.rows}>
        {steps.map((step) => (
          <ChecklistRow key={step.id} step={step} onStep={onStep} />
        ))}
      </View>
    </View>
  );
}

function ChecklistRow({
  step,
  onStep,
}: {
  step: FocusChecklistStep;
  onStep: (id: FocusChecklistStepId) => void;
}) {
  const handlePress = useCallback(() => onStep(step.id), [onStep, step.id]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      (hovered || pressed) && styles.rowHover,
    ],
    [],
  );
  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={step.done ? CHECKED : UNCHECKED}
      testID={`focus-checklist-${step.id}`}
    >
      {step.done ? (
        <ThemedCheck size={ICON} uniProps={accentIcon} />
      ) : (
        <ThemedCircle size={ICON} uniProps={faintIcon} />
      )}
      <Text style={step.done ? styles.labelDone : styles.label}>{step.label}</Text>
    </Pressable>
  );
}

const CHECKED = { checked: true } as const;
const UNCHECKED = { checked: false } as const;

const styles = StyleSheet.create((theme) => ({
  card: {
    width: "100%",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeight.medium,
  },
  progressGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  progressText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  progressTrack: {
    width: 56,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  progressFill: {
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.accent,
  },
  dismiss: {
    marginLeft: theme.spacing[1],
  },
  rows: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    paddingVertical: theme.spacing[1],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    paddingVertical: 7,
  },
  rowHover: {
    backgroundColor: theme.colors.surface1,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: 13,
  },
  labelDone: {
    color: theme.colors.accent,
    fontSize: 13,
  },
}));
