import { router, type Href } from "expo-router";
import { ChevronDown, ChevronLeft, Search, SquarePen } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import type { Theme } from "@/styles/theme";
import { buildNewChatRoute, buildOpenProjectRoute } from "@/utils/host-routes";
import { navigateToAgent } from "@/utils/navigate-to-agent";
import { deriveSidebarStateBucket } from "@/utils/sidebar-agent-state";
import { formatCompactTimeAgo } from "@/utils/time";
import { softStatusLabel, type SoftStatus } from "./soft-data";
import { SoftRoundButton } from "./soft-round-button";
import { SoftStatusIcon } from "./soft-status-icon";
import { softEdge, softRaised, SOFT_PILL } from "./soft-surface";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

interface AgentSummary {
  id: string;
  title: string;
  status: SoftStatus;
  model: string | null;
  lastActivityAt: number;
}

// preview copy
const UNTITLED = "New chat";

function summarize(agent: Agent): AgentSummary {
  return {
    id: agent.id,
    title: agent.title?.trim() || UNTITLED,
    status: deriveSidebarStateBucket({
      status: agent.status,
      requiresAttention: Boolean(agent.requiresAttention),
      attentionReason: agent.attentionReason ?? null,
      pendingPermissionCount: agent.pendingPermissions.length,
    }),
    model: agent.model,
    lastActivityAt: agent.lastActivityAt.getTime(),
  };
}

function sameSummaries(left: AgentSummary[], right: AgentSummary[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => {
      const other = right[index]!;
      return (
        item.id === other.id &&
        item.title === other.title &&
        item.status === other.status &&
        item.model === other.model &&
        item.lastActivityAt === other.lastActivityAt
      );
    })
  );
}

/** The agent and its live siblings in the same workspace, oldest first. */
function useWorkspaceAgents(serverId: string, agentId: string) {
  return useStoreWithEqualityFn(
    useSessionStore,
    (state) => {
      const agents = state.sessions[serverId]?.agents;
      const self = agents?.get(agentId);
      if (!agents || !self) return { workspaceId: null, agents: [] as AgentSummary[] };
      const siblings = self.workspaceId
        ? [...agents.values()].filter(
            (agent) => agent.workspaceId === self.workspaceId && !agent.archivedAt,
          )
        : [self];
      siblings.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      return { workspaceId: self.workspaceId ?? null, agents: siblings.map(summarize) };
    },
    (left, right) => left.workspaceId === right.workspaceId && sameSummaries(left.agents, right.agents),
  );
}

/**
 * The soft conversation header (ChatGPT/Perplexity iOS): a floating bar over the conversation
 * with the chat title and a ▾ that opens a card of this workspace's agents to switch between,
 * plus round icon buttons for search and a new chat.
 */
export function SoftConversationTop({ serverId, agentId }: { serverId: string; agentId: string }) {
  const { t } = useTranslation();
  const compact = useIsCompactFormFactor();
  const [open, setOpen] = useState(false);
  const { workspaceId, agents } = useWorkspaceAgents(serverId, agentId);
  const workspace = useWorkspace(serverId, workspaceId);
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const self = agents.find((agent) => agent.id === agentId);

  const toggle = useCallback(() => setOpen((value) => !value), []);
  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.navigate(buildOpenProjectRoute());
  }, []);
  const openSearch = useCallback(() => setCommandCenterOpen(true), [setCommandCenterOpen]);
  const newChat = useCallback(
    () => router.push(buildNewChatRoute(serverId) as Href),
    [serverId],
  );
  const pick = useCallback(
    (id: string) => {
      setOpen(false);
      if (id !== agentId) navigateToAgent({ serverId, agentId: id });
    },
    [agentId, serverId],
  );

  const place = useMemo(() => {
    if (!workspace || workspace.chat) return null;
    const project = workspace.projectCustomName?.trim() || workspace.projectDisplayName;
    const branch = workspace.gitRuntime?.currentBranch?.trim();
    return branch ? `${project} · ${branch}` : project;
  }, [workspace]);

  if (!self) return null;
  const subtitle = [softStatusLabel(self.status), place].filter(Boolean).join(" · ");

  return (
    <View style={styles.wrap} testID="soft-conversation-top">
      <View style={styles.bar}>
        <View style={compact ? styles.sideCompact : styles.side}>
          {compact ? (
            <SoftRoundButton icon={ChevronLeft} label={t("sidebar.actions.home")} onPress={goBack} />
          ) : null}
        </View>
        <Pressable
          onPress={toggle}
          style={compact ? titlePillCompactStyle() : styles.titlePill}
          accessibilityRole="button"
          accessibilityState={open ? EXPANDED : COLLAPSED}
          accessibilityLabel={self.title}
          testID="soft-conversation-title"
        >
          <SoftStatusIcon status={self.status} size={24} />
          <View style={styles.titleBody}>
            <View style={styles.titleLine}>
              <Text style={styles.title} numberOfLines={1}>
                {self.title}
              </Text>
              <ThemedChevronDown size={16} strokeWidth={2.4} uniProps={mutedMapping} />
            </View>
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          </View>
        </Pressable>
        <View style={compact ? styles.sideCompact : styles.actionsSide}>
          {compact ? null : (
            <SoftRoundButton icon={Search} label={t("sidebar.sections.search")} onPress={openSearch} />
          )}
          <SoftRoundButton icon={SquarePen} label={t("sidebar.chats.newChat")} onPress={newChat} />
        </View>
      </View>
      {open ? <AgentMenu agents={agents} currentId={agentId} onPick={pick} /> : null}
    </View>
  );
}

const EXPANDED = { expanded: true } as const;
const COLLAPSED = { expanded: false } as const;

function AgentMenu({
  agents,
  currentId,
  onPick,
}: {
  agents: AgentSummary[];
  currentId: string;
  onPick: (id: string) => void;
}) {
  return (
    <View style={styles.menu} testID="soft-conversation-menu">
      {agents.map((agent) => (
        <AgentMenuRow key={agent.id} agent={agent} current={agent.id === currentId} onPick={onPick} />
      ))}
    </View>
  );
}

function AgentMenuRow({
  agent,
  current,
  onPick,
}: {
  agent: AgentSummary;
  current: boolean;
  onPick: (id: string) => void;
}) {
  const press = useCallback(() => onPick(agent.id), [agent.id, onPick]);
  const meta = [agent.model, formatCompactTimeAgo(new Date(agent.lastActivityAt))]
    .filter(Boolean)
    .join(" · ");
  return (
    <Pressable
      onPress={press}
      style={current ? menuRowCurrentStyle() : styles.menuRow}
      accessibilityRole="menuitem"
    >
      <SoftStatusIcon status={agent.status} size={28} />
      <View style={styles.titleBody}>
        <Text style={styles.menuTitle} numberOfLines={1}>
          {agent.title}
        </Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {meta}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  wrap: {
    position: "relative",
    alignItems: "center",
    zIndex: 20,
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 4,
  },
  bar: {
    alignSelf: "stretch",
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  titlePill: {
    flexShrink: 1,
    maxWidth: 520,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingLeft: 8,
    paddingRight: 16,
    paddingVertical: 6,
    borderRadius: SOFT_PILL,
    ...softRaised(rt.themeName, "md"),
    ...softEdge(rt.themeName),
  },
  titleBody: {
    flexShrink: 1,
    minWidth: 0,
  },
  titleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  title: {
    flexShrink: 1,
    fontSize: 14.5,
    fontWeight: "700",
    color: theme.colors.foreground,
  },
  subtitle: {
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  side: {
    flex: 1,
    flexDirection: "row",
  },
  // Compact: the title takes the room between one round button on each side.
  sideCompact: {
    flexDirection: "row",
  },
  titlePillCompact: {
    flex: 1,
    maxWidth: undefined,
  },
  actionsSide: {
    flex: 1,
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  menu: {
    position: "absolute",
    top: 62,
    alignSelf: "center",
    width: 320,
    padding: 6,
    gap: 2,
    borderRadius: 22,
    ...softRaised(rt.themeName, "lg"),
    ...softEdge(rt.themeName),
  },
  menuRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 16,
  },
  menuRowCurrent: {
    backgroundColor: theme.colors.surface2,
  },
  menuTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: theme.colors.foreground,
  },
}));

// Composed at render: reading style proxies at module scope is not allowed.
const titlePillCompactStyle = () => [styles.titlePill, styles.titlePillCompact];
const menuRowCurrentStyle = () => [styles.menuRow, styles.menuRowCurrent];
