import { useCallback } from "react";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ArrowRight, ChevronDown, Folder, FolderPlus, GitBranch, MessageSquare } from "lucide-react-native";
import { MenuItem, MenuLabel, MenuRoot, MenuSeparator, MenuSurface, MenuTrigger } from "@/components/ui/menu";
import type { MenuTriggerState } from "@/components/ui/menu";
import type { ProjectDescriptor } from "@/stores/session-store";
import type { Theme } from "@/styles/theme";

const ICON = 13;
const mutedIcon = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedFolder = withUnistyles(Folder);
const ThemedChevron = withUnistyles(ChevronDown);
const ThemedBranch = withUnistyles(GitBranch);
const ThemedArrow = withUnistyles(ArrowRight);
const ThemedChat = withUnistyles(MessageSquare);
const ThemedFolderPlus = withUnistyles(FolderPlus);
const CHAT_ICON = <ThemedChat size={ICON} uniProps={mutedIcon} />;
const FOLDER_ICON = <ThemedFolder size={ICON} uniProps={mutedIcon} />;
const ADD_ICON = <ThemedFolderPlus size={ICON} uniProps={mutedIcon} />;

export function projectLabel(project: ProjectDescriptor): string {
  return project.projectCustomName?.trim() || project.projectDisplayName;
}

/**
 * The chips under Devin's composer: which repo the chat runs in (or none, for a plain chat), the
 * branch that checkout is on, and a link out to the full New workspace screen for worktrees.
 * preview copy
 */
export function FocusRepoChips({
  projects,
  selected,
  branch,
  projectsEnabled,
  onSelect,
  onAddProject,
  onOpenWorktree,
}: {
  projects: ProjectDescriptor[];
  selected: ProjectDescriptor | null;
  branch: string | null;
  projectsEnabled: boolean;
  onSelect: (project: ProjectDescriptor | null) => void;
  onAddProject: () => void;
  onOpenWorktree: () => void;
}) {
  const handleChat = useCallback(() => onSelect(null), [onSelect]);
  const chipStyle = useCallback(
    ({ hovered, pressed, open }: MenuTriggerState) => [
      styles.chip,
      (hovered || pressed || open) && styles.chipActive,
    ],
    [],
  );
  const linkStyle = useCallback(
    ({ hovered }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.link,
      hovered && styles.linkHover,
    ],
    [],
  );
  return (
    <View style={styles.row}>
      <MenuRoot compactMode="sheet">
        <MenuTrigger style={chipStyle} accessibilityRole="button" testID="focus-repo-chip">
          {selected ? FOLDER_ICON : CHAT_ICON}
          <Text style={styles.chipText} numberOfLines={1}>
            {selected ? projectLabel(selected) : "No repository"}
          </Text>
          <ThemedChevron size={12} uniProps={mutedIcon} />
        </MenuTrigger>
        <MenuSurface side="bottom" align="start" width={260} sheetTitle="Repository">
          <MenuItem leading={CHAT_ICON} selected={selected === null} onSelect={handleChat}>
            No repository (chat)
          </MenuItem>
          {projectsEnabled && projects.length > 0 ? (
            <>
              <MenuSeparator />
              <MenuLabel>Projects</MenuLabel>
              {projects.map((project) => (
                <ProjectItem
                  key={project.projectId}
                  project={project}
                  selected={selected?.projectId === project.projectId}
                  onSelect={onSelect}
                />
              ))}
            </>
          ) : null}
          <MenuSeparator />
          <MenuItem leading={ADD_ICON} onSelect={onAddProject}>
            Add a project…
          </MenuItem>
        </MenuSurface>
      </MenuRoot>
      {selected && branch ? (
        <View style={styles.chip} testID="focus-branch-chip">
          <ThemedBranch size={ICON} uniProps={mutedIcon} />
          <Text style={styles.chipText} numberOfLines={1}>
            {branch}
          </Text>
        </View>
      ) : null}
      {selected ? (
        <Pressable style={linkStyle} onPress={onOpenWorktree} accessibilityRole="link">
          <Text style={styles.linkText}>New worktree</Text>
          <ThemedArrow size={12} uniProps={mutedIcon} />
        </Pressable>
      ) : null}
    </View>
  );
}

function ProjectItem({
  project,
  selected,
  onSelect,
}: {
  project: ProjectDescriptor;
  selected: boolean;
  onSelect: (project: ProjectDescriptor) => void;
}) {
  const handleSelect = useCallback(() => onSelect(project), [onSelect, project]);
  return (
    <MenuItem
      leading={FOLDER_ICON}
      description={project.projectRootPath}
      selected={selected}
      onSelect={handleSelect}
    >
      {projectLabel(project)}
    </MenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[1],
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    maxWidth: 260,
    height: 26,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  chipActive: {
    backgroundColor: theme.colors.surface2,
  },
  chipText: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    height: 26,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
  },
  linkHover: {
    backgroundColor: theme.colors.surface2,
  },
  linkText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
}));
