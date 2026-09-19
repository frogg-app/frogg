import { useCallback, useMemo, type ReactElement } from "react";
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Plus } from "lucide-react-native";
import {
  PROVIDER_ACCOUNT_DEFAULT_NAME,
  parseProviderAccountDefaultId,
  providerAccountDefaultId,
  type ProviderAccountState,
} from "@frogg/protocol/provider-accounts";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import {
  ProviderAccountAvatar,
  resolveProviderAccountColor,
} from "@/provider-accounts/account-avatar";

const ThemedPlus = withUnistyles(Plus);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * What to call an account on screen. The provider's implicit default account is
 * stored under a reserved name, which is a protocol detail rather than a label,
 * so it is shown as the translated "Default" the composer also uses.
 */
export function providerAccountDisplayName(
  account: Pick<ProviderAccountState, "id" | "name">,
  t: TFunction,
): string {
  const isDefault = parseProviderAccountDefaultId(account.id) !== null;
  if (isDefault && account.name === PROVIDER_ACCOUNT_DEFAULT_NAME) {
    return t("agentControls.account.default");
  }
  return account.name;
}

/**
 * The daemon only lists a provider's implicit default account once something
 * has been stored about it (a rename, a restriction, a preference), but it
 * accepts the default id for every per-account request either way. Synthesize
 * it so the default sign-in always has a tab of its own. It is the account in
 * use when no other one is active.
 */
export function withDefaultAccount(
  accounts: readonly ProviderAccountState[],
  providerId: string,
): ProviderAccountState[] {
  const defaultId = providerAccountDefaultId(providerId);
  if (accounts.some((account) => account.id === defaultId)) {
    return [...accounts];
  }
  const synthesized: ProviderAccountState = {
    id: defaultId,
    provider: accounts[0]?.provider ?? providerId,
    name: PROVIDER_ACCOUNT_DEFAULT_NAME,
    configDir: "~",
    linkedFolders: [],
    createdAt: "",
    authenticated: false,
    isActive: !accounts.some((account) => account.isActive),
  };
  return [synthesized, ...accounts];
}

/** True for a tab the daemon has stored nothing about: {@link withDefaultAccount} made it up. */
export function isSynthesizedAccount(
  accounts: readonly ProviderAccountState[],
  account: ProviderAccountState,
): boolean {
  return !accounts.some((candidate) => candidate.id === account.id);
}

interface AccountTabProps {
  account: ProviderAccountState;
  label: string;
  isSelected: boolean;
  onSelect: (accountId: string) => void;
}

function AccountTab({ account, label, isSelected, onSelect }: AccountTabProps) {
  const handlePress = useCallback(() => onSelect(account.id), [account.id, onSelect]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  const color = resolveProviderAccountColor(account);
  return (
    <Pressable
      onPress={handlePress}
      style={[styles.tab, isSelected ? styles.tabSelected : null]}
      accessibilityRole="tab"
      accessibilityState={accessibilityState}
      testID={`provider-account-tab-${account.id}`}
    >
      <ProviderAccountAvatar
        label={label}
        color={color}
        size={20}
        authenticated={account.authenticated}
      />
      <Text
        style={[styles.tabLabel, isSelected ? styles.tabLabelSelected : null]}
        numberOfLines={1}
      >
        {label}
      </Text>
      {account.isActive ? <View style={styles.activeDot} /> : null}
    </Pressable>
  );
}

export interface AccountTabsProps {
  accounts: readonly ProviderAccountState[];
  selectedAccountId: string | null;
  onSelect: (accountId: string) => void;
  /** Omitted when the daemon does not accept new accounts for this provider. */
  onAdd?: () => void;
}

/**
 * The account switcher: one tab per sign-in, and everything else on the sheet
 * belongs to the selected tab.
 */
export function AccountTabs({
  accounts,
  selectedAccountId,
  onSelect,
  onAdd,
}: AccountTabsProps): ReactElement {
  const { t } = useTranslation();
  return (
    <View style={styles.bar}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.strip}
        testID="provider-account-tabs"
      >
        {accounts.map((account) => (
          <AccountTab
            key={account.id}
            account={account}
            label={providerAccountDisplayName(account, t)}
            isSelected={account.id === selectedAccountId}
            onSelect={onSelect}
          />
        ))}
        {onAdd ? (
          <Pressable
            onPress={onAdd}
            style={styles.addTab}
            accessibilityRole="button"
            accessibilityLabel={t("settings.host.providerAccounts.addAccount")}
            testID="provider-account-tab-add"
          >
            <ThemedPlus size={ICON_SIZE.sm} uniProps={mutedColorMapping} />
          </Pressable>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingBottom: theme.spacing[2],
  },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    maxWidth: 200,
    paddingVertical: theme.spacing[1.5],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabSelected: {
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
  },
  tabLabel: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  tabLabelSelected: {
    color: theme.colors.foreground,
    fontWeight: theme.fontWeight.medium,
  },
  activeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.colors.statusSuccess,
  },
  addTab: {
    alignItems: "center",
    justifyContent: "center",
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
}));
