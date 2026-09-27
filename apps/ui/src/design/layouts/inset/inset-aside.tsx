import { router } from "expo-router";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { useCallback, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { STATUS_BUCKET_LABELS } from "@/hooks/sidebar-status-view-model";
import { providerAccountLabel } from "@/provider-accounts/provider-labels";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";
import type { Theme } from "@/styles/theme";
import { buildHostAgentDetailRoute } from "@/utils/host-routes";
import { formatTimeAgo } from "@/utils/time";
import { INSET_COPY } from "./copy";
import { useWorkspaceAgents, type InsetAgentSummary } from "./use-workspace-agents";
import { InsetStatusGlyph } from "./status-glyph";

type HoverState = PressableStateCallbackType & { hovered?: boolean };

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const ThemedDown = withUnistyles(ChevronDown);
const ThemedRight = withUnistyles(ChevronRight);
const DOWN_ICON = <ThemedDown size={11} uniProps={mutedMapping} />;
const RIGHT_ICON = <ThemedRight size={11} uniProps={mutedMapping} />;

const ASIDE_WIDTH = 272;

function formatDate(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Linear's issue properties rail beside a workspace: small labelled sections for the session's
 * status, its agent's model and provider, branch, changes and dates, then the agents in it.
 * Renders nothing off a workspace route.
 */
export function InsetAside() {
  const selection = useActiveWorkspaceSelection();
  if (!selection) return null;
  return <WorkspaceProperties serverId={selection.serverId} workspaceId={selection.workspaceId} />;
}

function WorkspaceProperties({ serverId, workspaceId }: { serverId: string; workspaceId: string }) {
  const workspace = useWorkspace(serverId, workspaceId);
  const agents = useWorkspaceAgents(serverId, workspaceId);
  const openAgent = useCallback(
    (agentId: string) => router.push(buildHostAgentDetailRoute(serverId, agentId, workspaceId)),
    [serverId, workspaceId],
  );
  if (!workspace) return null;
  return (
    <ScrollView
      style={styles.aside}
      contentContainerStyle={styles.asideContent}
      testID="inset-aside"
    >
      <PropertiesSection workspace={workspace} primary={agents[0] ?? null} />
      {workspace.chat ? null : (
        <Section title={INSET_COPY.project}>
          <Property label={INSET_COPY.project}>
            <Text style={styles.value} numberOfLines={1}>
              {workspace.projectCustomName || workspace.projectDisplayName}
            </Text>
          </Property>
          <Property label={INSET_COPY.directory}>
            <Text style={styles.valueMono} numberOfLines={1} dataSet={CODE_SURFACE_DATASET}>
              {workspace.workspaceDirectory || INSET_COPY.none}
            </Text>
          </Property>
        </Section>
      )}
      {agents.length > 0 ? (
        <Section title={INSET_COPY.agents}>
          {agents.map((agent) => (
            <AgentItem key={agent.id} agent={agent} onOpen={openAgent} />
          ))}
        </Section>
      ) : null}
    </ScrollView>
  );
}

function PropertiesSection({
  workspace,
  primary,
}: {
  workspace: WorkspaceDescriptor;
  primary: InsetAgentSummary | null;
}) {
  const branch = workspace.gitRuntime?.currentBranch?.trim() || null;
  const lastActive = workspace.activityAt ? new Date(workspace.activityAt) : null;
  return (
    <Section title={INSET_COPY.properties}>
      <Property label={INSET_COPY.status}>
        <View style={styles.inline}>
          <InsetStatusGlyph bucket={workspace.status} />
          <Text style={styles.value}>{STATUS_BUCKET_LABELS[workspace.status]}</Text>
        </View>
      </Property>
      <Property label={INSET_COPY.model}>
        <OptionalValue value={primary?.model ?? null} />
      </Property>
      <Property label={INSET_COPY.provider}>
        <OptionalValue value={primary ? providerAccountLabel(primary.provider) : null} />
      </Property>
      <Property label={INSET_COPY.branch}>
        <OptionalValue value={branch} mono />
      </Property>
      <Property label={INSET_COPY.changes}>
        <Changes diffStat={workspace.diffStat} />
      </Property>
      <Property label={INSET_COPY.created}>
        <OptionalValue value={formatDate(workspace.createdAt)} />
      </Property>
      {lastActive && Number.isFinite(lastActive.getTime()) ? (
        <Property label={INSET_COPY.lastActive}>
          <Text style={styles.value}>{formatTimeAgo(lastActive)}</Text>
        </Property>
      ) : null}
    </Section>
  );
}

function OptionalValue({ value, mono = false }: { value: string | null; mono?: boolean }) {
  if (!value) return <Text style={styles.valueMuted}>{INSET_COPY.none}</Text>;
  return (
    <Text
      style={mono ? styles.valueMono : styles.value}
      numberOfLines={1}
      dataSet={mono ? CODE_SURFACE_DATASET : undefined}
    >
      {value}
    </Text>
  );
}

function Changes({ diffStat }: { diffStat: WorkspaceDescriptor["diffStat"] }) {
  if (!diffStat || (diffStat.additions === 0 && diffStat.deletions === 0)) {
    return <Text style={styles.valueMuted}>{INSET_COPY.noChanges}</Text>;
  }
  return (
    <View style={styles.inline}>
      <Text style={styles.diffAdd}>+{diffStat.additions}</Text>
      <Text style={styles.diffDel}>−{diffStat.deletions}</Text>
    </View>
  );
}

function sectionHeaderStyle({ hovered }: HoverState) {
  return [styles.sectionHeader, Boolean(hovered) && styles.sectionHeaderHovered];
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(true);
  const toggle = useCallback(() => setOpen((value) => !value), []);
  return (
    <View style={styles.card}>
      <Pressable
        onPress={toggle}
        style={sectionHeaderStyle}
        accessibilityRole="button"
        accessibilityState={open ? EXPANDED : COLLAPSED}
      >
        <Text style={styles.sectionTitle}>{title}</Text>
        {open ? DOWN_ICON : RIGHT_ICON}
      </Pressable>
      {open ? <View style={styles.sectionBody}>{children}</View> : null}
    </View>
  );
}

const EXPANDED = { expanded: true } as const;
const COLLAPSED = { expanded: false } as const;

function Property({ label, children }: { label: string; children: ReactNode }) {
  return (
    <View style={styles.property}>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      <View style={styles.propertyValue}>{children}</View>
    </View>
  );
}

function agentRowStyle({ hovered }: HoverState) {
  return [styles.agentRow, Boolean(hovered) && styles.sectionHeaderHovered];
}

function AgentItem({
  agent,
  onOpen,
}: {
  agent: InsetAgentSummary;
  onOpen: (agentId: string) => void;
}) {
  const handlePress = useCallback(() => onOpen(agent.id), [agent.id, onOpen]);
  return (
    <Pressable onPress={handlePress} style={agentRowStyle} accessibilityRole="button">
      <InsetStatusGlyph bucket={agent.bucket} size={13} />
      <View style={styles.agentText}>
        <Text style={styles.value} numberOfLines={1}>
          {agent.title ?? providerAccountLabel(agent.provider)}
        </Text>
        <Text style={styles.agentMeta} numberOfLines={1}>
          {[providerAccountLabel(agent.provider), agent.model].filter(Boolean).join(" · ")}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  aside: {
    width: ASIDE_WIDTH,
    flexGrow: 0,
    flexShrink: 0,
  },
  // The frame row already holds the column off the window edges; only the gap to the content
  // card is ours.
  asideContent: {
    gap: 8,
    paddingLeft: 6,
  },
  card: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
    paddingVertical: 6,
  },
  sectionHeader: {
    height: 26,
    marginHorizontal: 6,
    paddingHorizontal: 6,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderRadius: 5,
  },
  sectionHeaderHovered: {
    backgroundColor: theme.colors.surface2,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: "500",
    color: theme.colors.foregroundMuted,
  },
  sectionBody: {
    paddingHorizontal: 12,
    paddingTop: 2,
    gap: 2,
  },
  property: {
    minHeight: 28,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  label: {
    width: 76,
    fontSize: 12,
    color: theme.colors.foregroundMuted,
  },
  propertyValue: {
    flex: 1,
    minWidth: 0,
  },
  inline: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  value: {
    fontSize: 13,
    color: theme.colors.foreground,
  },
  valueMuted: {
    fontSize: 13,
    color: theme.colors.foregroundExtraMuted,
  },
  valueMono: {
    fontSize: 12,
    fontFamily: theme.design.monoFontFamily,
    color: theme.colors.foreground,
  },
  diffAdd: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    color: theme.colors.diffAddition,
  },
  diffDel: {
    fontSize: 13,
    fontVariant: ["tabular-nums"],
    color: theme.colors.diffDeletion,
  },
  agentRow: {
    minHeight: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginHorizontal: -6,
    paddingHorizontal: 6,
    borderRadius: 5,
  },
  agentText: {
    flex: 1,
    minWidth: 0,
  },
  agentMeta: {
    fontSize: 11,
    color: theme.colors.foregroundMuted,
  },
}));
