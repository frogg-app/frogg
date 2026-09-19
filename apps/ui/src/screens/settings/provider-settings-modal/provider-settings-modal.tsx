import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Alert, Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { settingsStyles } from "@/styles/settings";
import { useHostFeature } from "@/runtime/host-features";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { buildProviderDefinitions } from "@/utils/provider-definitions";
import { getProviderIcon } from "@/components/provider-icons";
import { confirmDialog } from "@/utils/confirm-dialog";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import {
  getProviderStatus,
  type ProviderStatus,
  type StatusTone,
} from "@/screens/settings/providers-section";
import { parseProviderAccountDefaultId } from "@frogg/protocol/provider-accounts";
import { selectProviderAccounts } from "@/provider-accounts/model";
import { useProviderAccounts } from "@/provider-accounts/use-provider-accounts";
import { useAuthenticateProviderAccount } from "@/provider-accounts/use-authenticate-account";
import { useCreateAccountFlow } from "@/provider-accounts/use-create-account-flow";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import type { Theme } from "@/styles/theme";
import { AccountPane } from "./account-pane";
import { AccountTabs, isSynthesizedAccount, withDefaultAccount } from "./account-tabs";
import { ProviderModelsSection } from "./provider-models-section";

const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const loadingSpinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const providerIconMapping = (theme: Theme) => ({
  size: theme.iconSize.md,
  color: theme.colors.foreground,
});

/** The provider's own tab, which is not an account. */
const PROVIDER_TAB = "__provider__";

function statusDotToneStyle(tone: StatusTone) {
  switch (tone) {
    case "success":
      return styles.statusDotSuccess;
    case "warning":
      return styles.statusDotWarning;
    case "danger":
      return styles.statusDotDanger;
    default:
      return styles.statusDotMuted;
  }
}

interface ProviderHeaderProps {
  providerId: string;
  providerLabel: string;
  status: ProviderStatus | null;
  onPress: () => void;
}

/** The sheet's provider row, which doubles as the provider's own tab. */
function ProviderHeader({ providerId, providerLabel, status, onPress }: ProviderHeaderProps) {
  const { t } = useTranslation();
  const ProviderIcon = getProviderIcon(providerId);
  const ThemedProviderIcon = useMemo(
    () => (ProviderIcon ? withUnistyles(ProviderIcon) : null),
    [ProviderIcon],
  );
  if (!ThemedProviderIcon) return null;
  return (
    <Pressable
      style={styles.headerRow}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={t("settings.providers.providerDetails", { name: providerLabel })}
      testID="provider-settings-modal-header"
    >
      <ThemedProviderIcon uniProps={providerIconMapping} />
      <View style={styles.headerText}>
        <Text style={settingsStyles.rowTitle} numberOfLines={1}>
          {providerLabel}
        </Text>
        {status ? (
          <View style={styles.statusRow}>
            {status.tone === "loading" ? (
              <ThemedLoadingSpinner size={10} uniProps={loadingSpinnerMapping} />
            ) : (
              <View style={[styles.statusDot, statusDotToneStyle(status.tone)]} />
            )}
            <Text style={styles.statusLabel}>{status.label}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

interface ProviderPaneProps {
  serverId: string;
  providerId: string;
  providerLabel: string;
  canRemove: boolean;
  accounts: ReturnType<typeof useProviderAccounts>;
  onClose: () => void;
}

/**
 * The provider's own tab: what is true of the provider rather than of one
 * sign-in — its model catalogue, and uninstalling it.
 */
function ProviderPane({
  serverId,
  providerId,
  providerLabel,
  canRemove,
  accounts,
  onClose,
}: ProviderPaneProps) {
  const { t } = useTranslation();
  const { patchConfig } = useDaemonConfig(serverId);
  const [isRemoving, setIsRemoving] = useState(false);
  const removingRef = useRef(false);

  const handleRemove = useCallback(() => {
    void (async () => {
      if (removingRef.current) return;
      removingRef.current = true;
      setIsRemoving(true);
      try {
        const confirmed = await confirmDialog({
          title: t("settings.providers.remove.confirmTitle", { name: providerLabel }),
          message: t("settings.providers.remove.confirmMessage"),
          confirmLabel: t("settings.providers.remove.confirm"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }

        await patchConfig({ removeProviders: [providerId] });
        onClose();
      } catch (error) {
        Alert.alert(
          t("settings.providers.remove.errorTitle"),
          error instanceof Error ? error.message : String(error),
        );
      } finally {
        removingRef.current = false;
        setIsRemoving(false);
      }
    })();
  }, [onClose, patchConfig, providerId, providerLabel, t]);

  const handleRefreshAccounts = useCallback(() => {
    void accounts.refresh();
  }, [accounts]);

  return (
    <View style={styles.pane} testID="provider-settings-provider-pane">
      <ProviderModelsSection serverId={serverId} providerId={providerId} />
      {accounts.supported && !accounts.connected ? (
        <Text style={styles.message} testID="provider-settings-accounts-unavailable">
          {t("settings.host.providerAccounts.unavailable")}
        </Text>
      ) : null}
      {accounts.loadError ? (
        <View style={settingsStyles.card}>
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.host.providerAccounts.loadFailed")}
              </Text>
              <Text style={settingsStyles.rowError}>{accounts.loadError.message}</Text>
            </View>
            <Button size="sm" variant="outline" onPress={handleRefreshAccounts}>
              {t("common.actions.retry")}
            </Button>
          </View>
        </View>
      ) : null}
      {canRemove ? (
        <View style={styles.dangerZone} testID="provider-settings-modal-danger-zone">
          <Text style={styles.dangerZoneTitle}>
            {t("settings.providers.settingsModal.dangerZoneTitle")}
          </Text>
          <Button
            variant="destructive"
            onPress={handleRemove}
            disabled={isRemoving}
            testID="provider-settings-modal-uninstall-button"
          >
            {isRemoving
              ? t("settings.providers.actions.removing")
              : t("settings.providers.settingsModal.uninstallTitle")}
          </Button>
        </View>
      ) : null}
    </View>
  );
}

export interface ProviderSettingsModalProps {
  serverId: string;
  providerId: string;
  visible: boolean;
  onClose: () => void;
}

/**
 * One sheet per provider, and inside it one tab per sign-in. Everything an
 * account owns — its identity, its sign-in, its usage, its defaults, the models
 * it may run, what it appends to every agent, and deleting it — lives on that
 * account's tab and nowhere else. The provider's own tab, reached from the
 * header, keeps what is not about a single account: the model catalogue and
 * uninstalling the provider.
 */
export function ProviderSettingsModal({
  serverId,
  providerId,
  visible,
  onClose,
}: ProviderSettingsModalProps) {
  const { t } = useTranslation();
  const supportsProviderRemoval = useHostFeature(serverId, "providerRemoval");
  const canManage = useHostFeature(serverId, "providerAccountManagement");
  const canRestrictModels = useHostFeature(serverId, "providerAccountAllowedModels");
  const canSetPreferences = useHostFeature(serverId, "providerAccountPreferences");
  const { entries } = useProvidersSnapshot(serverId);
  const accounts = useProviderAccounts(serverId);
  const auth = useAuthenticateProviderAccount(serverId);
  const createFlow = useCreateAccountFlow(serverId, providerId);
  const [selectedTab, setSelectedTab] = useState<string | null>(null);

  const providerDefinitions = useMemo(() => buildProviderDefinitions(entries), [entries]);
  const def = useMemo(
    () => providerDefinitions.find((candidate) => candidate.id === providerId),
    [providerDefinitions, providerId],
  );
  const entry = useMemo(
    () => entries?.find((candidate) => candidate.provider === providerId),
    [entries, providerId],
  );

  const enabled = entry?.enabled ?? true;
  const models = useMemo(
    () => filterSelectableModels(entry?.models ?? null) ?? [],
    [entry?.models],
  );
  const providerStatus = entry ? getProviderStatus(entry.status, enabled, models.length, t) : null;
  const canRemove = supportsProviderRemoval && entry?.source === "custom";

  const storedAccounts = useMemo(
    () => selectProviderAccounts(accounts.payload?.accounts ?? [], providerId),
    [accounts.payload, providerId],
  );
  // The default sign-in always gets a tab, whether or not the daemon has stored
  // anything about it yet.
  const tabAccounts = useMemo(
    () =>
      accounts.supported && accounts.connected
        ? withDefaultAccount(storedAccounts, providerId)
        : [],
    [accounts.connected, accounts.supported, providerId, storedAccounts],
  );

  // The account in use is the one a person most likely came to change.
  const preferredTab = useMemo(() => {
    if (tabAccounts.length === 0) return PROVIDER_TAB;
    return (tabAccounts.find((account) => account.isActive) ?? tabAccounts[0]!).id;
  }, [tabAccounts]);

  const activeTab =
    selectedTab !== null &&
    (selectedTab === PROVIDER_TAB || tabAccounts.some((account) => account.id === selectedTab))
      ? selectedTab
      : preferredTab;

  // A fresh sheet opens on the account in use rather than on the last tab
  // someone happened to look at.
  useEffect(() => {
    if (!visible) setSelectedTab(null);
  }, [visible]);

  const selectedAccount = useMemo(
    () => tabAccounts.find((account) => account.id === activeTab) ?? null,
    [activeTab, tabAccounts],
  );

  // Usage is read for the account whose tab is open, not for whichever sign-in
  // the daemon happens to have active: showing the active account's figures
  // under another account's name is what made every tab report the same
  // numbers. `null` names the provider's primary directory, which is what the
  // implicit default account is, and is understood by every daemon.
  const usageAccountId = useMemo(() => {
    if (!selectedAccount) return undefined;
    return parseProviderAccountDefaultId(selectedAccount.id) !== null ? null : selectedAccount.id;
  }, [selectedAccount]);
  const usage = useProviderUsage(serverId, {
    enabled: selectedAccount !== null,
    provider: providerId,
    providerAccountId: usageAccountId,
  });

  const providerUsage = useMemo(
    () =>
      usage.view.kind === "ready"
        ? (usage.view.payload.providers.find((item) => item.providerId === providerId) ?? null)
        : null,
    [providerId, usage.view],
  );

  const sheetHeader = useMemo<SheetHeader>(() => ({ title: def?.label ?? "" }), [def?.label]);

  const handleSelectProviderTab = useCallback(() => setSelectedTab(PROVIDER_TAB), []);
  // Deleting the account whose tab is open leaves nothing to show, so the sheet
  // falls back to whichever account the daemon now reports as in use.
  const handleAccountDeleted = useCallback(() => setSelectedTab(null), []);

  if (!def) {
    return null;
  }

  let body: ReactNode;
  if (selectedAccount) {
    body = (
      <AccountPane
        providerId={providerId}
        providerLabel={def.label}
        account={selectedAccount}
        models={models}
        accounts={accounts}
        auth={auth}
        canManage={canManage}
        canRestrictModels={canRestrictModels}
        canSetPreferences={canSetPreferences}
        usage={providerUsage}
        synthesized={isSynthesizedAccount(storedAccounts, selectedAccount)}
        onDeleted={handleAccountDeleted}
      />
    );
  } else {
    body = (
      <ProviderPane
        serverId={serverId}
        providerId={providerId}
        providerLabel={def.label}
        canRemove={canRemove}
        accounts={accounts}
        onClose={onClose}
      />
    );
  }

  return (
    <AdaptiveModalSheet
      visible={visible}
      header={sheetHeader}
      onClose={onClose}
      testID="provider-settings-modal"
      desktopMaxWidth={560}
    >
      <View style={styles.body}>
        <ProviderHeader
          providerId={def.id}
          providerLabel={def.label}
          status={providerStatus}
          onPress={handleSelectProviderTab}
        />

        {accounts.supported && accounts.isLoading ? (
          <View testID="provider-settings-accounts-loading">
            <LoadingSpinner size="small" color={styles.message.color} />
          </View>
        ) : null}

        {tabAccounts.length > 0 ? (
          <AccountTabs
            accounts={tabAccounts}
            selectedAccountId={selectedAccount?.id ?? null}
            onSelect={setSelectedTab}
            onAdd={createFlow.capability ? createFlow.open : undefined}
          />
        ) : null}

        {body}
      </View>
      {createFlow.modal}
    </AdaptiveModalSheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[4],
    paddingBottom: theme.spacing[6],
  },
  pane: {
    gap: theme.spacing[4],
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
  },
  headerText: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusDotSuccess: {
    backgroundColor: theme.colors.statusSuccess,
  },
  statusDotWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
  statusDotDanger: {
    backgroundColor: theme.colors.statusDanger,
  },
  statusDotMuted: {
    backgroundColor: theme.colors.foregroundMuted,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  dangerZone: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingTop: theme.spacing[4],
    gap: theme.spacing[3],
  },
  dangerZoneTitle: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
