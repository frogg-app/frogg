import type { Agent, ProjectDescriptor, WorkspaceDescriptor } from "@/stores/session-store";
import { deriveSidebarStateBucket, type SidebarStateBucket } from "@/utils/sidebar-agent-state";

// Pure derivations behind the Focus (Devin / Cursor) layout regions. Kept free of React and
// stores so the status wording and the checklist can be tested directly.

/** The colour family a status line is drawn in. */
export type FocusTone = "running" | "warning" | "danger" | "success" | "muted";

export interface FocusStatusLine {
  bucket: SidebarStateBucket;
  tone: FocusTone;
  /** The wording before any diff stat, e.g. "Working" or "Changes ready". */
  label: string;
  /** Additions/deletions to show after the label, when the chat's workspace has changes. */
  diff: { additions: number; deletions: number } | null;
  /** A blue unread dot: the agent finished something the user has not looked at yet. */
  unread: boolean;
  /** When the relative time should replace the label (a quiet, finished chat). */
  showTime: boolean;
}

type StatusAgent = Pick<
  Agent,
  "status" | "pendingPermissions" | "requiresAttention" | "attentionReason"
>;

function nonEmptyDiff(
  diff: WorkspaceDescriptor["diffStat"] | undefined,
): FocusStatusLine["diff"] {
  if (!diff || diff.additions + diff.deletions === 0) return null;
  return diff;
}

/**
 * Devin's coloured sub-line under each recent chat: what the agent is doing, or what it left.
 * preview copy
 */
export function describeFocusStatus(
  agent: StatusAgent,
  workspaceDiff: WorkspaceDescriptor["diffStat"] | undefined,
): FocusStatusLine {
  const bucket = deriveSidebarStateBucket({
    status: agent.status,
    pendingPermissionCount: agent.pendingPermissions.length,
    requiresAttention: agent.requiresAttention,
    attentionReason: agent.attentionReason ?? undefined,
  });
  const diff = nonEmptyDiff(workspaceDiff);
  const unread = agent.requiresAttention === true && agent.attentionReason === "finished";
  const base = { bucket, diff, unread, showTime: false };
  if (bucket === "needs_input") return { ...base, tone: "warning", label: "Needs input" };
  if (bucket === "failed") return { ...base, tone: "danger", label: "Failed" };
  if (bucket === "running") return { ...base, tone: "running", label: "Working…" };
  if (diff) return { ...base, tone: "success", label: "Changes ready" };
  if (bucket === "attention") return { ...base, tone: "success", label: "Task completed" };
  return { ...base, tone: "muted", label: "", showTime: true };
}

/** Top-level, unarchived chats, most recently active first. */
export function selectRecentAgents(
  agents: Iterable<Agent>,
  limit: number,
): Agent[] {
  const list: Agent[] = [];
  for (const agent of agents) {
    if (agent.parentAgentId || agent.archivedAt) continue;
    list.push(agent);
  }
  list.sort((a, b) => b.lastActivityAt.getTime() - a.lastActivityAt.getTime());
  return list.slice(0, limit);
}

/** The agents sharing a workspace, oldest first so cards keep their place as they update. */
export function selectWorkspaceAgents(
  agents: Iterable<Agent>,
  workspaceId: string | undefined,
): Agent[] {
  if (!workspaceId) return [];
  const list: Agent[] = [];
  for (const agent of agents) {
    if (agent.workspaceId !== workspaceId || agent.parentAgentId || agent.archivedAt) continue;
    list.push(agent);
  }
  list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  return list;
}

export function agentDisplayTitle(agent: Pick<Agent, "title" | "id">): string {
  const title = agent.title?.trim();
  return title && title.length > 0 ? title : "New chat"; // preview copy
}

/** "15s", "4m", "1h 3m": how long a running turn has been going. */
export function formatWorkingDuration(startedAt: Date, now: Date): string {
  const seconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

export type FocusChecklistStepId = "host" | "project" | "chat" | "scripts";

export interface FocusChecklistStep {
  id: FocusChecklistStepId;
  label: string;
  done: boolean;
}

export interface FocusChecklistInput {
  hostOnline: boolean;
  projects: Iterable<ProjectDescriptor>;
  workspaces: Iterable<WorkspaceDescriptor>;
  agentCount: number;
}

/**
 * Devin's "Get started" card, built from what the host already knows: connected, a project
 * added, a first chat run, and worktree scripts configured for some project.
 * preview copy
 */
export function buildFocusChecklist(input: FocusChecklistInput): FocusChecklistStep[] {
  let hasProject = false;
  for (const project of input.projects) {
    if (!project.chats) {
      hasProject = true;
      break;
    }
  }
  let hasScripts = false;
  for (const workspace of input.workspaces) {
    if (!workspace.chat && workspace.scripts.length > 0) {
      hasScripts = true;
      break;
    }
  }
  return [
    { id: "host", label: "Connect a host", done: input.hostOnline },
    { id: "project", label: "Add a project", done: hasProject },
    { id: "chat", label: "Run your first chat", done: input.agentCount > 0 },
    { id: "scripts", label: "Set up worktree scripts", done: hasScripts },
  ];
}

/** Real projects (not the chats container), most recently created first. */
export function selectFocusProjects(projects: Iterable<ProjectDescriptor>): ProjectDescriptor[] {
  const list = [...projects].filter((project) => !project.chats);
  list.sort((a, b) => (b.projectCreatedAt ?? "").localeCompare(a.projectCreatedAt ?? ""));
  return list;
}

/** The branch the project's root checkout is on, when a workspace reports it. */
export function resolveProjectBranch(
  project: Pick<ProjectDescriptor, "projectId" | "projectRootPath">,
  workspaces: Iterable<WorkspaceDescriptor>,
): string | null {
  let fallback: string | null = null;
  for (const workspace of workspaces) {
    if (workspace.projectId !== project.projectId) continue;
    const branch = workspace.gitRuntime?.currentBranch?.trim() || null;
    if (!branch) continue;
    if (workspace.workspaceDirectory === project.projectRootPath) return branch;
    fallback ??= branch;
  }
  return fallback;
}
