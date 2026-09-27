import { brand } from "@frogg/branding";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import {
  TITLEBAR_DRAG_SURFACE_DATASET,
  TitlebarDragRegion,
} from "@/components/desktop/titlebar-drag-region";
import { DESKTOP_TRAFFIC_LIGHT_WIDTH, useIsCompactFormFactor } from "@/constants/layout";
import { builtinSidebarNavLabelKey } from "@/sidebar-nav/model";
import { useOwnsWindowChromeCorner } from "@/utils/desktop-window";
import { PaperMobileSidebar } from "./paper-mobile-sidebar";
import { PaperAccountFooter, PaperRecentsList } from "./paper-sidebar-parts";
import { PaperNavRow, PaperWordmark } from "./paper-sidebar-rows";
import { usePaperSidebarStore } from "./paper-store";
import { usePaperNav } from "./use-paper-nav";

const SIDEBAR_WIDTH = 272;
const RAIL_WIDTH = 56;

/**
 * Paper's sidebar, after Claude's: a slim column with a prominent New chat, a few links, and a
 * flat Recents list in place of the project tree. On desktop it folds to an icon rail; on
 * compact layouts it is the slide-over drawer.
 */
export function PaperSidebar({ active }: { active: boolean }) {
  const isCompact = useIsCompactFormFactor();
  if (isCompact) return <PaperMobileSidebar />;
  return <PaperDesktopSidebar active={active} />;
}

function PaperDesktopSidebar({ active }: { active: boolean }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const collapsed = usePaperSidebarStore((state) => state.collapsed);
  const toggleCollapsed = usePaperSidebarStore((state) => state.toggleCollapsed);
  const nav = usePaperNav();
  const toggleLabel = t("shell.menu.toggleSidebar");

  return (
    <View
      style={[
        styles.column,
        collapsed ? styles.columnRail : styles.columnFull,
        !active && styles.hidden,
        { paddingTop: insets.top },
      ]}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      testID="paper-sidebar"
    >
      <View
        style={[
          collapsed ? styles.headerRail : styles.header,
          ownsTopLeft && (collapsed ? styles.headerRailBelowLights : styles.headerBelowLights),
        ]}
        dataSet={TITLEBAR_DRAG_SURFACE_DATASET}
      >
        <TitlebarDragRegion />
        {collapsed ? null : <PaperWordmark label={brand.name} />}
        <PaperNavRow
          icon="panelLeft"
          label={toggleLabel}
          onPress={toggleCollapsed}
          collapsed
          testID="paper-sidebar-toggle"
        />
      </View>
      <View style={collapsed ? styles.navRail : styles.nav}>
        <PaperNavRow
          icon="plus"
          label={t("sidebar.chats.newChat")}
          onPress={nav.newChat}
          collapsed={collapsed}
          active={nav.current.home}
          prominent
          testID="paper-sidebar-new-chat"
        />
        <PaperNavRow
          icon="search"
          label={t(builtinSidebarNavLabelKey("search"))}
          onPress={nav.search}
          collapsed={collapsed}
          testID="paper-sidebar-search"
        />
        <View style={styles.navGap} />
        <PaperNavRow
          icon="history"
          label={t(builtinSidebarNavLabelKey("history"))}
          onPress={nav.history}
          collapsed={collapsed}
          active={nav.current.history}
          testID="paper-sidebar-history"
        />
        <PaperNavRow
          icon="folder"
          label={t("sidebar.sections.projects")}
          onPress={nav.projects}
          collapsed={collapsed}
          active={nav.current.projects}
          testID="paper-sidebar-projects"
        />
      </View>
      {collapsed ? (
        <View style={styles.spacer} />
      ) : (
        <PaperRecentsList activeKey={nav.activeKey} onOpen={nav.openRecent} />
      )}
      <PaperAccountFooter collapsed={collapsed} onPress={nav.settings} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  column: {
    position: "relative",
    height: "100%",
    backgroundColor: theme.colors.surfaceSidebar,
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderAccent,
  },
  columnFull: {
    width: SIDEBAR_WIDTH,
  },
  columnRail: {
    width: RAIL_WIDTH,
    alignItems: "center",
  },
  hidden: {
    display: "none",
  },
  header: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    height: 52,
    paddingLeft: 16,
    paddingRight: 10,
  },
  headerBelowLights: {
    paddingLeft: DESKTOP_TRAFFIC_LIGHT_WIDTH,
  },
  headerRail: {
    position: "relative",
    height: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  headerRailBelowLights: {
    marginTop: 28,
  },
  nav: {
    paddingHorizontal: 8,
    gap: 1,
  },
  navRail: {
    alignItems: "center",
    gap: 4,
  },
  navGap: {
    height: 10,
  },
  spacer: {
    flex: 1,
  },
}));
