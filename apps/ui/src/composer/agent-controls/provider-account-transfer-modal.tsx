import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  parseProviderAccountDefaultId,
  PROVIDER_ACCOUNT_DEFAULT_NAME,
} from "@frogg/protocol/provider-accounts";
import type { ProviderSnapshotAccount } from "@frogg/protocol/agent-types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";

/**
 * An account a transfer can target: every account of the agent's provider
 * except the one it already runs as. The Default row is included — moving back
 * onto the primary sign-in is as legitimate a move as any other.
 */
export interface ProviderAccountTransferOption {
  id: string;
  label: string;
  authenticated: boolean;
}

export interface ProviderAccountTransferModalProps {
  visible: boolean;
  /** Never includes the account the agent runs as today. */
  options: readonly ProviderAccountTransferOption[];
  /**
   * The agent's context size (the same figure the context meter shows), which
   * is exactly what the move re-sends. Null when unknown; the cost statement
   * then omits the figure rather than inventing one.
   */
  contextTokens: number | null;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (optionId: string) => void;
}

/**
 * Moving a conversation to another sign-in, with the cost stated before it is
 * run up: the target account has no cache for these tokens, so the whole
 * context is re-sent as fresh input at full price.
 */
export function ProviderAccountTransferModal({
  visible,
  options,
  contextTokens,
  isPending,
  error,
  onClose,
  onConfirm,
}: ProviderAccountTransferModalProps): ReactElement {
  const { t } = useTranslation();
  const onlyOptionId = options.length === 1 ? options[0].id : null;
  const [selectedId, setSelectedId] = useState<string | null>(onlyOptionId);

  // A reopened sheet starts fresh; a single destination is picked for the user.
  useEffect(() => {
    if (visible) setSelectedId(onlyOptionId);
  }, [visible, onlyOptionId]);

  const selected = useMemo(
    () => options.find((option) => option.id === selectedId) ?? null,
    [options, selectedId],
  );
  const canConfirm = !isPending && selected !== null && selected.authenticated;

  const header = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.account.transfer.title") }),
    [t],
  );

  const selectOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      options.map((option) => ({
        id: option.id,
        value: option.id,
        label: option.label,
        description: option.authenticated ? undefined : t("agentControls.account.notSignedIn"),
        testID: `provider-account-transfer-option-${option.id}`,
      })),
    [options, t],
  );
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(
    () => (selected ? { label: selected.label } : null),
    [selected],
  );

  const handleChange = useCallback((value: string) => setSelectedId(value), []);
  const handleConfirm = useCallback(() => {
    if (canConfirm && selected) onConfirm(selected.id);
  }, [canConfirm, onConfirm, selected]);

  const cost =
    contextTokens === null
      ? t("agentControls.account.transfer.costUnknownTokens")
      : t("agentControls.account.transfer.cost", { tokens: formatTokenCount(contextTokens) });

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="provider-account-transfer-modal"
    >
      <View style={styles.body}>
        <SelectField
          label={t("agentControls.account.transfer.targetLabel")}
          value={selectedId}
          selectedDisplay={selectedDisplay}
          options={selectOptions}
          onChange={handleChange}
          placeholder={t("agentControls.account.transfer.targetPlaceholder")}
          emptyText={t("agentControls.account.transfer.noTargets")}
          disabled={isPending}
          error={
            selected && !selected.authenticated ? t("agentControls.account.notSignedIn") : null
          }
          triggerTestID="provider-account-transfer-target"
        />

        <Alert variant="warning" description={cost} testID="provider-account-transfer-warning" />

        {error ? (
          <Text style={styles.error} testID="provider-account-transfer-error">
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
            testID="provider-account-transfer-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant="default"
            size="sm"
            style={styles.actionButton}
            onPress={handleConfirm}
            disabled={!canConfirm}
            loading={isPending}
            testID="provider-account-transfer-confirm"
          >
            {isPending
              ? t("agentControls.account.transfer.moving")
              : t("agentControls.account.transfer.confirm")}
          </Button>
        </View>
      </View>
    </AdaptiveModalSheet>
  );
}

/**
 * The label a transfer row carries. A provider's implicit default account is
 * stored under a reserved name, which is a protocol detail rather than
 * something to show, so it reads as the same "Default" the picker uses.
 */
export function providerAccountTransferLabel(
  account: Pick<ProviderSnapshotAccount, "id" | "name">,
  defaultLabel: string,
): string {
  const isDefault = parseProviderAccountDefaultId(account.id) !== null;
  return isDefault && account.name === PROVIDER_ACCOUNT_DEFAULT_NAME ? defaultLabel : account.name;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
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
