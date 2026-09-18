import { useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { UserRound } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { composerPillStyles } from "@/composer/pill-styles";
import {
  resolveProviderAccountControlModel,
  shouldShowProviderAccountPill,
} from "@/composer/agent-controls/provider-account";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

const ThemedUserRound = withUnistyles(UserRound);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type AgentProviderAccountSlice = {
  provider: string;
  cwd: string | null;
  providerAccountId: string | null | undefined;
} | null;

function selectAgentProviderAccountSlice(
  state: ReturnType<typeof useSessionStore.getState>,
  serverId: string,
  agentId: string,
): AgentProviderAccountSlice {
  const agent = state.sessions[serverId]?.agents?.get(agentId) ?? null;
  if (!agent) {
    return null;
  }
  return {
    provider: agent.provider,
    cwd: agent.cwd,
    providerAccountId: agent.providerAccountId,
  };
}

/**
 * COMPAT(perAgentProviderAccounts): added in v1.3.6, remove after 2027-09-17.
 *
 * `null` when the pill must not render at all — a provider with one account or
 * none is nothing to disambiguate, and `useProviderAccountPill` in
 * `agent-controls/index.tsx` relies on this same shape to decide whether the
 * toolbar's read-only badge should stand down.
 */
export interface ProviderAccountPillModel {
  label: string;
}

export function useProviderAccountPillModel(
  serverId: string,
  agentId: string,
): ProviderAccountPillModel | null {
  const agent = useSessionStore(
    useShallow((state) => selectAgentProviderAccountSlice(state, serverId, agentId)),
  );
  const { entries } = useProvidersSnapshot(serverId, { cwd: agent?.cwd });
  const entry = useMemo(
    () => entries?.find((candidate) => candidate.provider === agent?.provider) ?? null,
    [entries, agent?.provider],
  );

  return useMemo(() => {
    const accounts = entry?.accounts;
    if (!agent || !accounts) {
      return null;
    }
    // COMPAT(perAgentProviderAccounts): every agent this hook is asked about is
    // already launched, so "running" here means "bound to a provider process",
    // matching `buildReadOnlyProviderAccountControl`'s comment. There is no
    // separate turn-activity signal to check.
    if (!shouldShowProviderAccountPill({ isRunning: true, accountsCount: accounts.length })) {
      return null;
    }
    const model = resolveProviderAccountControlModel({
      accounts,
      defaultAccountId: entry?.defaultAccountId,
      selection: agent.providerAccountId,
      resolveAbsentToActiveAccount: true,
    });
    return model ? { label: model.displayLabel } : null;
  }, [agent, entry]);
}

/**
 * The account a running agent's provider process is bound to, as its own pill
 * in the row above the composer — alongside the workspace, task, and subagent
 * pills. Purely informational: the account cannot be switched mid-run, so
 * unlike its siblings this pill is never pressable.
 */
export function ProviderAccountPill({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement | null {
  const { t } = useTranslation();
  const model = useProviderAccountPillModel(serverId, agentId);
  if (!model) {
    return null;
  }
  const label = t("agentControls.account.pillLabel", { value: model.label });
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={composerPillStyles.body}
      testID="composer-provider-account-pill"
    >
      <ThemedUserRound size={14} uniProps={iconColor} />
      <Text numberOfLines={1} style={composerPillStyles.label}>
        {model.label}
      </Text>
    </View>
  );
}
