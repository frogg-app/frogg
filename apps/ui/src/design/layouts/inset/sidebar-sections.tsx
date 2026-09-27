import { usePathname } from "expo-router";
import {
  Box,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Inbox,
  Layers,
  MessageSquare,
  Plus,
} from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useSidebarModel } from "@/components/sidebar/sidebar-model";
import type {
  SidebarProjectEntry,
  SidebarWorkspaceEntry,
} from "@/hooks/use-sidebar-workspaces-list";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { Theme } from "@/styles/theme";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { formatCompactTimeAgo } from "@/utils/time";
import { VIEW_LABELS } from "./copy";
import {
  countView,
  rowFromEntry,
  useInsetChatRows,
  useInsetViewStore,
  type InsetRow,
  type InsetView,
} from "./inset-data";
import { InsetNavMeta, InsetNavRow } from "./nav-row";
import { InsetStatusGlyph } from "./status-glyph";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const accentMapping = (theme: Theme) => ({ color: theme.colors.accent });
const ThemedInbox = withUnistyles(Inbox);
const ThemedCircleDot = withUnistyles(CircleDot);
const ThemedLayers = withUnistyles(Layers);
const ThemedBox = withUnistyles(Box);
const ThemedChat = withUnistyles(MessageSquare);
const ThemedDown = withUnistyles(ChevronDown);
const ThemedRight = withUnistyles(ChevronRight);
const ThemedPlus = withUnistyles(Plus);

const NAV_ITEMS: ReadonlyArray<{ view: InsetView; icon: React.ReactElement }> = [
  { view: "inbox", icon: <ThemedInbox size={14} uniProps={mutedMapping} /> },
  { view: "running", icon: <ThemedCircleDot size={14} uniProps={mutedMapping} /> },
  { view: "all", icon: <ThemedLayers size={14} uniProps={mutedMapping} /> },
];

interface SectionActions {
  openView: (view: InsetView) => void;
  openWorkspace: (serverId: string, workspaceId: string) => void;
  addProject: () => void;
}

/** Linear's personal views (Inbox, My issues…) as status views over every session and chat. */
export function InsetNavGroup({ openView }: Pick<SectionActions, "openView">) {
  const { workspaceEntriesByKey } = useSidebarModel();
  const chats = useInsetChatRows();
  const rows = useMemo(
    () => [...[...workspaceEntriesByKey.values()].map(rowFromEntry), ...chats],
    [chats, workspaceEntriesByKey],
  );
  const view = useInsetViewStore((state) => state.view);
  const onHome = usePathname() === buildOpenProjectRoute();
  return (
    <View style={styles.group}>
      {NAV_ITEMS.map((item) => (
        <NavItem
          key={item.view}
          view={item.view}
          icon={item.icon}
          count={countView(rows, item.view)}
          active={onHome && view === item.view}
          onOpen={openView}
        />
      ))}
    </View>
  );
}

function NavItem({
  view,
  icon,
  count,
  active,
  onOpen,
}: {
  view: InsetView;
  icon: React.ReactElement;
  count: number;
  active: boolean;
  onOpen: (view: InsetView) => void;
}) {
  const handlePress = useCallback(() => onOpen(view), [onOpen, view]);
  return (
    <InsetNavRow
      leading={icon}
      label={VIEW_LABELS[view]}
      trailing={count > 0 ? <InsetNavMeta>{count}</InsetNavMeta> : null}
      active={active}
      onPress={handlePress}
      testID={`inset-nav-${view}`}
    />
  );
}

function sectionHeaderStyle({ hovered }: HoverState) {
  return [styles.sectionHeader, Boolean(hovered) && styles.sectionHeaderHovered];
}

function SectionHeader({
  label,
  open,
  onToggle,
  onAdd,
  addLabel,
}: {
  label: string;
  open: boolean;
  onToggle: () => void;
  onAdd?: () => void;
  addLabel?: string;
}) {
  return (
    <View style={styles.sectionHeaderRow}>
      <Pressable
        onPress={onToggle}
        style={sectionHeaderStyle}
        accessibilityRole="button"
        accessibilityState={open ? EXPANDED : COLLAPSED}
      >
        <Text style={styles.sectionLabel}>{label}</Text>
        {open ? (
          <ThemedDown size={10} uniProps={mutedMapping} />
        ) : (
          <ThemedRight size={10} uniProps={mutedMapping} />
        )}
      </Pressable>
      {onAdd ? (
        <Pressable
          onPress={onAdd}
          style={styles.sectionAdd}
          accessibilityRole="button"
          accessibilityLabel={addLabel}
          testID="inset-sidebar-add-project"
        >
          <ThemedPlus size={13} uniProps={mutedMapping} />
        </Pressable>
      ) : null}
    </View>
  );
}

const EXPANDED = { expanded: true } as const;
const COLLAPSED = { expanded: false } as const;

/** "Projects": each project a collapsible team-style row with its sessions indented below. */
export function InsetProjectsGroup({
  openWorkspace,
  addProject,
}: Pick<SectionActions, "openWorkspace" | "addProject">) {
  const { t } = useTranslation();
  const { projects, workspaceEntriesByKey, collapsedProjectKeys, toggleProjectCollapsed } =
    useSidebarModel();
  const selection = useActiveWorkspaceSelection();
  const activeKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return (
    <View style={styles.group}>
      <SectionHeader
        label={t("sidebar.sections.projects")}
        open={open}
        onToggle={toggle}
        onAdd={addProject}
        addLabel={t("sidebar.actions.addProject")}
      />
      {open
        ? projects.map((project) => (
            <ProjectBlock
              key={project.viewKey}
              project={project}
              entries={workspaceEntriesByKey}
              collapsed={collapsedProjectKeys.has(project.viewKey)}
              onToggle={toggleProjectCollapsed}
              activeKey={activeKey}
              openWorkspace={openWorkspace}
            />
          ))
        : null}
    </View>
  );
}

const ProjectBlock = memo(function ProjectBlock({
  project,
  entries,
  collapsed,
  onToggle,
  activeKey,
  openWorkspace,
}: {
  project: SidebarProjectEntry;
  entries: ReadonlyMap<string, SidebarWorkspaceEntry>;
  collapsed: boolean;
  onToggle: (viewKey: string) => void;
  activeKey: string | null;
  openWorkspace: (serverId: string, workspaceId: string) => void;
}) {
  const handleToggle = useCallback(() => onToggle(project.viewKey), [onToggle, project.viewKey]);
  const rows = useMemo(
    () =>
      project.workspaces.flatMap((placement) => {
        const entry = entries.get(placement.workspaceKey);
        return entry && !entry.archivingAt ? [rowFromEntry(entry)] : [];
      }),
    [entries, project.workspaces],
  );
  return (
    <View>
      <InsetNavRow
        leading={<ThemedBox size={14} uniProps={accentMapping} />}
        label={project.projectName}
        trailing={
          collapsed ? (
            <ThemedRight size={12} uniProps={mutedMapping} />
          ) : (
            <ThemedDown size={12} uniProps={mutedMapping} />
          )
        }
        onPress={handleToggle}
        testID={`inset-project-${project.viewKey}`}
      />
      {collapsed
        ? null
        : rows.map((row) => (
            <SessionItem
              key={row.key}
              row={row}
              active={row.key === activeKey}
              onOpen={openWorkspace}
            />
          ))}
    </View>
  );
});

function SessionItem({
  row,
  active,
  onOpen,
}: {
  row: InsetRow;
  active: boolean;
  onOpen: (serverId: string, workspaceId: string) => void;
}) {
  const handlePress = useCallback(
    () => onOpen(row.serverId, row.workspaceId),
    [onOpen, row.serverId, row.workspaceId],
  );
  return (
    <InsetNavRow
      indented
      leading={<InsetStatusGlyph bucket={row.bucket} size={13} />}
      label={row.title}
      trailing={row.at ? <InsetNavMeta>{formatCompactTimeAgo(row.at)}</InsetNavMeta> : null}
      active={active}
      onPress={handlePress}
      testID={`inset-session-${row.key}`}
    />
  );
}

/** Project-less chats, flat, newest first. */
export function InsetChatsGroup({ openWorkspace }: Pick<SectionActions, "openWorkspace">) {
  const { t } = useTranslation();
  const chats = useInsetChatRows();
  const selection = useActiveWorkspaceSelection();
  const activeKey = selection ? `${selection.serverId}:${selection.workspaceId}` : null;
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  const sorted = useMemo(
    () => [...chats].sort((a, b) => (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0)),
    [chats],
  );
  if (sorted.length === 0) return null;
  return (
    <View style={styles.group}>
      <SectionHeader label={t("sidebar.sections.chats")} open={open} onToggle={toggle} />
      {open
        ? sorted.map((row) => (
            <ChatItem
              key={row.key}
              row={row}
              active={row.key === activeKey}
              onOpen={openWorkspace}
            />
          ))
        : null}
    </View>
  );
}

function ChatItem({
  row,
  active,
  onOpen,
}: {
  row: InsetRow;
  active: boolean;
  onOpen: (serverId: string, workspaceId: string) => void;
}) {
  const handlePress = useCallback(
    () => onOpen(row.serverId, row.workspaceId),
    [onOpen, row.serverId, row.workspaceId],
  );
  const leading =
    row.bucket === "done" ? (
      <ThemedChat size={13} uniProps={mutedMapping} />
    ) : (
      <InsetStatusGlyph bucket={row.bucket} size={13} />
    );
  return (
    <InsetNavRow
      leading={leading}
      label={row.title}
      active={active}
      onPress={handlePress}
      testID={`inset-chat-${row.key}`}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  group: {
    gap: 1,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 2,
  },
  sectionHeader: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
  },
  sectionHeaderHovered: {
    backgroundColor: theme.colors.surface3,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.foregroundMuted,
  },
  sectionAdd: {
    width: 24,
    height: 24,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
}));
