import { useCallback, useMemo, useState, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { UserRound } from "lucide-react-native";
import { withUnistyles } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { composerPillStyles } from "@/composer/pill-styles";
import {
  resolveProviderAccountControlModel,
  resolveProviderAccountTransferOptions,
  shouldShowProviderAccountPill,
  toProviderAccountSelection,
} from "@/composer/agent-controls/provider-account";
import {
  ProviderAccountTransferModal,
  type ProviderAccountTransferOption,
} from "@/composer/agent-controls/provider-account-transfer-modal";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

const ThemedUserRound = withUnistyles(UserRound);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

type AgentProviderAccountSlice = {
  provider: string;
  cwd: string | null;
  providerAccountId: string | null | undefined;
  /** What a transfer costs to re-send; null until the agent reports usage. */
  contextTokens: number | null;
} | null;

/** The context meter's used-token figure, or null when it is not a real count. */
function resolveContextTokens(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

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
    contextTokens: resolveContextTokens(agent.lastUsage?.contextWindowUsedTokens),
  };
}

/**
 * COMPAT(perAgentProviderAccounts): added in v1.3.6, remove after 2027-09-17.
 *
 * `null` when the pill must not render at all — a provider with no accounts has
 * nothing to name, and `useProviderAccountPill` in
 * `agent-controls/index.tsx` relies on this same shape to decide whether the
 * toolbar's read-only badge should stand down.
 */
export interface ProviderAccountPillModel {
  label: string;
  /**
   * COMPAT(agentProviderAccountTransfer): added in v1.5.7, remove after
   * 2027-09-19. Every account this conversation could move to — the provider's
   * accounts and its Default row, minus the one it already runs as. Empty when
   * the agent has nowhere to move, which is what keeps the pill unpressable.
   */
  transferOptions: ProviderAccountTransferOption[];
  contextTokens: number | null;
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
    });
    if (!model) {
      return null;
    }
    const transferOptions = resolveProviderAccountTransferOptions(model).map((option) => ({
      id: option.id,
      label: option.label,
      authenticated: option.authenticated,
    }));
    return {
      label: model.displayLabel,
      transferOptions,
      contextTokens: agent.contextTokens,
    };
  }, [agent, entry]);
}

/**
 * The account a running agent's provider process is bound to, as its own pill
 * in the row above the composer — alongside the workspace, task, and subagent
 * pills.
 *
 * COMPAT(agentProviderAccountTransfer): added in v1.5.7, remove after
 * 2027-09-19. Pressing it moves the conversation to another sign-in, on a
 * daemon that can do it and when there is somewhere to move to. Against an
 * older daemon, or a provider with nowhere else to go, it stays the read-only
 * badge it has always been.
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
  const client = useHostRuntimeClient(serverId);
  const canTransfer = useHostFeature(serverId, "agentProviderAccountTransfer");
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(() => {
    setError(null);
    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    if (isPending) return;
    setIsOpen(false);
  }, [isPending]);

  const handleConfirm = useCallback(
    (optionId: string) => {
      if (!client) return;
      setIsPending(true);
      setError(null);
      void (async () => {
        try {
          await client.transferAgentProviderAccount(agentId, toProviderAccountSelection(optionId));
          setIsPending(false);
          setIsOpen(false);
        } catch (cause: unknown) {
          setIsPending(false);
          setError(
            cause instanceof Error && cause.message
              ? cause.message
              : t("agentControls.account.transfer.failed"),
          );
        }
      })();
    },
    [agentId, client, t],
  );

  if (!model) {
    return null;
  }

  const label = t("agentControls.account.pillLabel", { value: model.label });
  const isPressable = canTransfer && client !== null && model.transferOptions.length > 0;
  const body = (
    <>
      <ThemedUserRound size={14} uniProps={iconColor} />
      <Text numberOfLines={1} style={composerPillStyles.label}>
        {model.label}
      </Text>
    </>
  );

  if (!isPressable) {
    return (
      <View
        accessible
        accessibilityLabel={label}
        style={composerPillStyles.body}
        testID="composer-provider-account-pill"
      >
        {body}
      </View>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("agentControls.account.pillTransferLabel", { value: model.label })}
        onPress={handleOpen}
        style={composerPillStyles.body}
        testID="composer-provider-account-pill"
      >
        {body}
      </Pressable>
      <ProviderAccountTransferModal
        visible={isOpen}
        options={model.transferOptions}
        contextTokens={model.contextTokens}
        isPending={isPending}
        error={error}
        onClose={handleClose}
        onConfirm={handleConfirm}
      />
    </>
  );
}
