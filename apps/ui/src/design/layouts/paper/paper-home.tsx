import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useEarliestOnlineHostServerId } from "@/app/_layout";
import { Composer } from "@/composer";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { FileDropZone } from "@/components/file-drop/file-drop-zone";
import { SidebarMenuToggle } from "@/components/headers/menu-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { BrandLogo } from "@/components/icons/brand-logo";
import { useIsCompactFormFactor } from "@/constants/layout";
import { usePanelStore } from "@/stores/panel-store";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { PaperHomeChips } from "./paper-home-chips";
import { PAPER_NEW_CHAT_DRAFT_KEY, usePaperNewChat } from "./use-paper-new-chat";
import { usePaperChatServerId } from "./use-paper-recents";

const COMPOSER_MAX_WIDTH = 680;

// preview copy
function greetingFor(hour: number): string {
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

/**
 * Paper's home, after Claude's new-chat screen: the logo and a serif time-of-day greeting,
 * one large composer that really starts a chat, and suggestion chips for the other ways in.
 * On compact layouts the composer drops to the bottom like Claude iOS.
 */
export function PaperHome() {
  const isCompact = useIsCompactFormFactor();
  const openDesktopAgentList = usePanelStore((state) => state.openDesktopAgentList);
  const onlineServerId = useEarliestOnlineHostServerId();
  const serverId = usePaperChatServerId(onlineServerId);
  // Picked once per visit so the heading does not change under the user while they type.
  const [greeting] = useState(() => greetingFor(new Date().getHours()));
  const headerLeft = useMemo(() => <SidebarMenuToggle />, []);

  useEffect(() => {
    if (!isCompact) openDesktopAgentList();
  }, [isCompact, openDesktopAgentList]);

  const heading = (
    <View style={isCompact ? styles.greetingStack : styles.greetingRow}>
      <BrandLogo size={isCompact ? 44 : 40} />
      <Text style={styles.greeting} dataSet={DESIGN_FONT_DATASET} accessibilityRole="header">
        {greeting}
      </Text>
    </View>
  );

  return (
    <FileDropZone style={styles.container}>
      <ScreenHeader left={headerLeft} borderless />
      <TitlebarDragRegion />
      <View style={isCompact ? styles.bodyCompact : styles.body}>
        {isCompact ? <View style={styles.compactHero}>{heading}</View> : heading}
        <View style={styles.column}>
          {isCompact ? <PaperHomeChips scroll /> : null}
          {serverId ? (
            <PaperHomeComposer key={serverId} serverId={serverId} />
          ) : (
            <PaperNoChatHost connecting={onlineServerId === null} />
          )}
          {isCompact ? null : <PaperHomeChips />}
        </View>
      </View>
    </FileDropZone>
  );
}

function PaperHomeComposer({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { draft, agentControls, submit, isPending } = usePaperNewChat(serverId);
  return (
    <Composer
      externalKeyboardShift
      agentId={PAPER_NEW_CHAT_DRAFT_KEY}
      placeholder="How can I help you today?" /* preview copy */
      serverId={serverId}
      isPaneFocused
      onSubmitMessage={submit}
      submitButtonAccessibilityLabel={t("newChat.send")}
      submitButtonTestID="new-chat-submit"
      isSubmitLoading={isPending}
      submitBehavior="preserve-and-lock"
      blurOnSubmit
      value={draft.text}
      onChangeText={draft.editText}
      textReplacement={draft.textReplacement}
      attachments={draft.attachments}
      onChangeAttachments={draft.setAttachments}
      cwd=""
      clearDraft={draft.clear}
      autoFocus
      agentControls={agentControls}
    />
  );
}

/**
 * Where the composer would be when it cannot start a chat: still connecting to any host, or
 * the connected hosts cannot run chats.
 */
function PaperNoChatHost({ connecting }: { connecting: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={styles.unavailable} testID="paper-home-no-chat-host">
      <Text style={styles.unavailableText}>
        {connecting ? t("common.connectionStatus.connecting") : t("newChat.errors.hostUnsupported")}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  body: {
    position: "relative",
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 28,
    paddingHorizontal: 24,
    paddingBottom: 96,
  },
  bodyCompact: {
    flex: 1,
    alignItems: "stretch",
    gap: 12,
  },
  compactHero: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  greetingRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
  },
  greetingStack: {
    alignItems: "center",
    gap: 14,
  },
  greeting: {
    color: theme.colors.foreground,
    fontFamily: theme.design.headingFontFamily,
    fontSize: { xs: 28, md: 40 },
    lineHeight: { xs: 34, md: 48 },
    letterSpacing: -0.6,
    fontWeight: "400",
    textAlign: "center",
  },
  column: {
    width: "100%",
    maxWidth: COMPOSER_MAX_WIDTH,
    gap: 16,
  },
  unavailable: {
    alignItems: "center",
    padding: 24,
    borderRadius: 18,
    backgroundColor: theme.colors.surface1,
  },
  unavailableText: {
    color: theme.colors.foregroundMuted,
    fontSize: 14,
    textAlign: "center",
  },
}));
