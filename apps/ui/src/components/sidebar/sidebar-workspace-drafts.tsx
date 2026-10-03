import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { FilePenLine, Trash2 } from "lucide-react-native";
import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import { buildNewWorkspaceDraftKey } from "@/stores/draft-keys";
import { useDraftStore } from "@/stores/draft-store";
import type { DraftRecord } from "@/stores/draft-store/state";
import {
  useNewWorkspaceNavigationStore,
  type NewWorkspaceNavigationDraft,
} from "@/stores/new-workspace-navigation-store";
import { buildNewWorkspaceRoute } from "@/utils/host-routes";
import type { WorkspaceStructureHostPlacement } from "@/projects/workspace-structure";
import type { Theme } from "@/styles/theme";
import { ICON_SIZE } from "@/styles/theme";
import { SidebarHeaderRow } from "./sidebar-header-row";

const ThemedTrash = withUnistyles(Trash2);
const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

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

/** A draft with nothing typed, attached or picked is not worth listing. */
export function isDraftEmpty(
  draft: NewWorkspaceNavigationDraft,
  input: DraftRecord | undefined,
): boolean {
  const hasInput =
    input?.lifecycle === "active" &&
    (input.input.text.trim().length > 0 || input.input.attachments.length > 0);
  return (
    !hasInput &&
    draft.terminalPromptText.trim().length === 0 &&
    draft.pickerSelection.selectedItem === null
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
  const draftInputs = useDraftStore((state) => state.drafts);
  const drafts = Object.fromEntries(
    Object.entries(allDrafts).filter(
      ([key, draft]) =>
        !isDraftEmpty(draft, draftInputs[key]) &&
        (project
          ? draftBelongsToProject(draft, project)
          : !projects?.some((candidate) => draftBelongsToProject(draft, candidate))),
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
  const isCompact = useIsCompactFormFactor();
  const [hovered, setHovered] = useState(false);
  const handlePointerEnter = useCallback(() => setHovered(true), []);
  const handlePointerLeave = useCallback(() => setHovered(false), []);
  const handleDiscard = useCallback(() => {
    useNewWorkspaceNavigationStore.getState().discard(draftKey);
    useDraftStore.getState().clearDraftInput({ draftKey, lifecycle: "abandoned" });
  }, [draftKey]);
  const label =
    draft.route.displayName && !nested
      ? `${t("sidebar.workspaceDraft")} · ${draft.route.displayName}`
      : t("sidebar.workspaceDraft");
  return (
    // The open draft cannot be discarded from here: its screen would re-remember it.
    <View
      style={styles.row}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    >
      <SidebarHeaderRow
        icon={FilePenLine}
        label={label}
        isActive={isActive}
        testID={`sidebar-workspace-draft-${draftKey}`}
        variant="compact"
        onPress={handlePress}
      />
      {!isActive && (hovered || isNative || isCompact) ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("sidebar.workspaceDraftDiscard")}
          onPress={handleDiscard}
          style={styles.discard}
          testID={`sidebar-workspace-draft-discard-${draftKey}`}
        >
          <ThemedTrash size={ICON_SIZE.sm} uniProps={foregroundMutedColorMapping} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    position: "relative",
    justifyContent: "center",
  },
  discard: {
    position: "absolute",
    right: theme.spacing[4],
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.md,
  },
}));
