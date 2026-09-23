import { PanelRight } from "lucide-react-native";
import { type StyleProp, type ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { paneContentToolbarIconSize, ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { ShortcutKey } from "@/utils/format-shortcut";
import { usesCompactExplorerSidebar } from "@/workspace-tabs/explorer-sidebar";

const ThemedPanelRight = withUnistyles(PanelRight);

interface WorkspaceExplorerToggleProps {
  onPress: () => void;
  label: string;
  tooltipLabel: string;
  tooltipKeys: ShortcutKey[];
  accessibilityState: { expanded: boolean };
  mobile: boolean;
  style?: StyleProp<ViewStyle>;
}

export type WorkspaceExplorerToggleOwner = "mobile" | "header" | "window";

export function resolveWorkspaceExplorerToggleOwner({
  isMobile,
  hasMacTrafficLights,
}: {
  isMobile: boolean;
  hasMacTrafficLights: boolean;
}): WorkspaceExplorerToggleOwner {
  if (isMobile) return "mobile";
  return hasMacTrafficLights ? "window" : "header";
}

/**
 * Whether the open sidebar is on screen carrying its own close button. Only the docked pane
 * has one, and only when this workspace's layout can host it — the open flag is app-wide, so
 * it alone cannot answer this.
 */
export function resolveExplorerSidebarHostsToggle({
  isCompact,
  hasExplorerPane,
  focusModeEnabled,
}: {
  isCompact: boolean;
  hasExplorerPane: boolean;
  focusModeEnabled: boolean;
}): boolean {
  if (usesCompactExplorerSidebar({ isCompact })) {
    return false;
  }
  return hasExplorerPane && !focusModeEnabled;
}

export function WorkspaceExplorerToggle({
  onPress,
  label,
  tooltipLabel,
  tooltipKeys,
  accessibilityState,
  mobile,
  style,
}: WorkspaceExplorerToggleProps) {
  return (
    <HeaderToggleButton
      testID="workspace-explorer-toggle"
      onPress={onPress}
      tooltipLabel={tooltipLabel}
      tooltipKeys={tooltipKeys}
      tooltipSide="left"
      style={style}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
    >
      <ThemedPanelRight
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mobile ? mutedIconColorMapping : extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}

interface DesktopWorkspaceExplorerToggleProps extends Omit<WorkspaceExplorerToggleProps, "mobile"> {
  owner: WorkspaceExplorerToggleOwner;
  /** Whether the open sidebar is actually on screen carrying its own close button. */
  sidebarHostsToggle?: boolean;
}

/**
 * The workspace header owns the toggle only while the sidebar is collapsed. Once
 * it is open, the sidebar carries its own close button so the control sits next
 * to the thing it closes instead of across the window.
 *
 * `sidebarHostsToggle` is the safety catch: the open flag is app-wide while the
 * panel it opens belongs to a workspace, so a workspace that cannot draw the
 * sidebar would otherwise hide the header toggle in favour of a close button
 * that never renders, leaving no way to reach the panel at all.
 */
export function shouldShowHeaderExplorerToggle({
  owner,
  expanded,
  sidebarHostsToggle = true,
}: {
  owner: WorkspaceExplorerToggleOwner;
  expanded: boolean;
  sidebarHostsToggle?: boolean;
}): boolean {
  if (owner === "mobile") {
    return false;
  }
  return !expanded || !sidebarHostsToggle;
}

/** The open sidebar renders its own close button on every desktop platform. */
export function shouldShowSidebarExplorerToggle({
  owner,
  expanded,
}: {
  owner: WorkspaceExplorerToggleOwner;
  expanded: boolean;
}): boolean {
  return owner !== "mobile" && expanded;
}

export function WorkspaceHeaderExplorerToggle({
  owner,
  accessibilityState,
  sidebarHostsToggle,
  style,
  ...toggleProps
}: DesktopWorkspaceExplorerToggleProps) {
  if (
    !shouldShowHeaderExplorerToggle({
      owner,
      expanded: accessibilityState.expanded,
      sidebarHostsToggle,
    })
  ) {
    return null;
  }
  return (
    <WorkspaceExplorerToggle
      {...toggleProps}
      accessibilityState={accessibilityState}
      mobile={false}
      style={style}
    />
  );
}

/**
 * The open sidebar's close toggle. It lives in the hosted panel's toolbar, so it
 * uses toolbar chrome rather than the window-header button.
 */
export function WorkspaceExplorerSidebarToggle({
  owner,
  sidebarHostsToggle: _sidebarHostsToggle,
  onPress,
  label,
  tooltipLabel,
  tooltipKeys,
  accessibilityState,
}: DesktopWorkspaceExplorerToggleProps) {
  if (!shouldShowSidebarExplorerToggle({ owner, expanded: accessibilityState.expanded })) {
    return null;
  }
  return (
    <ToolbarButton
      testID="workspace-explorer-toggle"
      label={tooltipLabel}
      accessibilityHint={label}
      shortcut={[tooltipKeys]}
      onPress={onPress}
    >
      <ThemedPanelRight
        size={paneContentToolbarIconSize(false)}
        strokeWidth={1.5}
        uniProps={extraMutedIconColorMapping}
      />
    </ToolbarButton>
  );
}
