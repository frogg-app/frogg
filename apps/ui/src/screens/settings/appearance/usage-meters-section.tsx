import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Switch } from "@/components/ui/switch";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useAppSettings } from "@/hooks/use-settings";
import {
  DEFAULT_USAGE_METER_PREFERENCES,
  normalizeUsageThresholds,
  parseUsageRefreshInterval,
  type UsageMeterPreferences,
} from "@/provider-usage/meter-preferences";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface ToggleRowProps {
  title: string;
  hint: string;
  value: boolean;
  withBorder?: boolean;
  onChange: (value: boolean) => void;
}

function ToggleRow({ title, hint, value, withBorder = true, onChange }: ToggleRowProps) {
  return (
    <View style={withBorder ? [settingsStyles.row, settingsStyles.rowBorder] : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={title} />
    </View>
  );
}

interface NumberRowProps {
  title: string;
  hint: string;
  unit: string;
  draft: string;
  onChangeDraft: (value: string) => void;
  onCommit: () => void;
}

function NumberRow({ title, hint, unit, draft, onChangeDraft, onCommit }: NumberRowProps) {
  const handleChange = useCallback(
    (value: string) => onChangeDraft(value.replace(/[^\d]/g, "")),
    [onChangeDraft],
  );
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={styles.field}>
        <TextInput
          initialValue={draft}
          onChangeText={handleChange}
          onBlur={onCommit}
          onSubmitEditing={onCommit}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          style={styles.input}
          accessibilityLabel={title}
        />
        <Text style={styles.unit}>{unit}</Text>
      </View>
    </View>
  );
}

/**
 * Usage-meter preferences, collapsed by default. Everything here is a second-order
 * adjustment to meters that already work out of the box, so it stays folded away rather
 * than adding six rows to a page people open to change their theme.
 */
export function UsageMetersSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const preferences = settings.usageMeters ?? DEFAULT_USAGE_METER_PREFERENCES;
  const [expanded, setExpanded] = useState(false);
  const [intervalDraft, setIntervalDraft] = useState(() =>
    String(preferences.refreshIntervalSeconds),
  );
  const [warningDraft, setWarningDraft] = useState(() => String(preferences.warningThresholdPct));
  const [criticalDraft, setCriticalDraft] = useState(() =>
    String(preferences.criticalThresholdPct),
  );

  const patch = useCallback(
    (updates: Partial<UsageMeterPreferences>) => {
      void updateSettings((current) => ({
        usageMeters: {
          ...(current.usageMeters ?? DEFAULT_USAGE_METER_PREFERENCES),
          ...updates,
        },
      }));
    },
    [updateSettings],
  );

  const toggleExpanded = useCallback(() => setExpanded((value) => !value), []);
  const setRefreshWhileFocused = useCallback(
    (refreshWhileFocused: boolean) => patch({ refreshWhileFocused }),
    [patch],
  );
  const setRefreshOnHover = useCallback(
    (refreshOnHover: boolean) => patch({ refreshOnHover }),
    [patch],
  );
  const setRefreshOnAgentResponse = useCallback(
    (refreshOnAgentResponse: boolean) => patch({ refreshOnAgentResponse }),
    [patch],
  );
  const setAnimate = useCallback((animate: boolean) => patch({ animate }), [patch]);

  const commitInterval = useCallback(() => {
    const next = parseUsageRefreshInterval(intervalDraft);
    setIntervalDraft(String(next));
    if (next !== preferences.refreshIntervalSeconds) patch({ refreshIntervalSeconds: next });
  }, [intervalDraft, patch, preferences.refreshIntervalSeconds]);

  // Both thresholds commit through the same normalizer, so nudging amber past red pushes red
  // up rather than leaving a pair where the second colour could never be reached.
  const commitThresholds = useCallback(
    (input: { warning?: string; critical?: string }) => {
      const next = normalizeUsageThresholds({
        warningThresholdPct: Number.parseInt(input.warning ?? warningDraft, 10) || 0,
        criticalThresholdPct: Number.parseInt(input.critical ?? criticalDraft, 10) || 0,
      });
      setWarningDraft(String(next.warningThresholdPct));
      setCriticalDraft(String(next.criticalThresholdPct));
      if (
        next.warningThresholdPct !== preferences.warningThresholdPct ||
        next.criticalThresholdPct !== preferences.criticalThresholdPct
      ) {
        patch(next);
      }
    },
    [criticalDraft, patch, preferences, warningDraft],
  );

  const commitWarning = useCallback(() => commitThresholds({}), [commitThresholds]);
  const commitCritical = useCallback(() => commitThresholds({}), [commitThresholds]);

  const accessibilityState = useMemo(() => ({ expanded }), [expanded]);

  const summary = useMemo(() => {
    if (!preferences.refreshWhileFocused || preferences.refreshIntervalSeconds <= 0) {
      return t("settings.appearance.usage.summaryManual");
    }
    return t("settings.appearance.usage.summary", {
      seconds: preferences.refreshIntervalSeconds,
    });
  }, [preferences.refreshIntervalSeconds, preferences.refreshWhileFocused, t]);

  return (
    <SettingsSection title={t("settings.appearance.usage.title")}>
      <View style={settingsStyles.card}>
        <Pressable
          style={settingsStyles.row}
          onPress={toggleExpanded}
          accessibilityRole="button"
          accessibilityState={accessibilityState}
          accessibilityLabel={t("settings.appearance.usage.title")}
          testID="settings-usage-meters-disclosure"
        >
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.appearance.usage.heading")}</Text>
            <Text style={settingsStyles.rowHint}>{summary}</Text>
          </View>
          {expanded ? (
            <ThemedChevronDown size={ICON_SIZE.md} uniProps={mutedColorMapping} />
          ) : (
            <ThemedChevronRight size={ICON_SIZE.md} uniProps={mutedColorMapping} />
          )}
        </Pressable>
        {expanded ? (
          <View testID="settings-usage-meters-body">
            <ToggleRow
              title={t("settings.appearance.usage.refreshWhileFocused.label")}
              hint={t("settings.appearance.usage.refreshWhileFocused.description")}
              value={preferences.refreshWhileFocused}
              onChange={setRefreshWhileFocused}
            />
            <NumberRow
              title={t("settings.appearance.usage.interval.label")}
              hint={t("settings.appearance.usage.interval.description")}
              unit={t("settings.appearance.usage.interval.unit")}
              draft={intervalDraft}
              onChangeDraft={setIntervalDraft}
              onCommit={commitInterval}
            />
            <ToggleRow
              title={t("settings.appearance.usage.refreshOnHover.label")}
              hint={t("settings.appearance.usage.refreshOnHover.description")}
              value={preferences.refreshOnHover}
              onChange={setRefreshOnHover}
            />
            <ToggleRow
              title={t("settings.appearance.usage.refreshOnAgentResponse.label")}
              hint={t("settings.appearance.usage.refreshOnAgentResponse.description")}
              value={preferences.refreshOnAgentResponse}
              onChange={setRefreshOnAgentResponse}
            />
            <NumberRow
              title={t("settings.appearance.usage.warningThreshold.label")}
              hint={t("settings.appearance.usage.warningThreshold.description")}
              unit="%"
              draft={warningDraft}
              onChangeDraft={setWarningDraft}
              onCommit={commitWarning}
            />
            <NumberRow
              title={t("settings.appearance.usage.criticalThreshold.label")}
              hint={t("settings.appearance.usage.criticalThreshold.description")}
              unit="%"
              draft={criticalDraft}
              onChangeDraft={setCriticalDraft}
              onCommit={commitCritical}
            />
            <ToggleRow
              title={t("settings.appearance.usage.animate.label")}
              hint={t("settings.appearance.usage.animate.description")}
              value={preferences.animate}
              onChange={setAnimate}
            />
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  input: {
    width: 64,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "right",
  },
  unit: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));
