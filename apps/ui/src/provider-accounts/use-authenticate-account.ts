import { useCallback, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { ProviderAccountState } from "@frogg/protocol/provider-accounts";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useWorkspace, useWorkspaceKeys } from "@/stores/session-store-hooks";

/**
 * Signing an account in means running the provider's own interactive login in a
 * Frogg terminal: only the CLI can complete its device flow. The daemon owns the
 * command and the config-dir env — the client sends the account id and no
 * command at all.
 *
 * Terminals are workspace-scoped end to end (the daemon requires a workspace it
 * can resolve, and the only terminal view lives in a workspace tab), so the
 * login runs in one of the host's existing workspaces. The working directory is
 * irrelevant to a login command; with no workspace on the host there is nowhere
 * to show a terminal, and the action is disabled instead.
 */
export function useAuthenticateProviderAccount(serverId: string) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const workspaceKeys = useWorkspaceKeys(serverId);
  const hostWorkspaceKey = workspaceKeys[0] ?? null;
  const workspace = useWorkspace(serverId, hostWorkspaceKey);
  const target = useMemo(
    () =>
      workspace?.workspaceDirectory
        ? { workspaceId: workspace.id, cwd: workspace.workspaceDirectory }
        : null,
    [workspace],
  );

  const mutation = useMutation({
    mutationFn: async (account: ProviderAccountState) => {
      if (!client) {
        throw new Error(t("settings.host.providerAccounts.unavailable"));
      }
      if (!target) {
        throw new Error(t("settings.host.providerAccounts.authenticateNoWorkspace"));
      }
      const payload = await client.createTerminal(
        target.cwd,
        t("settings.host.providerAccounts.authenticateTerminalName", { name: account.name }),
        undefined,
        { workspaceId: target.workspaceId, providerAccountId: account.id },
      );
      if (!payload.terminal) {
        throw new Error(payload.error ?? t("settings.host.providerAccounts.authenticateFailed"));
      }
      return { terminalId: payload.terminal.id, workspaceId: target.workspaceId };
    },
    onSuccess: ({ terminalId, workspaceId }) => {
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "terminal", terminalId },
      });
    },
  });

  const authenticate = useCallback(
    (account: ProviderAccountState) => mutation.mutate(account),
    [mutation],
  );

  return {
    authenticate,
    canAuthenticate: target !== null && client !== null,
    isPending: mutation.isPending,
    pendingAccountId: mutation.isPending ? (mutation.variables?.id ?? null) : null,
    error: mutation.error instanceof Error ? mutation.error.message : null,
  };
}
