import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MessagePayload } from "@/composer/types";
import {
  resolveComposerAttachmentSubmitFormat,
  splitComposerAttachmentsForSubmit,
} from "@/composer/attachments/submit";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { CHAT_WEB_ACCESS_FEATURE_ID, useChatProviders } from "@/screens/new-chat-screen";
import { getWorkspaceNamingAttachments } from "@/screens/new-workspace-fork-context";
import { buildFirstAgentContext, submitWorkspaceDraft } from "@/screens/new-workspace-screen";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import type { AgentFeature } from "@frogg/protocol/agent-types";

/** The same draft as the New chat screen, so text typed on either carries over. */
export const PAPER_NEW_CHAT_DRAFT_KEY = "new-chat";

/**
 * The New chat screen's flow, for Paper's home composer: the same draft, chat-provider filtering,
 * web-access toggle and `createWorkspace({ source: chat })` submit, then the first message is
 * handed to the new workspace. Mirrors `NewChatScreen`; see the report for the hook point that
 * would let both share one implementation.
 */
export function usePaperNewChat(serverId: string) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsChats = useHostFeature(serverId, "chats");
  const supportsForgeSearch = useHostFeature(serverId, "forgeSearch");
  const chatProviders = useChatProviders(serverId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const [isPending, setIsPending] = useState(false);
  const [webAccess, setWebAccess] = useState(true);

  const draft = useAgentInputDraft({
    draftKey: PAPER_NEW_CHAT_DRAFT_KEY,
    composer: {
      initialServerId: serverId || null,
      isVisible: true,
      onlineServerIds: isConnected && serverId ? [serverId] : [],
    },
  });
  const baseState = draft.composerState;
  const composerState = useMemo(
    () =>
      baseState
        ? {
            ...baseState,
            selectedMode: "",
            featureValues: { ...baseState.featureValues, [CHAT_WEB_ACCESS_FEATURE_ID]: webAccess },
          }
        : null,
    [baseState, webAccess],
  );

  // The host's remembered provider may not run chats; start on the first one that does.
  const selectedProvider = baseState?.selectedProvider ?? null;
  const allProviderModels = baseState?.allProviderModels;
  const setProviderAndModel = baseState?.setProviderAndModelFromUser;
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

  const webFeature = useMemo(
    (): AgentFeature => ({
      type: "toggle",
      id: CHAT_WEB_ACCESS_FEATURE_ID,
      label: t("chats.web.label"),
      description: t("chats.web.description"),
      tooltip: t("chats.web.tooltip"),
      icon: "globe",
      value: webAccess,
    }),
    [t, webAccess],
  );

  const agentControls = useMemo(() => {
    if (!composerState) return undefined;
    const allowed = new Set(chatProviders);
    const controls = composerState.agentControls;
    return {
      ...controls,
      providerDefinitions: controls.providerDefinitions.filter((d) => allowed.has(d.id)),
      modelSelectorProviders: controls.modelSelectorProviders.filter((p) => allowed.has(p.id)),
      modeOptions: [],
      features: [webFeature],
      onSetFeature: (featureId: string, value: unknown) => {
        if (featureId === CHAT_WEB_ACCESS_FEATURE_ID) setWebAccess(Boolean(value));
      },
      disabled: isPending,
    };
  }, [chatProviders, composerState, isPending, webFeature]);

  const submit = useCallback(
    async (payload: MessagePayload) => {
      if (isPending) return;
      try {
        if (!client || !isConnected) throw new Error(t("newWorkspace.errors.hostDisconnected"));
        if (!supportsChats) throw new Error(t("newChat.errors.hostUnsupported"));
        if (!composerState) throw new Error(t("newWorkspace.errors.composerStateRequired"));
        const provider = composerState.selectedProvider;
        if (!provider || !chatProviders.includes(provider)) {
          throw new Error(t("newChat.errors.unsupportedProvider"));
        }
        setIsPending(true);
        const { attachments: reviewAttachments } = splitComposerAttachmentsForSubmit(
          payload.attachments,
          {
            format: resolveComposerAttachmentSubmitFormat({
              supportsForgeAttachments: supportsForgeSearch,
            }),
          },
        );
        const firstAgentContext = buildFirstAgentContext({
          prompt: payload.text,
          attachments: getWorkspaceNamingAttachments(reviewAttachments),
        });
        const created = await client.createWorkspace({
          source: { kind: "chat" },
          ...(firstAgentContext ? { firstAgentContext } : {}),
        });
        if (created.error || !created.workspace) {
          throw new Error(created.error ?? t("newChat.errors.createFailed"));
        }
        const workspace = normalizeWorkspaceDescriptor(created.workspace);
        mergeWorkspaces(serverId, [
          { ...workspace, status: "running", statusEnteredAt: new Date() },
        ]);
        submitWorkspaceDraft({
          serverId,
          clearDraft: draft.clear,
          workspaceId: workspace.id,
          workspaceDirectory: workspace.workspaceDirectory,
          text: payload.text,
          attachments: payload.attachments,
          provider,
          composerState,
          supportsForgeSearch,
        });
      } catch (error) {
        toast.error(toErrorMessage(error));
      } finally {
        setIsPending(false);
      }
    },
    [
      chatProviders,
      client,
      composerState,
      draft.clear,
      isConnected,
      isPending,
      mergeWorkspaces,
      serverId,
      supportsChats,
      supportsForgeSearch,
      t,
      toast,
    ],
  );

  return { draft, agentControls, submit, isPending };
}
