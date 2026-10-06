// An in-memory stand-in for the daemon client, so real components run in the lab with no host.
// It answers the reads the components make from fixtures and plays agent turns on a timer.
import { useConfig } from "../daemon/config";
import { attachFixtureClient, useDaemon } from "../daemon/store";
import type { Agent, TimelineEntry, TimelineItem } from "../daemon/types";
import { loadUsage, useUsage } from "../daemon/usage";
import { useDirectory } from "../components/sessions/directory";
import { useToasts } from "../components/toast/store";
import { useUi } from "../ui-store";
import {
  accounts,
  agent as makeAgent,
  ago,
  checkoutStatus,
  commands,
  diffFiles,
  entry,
  placement,
  projects,
  providers,
  sessions,
  timelines,
  toolDetails,
  toolItem,
  usage,
  type Permission,
} from "./fixtures";
import { ciListRuns, ciPrStatus, seedCi } from "./fixtures/ci";
import { useLab } from "./store";
// Simulated RPCs (lab/sim/): file system, streams graph, subagents and the rest of the host.
import { resetSim, simulatedRpcs } from "./sim";

export const LAB_URL = "lab://fixtures";
const APP_VERSION: string = require("../../package.json").version;

type Listener = (event: unknown) => void;
const listeners = new Set<Listener>();
/** Sends a daemon event to whatever subscribed (Banners listens for storage alerts). */
export function emit(event: unknown): void {
  for (const fn of listeners) fn(event);
}

/** Bumped on every reseed so turns still playing from a previous demo stop. */
let epoch = 0;
const cancelled = new Set<string>();

/** A delay stretched by the lab's speed control, so timed demos slow down with the CSS. */
function wait(ms: number): Promise<void> {
  const rate = Number(useLab.getState().speed) || 1;
  return new Promise((done) => setTimeout(done, ms / rate));
}

function patchAgent(id: string, patch: Partial<Agent>): void {
  useDaemon.setState((st) => {
    const sess = st.sessions[id];
    if (!sess) return {};
    return {
      sessions: {
        ...st.sessions,
        [id]: { ...sess, agent: { ...sess.agent, ...patch, updatedAt: ago(0) } },
      },
    };
  });
}

function push(id: string, item: TimelineItem, turnId = "live"): void {
  useDaemon.setState((st) => ({
    timelines: { ...st.timelines, [id]: [...(st.timelines[id] ?? []), entry(item, turnId)] },
  }));
}

/** Replaces the last entry matching `match` (a tool call by id, the streaming reply). */
function replaceLast(id: string, match: (e: TimelineEntry) => boolean, item: TimelineItem): void {
  useDaemon.setState((st) => {
    const list = st.timelines[id] ?? [];
    const at = list.findLastIndex(match);
    if (at < 0) return {};
    const next = [...list];
    next[at] = { ...list[at], item };
    return { timelines: { ...st.timelines, [id]: next } };
  });
}

const REPLY_WORDS =
  "Done. I read the store, threaded the config through the constructor and replaced the clear-all with a least-recently-used eviction. Each eviction now logs at **debug** with the agent id. The store suite passes; `sessionCache.maxEntries` defaults to `200`.".split(
    " ",
  );

let turnSeq = 0;
/**
 * One simulated agent turn: thinking, a tool call that runs then completes, then a reply that
 * streams in word by word. Ends ready to review, like a finished turn on a real host.
 */
export async function playTurn(id: string, opts: { tool?: boolean } = {}): Promise<void> {
  const mine = epoch;
  turnSeq += 1;
  const turn = `t${turnSeq}`;
  const live = () => epoch === mine && !cancelled.has(id);
  cancelled.delete(id);
  patchAgent(id, { status: "running", requiresAttention: false, attentionReason: null });
  await wait(900);
  if (!live()) return;
  if (opts.tool !== false) {
    const callId = `${turn}-call`;
    push(id, toolItem(callId, "Bash", toolDetails.shell, "running"), turn);
    await wait(1600);
    if (!live()) return;
    replaceLast(
      id,
      (e) => e.item.type === "tool_call" && e.item.callId === callId,
      toolItem(callId, "Bash", toolDetails.shell, "completed"),
    );
    await wait(500);
  }
  const messageId = `${turn}-reply`;
  let text = "";
  for (const word of REPLY_WORDS) {
    if (!live()) return;
    text = text ? `${text} ${word}` : word;
    const item = { type: "assistant_message", text, messageId } as TimelineItem;
    if (text === word) push(id, item, turn);
    else
      replaceLast(
        id,
        (e) => e.item.type === "assistant_message" && e.item.messageId === messageId,
        item,
      );
    await wait(70);
  }
  if (!live()) return;
  patchAgent(id, { status: "idle", requiresAttention: true, attentionReason: "finished" });
}

function answer(id: string, requestId: string, allow: boolean): void {
  const sess = useDaemon.getState().sessions[id];
  if (!sess) return;
  const p = sess.agent.pendingPermissions.find((x) => x.id === requestId);
  patchAgent(id, {
    pendingPermissions: sess.agent.pendingPermissions.filter((x) => x.id !== requestId),
    attentionReason: null,
    requiresAttention: false,
  });
  if (!p) return;
  if (!allow) {
    push(id, {
      type: "assistant_message",
      text: "Understood, I won't do that. What would you like instead?",
      messageId: `deny-${requestId}`,
    } as TimelineItem);
    patchAgent(id, { status: "idle" });
    return;
  }
  void playTurn(id, { tool: p.kind !== "question" && p.kind !== "plan" });
}

const features = {
  agentCleanCut: true,
  providerAccounts: true,
  providerUsageAccountScoped: true,
  agentProviderAccountTransfer: true,
  // Simulated host capabilities (lab/sim/misc.ts).
  deviceAccess: true,
  securityPosture: true,
  securityAcknowledge: true,
  daemonUpdateRuns: true,
  betaChannelManagement: true,
  daemonChannelControl: true,
  devDaemonRebuild: true,
  hostResources: true,
  storageAlerts: true,
  webUiControl: true,
  deviceRoleManagement: true,
  skillsManagement: true,
  providerAgentDefinitions: true,
  plugins: true,
  projectTodos: true,
  releaseStreams: true,
};

let created = 0;
const known: Record<string, (...args: never[]) => unknown> = {
  getLastServerInfoMessage: () => ({ hostname: "devbox", version: APP_VERSION, features }),
  subscribe: (fn: Listener) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  subscribeConnectionStatus: () => () => {},
  subscribeRawMessages: () => () => {},
  supportsPlugins: () => false,
  subscribeTerminals: () => {},
  unsubscribeTerminals: () => {},
  unsubscribeCheckoutDiff: () => {},
  listTerminals: async () => ({ terminals: [] }),
  getCheckoutStatus: async (cwd: string) => checkoutStatus(cwd),
  subscribeCheckoutDiff: async () => ({ files: diffFiles, error: null }),
  // CI (lab/fixtures/ci.ts): simulated runs and the preview branch PR.
  checkoutPrStatus: async (cwd: string) => ciPrStatus(cwd),
  checkoutCiListRuns: async (cwd: string) => ciListRuns(cwd),
  close: async () => {},
  connect: async () => {},
  fetchAgentTimeline: async (id: string) => ({
    entries: useDaemon.getState().timelines[id] ?? [],
  }),
  setAgentTimelineSubscription: async () => ({}),
  sendMessage: async (id: string, text: string) => {
    push(id, { type: "user_message", text, messageId: `u-${Date.now()}` } as TimelineItem);
    void playTurn(id);
    return {};
  },
  respondToPermission: async (id: string, requestId: string, res: { behavior: string }) => {
    await wait(250);
    answer(id, requestId, res.behavior === "allow");
    return {};
  },
  cancelAgent: async (id: string) => {
    cancelled.add(id);
    patchAgent(id, { status: "idle" });
    return {};
  },
  listProjects: async () => ({ projects }),
  getProvidersSnapshot: async () => providers,
  getDaemonConfig: async () => ({ config: useConfig.getState().config ?? {} }),
  getDaemonStatus: async () => null,
  listCommands: async () => ({ commands, error: null }),
  listProviderAccounts: async (o: { provider?: string } = {}) => ({
    requestId: "lab",
    accounts: o.provider ? accounts.filter((a) => a.provider === o.provider) : accounts,
    capabilities: [],
    activeAccountIds: {},
    error: null,
  }),
  listProviderUsage: async (o: { provider?: string; providerAccountId?: string } = {}) => {
    const scoped = (p: string) =>
      o.provider === p ? usage[`${p}:${o.providerAccountId}`] : usage[`${p}:default:${p}`];
    return {
      requestId: "lab",
      fetchedAt: ago(0),
      providers: [scoped("claude"), scoped("codex"), usage.copilot, usage.cursor],
    };
  },
  createAgent: async (input: { provider: string; cwd: string; title?: string; model?: string }) => {
    created += 1;
    const id = `s-new-${created}`;
    const project = input.cwd.split("/").pop() ?? "frogg";
    const a = makeAgent({
      id,
      provider: input.provider as Agent["provider"],
      cwd: input.cwd,
      model: input.model ?? null,
      title: input.title ?? "New session",
      status: "running",
      createdAt: ago(0),
    });
    useDaemon.setState((st) => ({
      sessions: { ...st.sessions, [id]: { agent: a, project: placement(project, "feat/new") } },
      timelines: { ...st.timelines, [id]: [] },
    }));
    void playTurn(id);
    return a;
  },
  setAgentModel: async (id: string, model: string) => patchAgent(id, { model }),
  setAgentMode: async (id: string, currentModeId: string) => patchAgent(id, { currentModeId }),
  clearAgentAttention: async (ids: string[]) => {
    for (const id of ids) patchAgent(id, { requiresAttention: false, attentionReason: null });
    return {};
  },
  archiveAgent: async () => ({}),
};

/** Unknown calls fail like an older host would, so components show their error states. */
const sim = simulatedRpcs(emit);
const client = new Proxy(known, {
  get(target, name: string) {
    if (name in sim) return sim[name];
    if (name in target) return target[name];
    if (name === "then") return undefined;
    return async () => {
      throw new Error(`${name} is not available in the component lab`);
    };
  },
});

/** Puts every store back to the lab's starting fixtures. Each demo calls this before it mounts. */
export function seedLab(): void {
  epoch += 1;
  cancelled.clear();
  attachFixtureClient(client);
  resetSim();
  seedCi();
  useDaemon.setState({
    conn: "online",
    url: LAB_URL,
    serverName: "devbox",
    sessions: sessions(),
    timelines: timelines(),
    streaming: {},
  });
  useUi.setState({
    tool: "sessions",
    selected: null,
    listOpen: false,
    diffPath: null,
    terminalId: null,
    inboxId: null,
    filePath: null,
    settingsPage: null,
    newSessionOpen: false,
    newSessionPrompt: "",
    paletteOpen: false,
  });
  useToasts.setState({ toasts: [] });
  useConfig.setState({ providers: providers as never, config: {} as never, error: null });
  useUsage.setState({ groups: null, fetchedAt: null, loading: false, error: null });
  void loadUsage();
  const dir = useDirectory.getState();
  if (dir.sheet || dir.scope !== "all") useDirectory.setState({ sheet: null, scope: "all" });
}

/** Adds a pending permission to a session, as when an agent asks mid-turn. */
export function askPermission(id: string, p: Permission): void {
  const sess = useDaemon.getState().sessions[id];
  if (!sess) return;
  patchAgent(id, {
    status: "running",
    pendingPermissions: [...sess.agent.pendingPermissions.filter((x) => x.id !== p.id), p],
    attentionReason: "permission",
    requiresAttention: true,
  });
}

export { patchAgent };
