import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet as RNStyleSheet, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Composer } from "@/composer";
import type { MessagePayload } from "@/composer/types";
import {
  resolveComposerAttachmentSubmitFormat,
  splitComposerAttachmentsForSubmit,
} from "@/composer/attachments/submit";
import { useAgentInputDraft } from "@/composer/draft/input-draft";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { HEADER_INNER_HEIGHT, MAX_CONTENT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { normalizeWorkspaceDescriptor, useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import type { AgentFeature } from "@frogg/protocol/agent-types";
import { buildFirstAgentContext, submitWorkspaceDraft } from "./new-workspace-screen";
import { getWorkspaceNamingAttachments } from "./new-workspace-fork-context";

const NEW_CHAT_DRAFT_KEY = "new-chat";
const NEW_CHAT_TITLE_KEYS = [
  "t1",
  "t2",
  "t3",
  "t4",
  "t5",
  "t6",
  "t7",
  "t8",
  "t9",
  "t10",
  "t11",
  "t12",
] as const;

function pickNewChatTitleKey(): (typeof NEW_CHAT_TITLE_KEYS)[number] {
  return NEW_CHAT_TITLE_KEYS[Math.floor(Math.random() * NEW_CHAT_TITLE_KEYS.length)]!;
}
/** Matches CHAT_WEB_ACCESS_FEATURE_ID on the daemon. */
export const CHAT_WEB_ACCESS_FEATURE_ID = "web_access";
const EMPTY_CHAT_PROVIDERS: readonly string[] = [];

/** The chat providers a host advertises; empty when the host cannot run chats. */
export function useChatProviders(serverId: string): readonly string[] {
  return useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.chatProviders ?? EMPTY_CHAT_PROVIDERS,
  );
}

export function NewChatScreen({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const toast = useToast();
  const isCompact = useIsCompactFormFactor();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supportsChats = useHostFeature(serverId, "chats");
  const supportsForgeSearch = useHostFeature(serverId, "forgeSearch");
  const chatProviders = useChatProviders(serverId);
  const mergeWorkspaces = useSessionStore((state) => state.mergeWorkspaces);
  const [isPending, setIsPending] = useState(false);
  const [webAccess, setWebAccess] = useState(true);
  // Picked once per visit so the heading does not change under the user while they type.
  const [titleKey] = useState(pickNewChatTitleKey);

  const chatDraft = useAgentInputDraft({
    draftKey: NEW_CHAT_DRAFT_KEY,
    composer: {
      initialServerId: serverId || null,
      isVisible: true,
      onlineServerIds: isConnected && serverId ? [serverId] : [],
    },
  });
  const baseComposerState = chatDraft.composerState;
  const composerState = useMemo(
    () =>
      baseComposerState
        ? {
            ...baseComposerState,
            // Chats have no permission modes: the daemon's chat profile decides.
            selectedMode: "",
            featureValues: {
              ...baseComposerState.featureValues,
              [CHAT_WEB_ACCESS_FEATURE_ID]: webAccess,
            },
          }
        : null,
    [baseComposerState, webAccess],
  );

  // The host's remembered provider may not run chats; start on the first one that does.
  const selectedProvider = baseComposerState?.selectedProvider ?? null;
  const allProviderModels = baseComposerState?.allProviderModels;
  const setProviderAndModel = baseComposerState?.setProviderAndModelFromUser;
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
      providerDefinitions: controls.providerDefinitions.filter((definition) =>
        allowed.has(definition.id),
      ),
      modelSelectorProviders: controls.modelSelectorProviders.filter((provider) =>
        allowed.has(provider.id),
      ),
      modeOptions: [],
      features: [webFeature],
      onSetFeature: (featureId: string, value: unknown) => {
        if (featureId === CHAT_WEB_ACCESS_FEATURE_ID) setWebAccess(Boolean(value));
      },
      disabled: isPending,
    };
  }, [chatProviders, composerState, isPending, webFeature]);

  const handleSubmit = useCallback(
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
          clearDraft: chatDraft.clear,
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
      chatDraft.clear,
      chatProviders,
      client,
      composerState,
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

  const screenHeaderLeft = useMemo(() => <SidebarMenuToggle />, []);

  return (
    <FileDropZone style={styles.container}>
      <ScreenHeader left={screenHeaderLeft} borderless />
      <View style={[styles.content, isCompact ? styles.contentCompact : styles.contentCentered]}>
        <TitlebarDragRegion />
        <View style={staticStyles.centered}>
          <View style={styles.titleContainer}>
            <Text style={styles.title}>{t(`newChat.titles.${titleKey}`)}</Text>
          </View>
          <Composer
            externalKeyboardShift
            agentId={NEW_CHAT_DRAFT_KEY}
            placeholder={t("newChat.placeholder")}
            serverId={serverId}
            isPaneFocused={true}
            onSubmitMessage={handleSubmit}
            submitButtonAccessibilityLabel={t("newChat.send")}
            submitButtonTestID="new-chat-submit"
            isSubmitLoading={isPending}
            submitBehavior="preserve-and-lock"
            blurOnSubmit={true}
            value={chatDraft.text}
            onChangeText={chatDraft.editText}
            textReplacement={chatDraft.textReplacement}
            attachments={chatDraft.attachments}
            onChangeAttachments={chatDraft.setAttachments}
            cwd=""
            clearDraft={chatDraft.clear}
            autoFocus
            agentControls={agentControls}
          />
        </View>
      </View>
    </FileDropZone>
  );
}

const staticStyles = RNStyleSheet.create({
  centered: {
    width: "100%",
    maxWidth: MAX_CONTENT_WIDTH,
  },
});

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  content: {
    position: "relative",
    flex: 1,
    alignItems: "center",
  },
  contentCentered: {
    justifyContent: "center",
    paddingBottom: HEADER_INNER_HEIGHT + theme.spacing[6],
  },
  contentCompact: {
    justifyContent: "flex-end",
  },
  titleContainer: {
    marginBottom: theme.spacing[8],
    paddingLeft: theme.spacing[6],
    paddingRight: theme.spacing[4],
    gap: theme.spacing[2],
  },
  title: {
    fontSize: theme.fontSize["2xl"],
    fontWeight: theme.fontWeight.normal,
    color: theme.colors.foreground,
  },
}));
