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
import {
  normalizeWorkspaceDescriptor,
  useSessionStore,
  type ProjectDescriptor,
} from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { CHAT_WEB_ACCESS_FEATURE_ID, useChatProviders } from "@/screens/new-chat-screen";
import { buildFirstAgentContext, submitWorkspaceDraft } from "@/screens/new-workspace-screen";
import { getWorkspaceNamingAttachments } from "@/screens/new-workspace-fork-context";

export const FOCUS_HOME_DRAFT_KEY = "focus-home";

/**
 * The home composer's send path. With no repo chosen it is exactly the New chat flow (a
 * project-less chat workspace); with a repo chosen it opens a local workspace on that project's
 * checkout, the New workspace screen's "local" path, and sends the first message there. Both hand
 * off through `submitWorkspaceDraft`, which navigates to the new workspace.
 */
export function useFocusStartChat({
  serverId,
  project,
}: {
  serverId: string;
  project: ProjectDescriptor | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsChats = useHostFeature(serverId, "chats");
  const supportsLocalWorkspaces = useHostFeature(serverId, "workspaceMultiplicity");
  const supportsForgeSearch = useHostFeature(serverId, "forgeSearch");
  const chatProviders = useChatProviders(serverId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const [isPending, setIsPending] = useState(false);
  const isChat = project === null;

  const draft = useAgentInputDraft({
    draftKey: FOCUS_HOME_DRAFT_KEY,
    composer: {
      initialServerId: serverId || null,
      isVisible: true,
      onlineServerIds: isConnected && serverId ? [serverId] : [],
    },
  });
  const base = draft.composerState;
  const composerState = useMemo(() => {
    if (!base || !isChat) return base;
    // Chats have no permission modes, and run with web access on, as on the New chat screen.
    return {
      ...base,
      selectedMode: "",
      featureValues: { ...base.featureValues, [CHAT_WEB_ACCESS_FEATURE_ID]: true },
    };
  }, [base, isChat]);

  // A chat needs a provider that runs chats; move off one that does not.
  const selectedProvider = base?.selectedProvider ?? null;
  const allProviderModels = base?.allProviderModels;
  const setProviderAndModel = base?.setProviderAndModelFromUser;
  useEffect(() => {
    if (!isChat || !setProviderAndModel || !allProviderModels) return;
    if (selectedProvider && chatProviders.includes(selectedProvider)) return;
    for (const provider of chatProviders) {
      const firstModel = allProviderModels.get(provider)?.[0];
      if (firstModel) {
        setProviderAndModel(provider, firstModel.id);
        return;
      }
    }
  }, [allProviderModels, chatProviders, isChat, selectedProvider, setProviderAndModel]);

  const agentControls = useMemo(() => {
    if (!composerState) return undefined;
    const controls = composerState.agentControls;
    if (!isChat) return { ...controls, disabled: isPending };
    const allowed = new Set(chatProviders);
    return {
      ...controls,
      providerDefinitions: controls.providerDefinitions.filter((d) => allowed.has(d.id)),
      modelSelectorProviders: controls.modelSelectorProviders.filter((p) => allowed.has(p.id)),
      modeOptions: [],
      features: [],
      disabled: isPending,
    };
  }, [chatProviders, composerState, isChat, isPending]);

  const submit = useCallback(
    async (payload: MessagePayload) => {
      if (isPending) return;
      try {
        if (!client || !isConnected) throw new Error(t("newWorkspace.errors.hostDisconnected"));
        if (!composerState) throw new Error(t("newWorkspace.errors.composerStateRequired"));
        const provider = composerState.selectedProvider;
        if (!provider) throw new Error(t("newWorkspace.errors.selectModel"));
        if (isChat && !supportsChats) throw new Error(t("newChat.errors.hostUnsupported"));
        if (isChat && !chatProviders.includes(provider)) {
          throw new Error(t("newChat.errors.unsupportedProvider"));
        }
        setIsPending(true);
        await composerState.persistFormPreferences();
        const { attachments: reviewAttachments } = splitComposerAttachmentsForSubmit(
          payload.attachments,
          { format: resolveComposerAttachmentSubmitFormat({ supportsForgeAttachments: supportsForgeSearch }) },
        );
        const firstAgentContext = buildFirstAgentContext({
          prompt: payload.text,
          attachments: getWorkspaceNamingAttachments(reviewAttachments),
        });
        const created = await client.createWorkspace({
          source: project
            ? { kind: "directory", path: project.projectRootPath, projectId: project.projectId }
            : { kind: "chat" },
          ...(firstAgentContext ? { firstAgentContext } : {}),
        });
        if (created.error || !created.workspace) {
          throw new Error(created.error ?? t("newChat.errors.createFailed"));
        }
        const workspace = normalizeWorkspaceDescriptor(created.workspace);
        mergeWorkspaces(serverId, [{ ...workspace, status: "running", statusEnteredAt: new Date() }]);
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
      isChat,
      isConnected,
      isPending,
      mergeWorkspaces,
      project,
      serverId,
      supportsChats,
      supportsForgeSearch,
      t,
      toast,
    ],
  );

  return {
    draft,
    agentControls,
    submit,
    isPending,
    /** Whether this host can open a local workspace on a project from here. */
    supportsLocalWorkspaces,
  };
}
