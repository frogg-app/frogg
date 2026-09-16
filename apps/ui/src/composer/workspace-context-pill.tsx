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
export function WorkspaceContextPill({
  serverId,
  workspaceId,
  cwd,
}: {
  serverId: string;
  workspaceId: string;
  cwd: string;
}) {
  const workspace = useWorkspaceFields(serverId, workspaceId, (value) => ({
    directory: value.workspaceDirectory,
    branch: value.gitRuntime?.currentBranch ?? null,
  }));
  const directory = shortenPath(workspace?.directory || cwd);
  const branch = normalizeBranch(workspace?.branch) ?? "—";

  return (
    <View
      accessible
      accessibilityLabel={[directory, branch].filter(Boolean).join(", ")}
      style={[composerPillStyles.body, styles.body]}
      testID="composer-workspace-context"
    >
      <View style={styles.segment}>
        <ThemedFolder size={14} uniProps={iconColor} />
        <Text numberOfLines={1} style={composerPillStyles.label}>
          {directory}
        </Text>
      </View>
      <View style={styles.segment}>
        <ThemedGitBranch size={14} uniProps={iconColor} />
        <Text numberOfLines={1} style={composerPillStyles.label}>
          {branch}
        </Text>
      </View>
    </View>
  );
}

function normalizeBranch(value: string | null | undefined): string | null {
  const branch = value?.trim();
  return branch && branch !== "HEAD" ? branch : null;
}

const styles = StyleSheet.create((theme) => ({
  body: {
    flexShrink: 1,
    minWidth: 0,
    maxWidth: "100%",
  },
  segment: {
    alignItems: "center",
    flexDirection: "row",
    flexShrink: 1,
    gap: theme.spacing[1],
    minWidth: 0,
  },
}));
