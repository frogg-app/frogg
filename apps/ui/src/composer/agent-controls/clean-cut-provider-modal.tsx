/**
 * COMPAT(agentCleanCut): added in v1.7.0, remove after 2027-09-27.
 *
 * Confirms moving a live conversation to another provider. A provider cannot
 * resume another provider's transcript, so the only way across is a clean cut:
 * summarise, start fresh on the new provider, keep the old conversation on
 * screen. The sheet says so before it happens.
 */
import { useCallback, useMemo, useState, type ReactElement } from "react";
import type { ProviderSnapshotEntry } from "@frogg/protocol/agent-types";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { useCleanCut } from "@/composer/clean-cut";

export interface CleanCutProviderTarget {
  provider: string;
  providerLabel: string;
  model: string;
  modelLabel: string;
}

/**
 * Routes a model pick from the live agent's picker: the agent's own provider
 * switches model in place; another provider opens the confirmation, whose
 * confirm makes the clean cut onto that provider and model.
 */
export function useCleanCutProviderSwitch({
  serverId,
  agentId,
  agentProvider,
  snapshotEntries,
  onSelectSameProviderModel,
}: {
  serverId: string;
  agentId: string;
  agentProvider: string | undefined;
  snapshotEntries: readonly ProviderSnapshotEntry[] | undefined;
  onSelectSameProviderModel: (modelId: string) => unknown;
}) {
  const cleanCut = useCleanCut(serverId, agentId);
  const [target, setTarget] = useState<CleanCutProviderTarget | null>(null);
  const [error, setError] = useState<string | null>(null);

  const select = useCallback(
    (nextProvider: string, modelId: string) => {
      if (nextProvider === agentProvider) {
        void onSelectSameProviderModel(modelId);
        return;
      }
      const entry = snapshotEntries?.find((candidate) => candidate.provider === nextProvider);
      const model = entry?.models?.find((candidate) => candidate.id === modelId);
      setError(null);
      setTarget({
        provider: nextProvider,
        providerLabel: entry?.label ?? nextProvider,
        model: modelId,
        modelLabel: model?.label ?? modelId,
      });
    },
    [agentProvider, onSelectSameProviderModel, snapshotEntries],
  );
  const runCleanCut = cleanCut.run;
  const confirm = useCallback(
    (next: CleanCutProviderTarget) => {
      setError(null);
      void (async () => {
        const failure = await runCleanCut({ provider: next.provider, model: next.model });
        if (failure === null) {
          setTarget(null);
        } else {
          setError(failure);
        }
      })();
    },
    [runCleanCut],
  );
  const pending = cleanCut.pending;
  const close = useCallback(() => {
    if (!pending) setTarget(null);
  }, [pending]);

  const available = cleanCut.available;
  // The command center always offers every provider; without clean cut support
  // a pick there can only change the model.
  const selectAny = useCallback(
    (nextProvider: string, modelId: string) =>
      available ? select(nextProvider, modelId) : void onSelectSameProviderModel(modelId),
    [available, onSelectSameProviderModel, select],
  );
  const fromProviderLabel =
    snapshotEntries?.find((candidate) => candidate.provider === agentProvider)?.label ??
    agentProvider ??
    "";

  return {
    target,
    error,
    pending,
    fromProviderLabel,
    selectProviderAndModel: available ? select : undefined,
    selectAny,
    confirm,
    close,
  };
}

export function CleanCutProviderModal({
  target,
  fromProviderLabel,
  isPending,
  error,
  onClose,
  onConfirm,
}: {
  target: CleanCutProviderTarget | null;
  fromProviderLabel: string;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (target: CleanCutProviderTarget) => void;
}): ReactElement {
  const { t } = useTranslation();
  const header = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.cleanCutProvider.title") }),
    [t],
  );
  const handleConfirm = useCallback(() => {
    if (target) onConfirm(target);
  }, [onConfirm, target]);

  return (
    <AdaptiveModalSheet
      visible={target !== null}
      onClose={onClose}
      header={header}
      testID="clean-cut-provider-modal"
    >
      <View style={styles.body}>
        <Text style={styles.text}>
          {t("agentControls.cleanCutProvider.body", {
            from: fromProviderLabel,
            to: target?.providerLabel ?? "",
            model: target?.modelLabel ?? "",
          })}
        </Text>
        <Text style={styles.hint}>{t("agentControls.cleanCutProvider.hint")}</Text>

        {error ? (
          <Text style={styles.error} testID="clean-cut-provider-error">
            {error}
          </Text>
        ) : null}

        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            style={styles.actionButton}
            onPress={onClose}
            disabled={isPending}
            testID="clean-cut-provider-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            style={styles.actionButton}
            onPress={handleConfirm}
            disabled={isPending || target === null}
            loading={isPending}
            testID="clean-cut-provider-confirm"
          >
            {isPending
              ? t("composer.cleanCut.pending")
              : t("agentControls.cleanCutProvider.confirm")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  text: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.45,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  error: {
    color: theme.colors.palette.red[300],
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  actionButton: {
    flex: 1,
  },
}));
