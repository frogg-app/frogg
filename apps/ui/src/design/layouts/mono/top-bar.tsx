import { router } from "expo-router";
import { Menu, Plus, Search } from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { brand } from "@frogg/branding";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { BrandLogo } from "@/components/icons/brand-logo";
import { Shortcut } from "@/components/ui/shortcut";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { usePanelStore } from "@/stores/panel-store";
import type { Theme } from "@/styles/theme";
import { buildOpenProjectRoute, buildSessionsRoute, buildSettingsRoute } from "@/utils/host-routes";
import { WindowChromeSafeArea } from "@/utils/desktop-window";
import { projectNameOf } from "./mono-data";
import { CrumbSlash, HostCrumb, ProjectCrumb, WorkspaceCrumb } from "./top-bar-crumbs";
import { openFind, useMonoNewChat, useMonoRoute, type MonoRoute, type MonoTab } from "./use-mono-route";

// Mono's header, after Vercel's dashboard: logo, then host / project / branch selectors, with
// Find… and the primary action on the right, and underline tabs beneath that navigate.

const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const primaryIcon = (theme: Theme) => ({ color: theme.colors.primaryForeground });
const ThemedSearch = withUnistyles(Search);
const ThemedPlus = withUnistyles(Plus);
const ThemedMenu = withUnistyles(Menu);
const SEARCH_ICON = <ThemedSearch size={14} uniProps={mutedIcon} />;
const PLUS_ICON = <ThemedPlus size={14} uniProps={primaryIcon} />;
const MENU_ICON = <ThemedMenu size={18} uniProps={mutedIcon} />;

// preview copy
const COPY = { find: "Find…", overview: "Overview", changes: "Changes" };

export function MonoTopBar() {
  const compact = useIsCompactFormFactor();
  const route = useMonoRoute();
  return (
    <View style={styles.root} testID="mono-top-bar">
      {compact ? <CompactHeader route={route} /> : <DesktopHeader route={route} />}
      <Tabs route={route} />
    </View>
  );
}

function Logo() {
  const goHome = useCallback(() => router.push(buildOpenProjectRoute()), []);
  return (
    <Pressable onPress={goHome} accessibilityRole="link" accessibilityLabel={brand.name} style={styles.logo}>
      <BrandLogo size={28} />
    </Pressable>
  );
}

function Crumbs({ route }: { route: MonoRoute }) {
  const activeProject = route.workspace && !route.workspace.chat ? projectNameOf(route.workspace) : null;
  return (
    <View style={styles.crumbs}>
      <HostCrumb activeServerId={route.serverId} />
      <CrumbSlash />
      <ProjectCrumb activeProject={activeProject} />
      {route.workspace && route.serverId ? (
        <>
          <CrumbSlash />
          <WorkspaceCrumb serverId={route.serverId} workspace={route.workspace} />
        </>
      ) : null}
    </View>
  );
}

/** Phones have room for one selector: the chat's branch inside a workspace, else the project. */
function CompactCrumb({ route }: { route: MonoRoute }) {
  if (route.workspace && route.serverId) {
    return <WorkspaceCrumb serverId={route.serverId} workspace={route.workspace} />;
  }
  return <ProjectCrumb activeProject={null} />;
}

function DesktopHeader({ route }: { route: MonoRoute }) {
  return (
    <WindowChromeSafeArea placement="inline" horizontalPadding={16} style={styles.header}>
      <TitlebarDragRegion />
      <Logo />
      <CrumbSlash />
      <Crumbs route={route} />
      <View style={styles.spacer} />
      <FindButton />
      <NewChatButton route={route} />
    </WindowChromeSafeArea>
  );
}

function CompactHeader({ route }: { route: MonoRoute }) {
  const { t } = useTranslation();
  const openMenu = usePanelStore((state) => state.toggleMobileAgentList);
  return (
    <View style={styles.header}>
      <Logo />
      <CrumbSlash />
      <View style={styles.crumbs}>
        <CompactCrumb route={route} />
      </View>
      <View style={styles.spacer} />
      <Pressable onPress={openFind} style={styles.iconButton} accessibilityLabel={COPY.find}>
        {SEARCH_ICON}
      </Pressable>
      <Pressable
        onPress={openMenu}
        style={styles.iconButton}
        accessibilityLabel={t("sidebar.sections.projects")}
        testID="mono-open-menu"
      >
        {MENU_ICON}
      </Pressable>
    </View>
  );
}

function findStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.find, hovered && styles.findHovered];
}

function FindButton() {
  const keys = useShortcutKeys("toggle-command-center");
  return (
    <Pressable onPress={openFind} style={findStyle} testID="mono-find" accessibilityLabel={COPY.find}>
      {SEARCH_ICON}
      <Text style={styles.findText}>{COPY.find}</Text>
      {keys ? <Shortcut chord={keys} /> : null}
    </Pressable>
  );
}

function primaryStyle({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.primary, (hovered || pressed) && styles.primaryHovered];
}

function NewChatButton({ route }: { route: MonoRoute }) {
  const { t } = useTranslation();
  const onPress = useMonoNewChat(route);
  return (
    <Pressable onPress={onPress} style={primaryStyle} testID="mono-new-chat">
      {PLUS_ICON}
      <Text style={styles.primaryText}>{t("sidebar.chats.newChat")}</Text>
    </Pressable>
  );
}

function Tabs({ route }: { route: MonoRoute }) {
  const { t } = useTranslation();
  const workspace = route.workspace;
  const serverId = route.serverId;
  const openChanges = useCallback(() => {
    if (!serverId || !workspace) return;
    navigateToWorkspace({ serverId, workspaceId: workspace.id, target: { kind: "changes_tree" } });
  }, [serverId, workspace]);
  const tabs = useMemo(
    () =>
      [
        { id: "overview", label: COPY.overview, onPress: () => router.push(buildOpenProjectRoute()) },
        { id: "chats", label: t("sidebar.sections.chats"), onPress: () => router.push(buildSessionsRoute()) },
        ...(workspace && !workspace.chat ? [{ id: "changes", label: COPY.changes, onPress: openChanges }] : []),
        { id: "settings", label: t("sidebar.actions.settings"), onPress: () => router.push(buildSettingsRoute()) },
      ] satisfies { id: MonoTab; label: string; onPress: () => void }[],
    [openChanges, t, workspace],
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
      {tabs.map((tab) => (
        <Tab key={tab.id} label={tab.label} active={route.tab === tab.id} onPress={tab.onPress} id={tab.id} />
      ))}
    </ScrollView>
  );
}

function tabStyle({ hovered }: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.tab, hovered && styles.tabHovered];
}

function Tab({ id, label, active, onPress }: { id: MonoTab; label: string; active: boolean; onPress: () => void }) {
  styles.useVariants({ active });
  return (
    <Pressable onPress={onPress} style={tabStyle} testID={`mono-tab-${id}`} accessibilityRole="tab">
      <Text style={styles.tabText}>{label}</Text>
      <View style={styles.tabUnderline} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  root: {
    backgroundColor: theme.colors.surface0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  header: {
    position: "relative",
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 56,
    paddingHorizontal: 12,
  },
  logo: {
    marginHorizontal: 4,
  },
  crumbs: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 0,
    flexShrink: 1,
  },
  spacer: {
    flex: 1,
  },
  find: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 32,
    width: 220,
    paddingLeft: 10,
    paddingRight: 6,
    marginRight: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  findHovered: {
    borderColor: theme.colors.foregroundExtraMuted,
  },
  findText: {
    flex: 1,
    color: theme.colors.foregroundMuted,
    fontSize: 13,
  },
  primary: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: theme.colors.primary,
  },
  primaryHovered: {
    opacity: 0.85,
  },
  primaryText: {
    color: theme.colors.primaryForeground,
    fontSize: 13,
    fontWeight: "500",
  },
  iconButton: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 6,
  },
  tabs: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingHorizontal: 12,
    gap: 2,
  },
  tab: {
    height: 44,
    justifyContent: "center",
    paddingHorizontal: 10,
    position: "relative",
  },
  tabHovered: {
    opacity: 1,
  },
  tabText: {
    fontSize: 14,
    variants: {
      active: {
        true: { color: theme.colors.foreground, fontWeight: "500" },
        false: { color: theme.colors.foregroundMuted },
      },
    },
  },
  tabUnderline: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: -1,
    height: 2,
    variants: {
      active: {
        true: { backgroundColor: theme.colors.foreground },
        false: { backgroundColor: "transparent" },
      },
    },
  },
}));
