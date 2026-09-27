import { Menu, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { usePanelStore } from "@/stores/panel-store";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import { useSoftChatServerId, useSoftProjects, useSoftRecents } from "./soft-data";
import { SoftChatList, SoftProjectList } from "./soft-lists";
import { SoftPillComposer } from "./soft-pill-composer";
import { SoftRoundButton } from "./soft-round-button";

export type SoftSegment = "chats" | "projects";

// preview copy
const GREETING = "What are we building today?";

export function useSoftSegmentOptions(): SegmentedControlOption<SoftSegment>[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { value: "chats", label: t("sidebar.sections.chats"), testID: "soft-segment-chats" },
      { value: "projects", label: t("sidebar.sections.projects"), testID: "soft-segment-projects" },
    ],
    [t],
  );
}

/**
 * The soft home. Compact (Perplexity/ChatGPT iOS): round menu and search buttons either side of
 * a pill segmented control, the recent list, and a floating pill composer pinned above the tab bar.
 * Wide: the same pieces as a centred column that leads with a bold prompt and the composer.
 */
export function SoftHome() {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<SoftSegment>("chats");
  const options = useSoftSegmentOptions();
  const recents = useSoftRecents();
  const projects = useSoftProjects(recents);
  const chatServerId = useSoftChatServerId();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const openDesktopAgentList = usePanelStore((state) => state.openDesktopAgentList);
  const toggleMobileAgentList = usePanelStore((state) => state.toggleMobileAgentList);

  // Like the shipping home: arriving here on desktop brings the sidebar back.
  useEffect(() => {
    if (!compact) openDesktopAgentList();
  }, [compact, openDesktopAgentList]);

  // The top bar clears the status bar itself: the soft home has no shipping header above it.
  const topBarInset = useMemo(() => ({ paddingTop: insets.top + 10 }), [insets.top]);
  const openSearch = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);

  const list =
    segment === "chats" ? (
      <SoftChatList recents={recents} />
    ) : (
      <SoftProjectList projects={projects} />
    );

  if (compact) {
    return (
      <View style={styles.screen} testID="soft-home">
        <View style={[styles.topBar, topBarInset]}>
          <SoftRoundButton icon={Menu} label={t("shell.menu.open")} onPress={toggleMobileAgentList} />
          <SegmentedControl options={options} value={segment} onValueChange={setSegment} size="md" />
          <SoftRoundButton icon={Search} label={t("sidebar.sections.search")} onPress={openSearch} />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.compactList}>
          {list}
        </ScrollView>
        <View style={styles.compactComposer}>
          <SoftPillComposer serverId={chatServerId} />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.screen} testID="soft-home">
      <TitlebarDragRegion />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.wideScroll}>
        <View style={styles.wideColumn}>
          <Text style={styles.greeting} dataSet={DESIGN_FONT_DATASET} accessibilityRole="header">
            {GREETING}
          </Text>
          <SoftPillComposer serverId={chatServerId} />
          <View style={styles.wideSegmentRow}>
            <SegmentedControl options={options} value={segment} onValueChange={setSegment} size="md" />
            <SoftRoundButton icon={Search} label={t("sidebar.sections.search")} onPress={openSearch} />
          </View>
          {list}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  scroll: {
    flex: 1,
  },
  compactList: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 16,
  },
  compactComposer: {
    paddingHorizontal: 12,
    paddingTop: 4,
    paddingBottom: 10,
  },
  wideScroll: {
    alignItems: "center",
    paddingHorizontal: 24,
    paddingTop: 88,
    paddingBottom: 48,
  },
  wideColumn: {
    width: "100%",
    maxWidth: 680,
    gap: 20,
  },
  greeting: {
    fontFamily: theme.design.headingFontFamily,
    fontSize: 32,
    lineHeight: 40,
    fontWeight: "700",
    letterSpacing: -0.6,
    color: theme.colors.foreground,
    textAlign: "center",
    marginBottom: 4,
  },
  wideSegmentRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 12,
  },
}));
