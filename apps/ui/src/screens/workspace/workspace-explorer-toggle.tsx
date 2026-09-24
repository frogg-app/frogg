import { PanelRight } from "lucide-react-native";
import { type StyleProp, type ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import type { ShortcutKey } from "@/utils/format-shortcut";

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
}

/**
 * The toggle lives in the workspace header on every desktop platform, open or closed, so it
 * never moves and stays reachable whether or not this workspace can draw the sidebar.
 */
export function shouldShowHeaderExplorerToggle({
  owner,
}: {
  owner: WorkspaceExplorerToggleOwner;
}): boolean {
  return owner !== "mobile";
}

export function WorkspaceHeaderExplorerToggle({
  owner,
  accessibilityState,
  style,
  ...toggleProps
}: DesktopWorkspaceExplorerToggleProps) {
  if (!shouldShowHeaderExplorerToggle({ owner })) {
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
