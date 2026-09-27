import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { extractAgentModel } from "@/utils/extract-agent-model";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import type { DesignSlotProps } from "../slots";
import { useFocusAgents, useFocusWorkspaces } from "./focus-data";
import {
  agentDisplayTitle,
  describeFocusStatus,
  formatWorkingDuration,
  selectWorkspaceAgents,
  type FocusStatusLine,
  type FocusTone,
} from "./focus-model";

/**
 * Cursor's agent cards above a conversation: one card per agent in this workspace with its model,
 * title and live status ("Working for 15s", "Task completed"). Pressing a card switches to it.
 * preview copy
 */
export function FocusAgentCards({ serverId, agentId }: DesignSlotProps["conversationTop"]) {
  const agents = useFocusAgents(serverId);
  const workspaces = useFocusWorkspaces(serverId);
  const workspaceId = useSessionStore(
    (state) =>
      state.sessions[serverId]?.agents.get(agentId)?.workspaceId ??
      state.sessions[serverId]?.agentDetails.get(agentId)?.workspaceId,
  );
  const list = useMemo(
    () => selectWorkspaceAgents(agents.values(), workspaceId),
    [agents, workspaceId],
  );
  const diff = workspaceId ? workspaces.get(workspaceId)?.diffStat : undefined;
  const handleOpen = useCallback(
    (id: string) => {
      if (id !== agentId) navigateToAgent({ serverId, agentId: id, workspaceId });
    },
    [agentId, serverId, workspaceId],
  );
  if (list.length === 0) return null;
  return (
    <View style={styles.strip} testID="focus-agent-cards">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {list.map((agent) => (
          <AgentCard
            key={agent.id}
            agent={agent}
            diff={diff}
            selected={agent.id === agentId}
            onOpen={handleOpen}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const AgentCard = memo(function AgentCard({
  agent,
  diff,
  selected,
  onOpen,
}: {
  agent: Agent;
  diff: { additions: number; deletions: number } | null | undefined;
  selected: boolean;
  onOpen: (id: string) => void;
}) {
  const status = describeFocusStatus(agent, diff);
  const handlePress = useCallback(() => onOpen(agent.id), [agent.id, onOpen]);
  const cardStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.card,
      selected && styles.cardSelected,
      !selected && (hovered || pressed) && styles.cardHover,
    ],
    [selected],
  );
  const model = extractAgentModel(agent);
  return (
    <Pressable
      style={cardStyle}
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityState={selected ? SELECTED : UNSELECTED}
      testID={`focus-agent-card-${agent.id}`}
    >
      <View style={styles.statusRow}>
        <View style={dotStyle(status.tone)} />
        <StatusText agent={agent} status={status} />
        {status.diff ? (
          <Text style={styles.diff} numberOfLines={1}>
            <Text style={styles.additions}>{`+${status.diff.additions}`}</Text>
            {" "}
            <Text style={styles.deletions}>{`−${status.diff.deletions}`}</Text>
          </Text>
        ) : null}
      </View>
      <Text style={styles.title} numberOfLines={1}>
        {agentDisplayTitle(agent)}
      </Text>
      <Text style={styles.meta} numberOfLines={1}>
        {model ? `${agent.provider} · ${model}` : agent.provider}
      </Text>
    </Pressable>
  );
});

const SELECTED = { selected: true } as const;
const UNSELECTED = { selected: false } as const;

function StatusText({ agent, status }: { agent: Agent; status: FocusStatusLine }) {
  if (status.tone === "running") {
    const startedAt = agent.activeTurn?.startedAt ?? null;
    return startedAt ? (
      <WorkingFor startedAt={startedAt} />
    ) : (
      <Text style={styles.status}>Working…</Text>
    );
  }
  if (status.tone === "success") return <Text style={styles.status}>Task completed</Text>;
  if (status.label) return <Text style={styles.status}>{status.label}</Text>;
  return <IdleSince date={agent.lastActivityAt} />;
}

function WorkingFor({ startedAt }: { startedAt: Date }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const handle = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(handle);
  }, []);
  return (
    <Text style={styles.status} numberOfLines={1}>
      {`Working for ${formatWorkingDuration(startedAt, now)}`}
    </Text>
  );
}

function IdleSince({ date }: { date: Date }) {
  const label = useCompactTimeAgo(date);
  return (
    <Text style={styles.status} numberOfLines={1}>
      {label === "now" ? "Idle" : `Idle · ${label}`}
    </Text>
  );
}

function dotStyle(tone: FocusTone) {
  if (tone === "running") return styles.dotRunning;
  if (tone === "warning") return styles.dotWarning;
  if (tone === "danger") return styles.dotDanger;
  if (tone === "success") return styles.dotSuccess;
  return styles.dotMuted;
}

const dot = { width: 6, height: 6, borderRadius: 3 } as const;

const styles = StyleSheet.create((theme) => ({
  strip: {
    width: "100%",
    paddingTop: theme.spacing[3],
    paddingBottom: theme.spacing[1],
  },
  row: {
    // Centred while the cards fit; scrolls from the left edge once they overflow.
    flexGrow: 1,
    justifyContent: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[4],
  },
  card: {
    width: 220,
    gap: 3,
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    borderRadius: theme.borderRadius.lg,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  cardHover: {
    backgroundColor: theme.colors.surface1,
  },
  cardSelected: {
    borderColor: theme.colors.surface4,
    backgroundColor: theme.colors.surface1,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  status: {
    flexShrink: 1,
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  diff: {
    marginLeft: "auto",
    fontSize: theme.fontSize.sm,
  },
  additions: {
    color: theme.colors.statusDotSuccess,
  },
  deletions: {
    color: theme.colors.statusDotDanger,
  },
  title: {
    color: theme.colors.foreground,
    fontSize: 13,
    fontWeight: theme.fontWeight.medium,
  },
  meta: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
  },
  dotRunning: { ...dot, backgroundColor: theme.colors.statusDotRunning },
  dotWarning: { ...dot, backgroundColor: theme.colors.statusDotWarning },
  dotDanger: { ...dot, backgroundColor: theme.colors.statusDotDanger },
  dotSuccess: { ...dot, backgroundColor: theme.colors.statusDotSuccess },
  dotMuted: { ...dot, backgroundColor: theme.colors.foregroundExtraMuted },
}));
