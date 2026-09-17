import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import type { ProviderAccountCapability } from "@frogg/protocol/provider-accounts";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { Button } from "@/components/ui/button";
import { Field, FormTextInput } from "@/components/ui/form-field";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import type { Theme } from "@/styles/theme";
import {
  buildProviderAccountCreatePayload,
  previewProviderAccountConfigDir,
  validateProviderAccountName,
  type ProviderAccountCreateInput,
} from "./model";
import { providerAccountLabel } from "./provider-labels";

const ThemedCheck = withUnistyles(Check);
const checkedIconMapping = (theme: Theme) => ({ color: theme.colors.primaryForeground });

export interface CreateProviderAccountModalProps {
  visible: boolean;
  capability: ProviderAccountCapability;
  existingNames: readonly string[];
  isSubmitting: boolean;
  /** Verbatim `error` from the last failed create, or null. Keeps the modal open. */
  error: string | null;
  /** Verbatim `warnings` from the last create attempt. */
  warnings: readonly string[];
  onClose: () => void;
  onSubmit: (input: ProviderAccountCreateInput) => void;
}

export function CreateProviderAccountModal({
  visible,
  capability,
  existingNames,
  isSubmitting,
  error,
  warnings,
  onClose,
  onSubmit,
}: CreateProviderAccountModalProps): ReactElement {
  const { t } = useTranslation();
  const [name, setName] = useState("");
  // Sharing every declared folder is the point of a second account, so they all
  // start checked; unchecking one is the deliberate act.
  const [excluded, setExcluded] = useState<readonly string[]>([]);

  const validation = useMemo(
    () => validateProviderAccountName(name, existingNames),
    [existingNames, name],
  );
  const configDir = useMemo(
    () => previewProviderAccountConfigDir(capability, validation.slug),
    [capability, validation.slug],
  );
  const selectedFolders = useMemo(
    () => capability.linkableFolders.filter((folder) => !excluded.includes(folder)),
    [capability.linkableFolders, excluded],
  );

  const toggleFolder = useCallback((folder: string) => {
    setExcluded((current) =>
      current.includes(folder) ? current.filter((entry) => entry !== folder) : [...current, folder],
    );
  }, []);

  const handleSubmit = useCallback(() => {
    const payload = buildProviderAccountCreatePayload({ capability, name, selectedFolders });
    if (!payload) {
      return;
    }
    onSubmit(payload);
  }, [capability, name, onSubmit, selectedFolders]);

  const nameError = useMemo(() => {
    if (validation.status === "invalid") {
      return t("settings.host.providerAccounts.nameInvalid");
    }
    if (validation.status === "duplicate") {
      return t("settings.host.providerAccounts.nameDuplicate", { slug: validation.slug ?? "" });
    }
    return null;
  }, [t, validation.slug, validation.status]);

  const header = useMemo<SheetHeader>(
    () => ({
      title: t("settings.host.providerAccounts.addAccountTitle", {
        provider: providerAccountLabel(capability.provider),
      }),
    }),
    [capability.provider, t],
  );

  const footer = useMemo(
    () => (
      <View style={styles.footer}>
        <Button
          variant="outline"
          style={styles.footerButton}
          onPress={onClose}
          testID="provider-account-create-cancel"
        >
          {t("common.actions.cancel")}
        </Button>
        <Button
          style={styles.footerButton}
          disabled={validation.status !== "valid" || isSubmitting}
          loading={isSubmitting}
          onPress={handleSubmit}
          testID="provider-account-create-submit"
        >
          {t("settings.host.providerAccounts.create")}
        </Button>
      </View>
    ),
    [handleSubmit, isSubmitting, onClose, t, validation.status],
  );

  return (
    <AdaptiveModalSheet
      header={header}
      visible={visible}
      onClose={onClose}
      footer={footer}
      testID="provider-account-create-sheet"
    >
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <Field
            label={t("settings.host.providerAccounts.nameLabel")}
            hint={t("settings.host.providerAccounts.nameHint")}
            error={nameError}
            testID="provider-account-name-field"
          >
            <FormTextInput
              initialValue=""
              onChangeText={setName}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isSubmitting}
              placeholder={t("settings.host.providerAccounts.namePlaceholder")}
              testID="provider-account-name-input"
            />
          </Field>
        </View>
        {configDir ? (
          <View style={settingsStyles.row}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowHint}>
                {t("settings.host.providerAccounts.slugPreview", { slug: validation.slug ?? "" })}
              </Text>
              <Text style={styles.path} numberOfLines={1} testID="provider-account-config-dir">
                {t("settings.host.providerAccounts.configDirPreview", { path: configDir })}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.host.providerAccounts.configDirEnvHint", {
                  env: capability.configDirEnv,
                })}
              </Text>
            </View>
          </View>
        ) : null}
      </View>

      <SettingsSection
        title={t("settings.host.providerAccounts.sharedFoldersLabel")}
        info={t("settings.host.providerAccounts.sharedFoldersHint")}
        flush
      >
        <View style={settingsStyles.card} testID="provider-account-folders-card">
          {capability.linkableFolders.length === 0 ? (
            <View style={settingsStyles.row}>
              <Text style={settingsStyles.rowHint}>
                {t("settings.host.providerAccounts.sharedFoldersEmpty")}
              </Text>
            </View>
          ) : (
            capability.linkableFolders.map((folder, index) => (
              <FolderCheckboxRow
                key={folder}
                folder={folder}
                checked={!excluded.includes(folder)}
                disabled={isSubmitting}
                withBorder={index > 0}
                onToggle={toggleFolder}
              />
            ))
          )}
        </View>
      </SettingsSection>

      {warnings.map((warning) => (
        <Text key={warning} style={styles.warning} testID="provider-account-create-warning">
          {warning}
        </Text>
      ))}
      {error ? (
        <Text style={settingsStyles.rowError} testID="provider-account-create-error">
          {error}
        </Text>
      ) : null}
    </AdaptiveModalSheet>
  );
}

interface FolderCheckboxRowProps {
  folder: string;
  checked: boolean;
  disabled: boolean;
  withBorder: boolean;
  onToggle: (folder: string) => void;
}

function FolderCheckboxRow({
  folder,
  checked,
  disabled,
  withBorder,
  onToggle,
}: FolderCheckboxRowProps): ReactElement {
  const handlePress = useCallback(() => onToggle(folder), [folder, onToggle]);
  const accessibilityState = useMemo(() => ({ checked, disabled }), [checked, disabled]);
  const rowStyle = useMemo(
    () => [
      settingsStyles.row,
      withBorder ? settingsStyles.rowBorder : null,
      styles.checkboxRow,
      disabled ? styles.disabledRow : null,
    ],
    [disabled, withBorder],
  );
  const boxStyle = useMemo(
    () => [styles.checkbox, checked ? styles.checkboxChecked : null],
    [checked],
  );

  return (
    <Pressable
      style={rowStyle}
      onPress={handlePress}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={folder}
      accessibilityState={accessibilityState}
      aria-checked={checked}
      testID={`provider-account-folder-${folder}`}
    >
      <View style={boxStyle}>
        {checked ? <ThemedCheck size={14} uniProps={checkedIconMapping} /> : null}
      </View>
      <Text style={settingsStyles.rowTitle}>{folder}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
  checkboxRow: {
    alignItems: "center",
    gap: theme.spacing[3],
  },
  disabledRow: {
    opacity: 0.5,
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  path: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  warning: {
    color: theme.colors.statusWarning,
    fontSize: theme.fontSize.sm,
  },
}));
