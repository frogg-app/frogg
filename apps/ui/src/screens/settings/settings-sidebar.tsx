import { useCallback, useMemo } from "react";
import type { ComponentType, ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { brand } from "@frogg/branding";
import { useTranslation } from "react-i18next";
import { isElectronRuntime } from "@/desktop/host";
import { SETTINGS_DESKTOP_SIDEBAR_WIDTH } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";
import { resolveSettingsScope, type SettingsView } from "@/navigation/settings-navigation";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import { SIDEBAR_SECTION_ITEMS } from "@/screens/settings/section-items";
import { useVisibleHostSectionItems } from "@/screens/settings/host-section-visibility";
import { useHosts } from "@/runtime/host-runtime";
import type { SecuritySeverity } from "@/security/posture";
import { SecurityDot } from "@/security/security-dot";
import { useSecurityPosture } from "@/security/use-security-posture";
import { BrandLogo } from "@/components/icons/brand-logo";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";

type SidebarIcon = ComponentType<{ size: number; color: string }>;

const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

function NavIcon({ Icon, color = "" }: { Icon: SidebarIcon; color?: string }) {
  return <Icon size={ICON_SIZE.md} color={color} />;
}

const ThemedNavIcon = withUnistyles(NavIcon);

function sidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [sidebarStyles.item, Boolean(hovered) && sidebarStyles.itemHovered];
}

function selectedSidebarItemStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [
    sidebarStyles.item,
    Boolean(hovered) && sidebarStyles.itemHovered,
    sidebarStyles.itemSelected,
  ];
}

interface SidebarSectionButtonProps {
  itemId: SettingsSectionSlug;
  label: string;
  icon: SidebarIcon;
  isSelected: boolean;
  onSelect: (section: SettingsSectionSlug) => void;
}

function SidebarSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
}: SidebarSectionButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      aria-selected={isSelected}
      onPress={handlePress}
      testID={`settings-section-${itemId}`}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <ThemedNavIcon
        Icon={IconComponent}
        uniProps={isSelected ? foregroundColorMapping : mutedColorMapping}
      />
      <Text
        style={[sidebarStyles.label, isSelected && sidebarStyles.labelSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

interface SidebarHostSectionButtonProps {
  itemId: HostSectionSlug;
  label: string;
  icon: SidebarIcon;
  isSelected: boolean;
  onSelect: (section: HostSectionSlug) => void;
  securitySeverity?: SecuritySeverity | null;
}

function SidebarHostSectionButton({
  itemId,
  label,
  icon: IconComponent,
  isSelected,
  onSelect,
  securitySeverity = null,
}: SidebarHostSectionButtonProps) {
  const handlePress = useCallback(() => {
    onSelect(itemId);
  }, [onSelect, itemId]);
  const accessibilityState = useMemo(() => ({ selected: isSelected }), [isSelected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      // React Native Web does not project `accessibilityState.selected` onto
      // the DOM, so the selected row would have no aria-selected without this.
      aria-selected={isSelected}
      onPress={handlePress}
      testID={`settings-host-section-${itemId}`}
      style={isSelected ? selectedSidebarItemStyle : sidebarItemStyle}
    >
      <ThemedNavIcon
        Icon={IconComponent}
        uniProps={isSelected ? foregroundColorMapping : mutedColorMapping}
      />
      <Text
        style={[sidebarStyles.label, isSelected && sidebarStyles.labelSelected]}
        numberOfLines={1}
      >
        {label}
      </Text>
      <SecurityDot
        severity={securitySeverity}
        testID={`settings-host-section-${itemId}-security-dot`}
      />
    </Pressable>
  );
}

export interface SettingsSidebarProps {
  view: SettingsView;
  onSelectSection: (section: SettingsSectionSlug) => void;
  onSelectHostSection: (section: HostSectionSlug) => void;
  /** `desktop` is the scrolling nav column beside the detail pane; `mobile` is the root list. */
  layout: "desktop" | "mobile";
}

/**
 * The settings nav. App settings and host settings are separate surfaces, so
 * the view's scope decides which list it shows: app sections, or the sections
 * of the one host being managed (hosts are switched from the sidebar's Hosts menu).
 */
export function SettingsSidebar({
  view,
  onSelectSection,
  onSelectHostSection,
  layout,
}: SettingsSidebarProps) {
  const { t } = useTranslation();
  const isDesktopApp = isElectronRuntime();
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  const scope = resolveSettingsScope(view);
  const isDesktop = layout === "desktop";
  // A host decides which of its own sections this app offers, so the list is
  // per-host rather than a constant.
  const hostSectionItems = useVisibleHostSectionItems(
    scope.kind === "host" ? scope.serverId : null,
  );
  const hosts = useHosts();
  const securityPosture = useSecurityPosture(scope.kind === "host" ? scope.serverId : "");
  const hostHasRemoteSsh =
    scope.kind === "host" &&
    hosts.some(
      (host) =>
        host.serverId === scope.serverId &&
        host.connections.some((connection) => connection.type === "remoteSsh"),
    );

  let sidebarBody: ReactNode;
  if (scope.kind === "host") {
    let selectedHostSection: HostSectionSlug | null = null;
    if (view.kind === "host") selectedHostSection = view.section;
    if (view.kind === "project") selectedHostSection = "projects";
    sidebarBody = (
      <View style={sidebarStyles.list}>
        {hostSectionItems
          .filter((item) => item.id !== "deploy" || hostHasRemoteSsh)
          // Only an owner on a daemon that reports its posture has anything to see here.
          .filter((item) => item.id !== "security" || securityPosture.available)
          .map((item) => (
            <SidebarHostSectionButton
              key={item.id}
              itemId={item.id}
              label={t(item.labelKey)}
              icon={item.icon}
              isSelected={selectedHostSection === item.id}
              onSelect={onSelectHostSection}
              securitySeverity={item.id === "security" ? securityPosture.severity : null}
            />
          ))}
      </View>
    );
  } else {
    const selectedSectionId = view.kind === "section" ? view.section : null;
    const items = SIDEBAR_SECTION_ITEMS.filter(
      (item) =>
        (!item.desktopOnly || isDesktopApp) &&
        (!item.webOnly || isWeb) &&
        (!item.requiresKeyboardShortcuts || shortcutsAvailable),
    );
    sidebarBody = (
      <View style={sidebarStyles.list}>
        {items.map((item) => (
          <SidebarSectionButton
            key={item.id}
            itemId={item.id}
            label={t(item.labelKey)}
            icon={item.icon}
            isSelected={selectedSectionId === item.id}
            onSelect={onSelectSection}
          />
        ))}
      </View>
    );
  }

  return (
    <View
      accessibilityLabel={t("settings.title")}
      role="navigation"
      style={isDesktop ? sidebarStyles.desktopContainer : sidebarStyles.mobileContainer}
      testID="settings-sidebar"
    >
      {isDesktop ? (
        <ScrollView
          style={sidebarStyles.scrollBody}
          showsVerticalScrollIndicator={false}
          testID="settings-sidebar-scroll-body"
        >
          {sidebarBody}
        </ScrollView>
      ) : (
        sidebarBody
      )}
      {isDesktop ? <SettingsSidebarFooter /> : null}
    </View>
  );
}

function SettingsSidebarFooter() {
  const versionText = formatVersionWithPrefix(resolveAppVersion());
  return (
    <View style={sidebarStyles.footer} testID="settings-sidebar-footer">
      <BrandLogo size={24} />
      <Text style={sidebarStyles.footerName} numberOfLines={1}>
        {brand.name}
      </Text>
      <Text style={sidebarStyles.footerVersion} numberOfLines={1}>
        {versionText}
      </Text>
    </View>
  );
}

const sidebarStyles = StyleSheet.create((theme) => ({
  desktopContainer: {
    width: SETTINGS_DESKTOP_SIDEBAR_WIDTH,
    borderRightWidth: 1,
    borderRightColor: theme.colors.border,
    backgroundColor: theme.colors.surfaceSidebar,
  },
  scrollBody: {
    flex: 1,
  },
  mobileContainer: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  list: {
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[1],
  },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
  },
  itemHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  itemSelected: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  label: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foregroundMuted,
    fontWeight: theme.fontWeight.normal,
    flex: 1,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[3],
    paddingHorizontal: theme.spacing[4],
  },
  footerName: {
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
    flexShrink: 1,
  },
  footerVersion: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  labelSelected: {
    color: theme.colors.foreground,
  },
}));
