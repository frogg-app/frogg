import { useCallback } from "react";
import { useToast } from "@/contexts/toast-context";
import { i18n } from "@/i18n/i18next";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { requestDetachSubagent, type ResolveDetachSubagentDialogInput } from "./detach-subagent";

export { resolveDetachedSubagentLabel, requestDetachSubagent } from "./detach-subagent";
export type {
  DetachSubagentDeps,
  RequestDetachSubagentInput,
  ResolveDetachSubagentDialogInput,
} from "./detach-subagent";

export interface UseDetachSubagentInput {
  serverId: string;
}

export function useDetachSubagent(input: UseDetachSubagentInput): (subagentId: string) => void {
  const { serverId } = input;
  const toast = useToast();

  return useCallback(
    (subagentId: string) => {
      void requestDetachSubagent(
        { serverId, subagentId },
        {
          getSubagent: (id): ResolveDetachSubagentDialogInput | undefined =>
            useSessionStore.getState().sessions[serverId]?.agents?.get(id),
          detachAgent: async ({ serverId: targetServerId, agentId }) => {
            const client = useSessionStore.getState().sessions[targetServerId]?.client;
            if (!client) {
              throw new Error(i18n.t("workspaceSetup.errors.hostDisconnected"));
            }
            await client.detachAgent(agentId);
          },
          openDetachedAgent: ({ serverId: targetServerId, agentId }) => {
            navigateToAgent({ serverId: targetServerId, agentId });
          },
          reportDetached: (label) => {
            toast.show(
              label
                ? i18n.t("subagents.detachedToast", { name: label })
                : i18n.t("subagents.detachedToastUnnamed"),
            );
          },
          reportError: (error) => {
            toast.error(toErrorMessage(error));
          },
        },
      );
    },
    [serverId, toast],
  );
}
