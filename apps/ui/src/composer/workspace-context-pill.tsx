import { Text, View } from "react-native";
import { Folder, GitBranch } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { composerPillStyles } from "@/composer/pill-styles";
import { useWorkspaceFields } from "@/stores/session-store-hooks";
import type { Theme } from "@/styles/theme";
import { shortenPath } from "@/utils/shorten-path";

const ThemedFolder = withUnistyles(Folder);
const ThemedGitBranch = withUnistyles(GitBranch);
const iconColor = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Persistent, read-only identity for the checkout the composer will use. */
export function WorkspaceContextPills({
  serverId,
  workspaceId,
  cwd,
}: {
  serverId: string;
  workspaceId: string;
  cwd: string;
}) {
  const workspace = useWorkspaceFields(serverId, workspaceId, (value) => ({
    directory:
      value.workspaceKind === "worktree" || value.worktreeSlug
        ? value.projectRootPath
        : value.workspaceDirectory,
    branch: value.gitRuntime?.currentBranch ?? null,
  }));
  const directory = shortenPath(workspace?.directory || cwd);
  const branch = normalizeBranch(workspace?.branch) ?? "—";

  return (
    <>
      <View
        accessible
        accessibilityLabel={directory}
        style={[composerPillStyles.body, styles.directoryPill]}
        testID="composer-workspace-directory"
      >
        <ThemedFolder size={14} uniProps={iconColor} />
        <Text numberOfLines={1} style={composerPillStyles.label}>
          {directory}
        </Text>
      </View>
      <View
        accessible
        accessibilityLabel={branch}
        style={composerPillStyles.body}
        testID="composer-workspace-branch"
      >
        <ThemedGitBranch size={14} uniProps={iconColor} />
        <Text numberOfLines={1} style={composerPillStyles.label}>
          {branch}
        </Text>
      </View>
    </>
  );
}

function normalizeBranch(value: string | null | undefined): string | null {
  const branch = value?.trim();
  return branch && branch !== "HEAD" ? branch : null;
}

// The row now scrolls horizontally (see `ComposerTrackBar`) instead of shrinking pills to fit, so
// the directory pill no longer needs its own shrink/clamp — it renders at its natural width like
// every other pill in the row.
const styles = StyleSheet.create({
  directoryPill: {},
});
