import { router, usePathname, type Href } from "expo-router";
import { House, MessagesSquare, Plus, Settings } from "lucide-react-native";
import { memo, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet } from "react-native-unistyles";
import { themedIcon, type ThemedIcon } from "./soft-icon";
import type { Theme } from "@/styles/theme";
import {
  buildNewChatRoute,
  buildOpenProjectRoute,
  buildSessionsRoute,
  buildSettingsRoute,
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import { useSoftChatServerId } from "./soft-data";
import { softEdge, softRaised, SOFT_PILL } from "./soft-surface";

type TabId = "home" | "chats" | "new" | "settings";

/** Height the floating tab bar covers above the bottom safe-area inset, for pages to clear. */
export const SOFT_TAB_BAR_CLEARANCE = 72;

const ThemedIcons: Record<TabId, ThemedIcon> = {
  home: themedIcon(House),
  chats: themedIcon(MessagesSquare),
  new: themedIcon(Plus),
  settings: themedIcon(Settings),
};
const activeMapping = (theme: Theme) => ({ color: theme.colors.accent });
const idleMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const onAccentMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

function activeTabOf(pathname: string): TabId | null {
  if (pathname.startsWith("/settings") || /^\/h\/[^/]+\/settings/.test(pathname)) return "settings";
  if (pathname.startsWith("/new-chat")) return "new";
  if (pathname.endsWith("/sessions") || pathname === buildSessionsRoute()) return "chats";
  if (pathname === "/" || pathname.endsWith("/open-project")) return "home";
  return null;
}

// The new-chat/new-session drafts and the connect/pair flows own the whole screen.
const HIDDEN_PREFIXES = ["/new", "/welcome", "/host-add", "/pair-"];

/**
 * Whether the tab bar shows. Like Perplexity and ChatGPT iOS it steps aside inside a
 * conversation (the conversation's own composer owns the bottom edge) and on the new-chat draft.
 */
function showsTabBar(pathname: string): boolean {
  if (HIDDEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return false;
  if (parseHostWorkspaceRouteFromPathname(pathname)) return false;
  if (parseHostAgentRouteFromPathname(pathname)) return false;
  return true;
}

/**
 * The soft compact navigation: a floating pill tab bar (Luma/Notion iOS) held off the bottom
 * edge, the active tab drawn as a raised tinted pill with its label, and a round accent
 * "new chat" button in the middle.
 */
export function SoftMobileNav() {
  const pathname = usePathname();
  if (!showsTabBar(pathname)) return null;
  return <SoftTabBar active={activeTabOf(pathname)} />;
}

const SoftTabBar = memo(function SoftTabBar({ active }: { active: TabId | null }) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const chatServerId = useSoftChatServerId();
  const wrapInset = useMemo(() => ({ paddingBottom: Math.max(insets.bottom, 10) }), [insets]);
  const go = useCallback(
    (tab: TabId) => {
      if (tab === active) return;
      if (tab === "home") router.navigate(buildOpenProjectRoute());
      if (tab === "chats") router.navigate(buildSessionsRoute());
      if (tab === "settings") router.navigate(buildSettingsRoute());
      if (tab === "new" && chatServerId) router.push(buildNewChatRoute(chatServerId) as Href);
    },
    [active, chatServerId],
  );
  return (
    <View style={[styles.wrap, wrapInset]} pointerEvents="box-none" testID="soft-mobile-nav">
      <View style={styles.bar} accessibilityRole="tablist">
        <SoftTab id="home" label={t("sidebar.actions.home")} active={active} onPress={go} />
        <SoftTab id="chats" label={t("sidebar.sections.chats")} active={active} onPress={go} />
        <SoftTab
          id="new"
          label={t("sidebar.chats.newChat")}
          active={active}
          onPress={go}
          disabled={!chatServerId}
        />
        <SoftTab id="settings" label={t("sidebar.actions.settings")} active={active} onPress={go} />
      </View>
    </View>
  );
});

function SoftTab({
  id,
  label,
  active,
  onPress,
  disabled = false,
}: {
  id: TabId;
  label: string;
  active: TabId | null;
  onPress: (tab: TabId) => void;
  disabled?: boolean;
}) {
  const Icon = ThemedIcons[id];
  const selected = id === active;
  const press = useCallback(() => onPress(id), [id, onPress]);
  const a11yState = useMemo(() => ({ selected, disabled }), [disabled, selected]);
  if (id === "new") {
    return (
      <Pressable
        onPress={press}
        disabled={disabled}
        style={disabled ? newDisabledStyle() : styles.newButton}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={a11yState}
        testID="soft-tab-new"
      >
        <Icon size={22} strokeWidth={2.4} uniProps={onAccentMapping} />
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={press}
      style={selected ? tabSelectedStyle() : styles.tab}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={a11yState}
      testID={`soft-tab-${id}`}
    >
      <Icon
        size={20}
        strokeWidth={selected ? 2.3 : 2}
        uniProps={selected ? activeMapping : idleMapping}
      />
      <Text style={selected ? styles.labelSelected : styles.label} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  // Floats over the bottom of the page (Luma/Notion iOS) instead of taking a strip of its own.
  wrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 2,
  },
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    padding: 5,
    borderRadius: SOFT_PILL,
    ...softRaised(rt.themeName, "lg"),
    ...softEdge(rt.themeName),
  },
  tab: {
    minWidth: 64,
    height: 50,
    paddingHorizontal: 12,
    borderRadius: SOFT_PILL,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  tabSelected: {
    backgroundColor: theme.colors.surface2,
  },
  label: {
    fontSize: 10.5,
    fontWeight: "500",
    color: theme.colors.foregroundMuted,
  },
  labelSelected: {
    fontSize: 10.5,
    fontWeight: "700",
    color: theme.colors.accent,
  },
  newButton: {
    width: 50,
    height: 50,
    marginHorizontal: 4,
    borderRadius: SOFT_PILL,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.accent,
  },
  newDisabled: {
    opacity: 0.4,
  },
}));

// Composed at render: reading style proxies at module scope is not allowed.
const tabSelectedStyle = () => [styles.tab, styles.tabSelected];
const newDisabledStyle = () => [styles.newButton, styles.newDisabled];
