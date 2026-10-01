import { GitBranch } from "lucide-react-native";
import { ScrollView, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useIsCompactFormFactor } from "@/constants/layout";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";
import { useWorkspaceAgents } from "./use-workspace-agents";
import { InsetStatusGlyph } from "./status-glyph";

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedBranch = withUnistyles(GitBranch);
const BRANCH_ICON = <ThemedBranch size={11} uniProps={mutedMapping} />;

/**
 * Linear mobile's property pills under an issue title. Compact only: on wide layouts the
 * properties rail beside the workspace carries the same facts.
 */
export function InsetConversationTop({ serverId, agentId }: { serverId: string; agentId: string }) {
  const compact = useIsCompactFormFactor();
  if (!compact) return null;
  return <PropertyPills serverId={serverId} agentId={agentId} />;
}

function PropertyPills({ serverId, agentId }: { serverId: string; agentId: string }) {
  const workspaceId = useStoreWithEqualityFn(
    useSessionStore,
    (state) => state.sessions[serverId]?.agents.get(agentId)?.workspaceId ?? null,
    Object.is,
  );
  const workspace = useWorkspace(serverId, workspaceId);
  const agents = useWorkspaceAgents(serverId, workspaceId ?? "");
  const agent = agents.find((candidate) => candidate.id === agentId) ?? null;
  if (!workspace || !agent) return null;
  const branch = workspace.gitRuntime?.currentBranch?.trim() || null;
  const diff = workspace.diffStat;
  const hasDiff = diff !== null && (diff.additions > 0 || diff.deletions > 0);
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.strip}
      contentContainerStyle={styles.stripContent}
      testID="inset-conversation-top"
    >
      <View style={styles.pill}>
        <InsetStatusGlyph bucket={agent.bucket} size={12} />
        <Text style={styles.pillText}>{STATUS_BUCKET_LABELS[agent.bucket]}</Text>
      </View>
      {agent.model ? (
        <View style={styles.pill}>
          <Text style={styles.pillText} numberOfLines={1}>
            {agent.model}
          </Text>
        </View>
      ) : null}
      {branch ? (
        <View style={styles.pill}>
          {BRANCH_ICON}
          <Text style={styles.pillMono} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
            {branch}
          </Text>
        </View>
      ) : null}
      {hasDiff ? (
        <View style={styles.pill}>
          <Text style={styles.diffAdd}>+{diff.additions}</Text>
          <Text style={styles.diffDel}>−{diff.deletions}</Text>
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  strip: {
    flexGrow: 0,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  stripContent: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  pill: {
    height: 24,
    maxWidth: 200,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface1,
  },
  pillText: {
    flexShrink: 1,
    fontSize: 12,
    color: theme.colors.foreground,
  },
  pillMono: {
    flexShrink: 1,
    fontSize: 11,
    fontFamily: theme.design.monoFontFamily,
    color: theme.colors.foregroundMuted,
  },
  diffAdd: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    color: theme.colors.diffAddition,
  },
  diffDel: {
    fontSize: 12,
    fontVariant: ["tabular-nums"],
    color: theme.colors.diffDeletion,
  },
}));
