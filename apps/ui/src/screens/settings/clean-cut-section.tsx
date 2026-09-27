/**
 * COMPAT(cleanCutSettings): added in v1.6.5, remove after 2027-09-27.
 *
 * The host's clean cut settings: which automatic resumes cut first, how long
 * a conversation may sit idle before it counts as cold, and which model writes
 * the summary, globally and per provider. Older daemons do not report
 * `cleanCut` and get no section.
 */
import { useCallback, useMemo, useState } from "react";
import { Alert, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { AgentProvider } from "@frogg/protocol/agent-types";
import {
  CLEAN_CUT_IDLE_THRESHOLD_MAX_MINUTES,
  type CleanCutSummaryModel,
  type MutableCleanCutConfigPatch,
} from "@frogg/protocol/messages";
import { brandDocsUrl } from "@/branding/links";
import { CombinedModelSelector } from "@/components/combined-model-selector";
import { Button } from "@/components/ui/button";
import { ExternalLink } from "@/components/ui/external-link";
import { Switch } from "@/components/ui/switch";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import {
  buildSelectableProviderSelectorProviders,
  type ProviderSelectorProvider,
} from "@/provider-selection/provider-selection";
import {
  inheritedThresholdMinutes,
  listOverrideProviders,
  parseThresholdDraft,
} from "@/screens/settings/clean-cut-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

const CLEAN_CUT_DOCS_URL = brandDocsUrl("using-frogg/clean-cut/#settings");

type SaveCleanCut = (patch: MutableCleanCutConfigPatch) => Promise<void>;

export function CleanCutSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { config, patchConfig } = useDaemonConfig(serverId);
  const snapshot = useProvidersSnapshot(serverId);
  const providers = useMemo(
    () => buildSelectableProviderSelectorProviders(snapshot.entries),
    [snapshot.entries],
  );
  const [isSaving, setIsSaving] = useState(false);
  const cleanCut = config?.cleanCut;

  const save = useCallback<SaveCleanCut>(
    async (patch) => {
      setIsSaving(true);
      try {
        await patchConfig({ cleanCut: patch });
      } catch (error) {
        Alert.alert(
          t("settings.cleanCut.saveError"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        setIsSaving(false);
      }
    },
    [patchConfig, t],
  );
  const setUsageLimit = useCallback(
    (usageLimit: boolean) => void save({ auto: { usageLimit } }),
    [save],
  );
  const setDaemonRestart = useCallback(
    (daemonRestart: boolean) => void save({ auto: { daemonRestart } }),
    [save],
  );
  const modelPicker = useMemo(
    () => ({
      providers,
      isLoading: snapshot.isLoading || snapshot.isFetching,
      onOpen: () => snapshot.refetchIfStale(),
      onRetryProvider: (provider: AgentProvider) => snapshot.refresh([provider]),
      isRetryingProvider: snapshot.isRefreshing,
    }),
    [providers, snapshot],
  );
  const docsLink = useMemo(
    () => <ExternalLink href={CLEAN_CUT_DOCS_URL} label={t("settings.cleanCut.docs")} />,
    [t],
  );

  if (!cleanCut) return null;
  const overrideProviders = listOverrideProviders(providers, cleanCut);

  return (
    <SettingsSection
      title={t("settings.cleanCut.title")}
      info={t("settings.cleanCut.description")}
      trailing={docsLink}
      testID="clean-cut-settings"
    >
      <View style={settingsStyles.card}>
        <ToggleRow
          title={t("settings.cleanCut.auto.usageLimit")}
          hint={t("settings.cleanCut.auto.usageLimitHint")}
          value={cleanCut.auto.usageLimit}
          onChange={setUsageLimit}
          testID="clean-cut-auto-usage-limit"
        />
        <ToggleRow
          title={t("settings.cleanCut.auto.daemonRestart")}
          hint={t("settings.cleanCut.auto.daemonRestartHint")}
          value={cleanCut.auto.daemonRestart}
          onChange={setDaemonRestart}
          withBorder
          testID="clean-cut-auto-daemon-restart"
        />
      </View>

      <View style={[settingsStyles.card, styles.cardGap]}>
        <ThresholdField
          title={t("settings.cleanCut.threshold.title")}
          hint={t("settings.cleanCut.threshold.hint")}
          value={cleanCut.idleThresholdMinutes ?? null}
          placeholder={t("settings.cleanCut.threshold.providerDefault")}
          onSave={(minutes) => save({ idleThresholdMinutes: minutes })}
          testID="clean-cut-threshold"
        />
        <SummaryModelField
          title={t("settings.cleanCut.summaryModel.title")}
          hint={t("settings.cleanCut.summaryModel.hint")}
          value={cleanCut.summaryModel ?? null}
          onSave={(summaryModel) => save({ summaryModel })}
          picker={modelPicker}
          disabled={isSaving}
          serverId={serverId}
          testID="clean-cut-summary-model"
        />
      </View>

      {overrideProviders.length > 0 ? (
        <View style={[settingsStyles.card, styles.cardGap]}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.cleanCut.providers.title")}</Text>
              <Text style={settingsStyles.rowHint}>{t("settings.cleanCut.providers.hint")}</Text>
            </View>
          </View>
          {overrideProviders.map((provider) => {
            const override = cleanCut.providers[provider.id];
            const inherited = inheritedThresholdMinutes(provider.id, cleanCut);
            return (
              <View key={provider.id} style={[styles.providerBlock, settingsStyles.rowBorder]}>
                <ThresholdField
                  title={t("settings.cleanCut.providers.threshold", { provider: provider.label })}
                  hint={
                    inherited === null
                      ? t("settings.cleanCut.providers.notCutByDefault")
                      : t("settings.cleanCut.providers.inherited", { minutes: inherited })
                  }
                  value={override?.idleThresholdMinutes ?? null}
                  placeholder={
                    inherited === null ? t("settings.cleanCut.threshold.off") : String(inherited)
                  }
                  onSave={(minutes) =>
                    save({ providers: { [provider.id]: { idleThresholdMinutes: minutes } } })
                  }
                  compact
                  testID={`clean-cut-provider-${provider.id}-threshold`}
                />
                <SummaryModelField
                  title={t("settings.cleanCut.providers.summaryModel", {
                    provider: provider.label,
                  })}
                  hint={t("settings.cleanCut.providers.summaryModelHint")}
                  value={override?.summaryModel ?? null}
                  onSave={(summaryModel) =>
                    save({ providers: { [provider.id]: { summaryModel } } })
                  }
                  picker={modelPicker}
                  disabled={isSaving}
                  serverId={serverId}
                  compact
                  testID={`clean-cut-provider-${provider.id}-summary-model`}
                />
              </View>
            );
          })}
        </View>
      ) : null}
    </SettingsSection>
  );
}

function ToggleRow({
  title,
  hint,
  value,
  onChange,
  withBorder = false,
  testID,
}: {
  title: string;
  hint: string;
  value: boolean;
  onChange: (value: boolean) => void;
  withBorder?: boolean;
  testID: string;
}) {
  return (
    <View style={withBorder ? [settingsStyles.row, settingsStyles.rowBorder] : settingsStyles.row}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        accessibilityLabel={title}
        testID={`${testID}-switch`}
      />
    </View>
  );
}

/** Whole minutes; empty clears back to the inherited value. Commits on blur or submit. */
function ThresholdField({
  title,
  hint,
  value,
  placeholder,
  onSave,
  compact = false,
  testID,
}: {
  title: string;
  hint: string;
  value: number | null;
  placeholder: string;
  onSave: (minutes: number | null) => Promise<void>;
  compact?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const saved = value === null ? "" : String(value);
  const [draft, setDraft] = useState(saved);
  // The input is uncontrolled: a new key resets it to the saved value after a
  // rejected entry or a change made elsewhere.
  const [resetCount, setResetCount] = useState(0);
  const [lastSaved, setLastSaved] = useState(saved);
  if (lastSaved !== saved) {
    setLastSaved(saved);
    setDraft(saved);
    setResetCount((count) => count + 1);
  }

  const handleChange = useCallback((next: string) => setDraft(next.replace(/[^\d]/g, "")), []);
  const commit = useCallback(() => {
    const parsed = parseThresholdDraft(draft);
    if ("invalid" in parsed) {
      Alert.alert(
        t("settings.cleanCut.threshold.invalid", { max: CLEAN_CUT_IDLE_THRESHOLD_MAX_MINUTES }),
      );
      setDraft(saved);
      setResetCount((count) => count + 1);
      return;
    }
    if (parsed.minutes === value) return;
    void onSave(parsed.minutes);
  }, [draft, onSave, saved, t, value]);

  return (
    <View style={compact ? styles.compactRow : settingsStyles.row} testID={testID}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={styles.field}>
        <TextInput
          key={resetCount}
          initialValue={draft}
          onChangeText={handleChange}
          onBlur={commit}
          onSubmitEditing={commit}
          placeholder={placeholder}
          keyboardType="number-pad"
          inputMode="numeric"
          selectTextOnFocus
          style={styles.input}
          placeholderTextColor={styles.placeholder.color}
          accessibilityLabel={title}
          testID={`${testID}-input`}
        />
        <Text style={styles.unit}>{t("settings.cleanCut.threshold.unit")}</Text>
      </View>
    </View>
  );
}

interface ModelPicker {
  providers: ProviderSelectorProvider[];
  isLoading: boolean;
  onOpen: () => void;
  onRetryProvider: (provider: AgentProvider) => void;
  isRetryingProvider: boolean;
}

/** A model, or automatic (null): the next candidate in the daemon's summariser order. */
function SummaryModelField({
  title,
  hint,
  value,
  onSave,
  picker,
  disabled,
  serverId,
  compact = false,
  testID,
}: {
  title: string;
  hint: string;
  value: CleanCutSummaryModel | null;
  onSave: (model: CleanCutSummaryModel | null) => Promise<void>;
  picker: ModelPicker;
  disabled: boolean;
  serverId: string;
  compact?: boolean;
  testID: string;
}) {
  const { t } = useTranslation();
  const handleSelect = useCallback(
    (provider: AgentProvider, model: string) => {
      if (!model) return;
      void onSave({ provider, model });
    },
    [onSave],
  );
  const clear = useCallback(() => void onSave(null), [onSave]);

  return (
    <View style={compact ? styles.compactRow : [settingsStyles.row, settingsStyles.rowBorder]}>
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle}>{title}</Text>
        <Text style={settingsStyles.rowHint}>{hint}</Text>
      </View>
      <View style={styles.modelControls}>
        {value ? (
          <Button
            size="sm"
            variant="ghost"
            onPress={clear}
            disabled={disabled}
            testID={`${testID}-clear`}
          >
            {t("settings.cleanCut.summaryModel.automatic")}
          </Button>
        ) : null}
        <CombinedModelSelector
          providers={picker.providers}
          selectedProvider={value?.provider ?? ""}
          selectedModel={value?.model ?? ""}
          onSelect={handleSelect}
          isLoading={picker.isLoading}
          onOpen={picker.onOpen}
          onRetryProvider={picker.onRetryProvider}
          isRetryingProvider={picker.isRetryingProvider}
          disabled={disabled}
          serverId={serverId}
          desktopPlacement="bottom-start"
          desktopMinWidth={360}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  cardGap: {
    marginTop: theme.spacing[3],
  },
  providerBlock: {
    paddingVertical: theme.spacing[1],
  },
  compactRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    rowGap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  input: {
    width: 88,
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
  placeholder: {
    color: theme.colors.foregroundMuted,
  },
  unit: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  modelControls: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    flexShrink: 1,
  },
}));
