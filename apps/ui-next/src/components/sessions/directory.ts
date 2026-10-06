import AsyncStorage from "@react-native-async-storage/async-storage";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { create } from "zustand";
import {
  archiveSession,
  getClient,
  onHostSwitch,
  useDaemon,
  type Project,
} from "../../daemon/store";
import type { Agent, Session } from "../../daemon/types";

/**
 * The session list's view of the daemon directory: projects, workspaces (labels, pins, chats),
 * the label catalog, plus the list's own scope, display prefs and open sheet.
 */

export type Workspace = Awaited<ReturnType<DaemonClient["fetchWorkspaces"]>>["entries"][number];
export type LabelColor = NonNullable<Parameters<DaemonClient["updateWorkspaceLabel"]>[0]["color"]>;
export interface LabelDef {
  name: string;
  color: LabelColor;
}
export type HistoryEntry = Awaited<
  ReturnType<DaemonClient["fetchAgentHistory"]>
>["entries"][number];
export type RecentProviderSession = Awaited<
  ReturnType<DaemonClient["fetchRecentProviderSessions"]>
>["entries"][number];

/** "all", "chats", "archived", or a project id. */
export type Scope = string;
export type Group = "attention" | "project" | "labels";
export type Sort = "recent" | "created" | "title";
export type ShowKey = "project" | "branch" | "host" | "labels" | "provider";

export interface Prefs {
  group: Group;
  sort: Sort;
  title: "title" | "branch";
  show: Record<ShowKey, boolean>;
  label: string | null;
  showHidden: boolean;
}

export type Sheet =
  | { kind: "menu"; agentId: string }
  | { kind: "labels"; agentId: string }
  | { kind: "rename"; agentId: string }
  | { kind: "archive"; agentId: string }
  | { kind: "import" }
  | { kind: "add-project" };

export const DEFAULT_PREFS: Prefs = {
  group: "attention",
  sort: "recent",
  title: "title",
  show: { project: true, branch: true, host: false, labels: true, provider: false },
  label: null,
  showHidden: false,
};

interface DirState {
  loaded: boolean;
  error: string | null;
  projects: Project[];
  chatsProjectId: string | null;
  workspaces: Record<string, Workspace>;
  labels: LabelDef[];
  scope: Scope;
  prefs: Prefs;
  /** Hidden from the list on this device only. */
  hidden: string[];
  sheet: Sheet | null;
}

export const useDirectory = create<DirState>(() => ({
  loaded: false,
  error: null,
  projects: [],
  chatsProjectId: null,
  workspaces: {},
  labels: [],
  scope: "all",
  prefs: DEFAULT_PREFS,
  hidden: [],
  sheet: null,
}));

export const openSheet = (sheet: Sheet | null) => useDirectory.setState({ sheet });
export const closeSheet = () => useDirectory.setState({ sheet: null });
export const setScope = (scope: Scope) => useDirectory.setState({ scope });
export const setPrefs = (patch: Partial<Prefs>) =>
  useDirectory.setState((st) => ({ prefs: { ...st.prefs, ...patch } }));

// ---- persistence (display prefs, hidden ids, scope) ----

const KEY = "frogg-next:session-list";
const ready = AsyncStorage.getItem(KEY)
  .then((raw): void => {
    if (!raw) return undefined;
    const saved = JSON.parse(raw) as Partial<Pick<DirState, "prefs" | "hidden" | "scope">>;
    useDirectory.setState({
      prefs: {
        ...DEFAULT_PREFS,
        ...saved.prefs,
        show: { ...DEFAULT_PREFS.show, ...saved.prefs?.show },
      },
      hidden: saved.hidden ?? [],
      scope: saved.scope ?? "all",
    });
    return undefined;
  })
  .catch(() => {});
void ready.then(() =>
  useDirectory.subscribe((s, prev) => {
    if (s.prefs !== prev.prefs || s.hidden !== prev.hidden || s.scope !== prev.scope)
      void AsyncStorage.setItem(
        KEY,
        JSON.stringify({ prefs: s.prefs, hidden: s.hidden, scope: s.scope }),
      );
  }),
);

export function toggleHidden(agentId: string): void {
  useDirectory.setState((st) => ({
    hidden: st.hidden.includes(agentId)
      ? st.hidden.filter((x) => x !== agentId)
      : [...st.hidden, agentId],
  }));
}

// ---- loading ----

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function loadWorkspaces(client: DaemonClient): Promise<void> {
  const res = await client.fetchWorkspaces({ page: { limit: 200 } });
  const workspaces: Record<string, Workspace> = {};
  for (const w of res.entries) workspaces[w.id] = w;
  useDirectory.setState({ workspaces });
}

export async function loadDirectory(): Promise<void> {
  const client = getClient();
  if (!client) return;
  try {
    const [projects, labels] = await Promise.all([
      client.listProjects(),
      client
        .listWorkspaceLabels({ subscriptionId: "ui-next-session-list" })
        .then((r) => r.labels)
        .catch(() => [] as LabelDef[]),
      loadWorkspaces(client),
    ]);
    if (getClient() !== client) return;
    useDirectory.setState({
      loaded: true,
      error: null,
      projects: projects.projects.filter((p) => !p.chats),
      chatsProjectId: projects.projects.find((p) => p.chats)?.projectId ?? null,
      labels,
    });
  } catch (e) {
    useDirectory.setState({ loaded: true, error: errText(e) });
  }
}

let refetch: ReturnType<typeof setTimeout> | null = null;
/** A session in a workspace we have not seen yet means a new workspace: refetch, coalesced. */
function refetchSoon(): void {
  if (refetch) return;
  refetch = setTimeout(() => {
    refetch = null;
    const client = getClient();
    if (client) void loadWorkspaces(client).catch(() => {});
  }, 600);
}

useDaemon.subscribe((s, prev) => {
  if (s.conn === "online" && prev.conn !== "online") void loadDirectory();
  if (s.sessions !== prev.sessions) {
    const known = useDirectory.getState().workspaces;
    for (const x of Object.values(s.sessions))
      if (x.agent.workspaceId && !known[x.agent.workspaceId]) {
        refetchSoon();
        break;
      }
  }
});
onHostSwitch(() =>
  useDirectory.setState({
    loaded: false,
    error: null,
    projects: [],
    chatsProjectId: null,
    workspaces: {},
    labels: [],
    sheet: null,
  }),
);

// ---- derived ----

export function workspaceOf(agent: Agent): Workspace | undefined {
  return agent.workspaceId ? useDirectory.getState().workspaces[agent.workspaceId] : undefined;
}

export function isChat(sess: Session, d: Pick<DirState, "workspaces" | "chatsProjectId">): boolean {
  const w = sess.agent.workspaceId ? d.workspaces[sess.agent.workspaceId] : undefined;
  return (
    !!w && (w.chat === true || (d.chatsProjectId !== null && w.projectId === d.chatsProjectId))
  );
}

export function projectIdOf(
  sess: Session,
  d: Pick<DirState, "workspaces" | "projects">,
): string | null {
  const w = sess.agent.workspaceId ? d.workspaces[sess.agent.workspaceId] : undefined;
  if (w) return w.projectId;
  const key = sess.project?.projectKey;
  return d.projects.find((p) => p.projectKey === key)?.projectId ?? null;
}

// ---- actions (each throws on failure so the caller can show it) ----

function need(): DaemonClient {
  const c = getClient();
  if (!c) throw new Error("Not connected to a host");
  return c;
}

export async function setSessionLabel(
  workspaceId: string,
  label: LabelDef,
  assigned: boolean,
): Promise<void> {
  const res = await need().setWorkspaceLabel({ workspaceId, label, assigned });
  useDirectory.setState((st) => {
    const w = st.workspaces[workspaceId];
    const labels = st.labels.some((l) => l.name === res.label.name)
      ? st.labels
      : [...st.labels, res.label];
    return {
      labels,
      workspaces: w
        ? { ...st.workspaces, [workspaceId]: { ...w, labels: res.workspaceLabels } }
        : st.workspaces,
    };
  });
}

export async function renameSession(agentId: string, name: string): Promise<void> {
  await need().updateAgent(agentId, { name });
}

export async function setPinned(workspaceId: string, pinned: boolean): Promise<void> {
  const { pinnedAt } = await need().setWorkspacePinned(workspaceId, pinned);
  useDirectory.setState((st) => {
    const w = st.workspaces[workspaceId];
    return w ? { workspaces: { ...st.workspaces, [workspaceId]: { ...w, pinnedAt } } } : {};
  });
}

export { archiveSession };

export async function addProject(cwd: string): Promise<void> {
  await need().addProject(cwd);
  await loadDirectory();
}

export async function listDir(dir: string): Promise<Array<{ name: string; path: string }>> {
  const res = await need().listDirectory(dir, ".");
  return res.entries
    .filter((e) => e.kind === "directory" && !e.name.startsWith("."))
    .map((e) => ({ name: e.name, path: joinPath(dir, e.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function makeDir(parentPath: string, name: string): Promise<void> {
  await need().createProjectDirectory({ parentPath, name });
}

export function joinPath(dir: string, name: string): string {
  return `${dir.replace(/\/+$/, "")}/${name}`;
}

export function parentDir(dir: string): string {
  const trimmed = dir.replace(/\/+$/, "");
  const i = trimmed.lastIndexOf("/");
  return i <= 0 ? "/" : trimmed.slice(0, i);
}

export async function fetchHistory(input: {
  search?: string;
  cursor?: string;
}): Promise<{ entries: HistoryEntry[]; next: string | null }> {
  const res = await need().fetchAgentHistory({
    filter: { includeArchived: true },
    ...(input.search ? { search: input.search } : {}),
    sort: [{ key: "updated_at", direction: "desc" }],
    page: { limit: 50, ...(input.cursor ? { cursor: input.cursor } : {}) },
  });
  return {
    entries: res.entries.filter((e) => e.agent.archivedAt),
    next: res.pageInfo.hasMore ? res.pageInfo.nextCursor : null,
  };
}

/** Refreshing an archived agent unarchives it on the daemon. */
export async function restoreSession(entry: HistoryEntry): Promise<void> {
  await need().refreshAgent(entry.agent.id);
  useDaemon.setState((st) => ({
    sessions: {
      ...st.sessions,
      [entry.agent.id]: { agent: { ...entry.agent, archivedAt: null }, project: entry.project },
    },
  }));
}

export async function fetchImportable(): Promise<{
  entries: RecentProviderSession[];
  hidden: number;
}> {
  const res = await need().fetchRecentProviderSessions({ limit: 100 });
  return { entries: res.entries, hidden: res.filteredAlreadyImportedCount ?? 0 };
}

export async function importSession(e: RecentProviderSession): Promise<string> {
  const agent = await need().importAgent({
    providerId: e.providerId,
    providerHandleId: e.providerHandleId,
    cwd: e.cwd,
  });
  return agent.id;
}
