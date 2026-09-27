import { router, usePathname, type Href } from "expo-router";
import { History, House, Search, Settings, SquarePen, type LucideIcon } from "lucide-react-native";
import { memo, useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { BrandLogo } from "@/components/icons/brand-logo";
import { LeftSidebar } from "@/components/left-sidebar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import { useOwnsWindowChromeCorner } from "@/utils/desktop-window";
import {
  buildNewChatRoute,
  buildOpenProjectRoute,
  buildSessionsRoute,
  buildSettingsRoute,
} from "@/utils/host-routes";
import { useSoftChatServerId, useSoftProjects, useSoftRecents } from "./soft-data";
import { useSoftSegmentOptions, type SoftSegment } from "./soft-home";
import { SoftChatList, SoftProjectList } from "./soft-lists";
import { softEdge, softRaised, SOFT_CARD_RADIUS, SOFT_PILL } from "./soft-surface";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const activeMapping = (theme: Theme) => ({ color: theme.colors.accent });
const idleMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const onAccentMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const themedIcons = new Map<LucideIcon, ReturnType<typeof withUnistyles<LucideIcon>>>();
function themedIcon(icon: LucideIcon) {
  let themed = themedIcons.get(icon);
  if (!themed) {
    themed = withUnistyles(icon);
    themedIcons.set(icon, themed);
  }
  return themed;
}

/**
 * The soft sidebar. Desktop: an icon rail on the frame (Notion/Arc style) beside a floating,
 * rounded list card holding the recent chats or projects. Compact keeps the shipping drawer:
 * the soft compact layout navigates from its bottom tab bar instead.
 */
export function SoftSidebar({ active }: { active: boolean }) {
  const compact = useIsCompactFormFactor();
  if (compact) return <LeftSidebar active={active} />;
  return <SoftDesktopSidebar active={active} />;
}

const SoftDesktopSidebar = memo(function SoftDesktopSidebar({ active }: { active: boolean }) {
  return (
    <View
      style={active ? styles.root : hiddenRootStyle()}
      accessibilityElementsHidden={!active}
      importantForAccessibility={active ? "auto" : "no-hide-descendants"}
      testID="soft-sidebar"
    >
      <SoftRail />
      <SoftListCard />
    </View>
  );
});

function SoftRail() {
  const { t } = useTranslation();
  const pathname = usePathname();
  const ownsTopLeft = useOwnsWindowChromeCorner("top-left");
  const chatServerId = useSoftChatServerId();
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const goHome = useCallback(() => router.navigate(buildOpenProjectRoute()), []);
  const goHistory = useCallback(() => router.navigate(buildSessionsRoute()), []);
  const goSettings = useCallback(() => router.navigate(buildSettingsRoute()), []);
  const openSearch = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const newChat = useCallback(() => {
    if (chatServerId) router.push(buildNewChatRoute(chatServerId) as Href);
  }, [chatServerId]);
  const onHome = pathname === "/" || pathname.endsWith("/open-project");
  return (
    <View style={ownsTopLeft ? railBelowLightsStyle() : styles.rail}>
      <TitlebarDragRegion />
      <Pressable
        onPress={goHome}
        style={styles.logo}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.actions.home")}
      >
        <BrandLogo size={28} />
      </Pressable>
      <Pressable
        onPress={newChat}
        disabled={!chatServerId}
        style={chatServerId ? styles.newChat : newChatDisabledStyle()}
        accessibilityRole="button"
        accessibilityLabel={t("sidebar.chats.newChat")}
        testID="soft-rail-new-chat"
      >
        <RailGlyph icon={SquarePen} mapping={onAccentMapping} />
      </Pressable>
      <RailButton icon={House} label={t("sidebar.actions.home")} selected={onHome} onPress={goHome} />
      <RailButton icon={Search} label={t("sidebar.sections.search")} onPress={openSearch} />
      <RailButton
        icon={History}
        label={t("sidebar.sections.sessions")}
        selected={pathname.endsWith("/sessions")}
        onPress={goHistory}
      />
      <View style={styles.railSpacer} />
      <RailButton
        icon={Settings}
        label={t("sidebar.actions.settings")}
        selected={pathname.includes("/settings")}
        onPress={goSettings}
      />
    </View>
  );
}

function RailGlyph({
  icon,
  mapping,
}: {
  icon: LucideIcon;
  mapping: (theme: Theme) => { color: string };
}) {
  const Icon = themedIcon(icon);
  return <Icon size={19} strokeWidth={2.1} uniProps={mapping} />;
}

function RailButton({
  icon,
  label,
  selected = false,
  onPress,
}: {
  icon: LucideIcon;
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const style = useCallback(
    ({ hovered, pressed }: HoverState) => [
      styles.railButton,
      (Boolean(hovered) || pressed) && styles.railButtonHovered,
      selected && styles.railButtonSelected,
    ],
    [selected],
  );
  return (
    <Pressable onPress={onPress} style={style} accessibilityRole="button" accessibilityLabel={label}>
      <RailGlyph icon={icon} mapping={selected ? activeMapping : idleMapping} />
    </Pressable>
  );
}

function SoftListCard() {
  const { t } = useTranslation();
  const [segment, setSegment] = useState<SoftSegment>("chats");
  const options = useSoftSegmentOptions();
  const recents = useSoftRecents();
  const projects = useSoftProjects(recents);
  const selection = useActiveWorkspaceSelection();
  const activeKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>
          {segment === "chats" ? t("sidebar.sections.chats") : t("sidebar.sections.projects")}
        </Text>
        <Text style={styles.cardCount}>
          {segment === "chats" ? recents.length : projects.length}
        </Text>
      </View>
      <View style={styles.segmentRow}>
        <SegmentedControl options={options} value={segment} onValueChange={setSegment} size="sm" />
      </View>
      <ScrollView style={styles.cardScroll} contentContainerStyle={styles.cardList}>
        {segment === "chats" ? (
          <SoftChatList recents={recents} activeKey={activeKey} dense />
        ) : (
          <SoftProjectList projects={projects} dense />
        )}
      </ScrollView>
    </View>
  );
}

const RAIL_WIDTH = 52;
const CARD_WIDTH = 284;

const styles = StyleSheet.create((theme, rt) => ({
  root: {
    flexDirection: "row",
    gap: 8,
    width: RAIL_WIDTH + 8 + CARD_WIDTH,
  },
  hidden: {
    display: "none",
  },
  rail: {
    width: RAIL_WIDTH,
    alignItems: "center",
    gap: 6,
    paddingTop: 6,
    paddingBottom: 4,
  },
  railBelowLights: {
    paddingTop: 36,
  },
  logo: {
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  newChat: {
    width: 40,
    height: 40,
    borderRadius: SOFT_PILL,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
    marginBottom: 8,
  },
  newChatDisabled: {
    opacity: 0.4,
  },
  railButton: {
    width: 40,
    height: 40,
    borderRadius: SOFT_PILL,
    alignItems: "center",
    justifyContent: "center",
  },
  railButtonHovered: {
    backgroundColor: theme.colors.surface2,
  },
  railButtonSelected: {
    ...softRaised(rt.themeName, "sm"),
    ...softEdge(rt.themeName),
  },
  railSpacer: {
    flex: 1,
  },
  card: {
    width: CARD_WIDTH,
    borderRadius: SOFT_CARD_RADIUS,
    overflow: "hidden",
    ...softRaised(rt.themeName, "md"),
    ...softEdge(rt.themeName),
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 8,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 10,
  },
  cardTitle: {
    fontFamily: theme.design.headingFontFamily,
    fontSize: 20,
    fontWeight: "700",
    letterSpacing: -0.4,
    color: theme.colors.foreground,
  },
  cardCount: {
    fontSize: 13,
    fontWeight: "600",
    color: theme.colors.foregroundExtraMuted,
  },
  segmentRow: {
    paddingHorizontal: 14,
    paddingBottom: 8,
  },
  cardScroll: {
    flex: 1,
  },
  cardList: {
    paddingHorizontal: 6,
    paddingBottom: 12,
  },
}));

// Composed at render: reading style proxies at module scope is not allowed.
const hiddenRootStyle = () => [styles.root, styles.hidden];
const railBelowLightsStyle = () => [styles.rail, styles.railBelowLights];
const newChatDisabledStyle = () => [styles.newChat, styles.newChatDisabled];
