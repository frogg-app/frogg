import { useCallback, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  ProviderAccountExportBundleSchema,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { settingsStyles } from "@/styles/settings";
import { copyToClipboard } from "@/utils/copy-to-clipboard";
import type { useProviderAccounts } from "@/provider-accounts/use-provider-accounts";

type Accounts = ReturnType<typeof useProviderAccounts>;
type Panel = "none" | "export" | "import";

export interface AccountTransferProps {
  providerId: string;
  account: ProviderAccountState;
  accounts: Accounts;
  /** True for the implicit default account the daemon has stored nothing about. */
  synthesized: boolean;
}

/**
 * Moving one sign-in to another server. The export bundle carries live
 * credentials, so it is held in component state for the user to copy and is
 * never written to disk or logged.
 */
export function AccountTransfer({
  providerId,
  account,
  accounts,
  synthesized,
}: AccountTransferProps): ReactElement {
  const { t } = useTranslation();
  const [panel, setPanel] = useState<Panel>("none");
  const [bundleText, setBundleText] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);

  const exportMutate = accounts.exportAccounts.mutateAsync;
  const importMutate = accounts.importAccounts.mutateAsync;

  const handleExport = useCallback(() => {
    setPanel("export");
    setBundleText(null);
    setCopied(false);
    setError(null);
    setWarnings([]);
    void (async () => {
      try {
        const payload = await exportMutate({ provider: providerId, accountIds: [account.id] });
        if (payload.error || !payload.bundle) {
          setError(payload.error ?? t("settings.providers.settingsModal.accounts.exportEmpty"));
          return;
        }
        setBundleText(JSON.stringify(payload.bundle, null, 2));
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [account.id, exportMutate, providerId, t]);

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
      setError(null);
      setWarnings([]);
      try {
        // The pasted text stays put on failure so it can be corrected.
        const payload = await importMutate(bundle);
        setWarnings(payload.warnings ?? []);
        setError(payload.error);
        if (payload.error === null) {
          setImportText("");
          setPanel("none");
        }
      } catch (cause: unknown) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    })();
  }, [importMutate, importText, t]);

  return (
    <View style={styles.section} testID="provider-account-transfer">
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>
          {t("settings.providers.settingsModal.account.transferTitle")}
        </Text>
        <Text style={styles.sectionDescription}>
          {t("settings.providers.settingsModal.account.transferDescription")}
        </Text>
      </View>

      <View style={styles.actions}>
        <Button
          size="sm"
          variant="outline"
          loading={accounts.exportAccounts.isPending}
          disabled={accounts.exportAccounts.isPending || synthesized}
          onPress={handleExport}
          testID="provider-account-export"
        >
          {t("settings.providers.settingsModal.accounts.export")}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onPress={handleOpenImport}
          testID="provider-account-import"
        >
          {t("settings.providers.settingsModal.accounts.importAction")}
        </Button>
      </View>

      {panel === "export" ? (
        <View style={styles.panel} testID="provider-account-export-panel">
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
                testID="provider-account-export-bundle"
              >
                {bundleText}
              </Text>
              <View style={styles.actions}>
                <Button size="sm" onPress={handleCopyBundle} testID="provider-account-export-copy">
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
        <View style={styles.panel} testID="provider-account-import-panel">
          <Field
            label={t("settings.providers.settingsModal.accounts.importTitle")}
            hint={t("settings.providers.settingsModal.accounts.importHint")}
            error={importError}
            testID="provider-account-import-field"
          >
            <FormTextInput
              initialValue=""
              onChangeText={setImportText}
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              editable={!accounts.importAccounts.isPending}
              placeholder={t("settings.providers.settingsModal.accounts.importPlaceholder")}
              testID="provider-account-import-input"
            />
          </Field>
          <View style={styles.actions}>
            <Button
              size="sm"
              loading={accounts.importAccounts.isPending}
              disabled={accounts.importAccounts.isPending}
              onPress={handleImport}
              testID="provider-account-import-submit"
            >
              {t("settings.providers.settingsModal.accounts.importSubmit")}
            </Button>
            <Button size="sm" variant="ghost" onPress={handleClosePanel}>
              {t("common.actions.cancel")}
            </Button>
          </View>
        </View>
      ) : null}

      {error ? (
        <Text style={settingsStyles.rowError} testID="provider-account-transfer-error">
          {error}
        </Text>
      ) : null}
      {warnings.map((warning) => (
        <Text key={warning} style={styles.warning} testID="provider-account-transfer-warning">
          {warning}
        </Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    gap: theme.spacing[2],
  },
  sectionHeader: {
    gap: 2,
    marginLeft: theme.spacing[1],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  sectionDescription: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  panel: {
    gap: theme.spacing[2],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
  bundle: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
