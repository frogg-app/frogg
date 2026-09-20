import type { ReactNode } from "react";
import { useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { QuotaRing } from "@/components/quota-ring";
import { resolveWindowGlyph } from "@/composer/meter-glyph";
import { buildProviderUsageColumns } from "@/provider-usage/account-summary";
import { useProviderUsage } from "@/provider-usage/use-provider-usage";

/**
 * Every ring in the cluster — the quota windows and the context window — is drawn at one
 * diameter in one slot width. They measure different things but they are the same kind of
 * thing, and a size difference between them would read as a hierarchy that does not exist.
 */
export const COMPOSER_METER_RING_SIZE = 16;
export const COMPOSER_METER_SLOT_WIDTH = 24;
/** The centre character's size. One point smaller and it stops resolving at 1x. */
export const COMPOSER_METER_GLYPH_SIZE = 8;

interface ComposerUsageClusterProps {
  serverId: string;
  provider: string | null;
  providerAccountId?: string | null;
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
  children,
}: ComposerUsageClusterProps) {
  const { view } = useProviderUsage(serverId, {
    ...(provider ? { provider } : {}),
    ...(providerAccountId !== undefined ? { providerAccountId } : {}),
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
