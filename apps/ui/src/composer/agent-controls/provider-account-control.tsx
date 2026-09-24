import { formatPct } from "@/provider-usage/format";
import { useEasedPct } from "@/provider-usage/use-eased-pct";
import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type DimensionValue } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TriangleAlert, UserRound } from "lucide-react-native";
import { type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Combobox, ComboboxItem, type ComboboxOption } from "@/components/ui/combobox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useComposerControlLayout } from "@/composer/agent-controls/layout-context";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { useIsCompactFormFactor } from "@/constants/layout";
import {
  resolveProviderAccountControlModel,
  toProviderAccountSelection,
  type ProviderAccountOption,
  type ProviderAccountSelection,
} from "@/composer/agent-controls/provider-account";
import {
  buildProviderUsageColumns,
  summarizeProviderUsage,
  type ProviderUsageColumn,
} from "@/provider-usage/account-summary";
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
 * One account's rolling-window usage, as the right-anchored cells shown beside
 * its name in the picker plus the same figures as a spoken line. Each row owns
 * its own query because the figures are per sign-in: the daemon answers for one
 * config directory at a time.
 */
function useProviderAccountUsage(input: {
  serverId: string | null | undefined;
  provider: string | null | undefined;
  accountId: string | null;
  enabled: boolean;
}): { columns: ProviderUsageColumn[]; spoken: string | null } {
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
  return useMemo(() => {
    if (view.kind !== "ready") return { columns: [], spoken: null };
    const providers = view.payload.providers;
    return {
      columns: buildProviderUsageColumns(providers, provider ?? undefined),
      spoken: summarizeProviderUsage(providers, provider ?? undefined),
    };
  }, [provider, view]);
}

/** Where a window stops being background information and starts being news. */
const USAGE_WARN_PCT = 70;
const USAGE_DANGER_PCT = 90;

/**
 * The figure's tint: plain until a window is nearly spent, so a picker of
 * healthy accounts reads as one calm colour and the account that is about to
 * run out is the only thing coloured.
 */
function usageTint(pct: number | null): string | undefined {
  if (pct == null) return undefined;
  if (pct >= USAGE_DANGER_PCT) return styles.usageDangerColor.color;
  if (pct >= USAGE_WARN_PCT) return styles.usageWarnColor.color;
  return undefined;
}

/**
 * One window as a small meter: caption and figure over a bar, with the reset
 * countdown beneath. The bar carries the comparison — how full each account is
 * reads down the picker at a glance — while the digits stay available for the
 * exact number.
 */
function ProviderAccountUsageMeter({
  column,
  stacked,
}: {
  column: ProviderUsageColumn;
  stacked: boolean;
}) {
  const tint = usageTint(column.pct);
  const easedPct = useEasedPct(column.pct);
  // A zero-width fill is invisible, so a barely-used window would look
  // identical to one with no bar at all. Keep a sliver.
  const fillWidth: DimensionValue = easedPct == null ? 0 : `${Math.max(2, easedPct)}%`;
  return (
    <View style={[styles.usageMeter, stacked && styles.usageMeterStacked]}>
      <View style={styles.usageMeterHead}>
        <Text numberOfLines={1} style={styles.usageLabel}>
          {column.label}
        </Text>
        <Text numberOfLines={1} style={[styles.usagePct, tint ? { color: tint } : null]}>
          {easedPct == null ? column.pctLabel : formatPct(easedPct)}
        </Text>
      </View>
      <View style={styles.usageTrack}>
        <View
          style={[styles.usageFill, { width: fillWidth }, tint ? { backgroundColor: tint } : null]}
        />
      </View>
      <Text numberOfLines={1} style={styles.usageReset}>
        {column.resetIn ?? ""}
      </Text>
    </View>
  );
}

/**
 * Every reported window's meter, in the fixed order all rows share. On a
 * narrow sheet the meters sit under the account name and share the row's
 * width; there is no room to put them beside a name without eating it.
 */
function ProviderAccountUsageColumns({
  columns,
  stacked = false,
}: {
  columns: readonly ProviderUsageColumn[];
  stacked?: boolean;
}) {
  return (
    <View style={[styles.usageColumns, stacked && styles.usageColumnsStacked]}>
      {columns.map((column) => (
        <ProviderAccountUsageMeter key={column.id} column={column} stacked={stacked} />
      ))}
    </View>
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
  // The sheet is the narrow surface: its rows have no room for a name and a
  // grid of meters side by side, so there the meters go under the name.
  const compact = useIsCompactFormFactor();
  const unauthenticated = account !== undefined && !account.authenticated;
  const usage = useProviderAccountUsage({
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
  const usageSlot = useMemo(
    () =>
      unauthenticated || usage.columns.length === 0 ? undefined : (
        <ProviderAccountUsageColumns columns={usage.columns} stacked={compact} />
      ),
    [compact, unauthenticated, usage.columns],
  );
  const accessibilityLabel = useMemo(() => {
    if (unauthenticated) return `${option.label} — ${unauthenticatedLabel}`;
    return usage.spoken ? `${option.label} — ${usage.spoken}` : option.label;
  }, [option.label, unauthenticated, unauthenticatedLabel, usage.spoken]);
  return (
    <ComboboxItem
      label={option.label}
      description={unauthenticated ? unauthenticatedLabel : undefined}
      selected={selected}
      active={active}
      disabled={unauthenticated}
      onPress={onPress}
      leadingSlot={leadingSlot}
      trailingSlot={compact ? undefined : usageSlot}
      belowSlot={compact ? usageSlot : undefined}
      accessibilityLabel={accessibilityLabel}
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
          desktopMinWidth={380}
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
  usageColumns: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
  },
  usageColumnsStacked: {
    alignSelf: "stretch",
    marginTop: theme.spacing[1],
  },
  usageMeterStacked: {
    width: undefined,
    flex: 1,
  },
  // A fixed width, not a content width: the point of the grid is that one
  // row's weekly meter sits directly above the next row's.
  usageMeter: {
    width: 104,
    gap: 3,
  },
  usageMeterHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    gap: theme.spacing[1],
  },
  // The figure is the point of the meter, so the caption is what gives way
  // when a three-digit percentage needs the room.
  usageLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    flexShrink: 1,
  },
  usagePct: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foreground,
    fontVariant: ["tabular-nums"],
    flexShrink: 0,
  },
  usageTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.surface3,
    overflow: "hidden",
  },
  usageFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.accent,
  },
  usageReset: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
    fontVariant: ["tabular-nums"],
  },
  usageWarnColor: {
    color: theme.colors.statusWarning,
  },
  usageDangerColor: {
    color: theme.colors.destructive,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
