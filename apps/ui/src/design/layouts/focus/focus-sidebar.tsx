import { useMemo } from "react";
import { StyleSheet as RNStyleSheet, useWindowDimensions, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { resolveDesktopSidebarWidth } from "@/components/desktop-sidebar-layout";
import { RetainedPanelActivity } from "@/components/retained-panel";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useCloseAgentListGesture } from "@/mobile-panels/gestures";
import { MobilePanelOverlay } from "@/mobile-panels/presentation";
import { useCloseMobileSidebarForNavigation } from "@/navigation/use-mobile-back";
import { usePanelStore } from "@/stores/panel-store";
import { useOwnsWindowChromeCorner, WindowChromeSafeArea } from "@/utils/desktop-window";
import type { DesignSlotProps } from "../slots";
import { FocusSidebarContent } from "./focus-sidebar-content";

/** The Focus sidebar region: a borderless Devin column on desktop, the same body in the drawer. */
export function FocusSidebar({ active }: DesignSlotProps["sidebar"]) {
  const isCompact = useIsCompactFormFactor();
  return (
    <RetainedPanelActivity active={active}>
      {isCompact ? <FocusMobileSidebar /> : <FocusDesktopSidebar active={active} />}
    </RetainedPanelActivity>
  );
}

function FocusDesktopSidebar({ active }: { active: boolean }) {
  const insets = useSafeAreaInsets();
  const sidebarWidth = usePanelStore((state) => state.sidebarWidth);
  const { width: viewportWidth } = useWindowDimensions();
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const width = resolveDesktopSidebarWidth({ requestedWidth: sidebarWidth, viewportWidth });
  const frameStyle = useMemo(
    () => [styles.desktop, { width, paddingTop: insets.top }, !active && staticStyles.hidden],
    [active, insets.top, width],
  );
  return (
    <View
      style={frameStyle}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      pointerEvents={active ? "auto" : "none"}
      testID="focus-sidebar"
    >
      {ownsTopLeft ? <WindowChromeSafeArea placement="below" /> : null}
      <FocusSidebarContent />
    </View>
  );
}

function FocusMobileSidebar() {
  const insets = useSafeAreaInsets();
  const close = useCloseMobileSidebarForNavigation();
  const { gesture } = useCloseAgentListGesture();
  const surfaceStyle = useMemo(
    () => [styles.mobile, { paddingTop: insets.top, paddingBottom: insets.bottom }],
    [insets.bottom, insets.top],
  );
  return (
    <MobilePanelOverlay panel="agent-list" closeGesture={gesture}>
      <View style={surfaceStyle} testID="focus-sidebar">
        <WindowChromeSafeArea placement="below" />
        <FocusSidebarContent onBeforeNavigate={close} onClose={close} />
      </View>
    </MobilePanelOverlay>
  );
}

const staticStyles = RNStyleSheet.create({
  hidden: { display: "none" },
});

const styles = StyleSheet.create((theme) => ({
  desktop: {
    position: "relative",
    backgroundColor: theme.colors.surfaceSidebar,
  },
  mobile: {
    flex: 1,
    backgroundColor: theme.colors.surfaceSidebar,
  },
}));
