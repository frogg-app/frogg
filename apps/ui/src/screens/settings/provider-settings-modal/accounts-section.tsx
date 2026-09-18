import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ProviderAccountExportBundleSchema,
  PROVIDER_ACCOUNT_DISPLAY_NAME_MAX_LENGTH,
  normalizeProviderAccountDisplayName,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { confirmDialog } from "@/utils/confirm-dialog";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import { useHostFeature } from "@/runtime/host-features";
import { ProviderAccountRow } from "@/provider-accounts/account-row";
import { CreateProviderAccountModal } from "@/provider-accounts/create-account-modal";
import { selectProviderAccounts, type ProviderAccountCreateInput } from "@/provider-accounts/model";
import { useProviderAccounts } from "@/provider-accounts/use-provider-accounts";
import { useAuthenticateProviderAccount } from "@/provider-accounts/use-authenticate-account";
import { ProviderUsageCard } from "@/provider-usage/card";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";

export interface AccountsSectionProps {
  serverId: string;
  providerId: string;
}

type Panel = "none" | "export" | "import";

/**
 * Per-provider account management inside the provider settings modal: rename,
 * sign out, remove, add, and move accounts between servers.
 *
 * Rename / sign out / export / import are gated on the daemon's
 * `providerAccountManagement` flag and simply do not render on a daemon that
 * does not advertise it — there is no fallback path.
 */
export function AccountsSection({
  serverId,
  providerId,
}: AccountsSectionProps): ReactElement | null {
  const { t } = useTranslation();
  const accounts = useProviderAccounts(serverId);
  const auth = useAuthenticateProviderAccount(serverId);
  const canManage = useHostFeature(serverId, "providerAccountManagement");
  const usage = useProviderUsage(serverId);

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [panel, setPanel] = useState<Panel>("none");
  const [bundleText, setBundleText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createWarnings, setCreateWarnings] = useState<readonly string[]>([]);

  const providerAccounts = useMemo(
    () => selectProviderAccounts(accounts.payload?.accounts ?? [], providerId),
    [accounts.payload, providerId],
  );
  const capability = useMemo(
    () =>
      (accounts.payload?.capabilities ?? []).find(
        (candidate) => candidate.provider === providerId,
      ) ?? null,
    [accounts.payload, providerId],
  );
  const providerUsage = useMemo(
    () =>
      usage.view.kind === "ready"
        ? (usage.view.payload.providers.find((entry) => entry.providerId === providerId) ?? null)
        : null,
    [providerId, usage.view],
  );

  const renameMutate = accounts.rename.mutateAsync;
  const signOutMutate = accounts.signOut.mutateAsync;
  const removeMutate = accounts.remove.mutateAsync;
  const setActiveMutate = accounts.setActive.mutateAsync;
  const createMutate = accounts.create.mutateAsync;
  const exportMutate = accounts.exportAccounts.mutateAsync;
  const importMutate = accounts.importAccounts.mutateAsync;

  const applyResult = useCallback((payload: { error: string | null; warnings?: string[] }) => {
    setWarnings(payload.warnings ?? []);
    setError(payload.error);
    return payload.error === null;
  }, []);

  const runMutation = useCallback(
    async (mutate: () => Promise<{ error: string | null; warnings?: string[] }>) => {
      setError(null);
      setWarnings([]);
      try {
        return applyResult(await mutate());
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
        return false;
      }
    },
    [applyResult],
  );

  // Renaming the provider's implicit default account is allowed: the daemon
  // stores a label override and never touches the directory.
  const handleStartRename = useCallback((account: ProviderAccountState) => {
    setError(null);
    setWarnings([]);
    setRenamingId(account.id);
    setRenameDraft(account.name);
  }, []);

  const handleCancelRename = useCallback(() => {
    setRenamingId(null);
    setRenameDraft("");
  }, []);

  const handleSubmitRename = useCallback(() => {
    const accountId = renamingId;
    const name = normalizeProviderAccountDisplayName(renameDraft);
    if (!accountId || !name) return;
    void (async () => {
      const ok = await runMutation(() => renameMutate({ accountId, name }));
      // The draft is kept on failure so the name can be corrected.
      if (ok) handleCancelRename();
    })();
  }, [handleCancelRename, renameDraft, renameMutate, renamingId, runMutation]);

  const handleSignOut = useCallback(
    (account: ProviderAccountState) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("settings.providers.settingsModal.accounts.signOutConfirmTitle", {
            name: account.name,
          }),
          message: t("settings.providers.settingsModal.accounts.signOutConfirmMessage"),
          confirmLabel: t("settings.providers.settingsModal.accounts.signOut"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
        await runMutation(() => signOutMutate(account.id));
      })();
    },
    [runMutation, signOutMutate, t],
  );

  const handleRemove = useCallback(
    (account: ProviderAccountState) => {
      void (async () => {
        const confirmed = await confirmDialog({
          title: t("settings.host.providerAccounts.removeConfirmTitle", {
            name: account.name,
          }),
          message: t("settings.host.providerAccounts.removeConfirmMessage", {
            path: account.configDir,
          }),
          confirmLabel: t("settings.host.providerAccounts.remove"),
          cancelLabel: t("common.actions.cancel"),
          destructive: true,
        });
        if (!confirmed) return;
        await runMutation(() => removeMutate(account.id));
      })();
    },
    [removeMutate, runMutation, t],
  );

  const handleMakeActive = useCallback(
    (account: ProviderAccountState) => {
      void runMutation(() =>
        setActiveMutate({ provider: account.provider, accountId: account.id }),
      );
    },
    [runMutation, setActiveMutate],
  );

  const handleCreate = useCallback(
    (input: ProviderAccountCreateInput) => {
      setCreateError(null);
      setCreateWarnings([]);
      void (async () => {
        try {
          const payload = await createMutate(input);
          setCreateWarnings(payload.warnings ?? []);
          if (payload.error) {
            setCreateError(payload.error);
            return;
          }
          setShowCreate(false);
        } catch (cause: unknown) {
          setCreateError(cause instanceof Error ? cause.message : String(cause));
        }
      })();
    },
    [createMutate],
  );

  // The bundle is secret material: it is held in component state only for the
  // user to copy, never written to disk and never logged.
  const handleExport = useCallback(() => {
    setPanel("export");
    setBundleText(null);
    setCopied(false);
    setError(null);
    setWarnings([]);
    void (async () => {
      try {
        const payload = await exportMutate({ provider: providerId });
        if (payload.error || !payload.bundle) {
          setError(payload.error ?? t("settings.providers.settingsModal.accounts.exportEmpty"));
          return;
        }
        setBundleText(JSON.stringify(payload.bundle, null, 2));
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [exportMutate, providerId, t]);

  const handleCopyBundle = useCallback(() => {
    if (!bundleText) return;
    void (async () => {
      await copyToClipboard(bundleText);
      setCopied(true);
    })();
  }, [bundleText]);

  const handleOpenImport = useCallback(() => {
    setPanel("import");
    setImportError(null);
    setError(null);
    setWarnings([]);
  }, []);

  const handleClosePanel = useCallback(() => {
    setPanel("none");
    setBundleText(null);
    setCopied(false);
  }, []);

  const handleOpenCreate = useCallback(() => {
    setShowCreate(true);
  }, []);

  const handleCloseCreate = useCallback(() => {
    setShowCreate(false);
    setCreateError(null);
    setCreateWarnings([]);
  }, []);

  const handleRefreshAccounts = useCallback(() => {
    void accounts.refresh();
  }, [accounts]);

  const handleImport = useCallback(() => {
    setImportError(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(importText) as unknown;
    } catch {
      setImportError(t("settings.providers.settingsModal.accounts.importInvalid"));
      return;
    }
    const result = ProviderAccountExportBundleSchema.safeParse(parsed);
    if (!result.success) {
      setImportError(t("settings.providers.settingsModal.accounts.importInvalid"));
      return;
    }
    const bundle = result.data;
    void (async () => {
      // The pasted text stays put on failure.
      const ok = await runMutation(() => importMutate(bundle));
      if (ok) {
        setImportText("");
        setPanel("none");
      }
    })();
  }, [importMutate, importText, runMutation, t]);

  const renameError = useMemo(() => {
    if (renamingId === null) return null;
    return normalizeProviderAccountDisplayName(renameDraft) === null
      ? t("common.errors.nameRequired")
      : null;
  }, [renameDraft, renamingId, t]);

  const addButton = useMemo(() => {
    if (!capability?.enabled) return null;
    return (
      <Button
        size="sm"
        variant="ghost"
        onPress={handleOpenCreate}
        testID="provider-settings-accounts-add"
      >
        {t("settings.host.providerAccounts.addAccount")}
      </Button>
    );
  }, [capability?.enabled, handleOpenCreate, t]);

  if (!accounts.supported) {
    return null;
  }

  if (!accounts.connected) {
    return (
      <SettingsSection
        title={t("settings.providers.settingsModal.accounts.title")}
        testID="provider-settings-accounts-section"
        flush
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
        <View testID="provider-settings-accounts-loading">
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
          <Button size="sm" variant="outline" onPress={handleRefreshAccounts}>
            {t("common.actions.retry")}
          </Button>
        </View>
      </View>
    );
  } else if (providerAccounts.length === 0) {
    body = (
      <View style={settingsStyles.card}>
        <Text style={styles.message} testID="provider-settings-accounts-empty">
          {t("settings.providers.settingsModal.accounts.empty")}
        </Text>
      </View>
    );
  } else {
    body = (
      <View style={settingsStyles.card}>
        {providerAccounts.map((account, index) =>
          renamingId === account.id ? (
            <View
              key={account.id}
              style={[settingsStyles.row, index === 0 ? null : settingsStyles.rowBorder]}
              testID={`provider-account-rename-form-${account.id}`}
            >
              <View style={settingsStyles.rowContent}>
                <Field
                  label={t("settings.providers.settingsModal.accounts.renameTitle")}
                  hint={t("settings.providers.settingsModal.accounts.renameHint")}
                  error={renameError}
                  testID={`provider-account-rename-field-${account.id}`}
                >
                  <FormTextInput
                    initialValue={account.name}
                    onChangeText={setRenameDraft}
                    maxLength={PROVIDER_ACCOUNT_DISPLAY_NAME_MAX_LENGTH}
                    autoCapitalize="none"
                    autoCorrect={false}
                    editable={!accounts.rename.isPending}
                    placeholder={t("settings.providers.settingsModal.accounts.renamePlaceholder")}
                    testID={`provider-account-rename-input-${account.id}`}
                  />
                </Field>
              </View>
              <View style={styles.actions}>
                <Button size="sm" variant="outline" onPress={handleCancelRename}>
                  {t("common.actions.cancel")}
                </Button>
                <Button
                  size="sm"
                  disabled={renameError !== null || accounts.rename.isPending}
                  loading={accounts.rename.isPending}
                  onPress={handleSubmitRename}
                  testID={`provider-account-rename-submit-${account.id}`}
                >
                  {t("settings.providers.settingsModal.accounts.rename")}
                </Button>
              </View>
            </View>
          ) : (
            <ProviderAccountRow
              key={account.id}
              account={account}
              isFirst={index === 0}
              canAuthenticate={auth.canAuthenticate}
              isAuthenticating={auth.pendingAccountId === account.id}
              isActivating={
                accounts.setActive.isPending &&
                accounts.setActive.variables?.accountId === account.id
              }
              isRemoving={accounts.remove.isPending && accounts.remove.variables === account.id}
              isSigningOut={accounts.signOut.isPending && accounts.signOut.variables === account.id}
              onRename={canManage ? handleStartRename : undefined}
              onSignOut={canManage ? handleSignOut : undefined}
              onAuthenticate={auth.authenticate}
              onMakeActive={handleMakeActive}
              onRemove={handleRemove}
            />
          ),
        )}
      </View>
    );
  }

  return (
    <>
      <SettingsSection
        title={t("settings.providers.settingsModal.accounts.title")}
        info={t("settings.providers.settingsModal.accounts.info")}
        trailing={addButton}
        testID="provider-settings-accounts-section"
        flush
      >
        {body}

        {canManage ? (
          <View style={styles.transferRow} testID="provider-settings-accounts-transfer">
            <Button
              size="sm"
              variant="outline"
              loading={accounts.exportAccounts.isPending}
              disabled={accounts.exportAccounts.isPending || providerAccounts.length === 0}
              onPress={handleExport}
              testID="provider-settings-accounts-export"
            >
              {t("settings.providers.settingsModal.accounts.export")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onPress={handleOpenImport}
              testID="provider-settings-accounts-import"
            >
              {t("settings.providers.settingsModal.accounts.importAction")}
            </Button>
          </View>
        ) : null}

        {panel === "export" ? (
          <View style={styles.panel} testID="provider-settings-accounts-export-panel">
            <Alert
              variant="warning"
              title={t("settings.providers.settingsModal.accounts.exportTitle")}
              description={t("settings.providers.settingsModal.accounts.exportWarning")}
            />
            {accounts.exportAccounts.isPending ? (
              <Text style={styles.message}>
                {t("settings.providers.settingsModal.accounts.exportPending")}
              </Text>
            ) : null}
            {bundleText ? (
              <>
                <Text
                  style={styles.bundle}
                  selectable
                  numberOfLines={6}
                  testID="provider-settings-accounts-export-bundle"
                >
                  {bundleText}
                </Text>
                <View style={styles.actions}>
                  <Button
                    size="sm"
                    onPress={handleCopyBundle}
                    testID="provider-settings-accounts-export-copy"
                  >
                    {copied
                      ? t("settings.providers.settingsModal.accounts.exportCopied")
                      : t("settings.providers.settingsModal.accounts.exportCopy")}
                  </Button>
                  <Button size="sm" variant="ghost" onPress={handleClosePanel}>
                    {t("common.actions.close")}
                  </Button>
                </View>
              </>
            ) : null}
          </View>
        ) : null}

        {panel === "import" ? (
          <View style={styles.panel} testID="provider-settings-accounts-import-panel">
            <Field
              label={t("settings.providers.settingsModal.accounts.importTitle")}
              hint={t("settings.providers.settingsModal.accounts.importHint")}
              error={importError}
              testID="provider-settings-accounts-import-field"
            >
              <FormTextInput
                initialValue=""
                onChangeText={setImportText}
                autoCapitalize="none"
                autoCorrect={false}
                multiline
                editable={!accounts.importAccounts.isPending}
                placeholder={t("settings.providers.settingsModal.accounts.importPlaceholder")}
                testID="provider-settings-accounts-import-input"
              />
            </Field>
            <View style={styles.actions}>
              <Button
                size="sm"
                loading={accounts.importAccounts.isPending}
                disabled={accounts.importAccounts.isPending}
                onPress={handleImport}
                testID="provider-settings-accounts-import-submit"
              >
                {t("settings.providers.settingsModal.accounts.importSubmit")}
              </Button>
              <Button size="sm" variant="ghost" onPress={handleClosePanel}>
                {t("common.actions.cancel")}
              </Button>
            </View>
          </View>
        ) : null}

        {auth.error ? (
          <Text style={settingsStyles.rowError} testID="provider-settings-accounts-auth-error">
            {auth.error}
          </Text>
        ) : null}
        {error ? (
          <Text style={settingsStyles.rowError} testID="provider-settings-accounts-error">
            {error}
          </Text>
        ) : null}
        {warnings.map((warning) => (
          <Text key={warning} style={styles.warning} testID="provider-settings-accounts-warning">
            {warning}
          </Text>
        ))}

        {providerUsage ? (
          <View style={styles.panel} testID="provider-settings-accounts-usage">
            <Text style={styles.usageTitle}>
              {t("settings.providers.settingsModal.accounts.usageTitle")}
            </Text>
            <View style={settingsStyles.card}>
              <ProviderUsageCard usage={providerUsage} compact />
            </View>
            <Text style={styles.message}>
              {t("settings.providers.settingsModal.accounts.usageInfo")}
            </Text>
          </View>
        ) : null}
      </SettingsSection>

      {showCreate && capability ? (
        <CreateProviderAccountModal
          visible
          capability={capability}
          existingNames={providerAccounts.map((account) => account.name)}
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

const styles = StyleSheet.create((theme) => ({
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  transferRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  panel: {
    gap: theme.spacing[2],
  },
  bundle: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
  usageTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
}));
