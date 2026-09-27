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
import { SoftProjectCards, SoftRecentCards } from "./soft-cards";
import { SoftChatList, SoftProjectList } from "./soft-lists";
import { SOFT_TAB_BAR_CLEARANCE } from "./soft-mobile-nav";
import { SoftPillComposer } from "./soft-pill-composer";
import { SoftRoundButton } from "./soft-round-button";

export type SoftSegment = "chats" | "projects";

// The wide home shows the latest few as cards; the sidebar card lists everything.
const WIDE_RECENT_LIMIT = 6;

// preview copy
const GREETING = "What are we building today?";

/** The Chats | Projects pill options; `scope` keeps test IDs apart between home and sidebar. */
export function useSoftSegmentOptions(scope: string): SegmentedControlOption<SoftSegment>[] {
  const { t } = useTranslation();
  return useMemo(
    () => [
      { value: "chats", label: t("sidebar.sections.chats"), testID: `soft-${scope}-chats` },
      {
        value: "projects",
        label: t("sidebar.sections.projects"),
        testID: `soft-${scope}-projects`,
      },
    ],
    [scope, t],
  );
}

/**
 * The soft home. Compact (Perplexity/ChatGPT iOS): round menu and search buttons either side of
 * a pill segmented control, the recent list, and a floating pill composer pinned above the tab bar.
 * Wide: a centred column that leads with a bold prompt and the composer, then the latest chats
 * (or projects) as Notion-style cards.
 */
export function SoftHome() {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const insets = useSafeAreaInsets();
  const [segment, setSegment] = useState<SoftSegment>("chats");
  const options = useSoftSegmentOptions("home");
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
  // The composer sits just above the floating tab bar.
  const composerInset = useMemo(
    () => ({ paddingBottom: SOFT_TAB_BAR_CLEARANCE + Math.max(insets.bottom, 10) + 4 }),
    [insets.bottom],
  );
  const openSearch = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const wideRecents = useMemo(() => recents.slice(0, WIDE_RECENT_LIMIT), [recents]);

  if (compact) {
    const list =
      segment === "chats" ? (
        <SoftChatList recents={recents} />
      ) : (
        <SoftProjectList projects={projects} />
      );
    return (
      <View style={styles.screen} testID="soft-home">
        <View style={[styles.topBar, topBarInset]}>
          <SoftRoundButton
            icon={Menu}
            label={t("shell.menu.open")}
            onPress={toggleMobileAgentList}
          />
          <SegmentedControl
            options={options}
            value={segment}
            onValueChange={setSegment}
            size="md"
          />
          <SoftRoundButton
            icon={Search}
            label={t("sidebar.sections.search")}
            onPress={openSearch}
          />
        </View>
        <ScrollView style={styles.scroll} contentContainerStyle={styles.compactList}>
          {list}
        </ScrollView>
        <View style={[styles.compactComposer, composerInset]}>
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
            <SegmentedControl
              options={options}
              value={segment}
              onValueChange={setSegment}
              size="md"
            />
            <SoftRoundButton
              icon={Search}
              label={t("sidebar.sections.search")}
              onPress={openSearch}
            />
          </View>
          {segment === "chats" ? <SoftRecentCards recents={wideRecents} /> : null}
          {segment === "projects" && projects.length > 0 ? (
            <SoftProjectCards projects={projects} />
          ) : null}
          {segment === "projects" && projects.length === 0 ? (
            <SoftProjectList projects={projects} />
          ) : null}
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
