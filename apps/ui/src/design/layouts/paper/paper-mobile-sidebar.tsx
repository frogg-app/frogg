import { brand } from "@frogg/branding";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { useCloseMobileSidebarForNavigation } from "@/navigation/use-mobile-back";
import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";
import { PaperIcon, paperMuted, paperOnPrimary } from "./paper-icons";
import { PaperAccountFooter, PaperRecentsList } from "./paper-sidebar-parts";
import { PaperNavRow, PaperWordmark } from "./paper-sidebar-rows";
import { usePaperNav } from "./use-paper-nav";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

function closeButtonStyle({ pressed }: HoverState) {
  return [styles.close, pressed && styles.closePressed];
}

function newChatStyle({ pressed }: HoverState) {
  return [styles.newChat, pressed && styles.newChatPressed];
}

/**
 * Claude iOS's drawer: the wordmark, large Chats / Projects links, the Recents list in big
 * touch rows, and a footer with the account avatar and a dark New chat pill.
 */
export function PaperMobileSidebar() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const closeSidebar = useCloseMobileSidebarForNavigation();
  const { gesture: closeGesture } = useCloseAgentListGesture();
  const nav = usePaperNav(closeSidebar);
  const panelStyle = useMemo(
    () => [styles.panel, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.bottom, insets.top],
  );

  return (
    <MobilePanelOverlay panel="agent-list" closeGesture={closeGesture} panelStyle={panelStyle}>
      <View style={styles.content} pointerEvents="auto">
        <View style={styles.header}>
          <PaperWordmark label={brand.name} />
          <Pressable
            onPress={closeSidebar}
            accessibilityRole="button"
            accessibilityLabel={t("sidebar.actions.closeSidebar")}
            hitSlop={8}
            testID="sidebar-close"
            style={closeButtonStyle}
          >
            <PaperIcon.close size={18} uniProps={paperMuted} />
          </Pressable>
        </View>
        <View style={styles.nav}>
          <PaperNavRow
            icon="history"
            label={t(builtinSidebarNavLabelKey("history"))}
            onPress={nav.history}
            large
            testID="paper-sidebar-history"
          />
          <PaperNavRow
            icon="folder"
            label={t("sidebar.sections.projects")}
            onPress={nav.projects}
            large
            testID="paper-sidebar-projects"
          />
          <PaperNavRow
            icon="search"
            label={t(builtinSidebarNavLabelKey("search"))}
            onPress={nav.search}
            large
            testID="paper-sidebar-search"
          />
        </View>
        <PaperRecentsList activeKey={nav.activeKey} onOpen={nav.openRecent} large />
        <View style={styles.footer}>
          <PaperAccountFooter collapsed onPress={nav.settings} />
          <Pressable
            onPress={nav.newChat}
            accessibilityRole="button"
            testID="paper-sidebar-new-chat"
            style={newChatStyle}
          >
            <PaperIcon.plus size={16} strokeWidth={2} uniProps={paperOnPrimary} />
            <Text style={styles.newChatLabel}>{t("sidebar.chats.newChat")}</Text>
          </Pressable>
        </View>
      </View>
    </MobilePanelOverlay>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    backgroundColor: theme.colors.surfaceSidebar,
  },
  content: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 20,
    paddingRight: 12,
    paddingTop: 14,
    paddingBottom: 10,
  },
  close: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  closePressed: {
    backgroundColor: theme.colors.surface2,
  },
  nav: {
    paddingHorizontal: 10,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 10,
    paddingRight: 16,
    paddingVertical: 6,
  },
  newChat: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 44,
    paddingHorizontal: 20,
    borderRadius: 22,
    backgroundColor: theme.colors.primary,
  },
  newChatPressed: {
    opacity: 0.85,
  },
  newChatLabel: {
    color: theme.colors.primaryForeground,
    fontSize: 15,
    fontWeight: "500",
  },
}));
