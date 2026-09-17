import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus, RotateCw } from "lucide-react-native";
import type {
  ProviderAccountCapability,
  ProviderAccountState,
} from "@frogg/protocol/provider-accounts";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { ProviderAccountRow } from "./account-row";
import { CreateProviderAccountModal } from "./create-account-modal";
import {
  selectEnabledCapabilities,
  selectProviderAccounts,
  type ProviderAccountCreateInput,
} from "./model";
import { providerAccountLabel } from "./provider-labels";
import { useAuthenticateProviderAccount } from "./use-authenticate-account";
import { useProviderAccounts } from "./use-provider-accounts";

const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const addIcon = <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;
const ThemedRotateCw = withUnistyles(RotateCw);
const refreshIcon = <ThemedRotateCw size={ICON_SIZE.sm} uniProps={mutedColorMapping} />;

/**
 * Multi-sign-in management. Providers are read from the daemon's capability
 * manifest and only the enabled ones are rendered, so nothing here knows which
 * provider supports accounts.
 */
export function ProviderAccountsSection({ serverId }: { serverId: string }): ReactElement | null {
  const { t } = useTranslation();
  const accounts = useProviderAccounts(serverId);
  const auth = useAuthenticateProviderAccount(serverId);
  const [createTarget, setCreateTarget] = useState<ProviderAccountCapability | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [mutationWarnings, setMutationWarnings] = useState<readonly string[]>([]);
  const [createWarnings, setCreateWarnings] = useState<readonly string[]>([]);
  const [mutationError, setMutationError] = useState<string | null>(null);

  const capabilities = useMemo(
    () => selectEnabledCapabilities(accounts.payload?.capabilities ?? []),
    [accounts.payload],
  );

  const createMutate = accounts.create.mutateAsync;
  const removeMutate = accounts.remove.mutateAsync;
  const setActiveMutate = accounts.setActive.mutateAsync;

  const handleCreate = useCallback(
    (input: ProviderAccountCreateInput) => {
      setCreateError(null);
      setCreateWarnings([]);
      void (async () => {
        try {
          const payload = await createMutate(input);
          setCreateWarnings(payload.warnings ?? []);
          if (payload.error) {
            // The modal stays open with the user's input intact so the name can
            // be corrected; the daemon's text is shown verbatim.
            setCreateError(payload.error);
            return;
          }
          setMutationWarnings(payload.warnings ?? []);
          setCreateTarget(null);
        } catch (error: unknown) {
          setCreateError(error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [createMutate],
  );

  const handleMakeActive = useCallback(
    (account: ProviderAccountState) => {
      setMutationError(null);
      setMutationWarnings([]);
      void (async () => {
        try {
          const payload = await setActiveMutate({
            provider: account.provider,
            accountId: account.id,
          });
          setMutationWarnings(payload.warnings ?? []);
          setMutationError(payload.error);
        } catch (error: unknown) {
          setMutationError(error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [setActiveMutate],
  );

  const handleRemove = useCallback(
    (account: ProviderAccountState) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("settings.host.providerAccounts.removeConfirmTitle", { name: account.name }),
          message: t("settings.host.providerAccounts.removeConfirmMessage", {
            path: account.configDir,
          }),
          confirmLabel: t("settings.host.providerAccounts.remove"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (!confirmed) {
          return;
        }
        setMutationError(null);
        setMutationWarnings([]);
        try {
          const payload = await removeMutate(account.id);
          setMutationWarnings(payload.warnings ?? []);
          setMutationError(payload.error);
        } catch (error: unknown) {
          setMutationError(error instanceof Error ? error.message : String(error));
        }
      })();
    },
    [removeMutate, t],
  );

  const handleRefresh = useCallback(() => {
    setMutationError(null);
    setMutationWarnings([]);
    void accounts.refresh();
  }, [accounts]);

  const refreshButton = useMemo(
    () => (
      <Button
        size="sm"
        variant="ghost"
        leftIcon={refreshIcon}
        onPress={handleRefresh}
        accessibilityLabel={t("settings.host.providerAccounts.refresh")}
        testID="provider-accounts-refresh"
      />
    ),
    [handleRefresh, t],
  );

  const handleCloseCreate = useCallback(() => {
    setCreateTarget(null);
    setCreateError(null);
    setCreateWarnings([]);
  }, []);

  // The daemon hides the whole surface: an older daemon never advertises the
  // feature, and there is no fallback path for one.
  if (!accounts.supported) {
    return null;
  }

  if (!accounts.connected) {
    return (
      <SettingsSection
        title={t("settings.host.providerAccounts.sectionTitle")}
        testID="provider-accounts-section"
      >
        <View style={settingsStyles.card}>
          <Text style={styles.message}>{t("settings.host.providerAccounts.unavailable")}</Text>
        </View>
      </SettingsSection>
    );
  }

  let body: ReactElement;
  if (accounts.isLoading) {
    body = (
      <View style={settingsStyles.card}>
        <View style={styles.message}>
          <LoadingSpinner size="small" color={styles.message.color} />
        </View>
      </View>
    );
  } else if (accounts.loadError) {
    body = (
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.host.providerAccounts.loadFailed")}
            </Text>
            <Text style={settingsStyles.rowError}>{accounts.loadError.message}</Text>
          </View>
          <Button size="sm" variant="outline" onPress={handleRefresh}>
            {t("common.actions.retry")}
          </Button>
        </View>
      </View>
    );
  } else {
    body = (
      <View style={styles.providers}>
        {capabilities.map((capability) => (
          <ProviderAccountsCard
            key={capability.provider}
            capability={capability}
            accounts={selectProviderAccounts(accounts.payload?.accounts ?? [], capability.provider)}
            canAuthenticate={auth.canAuthenticate}
            authenticatingAccountId={auth.pendingAccountId}
            activatingAccountId={
              accounts.setActive.isPending
                ? (accounts.setActive.variables?.accountId ?? null)
                : null
            }
            removingAccountId={
              accounts.remove.isPending ? (accounts.remove.variables ?? null) : null
            }
            onAdd={setCreateTarget}
            onAuthenticate={auth.authenticate}
            onMakeActive={handleMakeActive}
            onRemove={handleRemove}
          />
        ))}
        {capabilities.length === 0 ? (
          <View style={settingsStyles.card}>
            <Text style={styles.message}>
              {t("settings.host.providerAccounts.noEnabledProviders")}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.host.providerAccounts.sectionTitle")}
        info={t("settings.host.providerAccounts.sectionInfo")}
        trailing={refreshButton}
        testID="provider-accounts-section"
      >
        {body}
        {auth.error ? (
          <Text style={settingsStyles.rowError} testID="provider-accounts-auth-error">
            {auth.error}
          </Text>
        ) : null}
        {mutationError ? (
          <Text style={settingsStyles.rowError} testID="provider-accounts-error">
            {mutationError}
          </Text>
        ) : null}
        {mutationWarnings.map((warning) => (
          <Text key={warning} style={styles.warning} testID="provider-accounts-warning">
            {warning}
          </Text>
        ))}
      </SettingsSection>

      {createTarget ? (
        <CreateProviderAccountModal
          key={createTarget.provider}
          visible
          capability={createTarget}
          existingNames={selectProviderAccounts(
            accounts.payload?.accounts ?? [],
            createTarget.provider,
          ).map((account) => account.name)}
          isSubmitting={accounts.create.isPending}
          error={createError}
          warnings={createWarnings}
          onClose={handleCloseCreate}
          onSubmit={handleCreate}
        />
      ) : null}
    </>
  );
}

interface ProviderAccountsCardProps {
  capability: ProviderAccountCapability;
  accounts: readonly ProviderAccountState[];
  canAuthenticate: boolean;
  authenticatingAccountId: string | null;
  activatingAccountId: string | null;
  removingAccountId: string | null;
  onAdd: (capability: ProviderAccountCapability) => void;
  onAuthenticate: (account: ProviderAccountState) => void;
  onMakeActive: (account: ProviderAccountState) => void;
  onRemove: (account: ProviderAccountState) => void;
}

function ProviderAccountsCard({
  capability,
  accounts,
  canAuthenticate,
  authenticatingAccountId,
  activatingAccountId,
  removingAccountId,
  onAdd,
  onAuthenticate,
  onMakeActive,
  onRemove,
}: ProviderAccountsCardProps): ReactElement {
  const { t } = useTranslation();
  const handleAdd = useCallback(() => onAdd(capability), [capability, onAdd]);

  return (
    <View testID={`provider-accounts-${capability.provider}`}>
      <View style={styles.providerHeader}>
        <Text style={settingsStyles.rowTitle}>{providerAccountLabel(capability.provider)}</Text>
        <Button
          size="sm"
          variant="ghost"
          leftIcon={addIcon}
          onPress={handleAdd}
          testID={`provider-accounts-add-${capability.provider}`}
        >
          {t("settings.host.providerAccounts.addAccount")}
        </Button>
      </View>
      {capability.verified === false ? (
        <Text style={styles.warning} testID={`provider-accounts-unverified-${capability.provider}`}>
          {t("settings.host.providerAccounts.unverified", {
            note:
              capability.verificationNote ??
              t("settings.host.providerAccounts.unverifiedDefaultNote"),
          })}
        </Text>
      ) : null}
      <View style={settingsStyles.card}>
        {accounts.length === 0 ? (
          <Text style={styles.message} testID={`provider-accounts-empty-${capability.provider}`}>
            {t("settings.host.providerAccounts.empty")}
          </Text>
        ) : (
          accounts.map((account, index) => (
            <ProviderAccountRow
              key={account.id}
              account={account}
              isFirst={index === 0}
              canAuthenticate={canAuthenticate}
              isAuthenticating={authenticatingAccountId === account.id}
              isActivating={activatingAccountId === account.id}
              isRemoving={removingAccountId === account.id}
              onAuthenticate={onAuthenticate}
              onMakeActive={onMakeActive}
              onRemove={onRemove}
            />
          ))
        )}
      </View>
      <Text style={styles.hint}>
        {canAuthenticate
          ? t("settings.host.providerAccounts.authenticateHint")
          : t("settings.host.providerAccounts.authenticateNoWorkspace")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  providers: {
    gap: theme.spacing[4],
  },
  providerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing[2],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    padding: theme.spacing[4],
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[2],
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
}));
