import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { buildFirstAgentContext, submitWorkspaceDraft } from "@/screens/new-workspace-screen";
import { CHAT_WEB_ACCESS_FEATURE_ID, useChatProviders } from "@/screens/new-chat-screen";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";

// The same draft the shipping new-chat screen edits, so text typed on the soft home follows the
// user there (and back) instead of living in a second, invisible draft.
const NEW_CHAT_DRAFT_KEY = "new-chat";

export interface SoftStartChat {
  text: string;
  setText: (text: string) => void;
  /** Null while the host is offline or cannot run chats. */
  submit: (() => void) | null;
  isPending: boolean;
}

/**
 * Starts a real project-less chat from a single text field: the new-chat screen's submit path
 * (create a chat workspace, hand the first message to the draft submission flow, navigate)
 * without its full composer. Provider and model are the host's remembered chat defaults.
 */
export function useSoftStartChat(serverId: string | null): SoftStartChat {
  const { t } = useTranslation();
  const toast = useToast();
  const hostId = serverId ?? "";
  const client = useHostRuntimeClient(hostId);
  const isConnected = useHostRuntimeIsConnected(hostId);
  const supportsChats = useHostFeature(hostId, "chats");
  const supportsForgeSearch = useHostFeature(hostId, "forgeSearch");
  const chatProviders = useChatProviders(hostId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const [isPending, setIsPending] = useState(false);

  const draft = useAgentInputDraft({
    draftKey: NEW_CHAT_DRAFT_KEY,
    composer: {
      initialServerId: serverId,
      isVisible: true,
      onlineServerIds: isConnected && serverId ? [serverId] : [],
    },
  });
  const base = draft.composerState;
  const composerState = useMemo(
    () =>
      base
        ? {
            ...base,
            selectedMode: "",
            featureValues: { ...base.featureValues, [CHAT_WEB_ACCESS_FEATURE_ID]: true },
          }
        : null,
    [base],
  );

  // The remembered provider may not run chats; fall back to the first one that does.
  const selectedProvider = base?.selectedProvider ?? null;
  const allProviderModels = base?.allProviderModels;
  const setProviderAndModel = base?.setProviderAndModelFromUser;
  useEffect(() => {
    if (!setProviderAndModel || !allProviderModels) return;
    if (selectedProvider && chatProviders.includes(selectedProvider)) return;
    for (const provider of chatProviders) {
      const firstModel = allProviderModels.get(provider)?.[0];
      if (firstModel) {
        setProviderAndModel(provider, firstModel.id);
        return;
      }
    }
  }, [allProviderModels, chatProviders, selectedProvider, setProviderAndModel]);

  const text = draft.text;
  const clearDraft = draft.clear;
  const submit = useCallback(async () => {
    const prompt = text.trim();
    if (isPending || !prompt || !serverId) return;
    try {
      if (!client || !isConnected) throw new Error(t("newWorkspace.errors.hostDisconnected"));
      if (!supportsChats) throw new Error(t("newChat.errors.hostUnsupported"));
      if (!composerState) throw new Error(t("newWorkspace.errors.composerStateRequired"));
      const provider = composerState.selectedProvider;
      if (!provider || !chatProviders.includes(provider)) {
        throw new Error(t("newChat.errors.unsupportedProvider"));
      }
      setIsPending(true);
      const firstAgentContext = buildFirstAgentContext({ prompt, attachments: [] });
      const created = await client.createWorkspace({
        source: { kind: "chat" },
        ...(firstAgentContext ? { firstAgentContext } : {}),
      });
      if (created.error || !created.workspace) {
        throw new Error(created.error ?? t("newChat.errors.createFailed"));
      }
      const workspace = normalizeWorkspaceDescriptor(created.workspace);
      mergeWorkspaces(serverId, [{ ...workspace, status: "running", statusEnteredAt: new Date() }]);
      submitWorkspaceDraft({
        serverId,
        clearDraft,
        workspaceId: workspace.id,
        workspaceDirectory: workspace.workspaceDirectory,
        text: prompt,
        attachments: [],
        provider,
        composerState,
        supportsForgeSearch,
      });
    } catch (error) {
      // The draft is untouched on failure, so the user's text stays in the field.
      toast.error(toErrorMessage(error));
    } finally {
      setIsPending(false);
    }
  }, [
    chatProviders,
    clearDraft,
    client,
    composerState,
    isConnected,
    isPending,
    mergeWorkspaces,
    serverId,
    supportsChats,
    supportsForgeSearch,
    t,
    text,
    toast,
  ]);

  const runSubmit = useCallback(() => void submit(), [submit]);
  const canSubmit = Boolean(serverId && isConnected && supportsChats);
  return { text, setText: draft.editText, submit: canSubmit ? runSubmit : null, isPending };
}
