import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check, TriangleAlert } from "lucide-react-native";
import {
  parseProviderAccountDefaultId,
  PROVIDER_ACCOUNT_DEFAULT_NAME,
} from "@frogg/protocol/provider-accounts";
import type { ProviderSnapshotAccount } from "@frogg/protocol/agent-types";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { formatTokenCount } from "@/components/context-window-meter.utils";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedTriangleAlert = withUnistyles(TriangleAlert);
const ThemedCheck = withUnistyles(Check);
const warningColor = (theme: Theme) => ({ color: theme.colors.palette.amber[500] });
const selectedColor = (theme: Theme) => ({ color: theme.colors.foreground });

/**
 * The account rows a transfer can target: every account of the agent's provider
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
  /** The account the agent runs as today, for the row that is not offered. */
  currentLabel: string;
  options: readonly ProviderAccountTransferOption[];
  /**
   * The agent's context size, which is exactly what the move costs to re-send.
   * Null when the agent has not reported usage yet, and the warning then says
   * the same thing without a figure rather than inventing one.
   */
  contextTokens: number | null;
  isPending: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: (optionId: string) => void;
}

/**
 * Moving a conversation to another sign-in, with the bill stated before it is
 * run up.
 *
 * The warning is not a formality. The target account has never sent these
 * tokens upstream, so nothing in the conversation can come back as a cache
 * read: the entire context is re-sent as fresh input and charged at once. That
 * is the whole reason this is a modal rather than a menu item.
 */
export function ProviderAccountTransferModal({
  visible,
  currentLabel,
  options,
  contextTokens,
  isPending,
  error,
  onClose,
  onConfirm,
}: ProviderAccountTransferModalProps): ReactElement {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // A reopened sheet must not carry the previous pick, which would put the
  // warning about one account above a button that moves to another.
  useEffect(() => {
    if (!visible) setSelectedId(null);
  }, [visible]);

  const selected = useMemo(
    () => options.find((option) => option.id === selectedId) ?? null,
    [options, selectedId],
  );

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("agentControls.account.transfer.title"),
      subtitle: t("agentControls.account.transfer.subtitle", { name: currentLabel }),
    }),
    [currentLabel, t],
  );

  const handleConfirm = useCallback(() => {
    if (selected) onConfirm(selected.id);
  }, [onConfirm, selected]);

  return (
    <AdaptiveModalSheet
      visible={visible}
      onClose={onClose}
      header={header}
      testID="provider-account-transfer-modal"
    >
      <View style={styles.body}>
        <View style={styles.options}>
          {options.map((option) => (
            <TransferOptionRow
              key={option.id}
              option={option}
              isSelected={option.id === selectedId}
              disabled={isPending}
              onSelect={setSelectedId}
            />
          ))}
        </View>

        <View style={styles.warning} testID="provider-account-transfer-warning">
          <ThemedTriangleAlert size={ICON_SIZE.sm} uniProps={warningColor} />
          <View style={styles.warningText}>
            <Text style={styles.warningTitle}>
              {selected
                ? t("agentControls.account.transfer.warningTitle", { name: selected.label })
                : t("agentControls.account.transfer.warningTitleUnselected")}
            </Text>
            <Text style={styles.warningBody}>
              {contextTokens === null
                ? t("agentControls.account.transfer.warningBodyUnknownTokens")
                : t("agentControls.account.transfer.warningBody", {
                    tokens: formatTokenCount(contextTokens),
                  })}
            </Text>
          </View>
        </View>

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
            disabled={isPending || selected === null}
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

function TransferOptionRow({
  option,
  isSelected,
  disabled,
  onSelect,
}: {
  option: ProviderAccountTransferOption;
  isSelected: boolean;
  disabled: boolean;
  onSelect: (optionId: string) => void;
}): ReactElement {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onSelect(option.id), [onSelect, option.id]);
  const accessibilityState = useMemo(
    () => ({ selected: isSelected, disabled }),
    [disabled, isSelected],
  );

  return (
    <Pressable
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={accessibilityState}
      style={[styles.option, isSelected ? styles.optionSelected : null]}
      testID={`provider-account-transfer-option-${option.id}`}
    >
      <Text style={styles.optionLabel} numberOfLines={1}>
        {option.label}
      </Text>
      {option.authenticated ? null : (
        <StatusBadge label={t("agentControls.account.notSignedIn")} variant="warning" />
      )}
      {isSelected ? <ThemedCheck size={ICON_SIZE.sm} uniProps={selectedColor} /> : null}
    </Pressable>
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
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[2],
  },
  options: {
    gap: theme.spacing[1],
  },
  option: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  optionSelected: {
    borderColor: theme.colors.borderAccent,
    backgroundColor: theme.colors.surface2,
  },
  optionLabel: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  warning: {
    flexDirection: "row",
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.palette.amber[500],
    backgroundColor: theme.colors.surface0,
  },
  warningText: {
    flex: 1,
    gap: theme.spacing[1],
  },
  warningTitle: {
    color: theme.colors.palette.amber[500],
    fontSize: theme.fontSize.base,
  },
  warningBody: {
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
