import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { router, type Href } from "expo-router";
import { useTranslation } from "react-i18next";
import { Composer } from "@/composer";
import { TitlebarDragRegion } from "@/components/desktop/titlebar-drag-region";
import { MenuHeader } from "@/components/headers/menu-header";
import { BrandLogo } from "@/components/icons/brand-logo";
import { useDemoChatRoute } from "@/design/use-demo-chat-route";
import { openAddHostFlow } from "@/hosts/add-host-flow";
import { useOpenAddProject } from "@/hooks/use-open-add-project";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { usePanelStore } from "@/stores/panel-store";
import type { ProjectDescriptor } from "@/stores/session-store";
import { DESIGN_FONT_DATASET } from "@/styles/code-surface";
import {
  buildNewWorkspaceRoute,
  buildProjectSettingsRoute,
  buildProjectsSettingsRoute,
} from "@/utils/host-routes";
import { useFocusAgents, useFocusProjects, useFocusServerId, useFocusWorkspaces } from "./focus-data";
import { FocusChecklist } from "./focus-checklist";
import {
  buildFocusChecklist,
  resolveProjectBranch,
  selectFocusProjects,
  type FocusChecklistStepId,
} from "./focus-model";
import { FocusRepoChips, projectLabel } from "./focus-repo-chips";
import { useFocusStartChat } from "./use-focus-start-chat";

/**
 * The Focus home, after Devin's new-session screen: one big centred composer that starts a chat,
 * repo and branch chips under it, and a "Get started" checklist built from the host's state.
 * preview copy
 */
export function FocusHome() {
  const serverId = useFocusServerId();
  const isCompact = useIsCompactFormFactor();
  const openDesktopSidebar = usePanelStore((state) => state.openDesktopAgentList);
  // Like the shipping home: the sidebar is where you go next, so open it on desktop.
  useEffect(() => {
    if (!isCompact) openDesktopSidebar();
  }, [isCompact, openDesktopSidebar]);
  return (
    <View style={styles.container} testID="focus-home">
      <MenuHeader borderless />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <TitlebarDragRegion />
        <View style={styles.column}>
          <View style={styles.brandRow}>
            <BrandLogo size={24} />
            <Text style={styles.heading} dataSet={DESIGN_FONT_DATASET} accessibilityRole="header">
              What should we work on?
            </Text>
          </View>
          {serverId ? (
            <FocusHomeComposer key={serverId} serverId={serverId} />
          ) : (
            <Text style={styles.noHost}>Connect a host to start a chat.</Text>
          )}
          <FocusHomeChecklist serverId={serverId} />
        </View>
      </ScrollView>
    </View>
  );
}

function FocusHomeComposer({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const openAddProject = useOpenAddProject();
  const projectsById = useFocusProjects(serverId);
  const workspaces = useFocusWorkspaces(serverId);
  const projects = useMemo(() => selectFocusProjects(projectsById.values()), [projectsById]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const project: ProjectDescriptor | null =
    (selectedId && projectsById.get(selectedId)) || null;
  const branch = useMemo(
    () => (project ? resolveProjectBranch(project, workspaces.values()) : null),
    [project, workspaces],
  );
  const { draft, agentControls, submit, isPending, supportsLocalWorkspaces } = useFocusStartChat({
    serverId,
    project,
  });

  const handleSelect = useCallback((next: ProjectDescriptor | null) => {
    setSelectedId(next?.projectId ?? null);
  }, []);
  const handleAddProject = useCallback(() => openAddProject(serverId), [openAddProject, serverId]);
  const handleOpenWorktree = useCallback(() => {
    if (!project) return;
    router.push(
      buildNewWorkspaceRoute({
        serverId,
        projectId: project.projectId,
        sourceDirectory: project.projectRootPath,
        displayName: projectLabel(project),
        isolation: "worktree",
      }) as Href,
    );
  }, [project, serverId]);

  return (
    <View style={styles.composerBlock}>
      <Composer
        externalKeyboardShift
        agentId={FOCUS_COMPOSER_ID}
        placeholder={project ? `Ask about ${projectLabel(project)}, or describe a change` : t("newChat.placeholder")}
        serverId={serverId}
        isPaneFocused={true}
        onSubmitMessage={submit}
        submitButtonAccessibilityLabel={t("newChat.send")}
        submitButtonTestID="focus-home-submit"
        isSubmitLoading={isPending}
        submitBehavior="preserve-and-lock"
        blurOnSubmit={true}
        value={draft.text}
        onChangeText={draft.editText}
        textReplacement={draft.textReplacement}
        attachments={draft.attachments}
        onChangeAttachments={draft.setAttachments}
        cwd={project?.projectRootPath ?? ""}
        clearDraft={draft.clear}
        autoFocus
        agentControls={agentControls}
      />
      <FocusRepoChips
        projects={projects}
        selected={project}
        branch={branch}
        projectsEnabled={supportsLocalWorkspaces}
        onSelect={handleSelect}
        onAddProject={handleAddProject}
        onOpenWorktree={handleOpenWorktree}
      />
    </View>
  );
}

const FOCUS_COMPOSER_ID = "focus-home";

function FocusHomeChecklist({ serverId }: { serverId: string | null }) {
  const [dismissed, setDismissed] = useState(false);
  const isConnected = useHostRuntimeIsConnected(serverId ?? "");
  const agents = useFocusAgents(serverId);
  const projectsById = useFocusProjects(serverId);
  const workspaces = useFocusWorkspaces(serverId);
  const openAddProject = useOpenAddProject();
  const latestChatRoute = useDemoChatRoute();
  const steps = useMemo(
    () =>
      buildFocusChecklist({
        hostOnline: serverId !== null && isConnected,
        projects: projectsById.values(),
        workspaces: workspaces.values(),
        agentCount: agents.size,
      }),
    [agents.size, isConnected, projectsById, serverId, workspaces],
  );
  const handleStep = useCallback(
    (id: FocusChecklistStepId) => {
      if (id === "host") {
        openAddHostFlow("direct");
      } else if (id === "project") {
        openAddProject(serverId ?? undefined);
      } else if (id === "chat") {
        if (latestChatRoute) router.navigate(latestChatRoute as Href);
      } else if (serverId) {
        const first = selectFocusProjects(projectsById.values())[0];
        router.push(
          first
            ? buildProjectSettingsRoute(serverId, first.projectId)
            : buildProjectsSettingsRoute(serverId),
        );
      }
    },
    [latestChatRoute, openAddProject, projectsById, serverId],
  );
  const handleDismiss = useCallback(() => setDismissed(true), []);
  if (dismissed) return null;
  return <FocusChecklist steps={steps} onStep={handleStep} onDismiss={handleDismiss} />;
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: { xs: "flex-start", md: "center" },
    paddingHorizontal: { xs: theme.spacing[3], md: theme.spacing[6] },
    paddingTop: { xs: theme.spacing[6], md: theme.spacing[8] },
    paddingBottom: { xs: theme.spacing[8], md: theme.spacing[16] },
  },
  column: {
    width: "100%",
    maxWidth: 680,
    gap: theme.spacing[6],
  },
  brandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  heading: {
    color: theme.colors.foreground,
    fontSize: { xs: 18, md: 20 },
    fontWeight: theme.fontWeight.semibold,
    fontFamily: theme.design.headingFontFamily,
    letterSpacing: -0.3,
  },
  composerBlock: {
    gap: theme.spacing[2],
    marginTop: -theme.spacing[3],
  },
  noHost: {
    color: theme.colors.foregroundMuted,
    fontSize: 13,
    paddingHorizontal: theme.spacing[2],
  },
}));
