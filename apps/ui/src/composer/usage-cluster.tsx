import type { ReactNode } from "react";
import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { QuotaRing } from "@/components/quota-ring";
import { COMPOSER_METER_RING_SIZE } from "@/composer/meter-geometry";
import { resolveWindowGlyph } from "@/composer/meter-glyph";
import { buildProviderUsageColumns } from "@/provider-usage/account-summary";
import { useUsageMeterPreferences } from "@/provider-usage/use-meter-preferences";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";
import { useRefreshUsageOnAgentResponse } from "@/provider-usage/use-refresh-on-agent-response";

interface ComposerUsageClusterProps {
  serverId: string;
  provider: string | null;
  providerAccountId?: string | null;
  /** The agent whose turns should refresh these figures, when that trigger is on. */
  agentId?: string | null;
  /** The context-window meter, rendered as the cluster's rightmost ring. */
  children: ReactNode;
}

/**
 * The composer's meter cluster: the provider's rolling quota windows (a session window and a
 * weekly one, in the order the provider reports them) followed by the context meter, inside a
 * single capsule. Grouping them is what says these three rings are one kind of thing, distinct
 * from the icon buttons either side of them.
 *
 * Quota rings are dropped entirely when the host reports no windows, so hosts without usage
 * reporting keep today's lone context ring rather than showing two empty circles.
 */
export function ComposerUsageCluster({
  serverId,
  provider,
  providerAccountId,
  agentId,
  children,
}: ComposerUsageClusterProps) {
  const preferences = useUsageMeterPreferences();
  const { view, refresh } = useProviderUsage(serverId, {
    autoRefresh: true,
    ...(provider ? { provider } : {}),
    ...(providerAccountId !== undefined ? { providerAccountId } : {}),
  });
  useRefreshUsageOnAgentResponse({
    serverId,
    agentId,
    enabled: preferences.refreshOnAgentResponse,
    refresh,
  });
  const columns = useMemo(
    () =>
      view.kind === "ready"
        ? buildProviderUsageColumns(view.payload.providers, provider ?? undefined)
        : [],
    [provider, view],
  );

  if (columns.length === 0) {
    return <View style={styles.contextOnly}>{children}</View>;
  }

  return (
    <View style={styles.capsule} testID="composer-usage-cluster">
      {columns.map((column) => (
        <QuotaRing
          key={column.id}
          column={column}
          size={COMPOSER_METER_RING_SIZE}
          glyph={resolveWindowGlyph(column)}
          onOpen={preferences.refreshOnHover ? refresh : undefined}
          testID={`composer-quota-ring-${column.id}`}
        />
      ))}
      {children}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  capsule: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
    height: 28,
    paddingHorizontal: theme.spacing[0.5],
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.surface2,
  },
  contextOnly: {
    width: 28,
    height: 28,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
}));
