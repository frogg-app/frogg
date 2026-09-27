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
import { ProviderAccountComboboxOption } from "@/composer/agent-controls/provider-account-control";

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
  /**
   * COMPAT(agentCleanCut): added in v1.6.2. Moves with a summary instead of the
   * whole context. Absent on a daemon that cannot make a clean cut.
   */
  onCleanCut?: (optionId: string) => void;
  cleanCutPending?: boolean;
  /** Host and provider the accounts belong to; needed for each row's usage. */
  serverId?: string | null;
  provider?: string | null;
  /** The account the agent runs as today, listed first for comparison. */
  current?: { id: string; label: string } | null;
  /**
   * COMPAT(agentCleanCut): added in v1.6.2. Other enabled providers the
   * conversation can move to with a clean cut. Absent or empty hides the
   * provider switch.
   */
  otherProviders?: readonly { provider: string; label: string }[];
  onSwitchProvider?: (provider: string) => void;
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
  onCleanCut,
  cleanCutPending = false,
  serverId,
  provider,
  current,
  otherProviders,
  onSwitchProvider,
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
  const busy = isPending || cleanCutPending;
  const canConfirm = !busy && selected !== null && selected.authenticated;

  const header = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.account.transfer.title") }),
    [t],
  );

  const providerOptions = useMemo<SelectFieldOption<string>[]>(
    () =>
      (otherProviders ?? []).map((entry) => ({
        id: entry.provider,
        value: entry.provider,
        label: entry.label,
        testID: `provider-account-transfer-provider-${entry.provider}`,
      })),
    [otherProviders],
  );
  const noProviderDisplay = useMemo<SelectFieldDisplay | null>(() => null, []);
  const handleSwitchProvider = useCallback(
    (value: string) => onSwitchProvider?.(value),
    [onSwitchProvider],
  );
  const showProviderSwitch = Boolean(onSwitchProvider) && providerOptions.length > 0;

  const unauthenticatedLabel = t("agentControls.account.notSignedIn");
  const inUseLabel = t("agentControls.account.transfer.inUse");
  const iconColor = styles.optionIconColor.color;
  const warningColor = styles.warningIconColor.color;

  const handleConfirm = useCallback(() => {
    if (canConfirm && selected) onConfirm(selected.id);
  }, [canConfirm, onConfirm, selected]);
  const handleCleanCut = useCallback(() => {
    if (canConfirm && selected) onCleanCut?.(selected.id);
  }, [canConfirm, onCleanCut, selected]);

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
        <View style={styles.section}>
          <Text style={styles.sectionLabel}>{t("agentControls.account.transfer.targetLabel")}</Text>
          <View style={styles.accountList} testID="provider-account-transfer-target">
            {current ? (
              <ProviderAccountComboboxOption
                option={current}
                account={CURRENT_ACCOUNT}
                description={inUseLabel}
                selected={false}
                active={false}
                onPress={noop}
                iconColor={iconColor}
                warningColor={warningColor}
                unauthenticatedLabel={unauthenticatedLabel}
                serverId={serverId}
                provider={provider}
              />
            ) : null}
            {options.length === 0 ? (
              <Text style={styles.hint}>{t("agentControls.account.transfer.noTargets")}</Text>
            ) : (
              options.map((option) => (
                <TransferAccountRow
                  key={option.id}
                  option={option}
                  selected={option.id === selectedId}
                  disabled={busy}
                  onSelect={setSelectedId}
                  iconColor={iconColor}
                  warningColor={warningColor}
                  unauthenticatedLabel={unauthenticatedLabel}
                  serverId={serverId}
                  provider={provider}
                />
              ))
            )}
          </View>
        </View>

        <Alert variant="warning" description={cost} testID="provider-account-transfer-warning" />

        {onCleanCut ? (
          <Text style={styles.hint} testID="provider-account-transfer-clean-cut-hint">
            {t("agentControls.account.transfer.cleanCutHint")}
          </Text>
        ) : null}

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
            disabled={busy}
            testID="provider-account-transfer-cancel"
          >
            {t("common.actions.cancel")}
          </Button>
          <Button
            variant={onCleanCut ? "secondary" : "default"}
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
        {onCleanCut ? (
          <Button
            variant="default"
            size="sm"
            onPress={handleCleanCut}
            disabled={!canConfirm}
            loading={cleanCutPending}
            testID="provider-account-transfer-clean-cut"
          >
            {cleanCutPending
              ? t("composer.cleanCut.pending")
              : t("agentControls.account.transfer.cleanCut")}
          </Button>
        ) : null}

        {showProviderSwitch ? (
          <View style={styles.providerSwitch}>
            <SelectField
              label={t("agentControls.account.transfer.providerLabel")}
              value={null}
              selectedDisplay={noProviderDisplay}
              options={providerOptions}
              onChange={handleSwitchProvider}
              placeholder={t("agentControls.account.transfer.providerPlaceholder")}
              emptyText={t("agentControls.account.transfer.noTargets")}
              disabled={busy}
              triggerTestID="provider-account-transfer-provider"
            />
          </View>
        ) : null}
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

function noop(): void {}

const CURRENT_ACCOUNT = { authenticated: true };

/** A target row; binds its own press so the list stays free of inline closures. */
function TransferAccountRow({
  option,
  selected,
  disabled,
  onSelect,
  iconColor,
  warningColor,
  unauthenticatedLabel,
  serverId,
  provider,
}: {
  option: ProviderAccountTransferOption;
  selected: boolean;
  disabled: boolean;
  onSelect: (id: string) => void;
  iconColor: string;
  warningColor: string;
  unauthenticatedLabel: string;
  serverId: string | null | undefined;
  provider: string | null | undefined;
}): ReactElement {
  const handlePress = useCallback(() => {
    if (!disabled && option.authenticated) onSelect(option.id);
  }, [disabled, onSelect, option.authenticated, option.id]);
  return (
    <ProviderAccountComboboxOption
      option={option}
      account={option}
      selected={selected}
      active={false}
      onPress={handlePress}
      iconColor={iconColor}
      warningColor={warningColor}
      unauthenticatedLabel={unauthenticatedLabel}
      serverId={serverId}
      provider={provider}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  optionIconColor: {
    color: theme.colors.foreground,
  },
  warningIconColor: {
    color: theme.colors.statusWarning,
  },
  section: {
    gap: theme.spacing[2],
  },
  sectionLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  accountList: {
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: "hidden",
  },
  providerSwitch: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[3],
  },
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
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
