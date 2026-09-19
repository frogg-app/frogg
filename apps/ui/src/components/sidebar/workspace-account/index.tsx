import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { TriangleAlert, UserRound } from "lucide-react-native";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { resolveProviderAccountControlModel } from "@/composer/agent-controls/provider-account";
import { useWorkspaceAgentTree } from "@/components/sidebar/agents/workspace-tree";
import { useSidebarRowItems } from "@/components/sidebar/display-preferences/model";
import { resolveWorkspaceAccountAgent } from "./model";

export { resolveWorkspaceAccountAgent } from "./model";

/**
 * COMPAT(perAgentProviderAccounts): added in v1.4.0, remove after 2027-09-17.
 *
 * The account on a workspace row, for providers the user has signed into more than once:
 * the account's name, then its glyph, at the right end of the row after the diff stat. The
 * full "Account: …" wording lives in the tooltip.
 *
 * Only for a session that is one agent. Once the row owns sub-rows — subagents, or several
 * tabs — the account belongs to each of those individually and is rendered there instead,
 * because a single line cannot honestly name the account for several agents at once. What
 * stays at session level is the diff stat, which really is a property of the whole session.
 *
 * Renders nothing — and runs no snapshot query — for a workspace with no agent, which is
 * why the fetching half is a separate component below.
 */
export function SidebarWorkspaceAccountIndicator({ serverId }: { serverId: string }) {
  const { roots, nodes } = useWorkspaceAgentTree();
  const accountAgent = useMemo(() => resolveWorkspaceAccountAgent(roots), [roots]);
  // `nodes` is exactly what the disclosure chevron renders rows for, so this hides the
  // session-level account precisely when per-agent ones appear below it.
  if (nodes.length > 0) return null;
  if (!accountAgent) return null;
  return (
    <SidebarAccountIndicator
      serverId={serverId}
      provider={accountAgent.provider}
      providerAccountId={accountAgent.providerAccountId}
    />
  );
}

/**
 * The account one agent runs as. Shared by workspace rows and the agent tree under them, so
 * every tab and subagent names its account the same way.
 */
export function SidebarAccountIndicator(props: SidebarAccountIndicatorProps) {
  // The "Account" item in the sidebar's Show menu; off skips the snapshot query entirely.
  const { account } = useSidebarRowItems();
  if (!account) return null;
  return <SidebarAccountIndicatorContent {...props} />;
}

interface SidebarAccountIndicatorProps {
  serverId: string;
  provider: string;
  providerAccountId: string | null | undefined;
  /** The account name to the left of the glyph; off leaves the glyph alone. */
  showLabel?: boolean;
}

function SidebarAccountIndicatorContent({
  serverId,
  provider,
  providerAccountId,
  showLabel = true,
}: SidebarAccountIndicatorProps) {
  const { t } = useTranslation();
  // Home scope rather than the agent's cwd: accounts are a property of the provider on the
  // daemon, not of the directory, and one shared query key keeps every row in the sidebar on
  // a single subscription instead of one request per workspace.
  const { entries } = useProvidersSnapshot(serverId, { cwd: null });
  const model = useMemo(() => {
    const entry = entries?.find((candidate) => candidate.provider === provider);
    return resolveProviderAccountControlModel({
      accounts: entry?.accounts,
      defaultAccountId: entry?.defaultAccountId,
      selection: providerAccountId,
      // A launched agent runs as whatever the daemon resolved, so an absent pick names the
      // provider's active account rather than the Default row.
    });
  }, [entries, provider, providerAccountId]);

  // Null whenever the provider has no additional accounts, so a single-account setup looks
  // exactly as it did before this indicator existed.
  if (!model) return null;

  const label = t("sidebar.workspaceAccount", { value: model.displayLabel });
  const Icon = model.selectedIsUnauthenticated ? TriangleAlert : UserRound;
  const color = model.selectedIsUnauthenticated
    ? styles.warningIconColor.color
    : styles.iconColor.color;
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <View
          style={styles.indicator}
          accessibilityLabel={label}
          testID="sidebar-workspace-account"
        >
          {showLabel ? (
            <Text style={styles.name} numberOfLines={1}>
              {model.displayLabel}
            </Text>
          ) : null}
          <Icon size={12} color={color} />
        </View>
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{label}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Matches the trailing slot's line box so the glyph sits on the title's baseline row.
  indicator: {
    height: 20,
    flexShrink: 1,
    minWidth: 0,
    maxWidth: 120,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing[1],
  },
  name: {
    flexShrink: 1,
    minWidth: 0,
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  // Icon tints are read off the stylesheet rather than `useUnistyles`, which the lint rule
  // bans, because lucide takes a `color` prop and not a style.
  iconColor: {
    color: theme.colors.foregroundExtraMuted,
  },
  warningIconColor: {
    color: theme.colors.statusWarning,
  },
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
