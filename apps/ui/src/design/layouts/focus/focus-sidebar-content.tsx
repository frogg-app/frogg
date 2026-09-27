import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { router, usePathname, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  FolderGit2,
  FolderPlus,
  History,
  PanelLeft,
  Plus,
  Search,
  Server,
  Settings,
  SquarePen,
  X,
} from "lucide-react-native";
import { HostStatusDot } from "@/components/host-status-dot";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { openHostSettings } from "@/navigation/settings-navigation";
import { useHostRuntimeConnectionStatus } from "@/runtime/host-runtime";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { usePanelStore } from "@/stores/panel-store";
import { useSessionStore, type Agent } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import {
  buildHostSessionsRoute,
  buildOpenProjectRoute,
  buildProjectsSettingsRoute,
  buildSettingsRoute,
  parseHostAgentRouteFromPathname,
  parseHostWorkspaceRouteFromPathname,
} from "@/utils/host-routes";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import {
  useFocusHasHydratedAgents,
  useFocusRecentAgents,
  useFocusServerId,
  useFocusWorkspaces,
} from "./focus-data";
import { FocusHostSwitcher } from "./focus-host-switcher";
import { FocusRecentRow } from "./focus-recent-row";

const ICON = 15;
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundIcon = (theme: Theme) => ({ color: theme.colors.foreground });

const I = {
  folderGit: withUnistyles(FolderGit2),
  folderPlus: withUnistyles(FolderPlus),
  history: withUnistyles(History),
  panelLeft: withUnistyles(PanelLeft),
  plus: withUnistyles(Plus),
  search: withUnistyles(Search),
  server: withUnistyles(Server),
  settings: withUnistyles(Settings),
  squarePen: withUnistyles(SquarePen),
  x: withUnistyles(X),
};
type IconComponent = (typeof I)[keyof typeof I];

/**
 * The Focus sidebar body, after Devin: host switcher with search and collapse, a short nav, a
 * flat Recent list of chats with coloured status sub-lines, and a quiet footer.
 * preview copy
 */
export function FocusSidebarContent({
  onBeforeNavigate,
  onClose,
}: {
  onBeforeNavigate?: () => void;
  /** Compact only: closes the drawer, which otherwise covers the whole screen. */
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const serverId = useFocusServerId();
  const pathname = usePathname();
  const isCompact = useIsCompactFormFactor();
  const toggleDesktopSidebar = usePanelStore((state) => state.toggleDesktopAgentList);
  const openAddProject = useOpenAddProject();

  const go = useCallback(
    (href: string) => {
      onBeforeNavigate?.();
      router.navigate(href as Href);
    },
    [onBeforeNavigate],
  );
  const handleSearch = useCallback(() => {
    onBeforeNavigate?.();
    useKeyboardShortcutsStore.getState().setCommandCenterOpen(true);
  }, [onBeforeNavigate]);
  const handleNewChat = useCallback(() => go(buildOpenProjectRoute()), [go]);
  const handleAddProject = useCallback(() => {
    onBeforeNavigate?.();
    openAddProject(serverId ?? undefined);
  }, [onBeforeNavigate, openAddProject, serverId]);
  const handleHosts = useCallback(() => {
    if (!serverId) return;
    onBeforeNavigate?.();
    openHostSettings(serverId);
  }, [onBeforeNavigate, serverId]);

  const nav = useMemo(
    () => [
      { key: "new", icon: I.squarePen, label: "New chat", href: buildOpenProjectRoute() },
      {
        key: "chats",
        icon: I.history,
        label: t("sessions.title"),
        href: serverId ? buildHostSessionsRoute(serverId) : "/sessions",
      },
      {
        key: "projects",
        icon: I.folderGit,
        label: "Projects",
        href: serverId ? buildProjectsSettingsRoute(serverId) : null,
      },
      {
        key: "settings",
        icon: I.settings,
        label: t("sidebar.actions.settings"),
        href: buildSettingsRoute(),
      },
    ],
    [serverId, t],
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <FocusHostSwitcher serverId={serverId} onBeforeAction={onBeforeNavigate} />
        <View style={styles.headerIcons}>
          <IconButton icon={I.search} label="Search" onPress={handleSearch} />
          {isCompact && onClose ? (
            <IconButton icon={I.x} label={t("sidebar.actions.closeSidebar")} onPress={onClose} />
          ) : null}
          {isCompact ? null : (
            <IconButton
              icon={I.panelLeft}
              label="Collapse sidebar"
              onPress={toggleDesktopSidebar}
            />
          )}
        </View>
      </View>
      <View style={styles.nav}>
        {nav.map((item) =>
          item.href ? (
            <NavRow
              key={item.key}
              icon={item.icon}
              label={item.label}
              href={item.href}
              active={pathname === item.href || pathname.startsWith(`${item.href}/`)}
              onNavigate={go}
            />
          ) : null,
        )}
      </View>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Recent</Text>
        <IconButton icon={I.plus} label="New chat" onPress={handleNewChat} small />
      </View>
      <FocusRecentList
        serverId={serverId}
        pathname={pathname}
        onBeforeNavigate={onBeforeNavigate}
      />
      <View style={styles.footer}>
        <FooterStatus serverId={serverId} />
        <View style={styles.headerIcons}>
          <IconButton
            icon={I.folderPlus}
            label={t("sidebar.actions.addProject")}
            onPress={handleAddProject}
          />
          <IconButton
            icon={I.server}
            label={t("sidebar.hostsMenu.trigger")}
            onPress={handleHosts}
          />
        </View>
      </View>
    </View>
  );
}

function FocusRecentList({
  serverId,
  pathname,
  onBeforeNavigate,
}: {
  serverId: string | null;
  pathname: string;
  onBeforeNavigate?: () => void;
}) {
  const agents = useFocusRecentAgents(serverId);
  const workspaces = useFocusWorkspaces(serverId);
  const hydrated = useFocusHasHydratedAgents(serverId);
  const agentRoute = parseHostAgentRouteFromPathname(pathname);
  const workspaceRoute = parseHostWorkspaceRouteFromPathname(pathname);
  // On a workspace route the workspace screen reports which of its agents has focus.
  const focusedAgentId = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.focusedAgentId ?? null) : null,
  );
  const handleOpen = useCallback(
    (agent: Agent) => {
      if (!serverId) return;
      onBeforeNavigate?.();
      navigateToAgent({ serverId, agentId: agent.id });
    },
    [onBeforeNavigate, serverId],
  );

  if (agents.length === 0) {
    return (
      <View style={styles.list}>
        <Text style={styles.empty}>{hydrated || !serverId ? "No chats yet" : "Loading…"}</Text>
      </View>
    );
  }
  return (
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.listContent}
      testID="focus-recent-list"
    >
      {agents.map((agent) => (
        <FocusRecentRow
          key={agent.id}
          agent={agent}
          workspace={agent.workspaceId ? workspaces.get(agent.workspaceId) : undefined}
          selected={
            agentRoute?.agentId === agent.id ||
            (workspaceRoute !== null &&
              workspaceRoute.workspaceId === agent.workspaceId &&
              focusedAgentId === agent.id)
          }
          onOpen={handleOpen}
        />
      ))}
    </ScrollView>
  );
}

function FooterStatus({ serverId }: { serverId: string | null }) {
  const status = useHostRuntimeConnectionStatus(serverId ?? "");
  if (!serverId) return <View />;
  return (
    <View style={styles.footerStatus}>
      <HostStatusDot serverId={serverId} />
      <Text style={styles.footerText}>{status === "online" ? "Connected" : "Offline"}</Text>
    </View>
  );
}

function NavRow({
  icon,
  label,
  href,
  active,
  onNavigate,
}: {
  icon: IconComponent;
  label: string;
  href: string;
  active: boolean;
  onNavigate: (href: string) => void;
}) {
  const Icon = icon;
  const handlePress = useCallback(() => onNavigate(href), [href, onNavigate]);
  const rowStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.navRow,
      (active || hovered || pressed) && styles.navRowActive,
    ],
    [active],
  );
  return (
    <Pressable style={rowStyle} onPress={handlePress} accessibilityRole="link">
      <Icon size={ICON} uniProps={active ? foregroundIcon : mutedIcon} />
      <Text style={active ? styles.navLabelActive : styles.navLabel} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

function IconButton({
  icon,
  label,
  onPress,
  small = false,
}: {
  icon: IconComponent;
  label: string;
  onPress: () => void;
  small?: boolean;
}) {
  const Icon = icon;
  const buttonStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      small ? styles.iconButtonSmall : styles.iconButton,
      (hovered || pressed) && styles.navRowActive,
    ],
    [small],
  );
  return (
    <Pressable
      style={buttonStyle}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={4}
    >
      <Icon size={small ? 13 : ICON} uniProps={mutedIcon} />
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    minHeight: 0,
    paddingHorizontal: theme.spacing[2],
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    paddingTop: theme.spacing[2],
    paddingBottom: theme.spacing[1],
  },
  headerIcons: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
  },
  nav: {
    gap: 1,
    paddingVertical: theme.spacing[1],
  },
  navRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    height: { xs: 40, md: 30 },
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  navRowActive: {
    backgroundColor: theme.colors.surface2,
  },
  navLabel: {
    color: theme.colors.foreground,
    fontSize: 13,
  },
  navLabelActive: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeight.medium,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[4],
    paddingBottom: theme.spacing[1],
  },
  sectionTitle: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  list: {
    flex: 1,
    minHeight: 0,
  },
  listContent: {
    gap: 1,
    paddingBottom: theme.spacing[2],
  },
  empty: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[1],
    paddingVertical: theme.spacing[2],
  },
  footerStatus: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingLeft: theme.spacing[1],
  },
  footerText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  iconButton: {
    width: { xs: 36, md: 26 },
    height: { xs: 36, md: 26 },
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  iconButtonSmall: {
    width: 20,
    height: 20,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
  },
}));
