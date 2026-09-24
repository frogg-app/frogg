import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { FilePenLine } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { buildNewWorkspaceDraftKey } from "@/stores/draft-keys";
import {
  useNewWorkspaceNavigationStore,
  type NewWorkspaceNavigationDraft,
} from "@/stores/new-workspace-navigation-store";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import type { WorkspaceStructureHostPlacement } from "@/projects/workspace-structure";
import { SidebarHeaderRow } from "./sidebar-header-row";

interface DraftProjectScope {
  hosts: readonly Pick<
    WorkspaceStructureHostPlacement,
    "serverId" | "projectId" | "iconWorkingDir"
  >[];
}

export function draftBelongsToProject(
  draft: NewWorkspaceNavigationDraft,
  project: DraftProjectScope,
): boolean {
  const { serverId, projectId, sourceDirectory } = draft.route;
  return project.hosts.some(
    (host) =>
      (!serverId || host.serverId === serverId) &&
      ((projectId !== undefined && host.projectId === projectId) ||
        (sourceDirectory !== undefined && host.iconWorkingDir === sourceDirectory)),
  );
}

/**
 * Drafts render inside the project they target; pass `project` for that block's drafts,
 * or `projects` at the top level to show only drafts no listed project claims.
 */
export function SidebarWorkspaceDrafts({
  onBeforeNavigate,
  project,
  projects,
}: {
  onBeforeNavigate?: () => void;
  project?: DraftProjectScope;
  projects?: readonly DraftProjectScope[];
}) {
  const allDrafts = useNewWorkspaceNavigationStore((state) => state.drafts);
  const drafts = Object.fromEntries(
    Object.entries(allDrafts).filter(([, draft]) =>
      project
        ? draftBelongsToProject(draft, project)
        : !projects?.some((candidate) => draftBelongsToProject(draft, candidate)),
    ),
  );
  const pathname = usePathname();
  const params = useGlobalSearchParams<{ draftId?: string }>();
  const activeKey = buildNewWorkspaceDraftKey(
    typeof params.draftId === "string" ? params.draftId : undefined,
  );
  if (Object.keys(drafts).length === 0) return null;
  return (
    <View>
      {Object.entries(drafts).map(([key, draft]) => (
        <DraftRow
          key={key}
          draftKey={key}
          draft={draft}
          isActive={pathname === "/new" && activeKey === key}
          nested={project !== undefined}
          onBeforeNavigate={onBeforeNavigate}
        />
      ))}
    </View>
  );
}

function DraftRow({
  draftKey,
  draft,
  isActive,
  nested,
  onBeforeNavigate,
}: {
  draftKey: string;
  draft: NewWorkspaceNavigationDraft;
  isActive: boolean;
  nested: boolean;
  onBeforeNavigate?: () => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.navigate(buildNewWorkspaceRoute({ ...draft.route, resumeDraft: true }));
  }, [draft.route, onBeforeNavigate]);
  const label =
    draft.route.displayName && !nested
      ? `${t("sidebar.workspaceDraft")} · ${draft.route.displayName}`
      : t("sidebar.workspaceDraft");
  return (
    <SidebarHeaderRow
      icon={FilePenLine}
      label={label}
      isActive={isActive}
      testID={`sidebar-workspace-draft-${draftKey}`}
      variant="compact"
      onPress={handlePress}
    />
  );
}
