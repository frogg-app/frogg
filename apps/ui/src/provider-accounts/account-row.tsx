import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Trash2 } from "lucide-react-native";
import type { ProviderAccountState } from "@frogg/protocol/provider-accounts";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { settingsStyles } from "@/styles/settings";
import { ICON_SIZE, type Theme } from "@/styles/theme";

const ThemedTrash2 = withUnistyles(Trash2);
const destructiveColorMapping = (theme: Theme) => ({ color: theme.colors.destructive });
const removeIcon = <ThemedTrash2 size={ICON_SIZE.sm} uniProps={destructiveColorMapping} />;

export interface ProviderAccountRowProps {
  account: ProviderAccountState;
  isFirst: boolean;
  /** False when the host has no workspace to show a login terminal in. */
  canAuthenticate: boolean;
  isAuthenticating: boolean;
  isActivating: boolean;
  isRemoving: boolean;
  /** Omitted when the daemon does not advertise `providerAccountManagement`. */
  onRename?: (account: ProviderAccountState) => void;
  /** Omitted when the daemon does not advertise `providerAccountManagement`. */
  onSignOut?: (account: ProviderAccountState) => void;
  isRenaming?: boolean;
  isSigningOut?: boolean;
  onAuthenticate: (account: ProviderAccountState) => void;
  onMakeActive: (account: ProviderAccountState) => void;
  onRemove: (account: ProviderAccountState) => void;
}

export function ProviderAccountRow({
  account,
  isFirst,
  canAuthenticate,
  isAuthenticating,
  isActivating,
  isRemoving,
  onRename,
  onSignOut,
  isRenaming = false,
  isSigningOut = false,
  onAuthenticate,
  onMakeActive,
  onRemove,
}: ProviderAccountRowProps): ReactElement {
  const { t } = useTranslation();
  const handleAuthenticate = useCallback(() => onAuthenticate(account), [account, onAuthenticate]);
  const handleMakeActive = useCallback(() => onMakeActive(account), [account, onMakeActive]);
  const handleRemove = useCallback(() => onRemove(account), [account, onRemove]);
  const handleRename = useCallback(() => onRename?.(account), [account, onRename]);
  const handleSignOut = useCallback(() => onSignOut?.(account), [account, onSignOut]);
  const rowStyle = useMemo(
    () => [settingsStyles.row, isFirst ? null : settingsStyles.rowBorder],
    [isFirst],
  );

  return (
    <View style={rowStyle} testID={`provider-account-row-${account.id}`}>
      <View style={settingsStyles.rowContent}>
        <View style={styles.titleRow}>
          <Text style={settingsStyles.rowTitle} numberOfLines={1}>
            {account.name}
          </Text>
          {account.isActive ? (
            <StatusBadge label={t("settings.host.providerAccounts.active")} variant="success" />
          ) : null}
          <StatusBadge
            label={
              account.authenticated
                ? t("settings.host.providerAccounts.authenticated")
                : t("settings.host.providerAccounts.notAuthenticated")
            }
            variant={account.authenticated ? "success" : "warning"}
          />
        </View>
        <Text style={styles.path} numberOfLines={1} selectable>
          {account.configDir}
        </Text>
      </View>
      <View style={styles.actions}>
        <Button
          size="sm"
          variant="outline"
          disabled={!canAuthenticate || isAuthenticating}
          loading={isAuthenticating}
          onPress={handleAuthenticate}
          testID={`provider-account-authenticate-${account.id}`}
        >
          {t("settings.host.providerAccounts.authenticate")}
        </Button>
        {onRename ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isRenaming}
            loading={isRenaming}
            onPress={handleRename}
            testID={`provider-account-rename-${account.id}`}
          >
            {t("settings.providers.settingsModal.accounts.rename")}
          </Button>
        ) : null}
        {onSignOut && account.authenticated ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={isSigningOut}
            loading={isSigningOut}
            onPress={handleSignOut}
            testID={`provider-account-sign-out-${account.id}`}
          >
            {t("settings.providers.settingsModal.accounts.signOut")}
          </Button>
        ) : null}
        {account.isActive ? null : (
          <Button
            size="sm"
            variant="ghost"
            disabled={isActivating}
            loading={isActivating}
            onPress={handleMakeActive}
            testID={`provider-account-activate-${account.id}`}
          >
            {t("settings.host.providerAccounts.makeActive")}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          leftIcon={removeIcon}
          disabled={isRemoving}
          loading={isRemoving}
          onPress={handleRemove}
          accessibilityLabel={t("settings.host.providerAccounts.remove")}
          testID={`provider-account-remove-${account.id}`}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  path: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
    marginTop: theme.spacing[1],
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
