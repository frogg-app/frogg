import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderAccountState } from "@frogg/protocol/provider-accounts";
import type { AgentModelDefinition } from "@frogg/protocol/agent-types";
import { Button } from "@/components/ui/button";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";
import { Switch } from "@/components/ui/switch";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { useHostFeature } from "@/runtime/host-features";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { selectProviderAccounts } from "@/provider-accounts/model";
import { useProviderAccounts } from "@/provider-accounts/use-provider-accounts";

const ACCESSIBILITY_STATE_SELECTED = { selected: true };
const ACCESSIBILITY_STATE_UNSELECTED = { selected: false };

interface AccountChipProps {
  account: ProviderAccountState;
  isSelected: boolean;
  summary: { label: string; variant: StatusBadgeVariant };
  onSelect: (accountId: string) => void;
}

function AccountChip({ account, isSelected, summary, onSelect }: AccountChipProps) {
  const handlePress = useCallback(() => onSelect(account.id), [account.id, onSelect]);
  return (
    <Pressable
      style={[styles.chip, isSelected ? styles.chipSelected : null]}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={
        isSelected ? ACCESSIBILITY_STATE_SELECTED : ACCESSIBILITY_STATE_UNSELECTED
      }
      testID={`provider-settings-models-account-${account.id}`}
    >
      <Text style={styles.chipLabel} numberOfLines={1}>
        {account.name}
      </Text>
      <View testID={`provider-settings-models-state-${account.id}`}>
        <StatusBadge label={summary.label} variant={summary.variant} />
      </View>
    </Pressable>
  );
}

interface ModelRowProps {
  model: AgentModelDefinition;
  isFirst: boolean;
  isAllowed: boolean;
  busy: boolean;
  showToggle: boolean;
  onToggle: (modelId: string, next: boolean) => void;
}

function ModelRow({ model, isFirst, isAllowed, busy, showToggle, onToggle }: ModelRowProps) {
  const handleValueChange = useCallback(
    (next: boolean) => onToggle(model.id, next),
    [model.id, onToggle],
  );
  return (
    <View
      style={[settingsStyles.row, isFirst ? null : settingsStyles.rowBorder]}
      testID={`provider-settings-model-row-${model.id}`}
    >
      <View style={settingsStyles.rowContent}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {model.label}
        </Text>
        <Text style={styles.modelId} numberOfLines={1}>
          {model.id}
        </Text>
      </View>
      {showToggle ? (
        <Switch
          value={isAllowed}
          disabled={busy}
          onValueChange={handleValueChange}
          accessibilityLabel={model.label}
          testID={`provider-settings-model-toggle-${model.id}`}
        />
      ) : null}
    </View>
  );
}

export interface ModelsSectionProps {
  serverId: string;
  providerId: string;
}

/**
 * `allowedModels` is a tri-state on the wire: absent means unrestricted, `[]`
 * means the account may run nothing, and a list means exactly that list. The
 * badge below is the only place that distinction is rendered, so keep the three
 * cases visibly different.
 */
export function restrictionSummary(
  account: ProviderAccountState,
  total: number,
  t: (key: string, options?: Record<string, unknown>) => string,
): { label: string; variant: StatusBadgeVariant } {
  if (account.allowedModels === undefined) {
    return {
      label: t("settings.providers.settingsModal.models.unrestricted"),
      variant: "success",
    };
  }
  if (account.allowedModels.length === 0) {
    return {
      label: t("settings.providers.settingsModal.models.none"),
      variant: "error",
    };
  }
  return {
    label: t("settings.providers.settingsModal.models.restrictedCount", {
      allowed: account.allowedModels.length,
      total,
    }),
    variant: "warning",
  };
}

export function ModelsSection({ serverId, providerId }: ModelsSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const { entries } = useProvidersSnapshot(serverId);
  const accounts = useProviderAccounts(serverId);
  const canRestrict = useHostFeature(serverId, "providerAccountAllowedModels");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const models = useMemo(() => {
    const entry = entries?.find((candidate) => candidate.provider === providerId);
    return filterSelectableModels(entry?.models ?? null) ?? [];
  }, [entries, providerId]);

  const providerAccounts = useMemo(
    () => selectProviderAccounts(accounts.payload?.accounts ?? [], providerId),
    [accounts.payload, providerId],
  );

  const selected = useMemo(
    () => providerAccounts.find((account) => account.id === selectedAccountId) ?? null,
    [providerAccounts, selectedAccountId],
  );

  const setAllowedMutate = accounts.setAllowedModels.mutateAsync;
  const write = useCallback(
    (accountId: string, allowedModels: string[] | null) => {
      setError(null);
      void (async () => {
        try {
          const payload = await setAllowedMutate({ accountId, allowedModels });
          setError(payload.error);
        } catch (cause: unknown) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    },
    [setAllowedMutate],
  );

  const toggleModel = useCallback(
    (modelId: string, next: boolean) => {
      if (!selected) return;
      // Absent means unrestricted, so the first denial has to start from the
      // full catalogue rather than from an empty list.
      const current = selected.allowedModels ?? models.map((model) => model.id);
      const allowed = next
        ? [...new Set([...current, modelId])]
        : current.filter((id) => id !== modelId);
      write(selected.id, allowed);
    },
    [models, selected, write],
  );

  const busy = accounts.setAllowedModels.isPending;

  const handleSelectAccount = useCallback((accountId: string) => {
    setSelectedAccountId((current) => (current === accountId ? null : accountId));
  }, []);

  const handleAllowAll = useCallback(() => {
    if (selected) write(selected.id, null);
  }, [selected, write]);

  const handleAllowNone = useCallback(() => {
    if (selected) write(selected.id, []);
  }, [selected, write]);

  if (models.length === 0) {
    return (
      <SettingsSection
        title={t("settings.providers.settingsModal.models.title")}
        testID="provider-settings-models-section"
        flush
      >
        <View style={settingsStyles.card}>
          <Text style={styles.message} testID="provider-settings-models-empty">
            {t("settings.providers.settingsModal.models.empty")}
          </Text>
        </View>
      </SettingsSection>
    );
  }

  // Without the daemon flag the restriction affordances are not rendered at
  // all; the catalogue stays readable.
  const showRestrictions = canRestrict && accounts.supported && providerAccounts.length > 0;

  return (
    <SettingsSection
      title={t("settings.providers.settingsModal.models.title")}
      info={showRestrictions ? t("settings.providers.settingsModal.models.info") : undefined}
      testID="provider-settings-models-section"
      flush
    >
      {showRestrictions ? (
        <View style={styles.accountPicker} testID="provider-settings-models-accounts">
          {providerAccounts.map((account) => {
            const summary = restrictionSummary(account, models.length, t);
            const isSelected = account.id === selected?.id;
            return (
              <AccountChip
                key={account.id}
                account={account}
                isSelected={isSelected}
                summary={summary}
                onSelect={handleSelectAccount}
              />
            );
          })}
        </View>
      ) : null}

      {showRestrictions && !selected ? (
        <Text style={styles.message} testID="provider-settings-models-select-hint">
          {t("settings.providers.settingsModal.models.selectAccount")}
        </Text>
      ) : null}

      <View style={settingsStyles.card}>
        {models.map((model, index) => {
          const allowed = selected ? (selected.allowedModels ?? null) : null;
          const isAllowed = allowed === null || allowed.includes(model.id);
          return (
            <ModelRow
              key={model.id}
              model={model}
              isFirst={index === 0}
              isAllowed={isAllowed}
              busy={busy}
              showToggle={Boolean(showRestrictions && selected)}
              onToggle={toggleModel}
            />
          );
        })}
      </View>

      {showRestrictions && selected ? (
        <View style={styles.actions}>
          <Text style={styles.message}>
            {t("settings.providers.settingsModal.models.restrictionHint")}
          </Text>
          <View style={styles.actionsRow}>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || selected.allowedModels === undefined}
              onPress={handleAllowAll}
              testID="provider-settings-models-allow-all"
            >
              {t("settings.providers.settingsModal.models.allowAll")}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || selected.allowedModels?.length === 0}
              onPress={handleAllowNone}
              testID="provider-settings-models-allow-none"
            >
              {t("settings.providers.settingsModal.models.allowNone")}
            </Button>
          </View>
        </View>
      ) : null}

      {error ? (
        <Text style={settingsStyles.rowError} testID="provider-settings-models-error">
          {error}
        </Text>
      ) : null}
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  modelId: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  accountPicker: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    marginBottom: theme.spacing[2],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  chipSelected: {
    borderColor: theme.colors.primary,
    backgroundColor: theme.colors.muted,
  },
  chipLabel: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  actions: {
    gap: theme.spacing[2],
    marginTop: theme.spacing[2],
  },
  actionsRow: {
    flexDirection: "row",
    gap: theme.spacing[2],
  },
}));
