import { useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderAccountState } from "@frogg/protocol/provider-accounts";
import { AccountTabs } from "@/screens/settings/provider-settings-modal/account-tabs";
import {
  resolveSelectedUsageAccountId,
  resolveUsageAccountScopeId,
  shouldShowUsageAccountTabs,
} from "./accounts";
import { ProviderUsageCard } from "./card";
import type { ProviderUsage } from "./types";
import { useProviderUsage } from "./use-provider-usage";

/**
 * One provider's usage, with an account switcher when the provider has more
 * than one sign-in.
 *
 * Every sign-in has its own plan and its own limits, so a single card for the
 * provider can only ever describe one of them — and it described whichever the
 * daemon had active, under the provider's name, with nothing on screen saying
 * so. The figures shown are read for the open tab's account.
 */
export function ProviderUsageProviderSection({
  serverId,
  usage,
  accounts,
}: {
  serverId: string;
  /** This provider's figures as the unscoped list reported them. */
  usage: ProviderUsage;
  /** Every sign-in for this provider, the implicit default included. */
  accounts: readonly ProviderAccountState[];
}) {
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const hasTabs = shouldShowUsageAccountTabs(accounts);
  const activeAccountId = resolveSelectedUsageAccountId(accounts, selectedAccountId);
  const scopeAccountId = useMemo(
    () => (activeAccountId ? resolveUsageAccountScopeId(activeAccountId) : undefined),
    [activeAccountId],
  );

  // Only a provider with tabs asks for scoped figures: with one sign-in the
  // list's own entry already describes it, and a second request would read the
  // same directory twice.
  const scoped = useProviderUsage(serverId, {
    enabled: hasTabs && activeAccountId !== null,
    provider: usage.providerId,
    providerAccountId: scopeAccountId,
  });

  const scopedUsage = useMemo(() => {
    if (!hasTabs || scoped.view.kind !== "ready") return null;
    return (
      scoped.view.payload.providers.find((item) => item.providerId === usage.providerId) ?? null
    );
  }, [hasTabs, scoped.view, usage.providerId]);

  const handleSelect = useCallback((accountId: string) => {
    setSelectedAccountId(accountId);
  }, []);

  if (!hasTabs) {
    return <ProviderUsageCard usage={usage} />;
  }

  return (
    <View style={styles.section} testID={`provider-usage-section-${usage.providerId}`}>
      <View style={styles.tabs}>
        <AccountTabs
          accounts={accounts}
          selectedAccountId={activeAccountId}
          onSelect={handleSelect}
        />
      </View>
      {/* Until the open tab's own figures arrive, the unscoped card is the
          honest thing to show: it is the same provider, and it is what was on
          screen a moment ago. */}
      <ProviderUsageCard usage={scopedUsage ?? usage} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  section: {
    flexDirection: "column",
  },
  tabs: {
    paddingTop: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
}));
