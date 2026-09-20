import { Fragment } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ProviderAccountState } from "@frogg/protocol/provider-accounts";
import { settingsStyles } from "@/styles/settings";
import { ProviderUsageCard } from "./card";
import { ProviderUsageProviderSection } from "./provider-section";
import type { ProviderUsage } from "./types";

export function ProviderUsageList({
  providers,
  serverId,
  accountsByProvider,
}: {
  providers: ProviderUsage[];
  /**
   * Both are needed to scope a provider's figures to one sign-in, and both are
   * optional: a surface with no account context (or a daemon that lists no
   * accounts) renders exactly the card it always did.
   */
  serverId?: string;
  accountsByProvider?: ReadonlyMap<string, readonly ProviderAccountState[]>;
}) {
  return (
    <View style={settingsStyles.card}>
      {providers.map((usage, index) => {
        const accounts = accountsByProvider?.get(usage.providerId) ?? [];
        return (
          <Fragment key={usage.providerId}>
            {index > 0 ? <View style={styles.divider} /> : null}
            {serverId ? (
              <ProviderUsageProviderSection serverId={serverId} usage={usage} accounts={accounts} />
            ) : (
              <ProviderUsageCard usage={usage} />
            )}
          </Fragment>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  divider: {
    height: 1,
    backgroundColor: theme.colors.border,
  },
}));
