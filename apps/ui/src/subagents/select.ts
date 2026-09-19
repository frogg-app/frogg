import { useCallback, useEffect, useMemo } from "react";
import { usePendingArchiveAgentIds } from "@/hooks/use-archive-agent";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useSessionStore, type Agent } from "@/stores/session-store";
import { refreshProviderSubagents, useProviderSubagentStore } from "./provider-store";
import type { ProviderSubagentDescriptorPayload } from "@frogg/protocol/messages";

/** How deep a row sits in the subagent tree. Top-level rows are 0; a workflow's children are 1. */
export type SubagentRowDepth = number;

export interface FroggSubagentRow {
  kind: "frogg";
  id: Agent["id"];
  provider: Agent["provider"];
  title: Agent["title"];
  /** Managed agents have a real title, so the union's task line is always absent for them. */
  description: null;
  subtitle: null;
  status: Agent["status"];
  requiresAttention: Agent["requiresAttention"];
  createdAt: Agent["createdAt"];
  /** Managed agents are never nested under another subagent. */
  parentSubagentId?: null;
  depth?: SubagentRowDepth;
}

export interface ProviderSubagentRow {
  kind: "provider";
  id: string;
  parentAgentId: string;
  provider: ProviderSubagentDescriptorPayload["provider"];
  // `title` is the subagent type ("Explore", "general-purpose") and repeats across a fan-out;
  // `description` is the task it was given. Both are carried so presentation can choose which
  // one names the row — collapsing them here is what makes every row read alike.
  title: string | null;
  description: string | null;
  /** Compact provider-owned context. The app displays it without interpreting its contents. */
  subtitle: string | null;
  status: ProviderSubagentDescriptorPayload["status"];
  requiresAttention: boolean;
  createdAt: Date;
  /**
   * The subagent this row runs underneath, when the provider nests its children — Claude's
   * Workflow rows own the agents their run fans out. Null, or an id with no row of its own, both
   * read as top level, so an orphan is still shown rather than silently dropped.
   */
  parentSubagentId?: string | null;
  depth?: SubagentRowDepth;
}

export type SubagentRow = FroggSubagentRow | ProviderSubagentRow;

type SessionStoreSnapshot = ReturnType<typeof useSessionStore.getState>;
type ProviderSubagentStoreSnapshot = ReturnType<typeof useProviderSubagentStore.getState>;

interface SelectSubagentsParams {
  serverId: string;
  parentAgentId: string;
}

const EMPTY_SUBAGENT_ROWS: SubagentRow[] = [];
const EMPTY_PROVIDER_SUBAGENT_ROWS: ProviderSubagentRow[] = [];

function toSubagentRow(agent: Agent): SubagentRow {
  return {
    kind: "frogg",
    id: agent.id,
    provider: agent.provider,
    title: agent.title,
    description: null,
    subtitle: null,
    status: agent.status,
    requiresAttention: agent.requiresAttention,
    createdAt: agent.createdAt,
  };
}

export function selectSubagentsForParent(
  state: SessionStoreSnapshot,
  params: SelectSubagentsParams,
  pendingArchiveIds: ReadonlySet<string>,
): SubagentRow[] {
  const agents = state.sessions[params.serverId]?.agents;
  if (!agents || agents.size === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  const rows: SubagentRow[] = [];
  for (const agent of agents.values()) {
    if (
      agent.archivedAt ||
      pendingArchiveIds.has(agent.id) ||
      agent.parentAgentId !== params.parentAgentId
    ) {
      continue;
    }
    rows.push(toSubagentRow(agent));
  }

  if (rows.length === 0) {
    return EMPTY_SUBAGENT_ROWS;
  }

  rows.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  return rows;
}

export function selectProviderSubagentsForParent(
  state: ProviderSubagentStoreSnapshot,
  params: SelectSubagentsParams,
  supported: boolean,
): ProviderSubagentRow[] {
  if (!supported) return EMPTY_PROVIDER_SUBAGENT_ROWS;
  const rows: ProviderSubagentRow[] = [];
  const prefix = `${params.serverId}\0${params.parentAgentId}\0`;
  for (const [key, subagent] of state.descriptors) {
    if (!key.startsWith(prefix) || state.hiddenFromTrack.has(key)) continue;
    rows.push({
      kind: "provider",
      id: subagent.id,
      parentAgentId: subagent.parentAgentId,
      provider: subagent.provider,
      title: subagent.title,
      description: subagent.description,
      subtitle: subagent.subtitle ?? null,
      status: subagent.status,
      requiresAttention: subagent.status === "failed",
      createdAt: new Date(subagent.createdAt),
      parentSubagentId: subagent.parentSubagentId ?? null,
    });
  }
  return orderSubagentRowsByParent(rows);
}

/**
 * Order rows so every child follows its own parent, and record how deep each one sits.
 *
 * A flat createdAt sort scatters a workflow's agents through the list by start time, which reads
 * as a fan-out of unrelated rows; ordering by parent is what makes the run legible as one unit.
 * Siblings keep the chronological order they would have had on their own.
 *
 * A row whose parent is not present — the parent was archived, or its descriptor has yet to
 * arrive — is treated as top level rather than hidden, and a parent cycle cannot strand a row
 * because every row is emitted exactly once, when its turn in the walk comes.
 */
export function orderSubagentRowsByParent<Row extends SubagentRow>(rows: readonly Row[]): Row[] {
  const byCreatedAt = [...rows].sort(
    (left, right) => left.createdAt.getTime() - right.createdAt.getTime(),
  );
  const present = new Set(byCreatedAt.map((row) => row.id));
  const childrenByParentId = new Map<string, Row[]>();
  const roots: Row[] = [];
  for (const row of byCreatedAt) {
    const parentId = row.parentSubagentId ?? null;
    // Self-parenting would otherwise make a row its own ancestor and drop it from the walk.
    if (!parentId || parentId === row.id || !present.has(parentId)) {
      roots.push(row);
      continue;
    }
    const siblings = childrenByParentId.get(parentId) ?? [];
    siblings.push(row);
    childrenByParentId.set(parentId, siblings);
  }

  const ordered: Row[] = [];
  const emitted = new Set<string>();
  const visit = (row: Row, depth: SubagentRowDepth): void => {
    if (emitted.has(row.id)) return;
    emitted.add(row.id);
    ordered.push((row.depth ?? 0) === depth ? row : { ...row, depth });
    for (const child of childrenByParentId.get(row.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  // Anything left is part of a parent cycle; it still belongs in the track, at the top level.
  for (const row of byCreatedAt) visit(row, 0);
  return ordered;
}

export function useSubagentsForParent(params: SelectSubagentsParams): SubagentRow[] {
  const pendingArchiveIds = usePendingArchiveAgentIds(params.serverId);
  const supported = useSessionStore(
    (state) => state.sessions[params.serverId]?.serverInfo?.features?.providerSubagents === true,
  );
  // useSyncExternalStoreWithSelector memoizes on the selector's identity, so an inline
  // arrow re-runs the whole selection on every render of this component rather than only
  // when the store changes. Both selectors walk every agent on the server and sort, then
  // deep-compare the result, so that is real work on an unrelated render -- a keystroke,
  // for instance. The params object is destructured so a fresh literal at the call site
  // does not defeat this either.
  const { serverId, parentAgentId } = params;
  const selectFroggRows = useCallback(
    (state: SessionStoreSnapshot) =>
      selectSubagentsForParent(state, { serverId, parentAgentId }, pendingArchiveIds),
    [serverId, parentAgentId, pendingArchiveIds],
  );
  const selectProviderRows = useCallback(
    (state: ProviderSubagentStoreSnapshot) =>
      selectProviderSubagentsForParent(state, { serverId, parentAgentId }, supported),
    [serverId, parentAgentId, supported],
  );
  const froggRows = useStoreWithEqualityFn(useSessionStore, selectFroggRows, equal);
  const providerRows = useStoreWithEqualityFn(useProviderSubagentStore, selectProviderRows, equal);
  const client = useSessionStore((state) => state.sessions[params.serverId]?.client ?? null);

  useEffect(() => {
    if (!client || !supported) return;
    void refreshProviderSubagents(client, params.serverId, params.parentAgentId).catch(
      () => undefined,
    );
  }, [client, params.parentAgentId, params.serverId, supported]);

  return useMemo(() => {
    if (providerRows.length === 0) return froggRows;
    return orderSubagentRowsByParent([...froggRows, ...providerRows]);
  }, [froggRows, providerRows]);
}
