import { Settings } from "lucide-react-native";
import { memo, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import { TITLEBAR_DRAG_SURFACE_DATASET } from "@/components/desktop/titlebar-drag-region";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { HostsMenu } from "@/components/sidebar/hosts-menu";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { useCloseMobileSidebarForNavigation } from "@/navigation/use-mobile-back";
import { usePanelStore } from "@/stores/panel-store";
import type { Theme } from "@/styles/theme";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import { InsetNavRow } from "./nav-row";
import { InsetSidebarHeader } from "./sidebar-header";
import { InsetChatsGroup, InsetNavGroup, InsetProjectsGroup } from "./sidebar-sections";
import { useInsetActions } from "./use-inset-actions";

const ThemedSettings = withUnistyles(Settings);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const SETTINGS_ICON = <ThemedSettings size={14} uniProps={mutedMapping} />;

// Room the macOS traffic lights take when the sidebar owns the window's top-left corner.
const TRAFFIC_LIGHT_CLEARANCE = 28;

/**
 * Linear's sidebar: a switcher header, personal views with counts, then Projects with their
 * sessions indented under each, all on the tinted frame the inset content card floats over.
 */
export const InsetSidebar = memo(function InsetSidebar({ active }: { active: boolean }) {
  const isCompact = useIsCompactFormFactor();
  return (
    <RetainedPanelActivity active={active}>
      {isCompact ? <MobileInsetSidebar /> : <DesktopInsetSidebar active={active} />}
    </RetainedPanelActivity>
  );
});

function SidebarBody({ beforeNavigate }: { beforeNavigate?: () => void }) {
  const { t } = useTranslation();
  const actions = useInsetActions(beforeNavigate);
  return (
    <View style={styles.body}>
      <View style={styles.header} dataSet={TITLEBAR_DRAG_SURFACE_DATASET}>
        <InsetSidebarHeader onSearch={actions.search} onNewSession={actions.newSession} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        <InsetNavGroup openView={actions.openView} />
        <InsetProjectsGroup openWorkspace={actions.openWorkspace} addProject={actions.addProject} />
        <InsetChatsGroup openWorkspace={actions.openWorkspace} />
      </ScrollView>
      <View style={styles.footer}>
        <HostsMenu onBeforeAction={beforeNavigate} />
        <InsetNavRow
          leading={SETTINGS_ICON}
          label={t("sidebar.actions.settings")}
          muted
          onPress={actions.openSettings}
          testID="inset-sidebar-settings"
        />
      </View>
    </View>
  );
}

function DesktopInsetSidebar({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const requestedWidth = usePanelStore((state) => state.sidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const width = resolveDesktopSidebarWidth({ requestedWidth, viewportWidth });
  const columnStyle = useMemo(
    () => [
      styles.desktop,
      { width, paddingTop: insets.top + (ownsTopLeft ? TRAFFIC_LIGHT_CLEARANCE : 0) },
      !active && styles.hidden,
    ],
    [active, insets.top, ownsTopLeft, width],
  );
  return (
    <View
      style={columnStyle}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      testID="inset-sidebar"
    >
      <SidebarBody />
    </View>
  );
}

function MobileInsetSidebar() {
  const insets = useSafeAreaInsets();
  const close = useCloseMobileSidebarForNavigation();
  const { gesture } = useCloseAgentListGesture();
  const panelStyle = useMemo(
    () => [styles.mobile, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.bottom, insets.top],
  );
  return (
    <MobilePanelOverlay panel="agent-list" closeGesture={gesture} panelStyle={panelStyle}>
      <View style={styles.body} pointerEvents="auto" testID="inset-sidebar">
        <WindowChromeSafeArea placement="below" />
        <SidebarBody beforeNavigate={close} />
      </View>
    </MobilePanelOverlay>
  );
}

const styles = StyleSheet.create((theme) => ({
  desktop: {
    position: "relative",
    backgroundColor: theme.colors.surfaceSidebar,
  },
  hidden: {
    display: "none",
  },
  mobile: {
    backgroundColor: theme.colors.surfaceSidebar,
  },
  body: {
    flex: 1,
    minHeight: 0,
  },
  header: {
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 6,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 8,
    paddingBottom: 12,
    gap: 16,
  },
  footer: {
    paddingHorizontal: 8,
    paddingVertical: 8,
    gap: 1,
  },
}));
