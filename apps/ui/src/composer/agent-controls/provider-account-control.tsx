import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TriangleAlert, UserRound } from "lucide-react-native";
import { type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import {
  resolveProviderAccountControlModel,
  toProviderAccountSelection,
  type ProviderAccountOption,
  type ProviderAccountSelection,
} from "@/composer/agent-controls/provider-account";
import { summarizeProviderUsage } from "@/provider-usage/account-summary";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { useHostFeature } from "@/runtime/host-features";
import type { ProviderSnapshotAccount } from "@frogg/protocol/agent-types";

/**
 * COMPAT(perAgentProviderAccounts): added in v1.3.6, remove after 2027-09-17.
 * Mirrors `AgentModeControlValue`: the owning surface supplies the data and the
 * setter, so this control has no data source of its own.
 */
export interface ProviderAccountControlValue {
  accounts: readonly ProviderSnapshotAccount[] | undefined;
  defaultAccountId: string | null | undefined;
  selectedAccountId: ProviderAccountSelection;
  onSelectAccount: (accountId: string | null) => void;
  disabled?: boolean;
  /**
   * A launched agent cannot change account: the provider process is already
   * running against one config dir. The pill stays on the toolbar so the agent's
   * account is still visible, but it is greyed out and never opens a dropdown.
   */
  readOnly?: boolean;
  /**
   * The host and provider the accounts belong to. Both are needed to ask the
   * daemon for a single account's usage; without them the rows carry no usage
   * line and look exactly as they did before.
   */
  serverId?: string | null;
  provider?: string | null;
}

/**
 * One account's rolling-window usage, as the single line shown under its name
 * in the picker. Each row owns its own query because the figures are per
 * sign-in: the daemon answers for one config directory at a time.
 */
function useProviderAccountUsageLine(input: {
  serverId: string | null | undefined;
  provider: string | null | undefined;
  accountId: string | null;
  enabled: boolean;
}): string | null {
  const { serverId, provider, accountId, enabled } = input;
  // An older daemon ignores the account scope and answers for its default
  // config dir, which would show every row the same numbers. Better to show
  // none than to attribute one account's usage to all of them.
  const accountScoped = useHostFeature(serverId, "providerUsageAccountScoped");
  const { view } = useProviderUsage(serverId, {
    enabled: enabled && accountScoped && Boolean(provider),
    provider: provider ?? undefined,
    providerAccountId: accountId,
  });
  return useMemo(
    () =>
      view.kind === "ready"
        ? summarizeProviderUsage(view.payload.providers, provider ?? undefined)
        : null,
    [provider, view],
  );
}

function ProviderAccountComboboxOption({
  option,
  account,
  selected,
  active,
  onPress,
  iconColor,
  warningColor,
  unauthenticatedLabel,
  serverId,
  provider,
}: {
  option: ComboboxOption;
  account: ProviderAccountOption | undefined;
  selected: boolean;
  active: boolean;
  onPress: () => void;
  iconColor: string;
  warningColor: string;
  unauthenticatedLabel: string;
  serverId: string | null | undefined;
  provider: string | null | undefined;
}) {
  const unauthenticated = account !== undefined && !account.authenticated;
  const usageLine = useProviderAccountUsageLine({
    serverId,
    provider,
    accountId: toProviderAccountSelection(option.id),
    // An account with no credentials on disk has nothing to report, and asking
    // would make the daemon shell out to a provider that cannot authenticate.
    enabled: !unauthenticated,
  });
  const leadingSlot = useMemo(
    () =>
      unauthenticated ? (
        <TriangleAlert size={16} color={warningColor} />
      ) : (
        <UserRound size={16} color={iconColor} />
      ),
    [iconColor, unauthenticated, warningColor],
  );
  return (
    <ComboboxItem
      label={option.label}
      description={unauthenticated ? unauthenticatedLabel : (usageLine ?? undefined)}
      selected={selected}
      active={active}
      disabled={unauthenticated}
      onPress={onPress}
      leadingSlot={leadingSlot}
      accessibilityLabel={
        unauthenticated ? `${option.label} — ${unauthenticatedLabel}` : option.label
      }
      testID={`provider-account-option-${option.id}`}
    />
  );
}

export function ProviderAccountControl({
  accounts,
  defaultAccountId,
  selectedAccountId,
  onSelectAccount,
  disabled = false,
  readOnly = false,
  serverId,
  provider,
  surface = "toolbar",
  onClose,
}: ProviderAccountControlValue & {
  surface?: "toolbar" | "sheet";
  onClose?: () => void;
}) {
  const { presentation } = useComposerControlLayout();
  const { t } = useTranslation();
  const anchorRef = useRef<View>(null);
  const [open, setOpen] = useState(false);

  const model = useMemo(
    () =>
      resolveProviderAccountControlModel({
        accounts,
        defaultAccountId,
        selection: selectedAccountId,
      }),
    [accounts, defaultAccountId, selectedAccountId],
  );

  const optionsById = useMemo(() => {
    const map = new Map<string, ProviderAccountOption>();
    for (const option of model?.options ?? []) map.set(option.id, option);
    return map;
  }, [model]);

  const comboboxOptions = useMemo<ComboboxOption[]>(
    () =>
      (model?.options ?? []).map((option) => ({
        id: option.id,
        label: option.label,
      })),
    [model],
  );

  const handleOpenChange = useCallback(
    (next: boolean) => {
      setOpen(next);
      if (!next) onClose?.();
    },
    [onClose],
  );
  const handlePress = useCallback(() => {
    if (readOnly) return;
    handleOpenChange(!open);
  }, [handleOpenChange, open, readOnly]);
  const handleSelect = useCallback(
    (optionId: string) => {
      // Unauthenticated rows render disabled, but never trust the view layer to
      // be the only gate on a launch that would fail to authenticate.
      if (optionsById.get(optionId)?.authenticated === false) return;
      onSelectAccount(toProviderAccountSelection(optionId));
      handleOpenChange(false);
    },
    [handleOpenChange, onSelectAccount, optionsById],
  );

  const unauthenticatedLabel = t("agentControls.account.notSignedIn");
  const iconColor = styles.triggerIconColor.color;
  const warningColor = styles.warningIconColor.color;

  const renderOption = useCallback(
    (args: {
      option: ComboboxOption;
      selected: boolean;
      active: boolean;
      onPress: () => void;
    }): ReactElement => (
      <ProviderAccountComboboxOption
        option={args.option}
        account={optionsById.get(args.option.id)}
        selected={args.selected}
        active={args.active}
        onPress={args.onPress}
        iconColor={styles.optionIconColor.color}
        warningColor={warningColor}
        unauthenticatedLabel={unauthenticatedLabel}
        serverId={serverId}
        provider={provider}
      />
    ),
    [optionsById, provider, serverId, unauthenticatedLabel, warningColor],
  );

  const sheetHeader = useMemo<SheetHeader>(
    () => ({ title: t("agentControls.account.title") }),
    [t],
  );

  // The whole control is absent unless this provider actually has accounts, so a
  // provider with none looks exactly as it did before the picker existed.
  if (!model) return null;

  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <AgentControlTrigger
            ref={anchorRef}
            icon={model.selectedIsUnauthenticated ? TriangleAlert : UserRound}
            iconColor={model.selectedIsUnauthenticated ? warningColor : iconColor}
            surface={surface}
            label={t("agentControls.account.title")}
            value={model.displayLabel}
            showCaret={!readOnly && surface === "toolbar" && presentation.showCarets}
            open={open}
            disabled={disabled || readOnly}
            onPress={handlePress}
            accessibilityLabel={
              readOnly
                ? t("agentControls.account.lockedWithValue", {
                    value: model.displayLabel,
                  })
                : t("agentControls.account.selectWithValue", {
                    value: model.displayLabel,
                  })
            }
            testID="provider-account-control"
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>
            {readOnly ? t("agentControls.hints.accountLocked") : t("agentControls.hints.account")}
          </Text>
        </TooltipContent>
      </Tooltip>
      {readOnly ? null : (
        <Combobox
          options={comboboxOptions}
          value={model.selectedOptionId}
          onSelect={handleSelect}
          searchable={false}
          open={open}
          onOpenChange={handleOpenChange}
          anchorRef={anchorRef}
          desktopPlacement="top-start"
          desktopMinWidth={240}
          header={sheetHeader}
          renderOption={renderOption}
        />
      )}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Icon tints are read off the stylesheet rather than `useUnistyles`, which the
  // lint rule bans, because lucide takes a `color` prop and not a style.
  triggerIconColor: {
    color: theme.colors.foregroundMuted,
  },
  optionIconColor: {
    color: theme.colors.foreground,
  },
  warningIconColor: {
    color: theme.colors.statusWarning,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
