import { router } from "expo-router";
import { ChevronsUpDown, FolderPlus, Server } from "lucide-react-native";
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { HostStatusDot } from "@/components/host-status-dot";
import {
  MenuItem,
  MenuLabel,
  MenuRoot,
  MenuSeparator,
  MenuSurface,
  MenuTrigger,
} from "@/components/ui/menu";
import type { MenuTriggerState } from "@/components/ui/menu/menu-root";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { openHostSettings } from "@/navigation/settings-navigation";
import { useHosts } from "@/runtime/host-runtime";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";
import { buildOpenProjectRoute } from "@/utils/host-routes";
import { bucketOfWorkspace, useProjectIndex, type MonoProject } from "./mono-projects";
import { MonoText, StatusDot } from "./mono-parts";
import { useMonoScope } from "./mono-scope";

// The breadcrumb selectors in Mono's header: host, project, and (on a chat) its workspace
// branch. Each is a Vercel-style "name ⌄" trigger that opens a switcher.

const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedChevrons = withUnistyles(ChevronsUpDown);
const ThemedServer = withUnistyles(Server);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const CHEVRONS = <ThemedChevrons size={12} uniProps={mutedIcon} />;
const SERVER_ICON = <ThemedServer size={14} uniProps={mutedIcon} />;
const ADD_PROJECT_ICON = <ThemedFolderPlus size={14} uniProps={mutedIcon} />;

// preview copy
const COPY = {
  allHosts: "All hosts",
  allProjects: "All projects",
  hosts: "Hosts",
  projects: "Projects",
  branches: "Workspaces",
  hostSettings: "Host settings",
};

function crumbStyle({ hovered, open }: MenuTriggerState) {
  return [styles.crumb, (hovered || open) && styles.crumbHovered];
}

function Crumb({
  label,
  leading,
  mono,
  testID,
}: {
  label: string;
  leading?: ReactNode;
  mono?: boolean;
  testID: string;
}) {
  return (
    <MenuTrigger style={crumbStyle} testID={testID} accessibilityLabel={label}>
      {leading}
      {mono ? (
        <MonoText tone="strong" numberOfLines={1}>
          {label}
        </MonoText>
      ) : (
        <Text style={styles.crumbText} numberOfLines={1}>
          {label}
        </Text>
      )}
      {CHEVRONS}
    </MenuTrigger>
  );
}

export function CrumbSlash() {
  return <Text style={styles.slash}>/</Text>;
}

export function HostCrumb({ activeServerId }: { activeServerId: string | null }) {
  const hosts = useHosts();
  const scopeServerId = useMonoScope((state) => state.serverId);
  const setServerId = useMonoScope((state) => state.setServerId);
  const serverId = activeServerId ?? scopeServerId;
  const host = hosts.find((entry) => entry.serverId === serverId);
  const label = host?.label ?? (hosts.length === 1 ? hosts[0]?.label : null) ?? COPY.allHosts;
  const dotServerId = host?.serverId ?? (hosts.length === 1 ? hosts[0]?.serverId : null);
  const leading = useMemo(
    () => (dotServerId ? <HostStatusDot serverId={dotServerId} /> : SERVER_ICON),
    [dotServerId],
  );
  const selectAll = useCallback(() => setServerId(null), [setServerId]);

  return (
    <MenuRoot compactMode="sheet">
      <Crumb label={label} leading={leading} testID="mono-crumb-host" />
      <MenuSurface side="bottom" align="start" width={260} sheetTitle={COPY.hosts}>
        <MenuLabel>{COPY.hosts}</MenuLabel>
        <MenuItem selected={serverId === null} showSelectedCheck onSelect={selectAll}>
          {COPY.allHosts}
        </MenuItem>
        {hosts.map((entry) => (
          <HostItem
            key={entry.serverId}
            serverId={entry.serverId}
            label={entry.label}
            selected={entry.serverId === serverId}
          />
        ))}
        {serverId ? (
          <>
            <MenuSeparator />
            <HostSettingsItem serverId={serverId} />
          </>
        ) : null}
      </MenuSurface>
    </MenuRoot>
  );
}

function HostItem({
  serverId,
  label,
  selected,
}: {
  serverId: string;
  label: string;
  selected: boolean;
}) {
  const setServerId = useMonoScope((state) => state.setServerId);
  const onSelect = useCallback(() => {
    setServerId(serverId);
    router.push(buildOpenProjectRoute());
  }, [serverId, setServerId]);
  const trailing = useMemo(() => <HostStatusDot serverId={serverId} />, [serverId]);
  return (
    <MenuItem selected={selected} showSelectedCheck trailing={trailing} onSelect={onSelect}>
      {label}
    </MenuItem>
  );
}

function HostSettingsItem({ serverId }: { serverId: string }) {
  const onSelect = useCallback(() => openHostSettings(serverId), [serverId]);
  return (
    <MenuItem leading={SERVER_ICON} onSelect={onSelect}>
      {COPY.hostSettings}
    </MenuItem>
  );
}

export function ProjectCrumb({ activeProject }: { activeProject: string | null }) {
  const { t } = useTranslation();
  const scopeServerId = useMonoScope((state) => state.serverId);
  const scopeProject = useMonoScope((state) => state.projectName);
  const setProjectName = useMonoScope((state) => state.setProjectName);
  const openAddProject = useOpenAddProject();
  const projects = useProjectIndex(scopeServerId);
  const current = activeProject ?? scopeProject;
  const selectAll = useCallback(() => setProjectName(null), [setProjectName]);
  const addProject = useCallback(
    () => openAddProject(scopeServerId ?? undefined),
    [openAddProject, scopeServerId],
  );

  return (
    <MenuRoot compactMode="sheet">
      <Crumb label={current ?? COPY.allProjects} testID="mono-crumb-project" />
      <MenuSurface side="bottom" align="start" width={280} sheetTitle={COPY.projects} scrollable>
        <MenuLabel>{COPY.projects}</MenuLabel>
        <MenuItem selected={current === null} showSelectedCheck onSelect={selectAll}>
          {COPY.allProjects}
        </MenuItem>
        {projects.map((project) => (
          <ProjectItem key={project.name} project={project} selected={project.name === current} />
        ))}
        <MenuSeparator />
        <MenuItem leading={ADD_PROJECT_ICON} onSelect={addProject}>
          {t("sidebar.actions.addProject")}
        </MenuItem>
      </MenuSurface>
    </MenuRoot>
  );
}

function ProjectItem({ project, selected }: { project: MonoProject; selected: boolean }) {
  const setProjectName = useMonoScope((state) => state.setProjectName);
  const onSelect = useCallback(() => {
    setProjectName(project.name);
    router.push(buildOpenProjectRoute());
  }, [project.name, setProjectName]);
  const trailing = useMemo(
    () => <MonoText tone="faint">{project.workspaces.length}</MonoText>,
    [project.workspaces.length],
  );
  return (
    <MenuItem selected={selected} showSelectedCheck trailing={trailing} onSelect={onSelect}>
      {project.name}
    </MenuItem>
  );
}

export function WorkspaceCrumb({
  serverId,
  workspace,
}: {
  serverId: string;
  workspace: WorkspaceDescriptor;
}) {
  const projects = useProjectIndex(serverId);
  const siblings = useMemo(
    () =>
      projects.find((project) => project.workspaces.some((entry) => entry.id === workspace.id))
        ?.workspaces ?? [workspace],
    [projects, workspace],
  );
  const label = workspace.gitRuntime?.currentBranch?.trim() || workspace.name;

  return (
    <MenuRoot compactMode="sheet">
      <Crumb label={label} mono testID="mono-crumb-workspace" />
      <MenuSurface side="bottom" align="start" width={300} sheetTitle={COPY.branches} scrollable>
        <MenuLabel>{COPY.branches}</MenuLabel>
        {siblings.map((entry) => (
          <WorkspaceItem
            key={entry.id}
            serverId={serverId}
            workspace={entry}
            selected={entry.id === workspace.id}
          />
        ))}
      </MenuSurface>
    </MenuRoot>
  );
}

function WorkspaceItem({
  serverId,
  workspace,
  selected,
}: {
  serverId: string;
  workspace: WorkspaceDescriptor;
  selected: boolean;
}) {
  const onSelect = useCallback(
    () => navigateToWorkspace({ serverId, workspaceId: workspace.id }),
    [serverId, workspace.id],
  );
  const bucket = bucketOfWorkspace(workspace);
  const leading = useMemo(() => <StatusDot bucket={bucket} />, [bucket]);
  return (
    <MenuItem selected={selected} showSelectedCheck leading={leading} onSelect={onSelect}>
      {workspace.gitRuntime?.currentBranch?.trim() || workspace.name}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  crumb: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    height: 32,
    paddingHorizontal: 8,
    borderRadius: 6,
    minWidth: 0,
    flexShrink: 1,
  },
  crumbHovered: {
    backgroundColor: theme.colors.surface2,
  },
  crumbText: {
    color: theme.colors.foreground,
    fontSize: 14,
    fontWeight: "500",
    flexShrink: 1,
  },
  slash: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: 20,
    fontWeight: "200",
    marginHorizontal: 2,
  },
}));
