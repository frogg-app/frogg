// In-memory simulations for the daemon RPCs the lab's fixture client does not answer itself:
// settings pages, source control, plugins, devices, terminals and the session directory.
import { useConfig } from "../../daemon/config";
import { useDaemon } from "../../daemon/store";
import type { Agent } from "../../daemon/types";
import { accounts, agent as makeAgent, ago, ahead, placement, projects } from "../fixtures";
import { labWait, latency } from "./time";

type Rpc = (...args: never[]) => unknown;
type Emit = (event: unknown) => void;

let emitEvent: Emit = () => {};
/** client.ts hands over its `emit` so simulations can push daemon events. */
export function setLabEmitter(fn: Emit): void {
  emitEvent = fn;
}

const HOST = "devbox";
const VERSION = "1.6.12";
const GIB = 1024 ** 3;
let seq = 0;
const nextId = (prefix: string) => {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq}`;
};

// ---- config ------------------------------------------------------------------------------------

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}
function deepMerge(base: unknown, patch: unknown): unknown {
  if (!isObj(base) || !isObj(patch)) return patch;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}
const CONFIG_DEFAULTS = {
  mcp: { injectIntoAgents: true },
  browserTools: { enabled: false },
  enableTerminalAgentHooks: true,
  appendSystemPrompt: "",
  relay: { enabled: true, endpoint: "relay.frogg.app:443", useTls: true, endpointMutable: true },
  autoUpdate: { enabled: true, channel: "stable", checkIntervalHours: 24, quietHours: [9, 18] },
  storage: {
    alerts: { enabled: true, warnBytes: 20 * GIB, criticalBytes: 40 * GIB, notifyAt: "warn" },
  },
};
let config: unknown = null;
function currentConfig(): unknown {
  config ??= deepMerge(CONFIG_DEFAULTS, useConfig.getState().config ?? {});
  return config;
}

// ---- security ----------------------------------------------------------------------------------

const auth = {
  passwordEnabled: false,
  trustLan: true,
  lanTrustEffective: true,
  claimMode: true,
  claimed: true,
  overrideControlledPaths: [] as string[],
};
const acked = new Set<string>();
function findings() {
  const out: Array<{ id: string; severity: string; fixAction: string }> = [];
  if (auth.trustLan && !auth.claimMode)
    out.push({ id: "trust_lan_diverges", severity: "warning", fixAction: "disable_trust_lan" });
  if (!auth.passwordEnabled)
    out.push({ id: "exposed_without_password", severity: "warning", fixAction: "set_password" });
  if (!auth.claimMode)
    out.push({ id: "claim_mode_diverges", severity: "warning", fixAction: "enable_claim_mode" });
  return out.filter((f) => !acked.has(f.id));
}
function syncLan(): void {
  auth.lanTrustEffective = auth.trustLan && !auth.claimMode;
}

// ---- status, updates, channels -----------------------------------------------------------------

const startedAt = ago(60 * 26);
const daemonStatus = () => ({
  serverId: "srv_7f3a9c21e4",
  version: VERSION,
  pid: 48211,
  nodePath: "/usr/local/lib/frogg/node/bin/node",
  startedAt,
  listen: "0.0.0.0:7821",
  relay: { enabled: true, publicEndpoint: "relay.frogg.app:443", publicUseTls: true },
  providers: [
    { provider: "claude", available: true, error: null },
    { provider: "codex", available: true, error: null },
    { provider: "gemini", available: false, error: "gemini CLI not found on PATH" },
  ],
});

let updateRun: { from: string; to: string; phase: string; message: string | null } | null = null;
let lastResult: { to: string; status: string; reason: string | null; at: string } | null = {
  to: "1.6.11",
  status: "applied",
  reason: null,
  at: ago(60 * 24 * 3),
};
const LATEST = "1.6.13";

async function runUpdate(to: string): Promise<void> {
  for (const phase of ["downloading", "verifying", "installing", "restarting"]) {
    updateRun = {
      from: VERSION,
      to,
      phase,
      message: `${phase[0].toUpperCase()}${phase.slice(1)}…`,
    };
    await labWait(1800);
  }
  updateRun = null;
  lastResult = { to, status: "applied", reason: null, at: ago(0) };
}

const beta = {
  supported: true,
  installed: true,
  installedVersion: "1.7.0-beta.4",
  running: false,
  port: 7921,
  selfIsBeta: false,
  latestVersion: "1.7.0-beta.5",
  latestError: null as string | null,
  reason: null as string | null,
  run: null as { phase: string; message: string | null } | null,
  error: null as string | null,
};

const devCheckouts = [
  { name: "frogg", cwd: "/home/dev/frogg", branch: "main" },
  {
    name: "frogg (session cache)",
    cwd: "/home/dev/.frogg/worktrees/frogg/session-cache",
    branch: "feat/session-cache-cap",
  },
];
const devRunning = new Set<string>();
const devStatus = () => ({
  supported: true,
  reason: null,
  error: null,
  checkouts: devCheckouts,
  running: devRunning.size > 0,
  cwd: [...devRunning][0] ?? null,
  selfCwd: null,
  isSelf: false,
  canRebuild: true,
  instances: [...devRunning].map((cwd) => ({
    cwd,
    busy: false,
    canRebuild: true,
    lastError: null,
    port: 7831,
  })),
});

const web = {
  available: true,
  running: true,
  host: "127.0.0.1",
  port: 7830,
  startOnLaunch: true,
  startOnLaunchPinned: false,
  lastError: null as string | null,
};

// ---- resources ---------------------------------------------------------------------------------

let storage = [
  {
    id: "agent_worktrees",
    path: "~/.frogg/worktrees",
    bytes: 14.2 * GIB,
    reclaimableBytes: 6.8 * GIB,
    cleanable: true,
  },
  {
    id: "agents",
    path: "~/.frogg/agents",
    bytes: 1.9 * GIB,
    reclaimableBytes: 0,
    cleanable: false,
  },
  {
    id: "logs",
    path: "~/.frogg/logs",
    bytes: 612 * 1024 ** 2,
    reclaimableBytes: 540 * 1024 ** 2,
    cleanable: true,
  },
  {
    id: "daemon_versions",
    path: "~/.frogg/versions",
    bytes: 1.1 * GIB,
    reclaimableBytes: 0.8 * GIB,
    cleanable: true,
  },
  {
    id: "uploads",
    path: "~/.frogg/uploads",
    bytes: 84 * 1024 ** 2,
    reclaimableBytes: 84 * 1024 ** 2,
    cleanable: true,
  },
  {
    id: "models",
    path: "~/.frogg/models",
    bytes: 2.4 * GIB,
    reclaimableBytes: 0,
    cleanable: false,
  },
].map((c) => Object.assign(c, { exists: true, truncated: false }));
let storageAt = ago(42);

function metrics() {
  const t = Date.now() / 1000;
  return {
    platform: "linux",
    arch: "x64",
    uptimeSeconds: 86400 * 6 + 3600 * 4 + Math.floor(t % 3600),
    cpu: {
      cores: 16,
      model: "AMD Ryzen 9 7950X",
      usagePercent: Math.round(22 + 14 * Math.sin(t / 7) + Math.random() * 6),
    },
    memory: { totalBytes: 64 * GIB, usedBytes: (27 + 3 * Math.sin(t / 11)) * GIB },
    disk: { path: "/home", totalBytes: 1863 * GIB, usedBytes: 1112 * GIB },
    daemon: {
      pid: 48211,
      uptimeSeconds: 26 * 3600 + Math.floor(t % 3600),
      rssBytes: 312 * 1024 ** 2,
    },
  };
}

// ---- devices and pairing -----------------------------------------------------------------------

let devices = [
  {
    id: "dev-mbp",
    name: "Paz’s MacBook Pro",
    role: "owner",
    current: true,
    connected: true,
    lastSeenAt: ago(0),
  },
  {
    id: "dev-pixel",
    name: "Pixel 9 Pro",
    role: "operator",
    current: false,
    connected: true,
    lastSeenAt: ago(1),
  },
  {
    id: "dev-firefox",
    name: "Firefox on work laptop",
    role: "operator",
    current: false,
    connected: false,
    lastSeenAt: ago(60 * 5),
  },
  {
    id: "dev-ipad",
    name: "iPad Air",
    role: "viewer",
    current: false,
    connected: false,
    lastSeenAt: ago(60 * 24 * 9),
  },
].map((d) => Object.assign(d, { createdAt: ago(60 * 24 * 40) }));
let requests = [
  {
    id: "pr-1",
    deviceName: "Chrome on studio-imac",
    matchCode: "47 19",
    remoteAddress: "192.168.1.42",
    createdAt: ago(1),
  },
];
const codeChars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const mintCode = () =>
  Array.from({ length: 8 }, () => codeChars[Math.floor(Math.random() * codeChars.length)]).join("");

// ---- labels and workspaces ---------------------------------------------------------------------

let labels = [
  { name: "release", color: "violet" },
  { name: "bug", color: "red" },
  { name: "infra", color: "teal" },
  { name: "design", color: "pink" },
];
const wsLabels = new Map<string, string[]>();
const pinned = new Map<string, string | null>();

function workspaceFor(a: Agent, project: string | null, branch: string | null) {
  const p = projects.find((x) => x.projectKey === project) ?? projects[0];
  const id = a.workspaceId ?? `w-${a.id}`;
  return {
    id,
    projectId: p.projectId,
    projectDisplayName: p.projectDisplayName,
    projectRootPath: p.projectRootPath,
    workspaceDirectory: a.cwd,
    projectKind: p.projectKind,
    workspaceKind: "checkout",
    name: branch ?? p.projectDisplayName,
    title: null,
    pinnedAt: pinned.get(id) ?? null,
    labels: wsLabels.get(id) ?? [],
    archivingAt: null,
    status: "done",
    statusEnteredAt: a.updatedAt,
    activityAt: a.updatedAt,
  };
}

// ---- history and imports -----------------------------------------------------------------------

const archived = [
  ["h-1", "Migrate CI to pnpm workspaces", "frogg", "chore/pnpm", 60 * 26],
  ["h-2", "Flaky relay reconnect test", "frogg", "fix/relay-flake", 60 * 50],
  ["h-3", "Invoice PDF rounding", "billing", "fix/rounding", 60 * 24 * 4],
  ["h-4", "Weekly notes cleanup", "notes", null, 60 * 24 * 8],
  ["h-5", "Session cache eviction spike", "frogg", "spike/lru", 60 * 24 * 12],
] as const;
function historyEntries() {
  const live = Object.values(useDaemon.getState().sessions).map((s) => ({
    agent: s.agent,
    project: s.project,
  }));
  const old = archived.map(([id, title, project, branch, mins]) => ({
    agent: makeAgent({
      id,
      title,
      cwd: `/home/dev/${project}`,
      updatedAt: ago(mins),
      createdAt: ago(mins + 90),
      archivedAt: ago(mins - 10),
    } as Partial<Agent> & { id: string }),
    project: placement(project, branch),
  }));
  return [...live, ...old];
}
let importable = [
  {
    providerId: "claude",
    providerLabel: "Claude Code",
    providerHandleId: "0c7e1f9a-2b6d-4b1e-9d1a-5f0b7c3e8a21",
    cwd: "/home/dev/frogg",
    title: "Tighten websocket backpressure",
    firstPromptPreview: "The relay drops frames under load — look at the send queue",
    lastPromptPreview: "Add a test for the 4 MiB high-water mark",
    lastActivityAt: ago(95),
  },
  {
    providerId: "codex",
    providerLabel: "Codex",
    providerHandleId: "rollout-2026-10-05T21-14-03",
    cwd: "/home/dev/billing",
    title: null,
    firstPromptPreview: "Why does the tax line show 3 decimals?",
    lastPromptPreview: "ship it",
    lastActivityAt: ago(60 * 20),
  },
];

// ---- source control ----------------------------------------------------------------------------

const commits = [
  ["9f2c4e1", "feat(store): evict least-recently-used sessions past the cap", 14, false],
  ["3b81d07", "test(store): cover eviction ordering", 31, false],
  ["e04a6f2", "chore: thread sessionCache config through the constructor", 58, false],
  ["a71d3c9", "fix(relay): back off on 429 from the relay", 60 * 20, true],
] as [string, string, number, boolean][];
let localCommits = commits.map(([sha, subject, mins, isOnBase]) => ({
  sha: `${sha}${"0".repeat(33)}`,
  shortSha: sha,
  subject,
  authorName: "Frogg Agent",
  authorDate: ago(mins),
  isOnBase,
}));
let stashes = [
  {
    index: 0,
    message: "WIP on feat/session-cache-cap: debug logging",
    branch: "feat/session-cache-cap",
    createdAt: ago(80),
  },
  { index: 1, message: "On main: scratch benchmarks", branch: "main", createdAt: ago(60 * 30) },
];
const branchNames = [
  ["feat/session-cache-cap", 14, 3, 0],
  ["main", 60 * 20, 0, 0],
  ["fix/relay-flake", 60 * 50, 1, 2],
  ["chore/pnpm", 60 * 26, 0, 0],
  ["origin/release/1.6", 60 * 24 * 6, 0, 0],
] as [string, number, number, number][];

// ---- plugins -----------------------------------------------------------------------------------

let plugins = [
  {
    id: "frogg-linear",
    name: "Linear",
    description: "Pull Linear issues into sessions and link branches to tickets.",
    version: "0.4.2",
    enabled: true,
    status: "active",
    error: null as string | null,
    devPath: null as string | null,
    preinstalled: false,
    updateAvailable: "0.5.0" as string | null,
  },
  {
    id: "frogg-sentry",
    name: "Sentry",
    description: "Open recent Sentry issues as agent tasks.",
    version: "1.1.0",
    enabled: false,
    status: "disabled",
    error: null,
    devPath: null,
    preinstalled: true,
    updateAvailable: null,
  },
];
let repos = [
  {
    url: "https://plugins.frogg.app/index.json",
    name: "Frogg official",
    tier: "official",
    pluginCount: 12,
    publicKey: "ed25519:Fq3…9xA",
    error: null,
    removable: false,
  },
  {
    url: "https://github.com/acme/frogg-plugins",
    name: "acme/frogg-plugins",
    tier: "community",
    pluginCount: 3,
    publicKey: null,
    error: null,
    removable: true,
  },
];
const catalog = () =>
  (
    [
      [
        "frogg-linear",
        "Linear",
        "Pull Linear issues into sessions.",
        "productivity",
        "0.5.0",
        ["network", "secrets"],
      ],
      [
        "frogg-sentry",
        "Sentry",
        "Open Sentry issues as agent tasks.",
        "observability",
        "1.1.0",
        ["network"],
      ],
      [
        "frogg-vercel",
        "Vercel previews",
        "Show deploy previews for each branch.",
        "deploy",
        "0.2.1",
        ["network", "checkout.read"],
      ],
      [
        "frogg-pagerduty",
        "PagerDuty",
        "Start an agent from an incident.",
        "observability",
        "0.1.0",
        ["network", "agents.create"],
      ],
    ] as Array<[string, string, string, string, string, string[]]>
  ).map(([id, name, description, category, version, capabilities]) => ({
    id,
    name,
    description,
    category,
    tier: "official",
    repoUrl: repos[0].url,
    repoName: repos[0].name,
    installedVersion: plugins.find((p) => p.id === id)?.version ?? null,
    latest: { version, compatible: true, capabilities },
  }));
const pluginSettings: Record<string, Record<string, unknown>> = {
  "frogg-linear": { apiKey: "••••", team: "FRG", autoLink: true },
  "frogg-sentry": { org: "frogg" },
};
const settingFields: Record<string, unknown[]> = {
  "frogg-linear": [
    {
      key: "apiKey",
      type: "secret",
      title: "API key",
      description: "Personal API key",
      required: true,
    },
    { key: "team", type: "string", title: "Team key", description: "Issues are created here" },
    {
      key: "autoLink",
      type: "boolean",
      title: "Link branches",
      description: "Match branch names to issue ids",
      default: true,
    },
  ],
  "frogg-sentry": [
    { key: "org", type: "string", title: "Organisation", required: true },
    {
      key: "env",
      type: "select",
      title: "Environment",
      options: [
        { value: "production", label: "Production" },
        { value: "staging", label: "Staging" },
      ],
      default: "production",
    },
  ],
};
let linearIssues = [
  {
    id: "FRG-412",
    title: "Session cache grows without bound",
    subtitle: "In progress · Paz",
    badge: "urgent",
  },
  { id: "FRG-398", title: "Relay reconnect storms on wake", subtitle: "Todo", badge: "high" },
];

// ---- todos, skills, companion ------------------------------------------------------------------

const todos: Record<string, Array<Record<string, unknown>>> = {
  "p-frogg": [
    {
      id: "t-1",
      title: "Cap the session cache",
      description: "Evict least-recently-used past sessionCache.maxEntries.",
      priority: "high",
      category: "perf",
      status: "in_progress",
      claims: [{ agentId: "s-working", stale: false }],
    },
    {
      id: "t-2",
      title: "Document the relay backoff",
      description: "",
      priority: "low",
      category: "docs",
      status: "ready",
      claims: [],
    },
    {
      id: "t-3",
      title: "Flaky reconnect test",
      description: "Fails ~1 in 20 on CI.",
      priority: "medium",
      category: "test",
      status: "blocked",
      claims: [],
    },
    {
      id: "t-4",
      title: "Bump zod to 4.1",
      description: "",
      priority: "low",
      category: "deps",
      status: "done",
      claims: [],
    },
  ],
};
const skills = [
  {
    id: "frogg-dev",
    name: "frogg-dev",
    description: "Build, run and test the Frogg monorepo",
    enabled: true,
  },
  {
    id: "frogg-docs",
    name: "frogg-docs",
    description: "Update docs when code changes",
    enabled: true,
  },
  {
    id: "frogg-release",
    name: "frogg-release",
    description: "Build and publish distributions",
    enabled: false,
  },
];
let notebook = {
  updatedAt: ago(3),
  entries: [
    {
      id: "n-1",
      kind: "topic",
      text: "Session cache memory growth",
      status: "active",
      agentId: "s-working",
      updatedAt: ago(3),
    },
    {
      id: "n-2",
      kind: "task",
      text: "Cap the cache at 200 entries with LRU eviction",
      status: "active",
      agentId: "s-working",
      updatedAt: ago(3),
    },
    {
      id: "n-3",
      kind: "task",
      text: "Write the 1.6.12 release notes",
      status: "open",
      agentId: null,
      updatedAt: ago(40),
    },
    {
      id: "n-4",
      kind: "task",
      text: "Fix relay backoff on 429",
      status: "done",
      agentId: null,
      updatedAt: ago(60 * 20),
    },
  ],
};

// ---- terminals ---------------------------------------------------------------------------------

interface LabTerminal {
  id: string;
  name: string;
  title: string;
  cwd: string;
  buffer: string;
  line: string;
}
const terminals: LabTerminal[] = [];
const streamHandlers = new Set<(e: unknown) => void>();
const encoder = new TextEncoder();
const PROMPT =
  "\x1b[32mfrogg@devbox\x1b[0m \x1b[34m~/frogg\x1b[0m \x1b[33m(feat/session-cache-cap)\x1b[0m $ ";
const OUTPUTS: Record<string, string> = {
  "git status": [
    "On branch feat/session-cache-cap",
    "Your branch is ahead of 'origin/feat/session-cache-cap' by 3 commits.",
    "",
    "Changes not staged for commit:",
    "  \x1b[31mmodified:   packages/server/src/session-store.ts\x1b[0m",
    "  \x1b[31mmodified:   packages/server/src/session-store.test.ts\x1b[0m",
    "",
    'no changes added to commit (use "git add" and/or "git commit -a")',
  ].join("\r\n"),
  ls: "\x1b[34mapps\x1b[0m  \x1b[34mdocs\x1b[0m  \x1b[34mpackages\x1b[0m  \x1b[34mscripts\x1b[0m  AGENTS.md  CLAUDE.md  package.json  tsconfig.json",
  "npm test": [
    "",
    "> frogg@1.6.12 test",
    "> vitest run packages/server",
    "",
    " \x1b[32m✓\x1b[0m src/session-store.test.ts (14 tests) 212ms",
    " \x1b[32m✓\x1b[0m src/relay/backoff.test.ts (6 tests) 48ms",
    " \x1b[32m✓\x1b[0m src/config.test.ts (21 tests) 33ms",
    "",
    " Test Files  \x1b[32m3 passed\x1b[0m (3)",
    "      Tests  \x1b[32m41 passed\x1b[0m (41)",
    "   Duration  1.84s",
  ].join("\r\n"),
  pwd: "/home/dev/frogg",
  whoami: "frogg",
};

function write(t: LabTerminal, data: string): void {
  t.buffer += data;
  const bytes = encoder.encode(data);
  for (const fn of streamHandlers) fn({ terminalId: t.id, type: "output", data: bytes });
}
const termInfo = (t: LabTerminal) => ({ id: t.id, name: t.name, title: t.title, cwd: t.cwd });
function runLine(t: LabTerminal, raw: string): void {
  const cmd = raw.trim();
  if (cmd === "clear") {
    t.buffer = "";
    write(t, `\x1b[2J\x1b[H${PROMPT}`);
    return;
  }
  let out = OUTPUTS[cmd];
  if (out === undefined && cmd.startsWith("echo ")) out = cmd.slice(5);
  if (out === undefined && cmd) out = `bash: ${cmd.split(" ")[0]}: command not found`;
  write(t, `\r\n${out ? `${out}\r\n` : ""}${PROMPT}`);
}
function input(t: LabTerminal, data: string): void {
  for (const ch of data) {
    if (ch === "\r" || ch === "\n") {
      const line = t.line;
      t.line = "";
      runLine(t, line);
    } else if (ch === "\x7f" || ch === "\b") {
      if (t.line) {
        t.line = t.line.slice(0, -1);
        write(t, "\b \b");
      }
    } else if (ch === "\x03") {
      t.line = "";
      write(t, `^C\r\n${PROMPT}`);
    } else if (ch >= " ") {
      t.line += ch;
      write(t, ch);
    }
  }
}
/** The lab's open terminals, as listTerminals reports them. */
export function labTerminals() {
  return terminals.map(termInfo);
}

// ---- the RPCs ----------------------------------------------------------------------------------

const scmOk = async (ms = 400) => {
  await latency(ms);
  return { success: true, error: null };
};

export const miscRpcs: Record<string, Rpc> = {
  // Session directory
  addProject: async (cwd: string) => {
    await latency();
    const key = cwd.split("/").findLast(Boolean) ?? "project";
    if (!projects.some((p) => p.projectRootPath === cwd))
      projects.push({
        projectId: `p-${key}`,
        projectKey: key,
        projectDisplayName: key,
        projectRootPath: cwd,
        projectKind: "git",
      });
    return { project: projects.at(-1), error: null };
  },
  createProjectDirectory: async (o: { parentPath: string; name: string }) => {
    await latency();
    return { path: `${o.parentPath.replace(/\/+$/, "")}/${o.name}`, error: null };
  },
  fetchAgents: async () => {
    await latency();
    const entries = Object.values(useDaemon.getState().sessions).map((s) => ({
      agent: s.agent,
      project: s.project,
    }));
    return {
      requestId: "lab",
      entries,
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
    };
  },
  fetchAgentHistory: async (o: { search?: string } = {}) => {
    await latency(180);
    const needle = o.search?.toLowerCase() ?? "";
    const entries = historyEntries().filter(
      (e) => !needle || (e.agent.title ?? "").toLowerCase().includes(needle),
    );
    return {
      requestId: "lab",
      entries,
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
      searchTruncated: false,
    };
  },
  fetchWorkspaces: async () => {
    await latency();
    const entries = Object.values(useDaemon.getState().sessions).map((s) =>
      workspaceFor(
        s.agent,
        s.project?.projectKey ?? null,
        s.project?.checkout.currentBranch ?? null,
      ),
    );
    return {
      requestId: "lab",
      entries,
      emptyProjects: [],
      pageInfo: { nextCursor: null, prevCursor: null, hasMore: false },
    };
  },
  fetchRecentProviderSessions: async () => {
    await latency(300);
    return { requestId: "lab", entries: importable, filteredAlreadyImportedCount: 4 };
  },
  importAgent: async (o: { providerId: string; providerHandleId: string; cwd: string }) => {
    await latency(500);
    const src = importable.find((e) => e.providerHandleId === o.providerHandleId);
    importable = importable.filter((e) => e.providerHandleId !== o.providerHandleId);
    const id = nextId("s-import");
    const a = makeAgent({
      id,
      provider: o.providerId as Agent["provider"],
      cwd: o.cwd,
      title: src?.title ?? src?.firstPromptPreview ?? "Imported session",
      createdAt: ago(0),
    });
    const project = o.cwd.split("/").pop() ?? "frogg";
    useDaemon.setState((st) => ({
      sessions: { ...st.sessions, [id]: { agent: a, project: placement(project, "main") } },
      timelines: { ...st.timelines, [id]: [] },
    }));
    return a;
  },
  refreshAgent: async (agentId: string) => {
    await latency();
    return { agentId, error: null };
  },
  updateAgent: async (agentId: string, patch: { name?: string }) => {
    await latency();
    if (patch.name !== undefined)
      useDaemon.setState((st) => {
        const sess = st.sessions[agentId];
        if (!sess) return {};
        return {
          sessions: {
            ...st.sessions,
            [agentId]: { ...sess, agent: { ...sess.agent, title: patch.name ?? null } },
          },
        };
      });
    return { success: true };
  },
  listWorkspaceLabels: async () => {
    await latency();
    return { labels };
  },
  setWorkspaceLabel: async (o: {
    workspaceId: string;
    label: { name: string; color: string };
    assigned: boolean;
  }) => {
    await latency();
    if (!labels.some((l) => l.name.toLowerCase() === o.label.name.toLowerCase()))
      labels = [...labels, o.label];
    const cur = wsLabels.get(o.workspaceId) ?? [];
    const next = o.assigned
      ? [...cur.filter((n) => n !== o.label.name), o.label.name]
      : cur.filter((n) => n !== o.label.name);
    wsLabels.set(o.workspaceId, next);
    return { label: o.label, workspaceLabels: next };
  },
  updateWorkspaceLabel: async (o: { name: string; newName?: string; color?: string }) => {
    await latency();
    labels = labels.map((l) =>
      l.name === o.name ? { name: o.newName ?? l.name, color: o.color ?? l.color } : l,
    );
    if (o.newName)
      for (const [id, list] of wsLabels)
        wsLabels.set(
          id,
          list.map((n) => (n === o.name ? o.newName! : n)),
        );
    return { label: labels.find((l) => l.name === (o.newName ?? o.name)) ?? null, error: null };
  },
  deleteWorkspaceLabel: async (o: { name: string }) => {
    await latency();
    labels = labels.filter((l) => l.name !== o.name);
    for (const [id, list] of wsLabels)
      wsLabels.set(
        id,
        list.filter((n) => n !== o.name),
      );
    return { success: true };
  },
  setWorkspacePinned: async (workspaceId: string, pin: boolean) => {
    await latency();
    const pinnedAt = pin ? ago(0) : null;
    pinned.set(workspaceId, pinnedAt);
    return { workspaceId, pinnedAt };
  },

  // Session actions
  buildAgentForkContext: async (agentId: string) => {
    await latency(300);
    const items = useDaemon.getState().timelines[agentId] ?? [];
    return {
      error: null,
      itemCount: items.length,
      attachment: `<forked-conversation items="${items.length}">\n(conversation from ${agentId})\n</forked-conversation>`,
    };
  },
  cleanCutAgent: async (agentId: string) => {
    await latency(400);
    useDaemon.setState((st) => ({ timelines: { ...st.timelines, [agentId]: [] } }));
    return { success: true };
  },
  cancelAgentAutoResume: async () => {
    await latency();
    return { success: true };
  },
  rewindAgent: async (agentId: string, messageId: string) => {
    await latency(300);
    useDaemon.setState((st) => {
      const list = st.timelines[agentId] ?? [];
      const at = list.findIndex((e) => (e.item as { messageId?: string }).messageId === messageId);
      return at < 0 ? {} : { timelines: { ...st.timelines, [agentId]: list.slice(0, at) } };
    });
    return { success: true };
  },
  transferAgentProviderAccount: async (agentId: string, accountId: string | null) => {
    await latency(300);
    useDaemon.setState((st) => {
      const sess = st.sessions[agentId];
      if (!sess) return {};
      const agent = { ...sess.agent, providerAccountId: accountId } as Agent;
      return { sessions: { ...st.sessions, [agentId]: { ...sess, agent } } };
    });
    return { success: true };
  },

  // Source control
  checkoutCommit: async (_cwd: string, o: { message: string }) => {
    await latency(500);
    const sha = Math.random().toString(16).slice(2, 9);
    localCommits = [
      {
        sha: `${sha}${"0".repeat(33)}`,
        shortSha: sha,
        subject: o.message.split("\n")[0],
        authorName: "Paz",
        authorDate: ago(0),
        isOnBase: false,
      },
      ...localCommits,
    ];
    return { success: true, error: null };
  },
  checkoutDiscardChanges: () => scmOk(),
  checkoutMerge: () => scmOk(700),
  checkoutMergeFromBase: () => scmOk(700),
  checkoutPull: () => scmOk(900),
  checkoutPush: () => scmOk(1100),
  checkoutSwitchBranch: () => scmOk(500),
  checkoutPrCreate: async (_cwd: string, o: { title?: string }) => {
    await latency(1200);
    return {
      success: true,
      error: null,
      url: "https://github.com/frogg-app/frogg/pull/1287",
      number: 1287,
      title: o.title,
    };
  },
  checkoutPrMerge: () => scmOk(1200),
  checkoutForgeSetAutoMerge: () => scmOk(600),
  listCheckoutCommits: async () => {
    await latency();
    return { baseRef: "origin/main", commits: localCommits };
  },
  stashList: async () => {
    await latency();
    return { entries: stashes, error: null };
  },
  stashSave: async () => {
    await latency(400);
    stashes = [
      {
        index: 0,
        message: "WIP on feat/session-cache-cap: lab stash",
        branch: "feat/session-cache-cap",
        createdAt: ago(0),
      },
      ...stashes.map((s) => ({ ...s, index: s.index + 1 })),
    ];
    return { success: true, error: null };
  },
  stashPop: async (_cwd: string, index: number) => {
    await latency(400);
    stashes = stashes.filter((s) => s.index !== index);
    stashes.forEach((s, i) => {
      s.index = i;
    });
    return { success: true, error: null };
  },
  getBranchSuggestions: async (o: { query?: string; limit?: number }) => {
    await latency();
    const q = o.query?.toLowerCase() ?? "";
    const list = branchNames.filter(([n]) => n.toLowerCase().includes(q)).slice(0, o.limit ?? 40);
    return {
      branches: list.map(([n]) => n),
      branchDetails: list.map(([name, mins, localAhead, localBehind]) => ({
        name,
        committerDate: Date.now() - mins * 60_000,
        localAhead,
        localBehind,
      })),
      error: null,
    };
  },

  // Host settings
  getDaemonStatus: async () => {
    await latency();
    return daemonStatus();
  },
  patchDaemonConfig: async (patch: unknown) => {
    await latency(200);
    config = deepMerge(currentConfig(), patch);
    return { config };
  },
  restartServer: async () => {
    await latency(300);
    return { accepted: true };
  },
  ping: async () => {
    const t = Date.now();
    await labWait(18 + Math.random() * 22);
    return { requestId: "lab", clientSentAt: t, serverReceivedAt: t + 9, rttMs: Date.now() - t };
  },
  getAuthSettings: async () => {
    await latency();
    return { settings: { ...auth }, error: null };
  },
  updateAuthSettings: async (patch: { trustLan?: boolean; claimMode?: boolean }) => {
    await latency(250);
    Object.assign(auth, patch);
    syncLan();
    return { settings: { ...auth }, error: null };
  },
  setDaemonPassword: async (pw: string | null) => {
    await latency(400);
    auth.passwordEnabled = !!pw;
    return { success: true, error: null };
  },
  getDaemonSecurityPosture: async () => {
    await latency();
    return { posture: { findings: findings() }, error: null };
  },
  setSecurityFindingAcknowledged: async (o: { findingId: string; acknowledged: boolean }) => {
    await latency();
    if (o.acknowledged) acked.add(o.findingId);
    else acked.delete(o.findingId);
    return { success: true, error: null };
  },
  checkDaemonUpdate: async () => {
    await latency(900);
    return {
      currentVersion: VERSION,
      latestVersion: LATEST,
      updateAvailable: !lastResult || lastResult.to !== LATEST,
      updatable: true,
      reason: null,
      error: null,
    };
  },
  getDaemonUpdateStatus: async () => {
    await latency();
    return {
      currentVersion: VERSION,
      updatable: true,
      reason: null,
      installDir: "/usr/local/lib/frogg",
      run: updateRun,
      lastResult,
    };
  },
  startDaemonUpdate: async (o: { version?: string } = {}) => {
    await latency(300);
    void runUpdate(o.version ?? LATEST);
    return { accepted: true, error: null };
  },
  getBetaChannelStatus: async () => {
    await latency();
    return { ...beta };
  },
  installBetaChannel: async () => {
    beta.run = { phase: "downloading", message: `Fetching ${beta.latestVersion}` };
    await labWait(1500);
    beta.run = null;
    beta.installed = true;
    beta.installedVersion = beta.latestVersion;
    return { success: true, error: null };
  },
  startBetaChannel: async () => {
    await latency(700);
    beta.running = true;
    return { success: true, error: null };
  },
  stopBetaChannel: async () => {
    await latency(500);
    beta.running = false;
    return { success: true, error: null };
  },
  getDevDaemonStatus: async () => {
    await latency();
    return devStatus();
  },
  startDevDaemon: async (cwd: string) => {
    await latency(1200);
    devRunning.add(cwd);
    return { success: true, error: null };
  },
  stopDevDaemon: async (cwd: string) => {
    await latency(500);
    devRunning.delete(cwd);
    return { success: true, error: null };
  },
  rebuildDevDaemon: async () => {
    await labWait(2500);
    return { success: true, error: null };
  },
  getWebUiStatus: async () => {
    await latency();
    return { ...web };
  },
  startWebUi: async () => {
    await latency(600);
    web.running = true;
    return { ...web };
  },
  stopWebUi: async () => {
    await latency(400);
    web.running = false;
    return { ...web };
  },
  updateWebUi: async (patch: { startOnLaunch?: boolean; host?: string }) => {
    await latency();
    Object.assign(web, patch);
    return { ...web };
  },
  getHostMetrics: async () => {
    await latency(80);
    return { metrics: metrics() };
  },
  listOwnedStorage: async (o: { refresh?: boolean } = {}) => {
    await latency(o.refresh ? 1400 : 200);
    if (o.refresh) storageAt = ago(0);
    return { categories: storage, computedAt: storageAt };
  },
  cleanOwnedStorage: async (id: string) => {
    await latency(1000);
    let freed = 0;
    storage = storage.map((c) => {
      if (c.id !== id) return c;
      freed = c.reclaimableBytes;
      return { ...c, bytes: c.bytes - c.reclaimableBytes, reclaimableBytes: 0 };
    });
    return { success: true, freedBytes: freed, error: null };
  },
  collectDiagnostics: async () => {
    await latency(1200);
    const d = daemonStatus();
    return {
      diagnostic: [
        `frogg daemon ${VERSION} on ${HOST}`,
        `server id   ${d.serverId}`,
        `pid         ${d.pid}  node ${d.nodePath}`,
        `listen      ${d.listen}  relay ${d.relay.publicEndpoint}`,
        `platform    linux x64 · 16 cores · 64 GiB`,
        "",
        "providers",
        ...d.providers.map((p) => `  ${p.provider.padEnd(8)} ${p.available ? "ok" : p.error}`),
        "",
        `sessions    ${Object.keys(useDaemon.getState().sessions).length} live`,
        `storage     ${(storage.reduce((n, c) => n + c.bytes, 0) / GIB).toFixed(1)} GiB owned`,
      ].join("\n"),
    };
  },

  // Devices and pairing
  listDevices: async () => {
    await latency();
    return { devices };
  },
  listPairingRequests: async () => {
    await latency();
    return { requests };
  },
  decidePairingRequest: async (o: {
    pairingRequestId: string;
    decision: string;
    role?: string;
  }) => {
    await latency(400);
    const r = requests.find((x) => x.id === o.pairingRequestId);
    requests = requests.filter((x) => x.id !== o.pairingRequestId);
    if (r && o.decision === "approve")
      devices = [
        ...devices,
        {
          id: nextId("dev"),
          name: r.deviceName,
          role: o.role ?? "operator",
          current: false,
          connected: true,
          lastSeenAt: ago(0),
          createdAt: ago(0),
        },
      ];
    return { success: true, error: null };
  },
  createPairingCode: async (o: { role?: string; ttlSeconds?: number } = {}) => {
    await latency(300);
    const code = mintCode();
    const offer = `frogg://pair?host=192.168.1.20&port=7821&code=${code}`;
    return {
      code,
      role: o.role ?? "operator",
      expiresAt: ahead((o.ttlSeconds ?? 600) / 60),
      fingerprint: "SHA256:4f:9a:c2:7e:11:b0:5d:83",
      endpoints: [
        { host: "192.168.1.20", port: 7821, deepLink: offer },
        {
          host: "devbox.local",
          port: 7821,
          deepLink: offer.replace("192.168.1.20", "devbox.local"),
        },
      ],
      error: null,
    };
  },
  getDaemonPairingOffer: async () => {
    await latency();
    return {
      relayEnabled: true,
      url: "https://app.frogg.app/pair#offer=eyJzZXJ2ZXJJZCI6InNydl83ZjNhOWMyMWU0In0",
    };
  },
  renameDevice: async (o: { deviceId: string; name: string }) => {
    await latency();
    devices = devices.map((d) => (d.id === o.deviceId ? { ...d, name: o.name } : d));
    return { success: true, error: null };
  },
  setDeviceRole: async (o: { credentialId: string; role: string }) => {
    await latency();
    devices = devices.map((d) => (d.id === o.credentialId ? { ...d, role: o.role } : d));
    return { success: true, error: null };
  },
  revokeDevice: async (id: string) => {
    await latency(400);
    devices = devices.filter((d) => d.id !== id);
    return { success: true, error: null };
  },

  // Provider accounts
  createProviderAccount: async (o: { provider: string; name: string }) => {
    await latency(400);
    const a = {
      id: `${o.provider}-${o.name.toLowerCase().replace(/\W+/g, "-")}`,
      provider: o.provider,
      name: o.name,
      configDir: `~/.frogg/accounts/${o.provider}-${o.name}`,
      linkedFolders: [],
      createdAt: ago(0),
      authenticated: false,
      isActive: false,
      preferences: { color: "amber" },
    };
    accounts.push(a);
    return { account: a, error: null };
  },
  deleteProviderAccount: async (o: { accountId: string }) => {
    await latency(300);
    const at = accounts.findIndex((a) => a.id === o.accountId);
    if (at >= 0) accounts.splice(at, 1);
    return { success: true, error: null };
  },
  setActiveProviderAccount: async (o: { provider: string; accountId: string }) => {
    await latency(300);
    for (const a of accounts) if (a.provider === o.provider) a.isActive = a.id === o.accountId;
    return { success: true, error: null };
  },
  signOutProviderAccount: async (o: { accountId: string }) => {
    await latency(300);
    const a = accounts.find((x) => x.id === o.accountId);
    if (a) a.authenticated = false;
    return { success: true, error: null };
  },
  exportProviderAccounts: async (o: { provider: string }) => {
    await latency(400);
    const list = accounts.filter((a) => a.provider === o.provider);
    if (!list.length) return { bundle: null, error: null };
    return {
      error: null,
      bundle: {
        version: 1,
        provider: o.provider,
        exportedAt: ago(0),
        accounts: list.map((a) => ({
          name: a.name,
          files: { "credentials.json": "<redacted in lab>" },
        })),
      },
    };
  },
  importProviderAccounts: async (o: {
    bundle: { provider?: string; accounts?: Array<{ name: string }> };
  }) => {
    await latency(500);
    const provider = o.bundle?.provider;
    if (!provider) return { error: "Bundle has no provider", imported: 0 };
    let imported = 0;
    for (const x of o.bundle.accounts ?? []) {
      const id = `${provider}-${x.name}`;
      if (accounts.some((a) => a.id === id)) continue;
      imported += 1;
      accounts.push({
        ...accounts[0],
        id,
        provider,
        name: x.name,
        isActive: false,
        authenticated: true,
        createdAt: ago(0),
      });
    }
    return { error: null, imported };
  },

  // Orchestration
  listSkills: async () => {
    await latency();
    return { skills: skills.map((s) => ({ ...s })), error: null };
  },
  setSkillEnabled: async (id: string, enabled: boolean) => {
    await latency();
    const s = skills.find((x) => x.id === id);
    if (s) s.enabled = enabled;
    return { success: true, error: null };
  },
  getSkillContent: async (id: string) => {
    await latency(250);
    const s = skills.find((x) => x.id === id);
    if (!s) return { content: "", error: `No skill ${id}` };
    return {
      error: null,
      content: `---\nname: ${s.name}\ndescription: ${s.description}\n---\n\n# ${s.name}\n\n1. Read AGENTS.md first.\n2. Build the workspace in order: protocol, client, server.\n3. Run the narrowest test that covers your change.`,
    };
  },
  listProviderAgentDefinitions: async () => {
    await latency();
    return {
      error: null,
      definitions: [
        { provider: "claude", name: "reviewer", path: "~/.claude/agents/reviewer.md" },
        { provider: "claude", name: "test-writer", path: "~/.claude/agents/test-writer.md" },
        { provider: "codex", name: "migrations", path: "~/.codex/agents/migrations.toml" },
      ],
    };
  },

  // Project config and to-dos
  readProjectConfig: async (repoRoot: string) => {
    await latency();
    return {
      ok: true,
      revision: "rev-1",
      config: {
        setup: ["npm ci", "npm run build --workspace=@frogg/protocol"],
        scripts: {
          dev: { command: "npm run dev", port: 7830 },
          test: { command: "npm test" },
        },
        repoRoot,
      },
    };
  },
  writeProjectConfig: async (o: { config: unknown; expectedRevision: string | null }) => {
    await latency(300);
    return { ok: true, revision: nextId("rev"), config: o.config };
  },
  listProjectTodos: async (o: { projectId: string }) => {
    await latency();
    return { items: todos[o.projectId] ?? [], error: null };
  },
  createProjectTodo: async (o: {
    projectId: string;
    title: string;
    description?: string;
    priority?: string;
  }) => {
    await latency(300);
    const item = {
      id: nextId("t"),
      title: o.title,
      description: o.description ?? "",
      priority: o.priority ?? "medium",
      category: null,
      status: "backlog",
      claims: [],
    };
    todos[o.projectId] = [...(todos[o.projectId] ?? []), item];
    return { item, error: null };
  },
  setProjectTodoStatus: async (o: { projectId: string; todoId: string; status: string }) => {
    await latency(250);
    const t = todos[o.projectId]?.find((x) => x.id === o.todoId);
    if (t) t.status = o.status;
    return { error: null };
  },

  // Companion
  fetchCompanionNotebook: async () => {
    await latency(250);
    return notebook;
  },
  sendCompanionMessage: async (text: string) => {
    await latency(200);
    void (async () => {
      await labWait(1400);
      const entry = {
        id: nextId("n"),
        kind: "task",
        text,
        status: "open",
        agentId: null,
        updatedAt: ago(0),
      };
      notebook = { updatedAt: ago(0), entries: [entry, ...notebook.entries] };
      emitEvent({ type: "companion.notebook.update", payload: { notebook } });
      emitEvent({
        type: "companion.reply",
        payload: {
          text: `Noted — I added “${text}” to the notebook. Want me to start an agent on it?`,
          isFinal: true,
        },
      });
    })();
    return { accepted: true };
  },

  // Plugins
  pluginsList: async () => {
    await latency();
    return { plugins: plugins.map((p) => ({ ...p })) };
  },
  pluginsGetCatalog: async () => {
    await latency(400);
    return { plugins: catalog() };
  },
  pluginsInstall: async (o: { id: string; version?: string }) => {
    await labWait(1600);
    const c = catalog().find((x) => x.id === o.id);
    if (!plugins.some((p) => p.id === o.id))
      plugins = [
        ...plugins,
        {
          id: o.id,
          name: c?.name ?? o.id,
          description: c?.description ?? "",
          version: o.version ?? "0.1.0",
          enabled: true,
          status: "active",
          error: null,
          devPath: null,
          preinstalled: false,
          updateAvailable: null,
        },
      ];
    return { success: true, error: null };
  },
  pluginsSetEnabled: async (id: string, enabled: boolean) => {
    await latency(300);
    const p = plugins.find((x) => x.id === id);
    if (p) Object.assign(p, { enabled, status: enabled ? "active" : "disabled" });
    return { success: true };
  },
  pluginsGetContributions: async () => {
    await latency();
    return {
      contributions: [
        {
          pluginId: "frogg-linear",
          panels: [
            { id: "issues", title: "My issues" },
            { id: "settings", title: "Quick settings" },
          ],
        },
        { pluginId: "frogg-sentry", panels: [{ id: "recent", title: "Recent errors" }] },
      ],
    };
  },
  pluginsRpcCall: async (o: {
    pluginId: string;
    method: string;
    params?: Record<string, unknown>;
  }) => {
    await latency(250);
    if (o.method === "panel.issues.render")
      return {
        result: {
          kind: "list",
          emptyText: "No assigned issues.",
          items: linearIssues.map((i) => ({
            ...i,
            action: { method: "issues.done", params: { id: i.id } },
          })),
        },
      };
    if (o.method === "issues.done") {
      linearIssues = linearIssues.filter((i) => i.id !== o.params?.id);
      return { result: { ok: true } };
    }
    if (o.method === "panel.settings.render")
      return {
        result: {
          kind: "form",
          fields: settingFields["frogg-linear"].slice(1),
          values: pluginSettings["frogg-linear"],
          submitLabel: "Save",
        },
      };
    if (o.method.endsWith(".submit")) {
      Object.assign(pluginSettings[o.pluginId] ?? {}, (o.params?.values ?? {}) as object);
      return { result: { ok: true } };
    }
    return {
      result: {
        kind: "markdown",
        markdown:
          "**3 new errors** in the last hour\n\n- `TypeError: cannot read 'cwd'` · 41 events\n- `RelayTimeout` · 12 events",
      },
    };
  },
  pluginsSettingsGet: async (id: string) => {
    await latency();
    return { fields: settingFields[id] ?? [], values: { ...pluginSettings[id] } };
  },
  pluginsSettingsSet: async (id: string, values: Record<string, unknown>) => {
    await latency(300);
    pluginSettings[id] = { ...pluginSettings[id], ...values };
    return { success: true };
  },
  pluginsReposList: async () => {
    await latency();
    return { repos };
  },
  pluginsReposAdd: async (o: { url: string; publicKey?: string }) => {
    await latency(600);
    const repo = {
      url: o.url,
      name: o.url.replace(/^https?:\/\/(github\.com\/)?/, ""),
      tier: "community",
      pluginCount: 2,
      publicKey: o.publicKey ?? null,
      error: null,
      removable: true,
    };
    repos = [...repos, repo];
    return { repo };
  },
  pluginsReposRemove: async (url: string) => {
    await latency(300);
    repos = repos.filter((r) => r.url !== url);
    return { success: true };
  },

  // Terminals
  listTerminals: async () => {
    await latency(80);
    return { terminals: labTerminals() };
  },
  createTerminal: async (cwd: string) => {
    await latency(250);
    const t: LabTerminal = {
      id: nextId("term"),
      name: `bash ${terminals.length + 1}`,
      title: "bash",
      cwd,
      buffer: `Last login: ${new Date().toUTCString()} on pts/${terminals.length + 2}\r\n${PROMPT}`,
      line: "",
    };
    terminals.push(t);
    return { terminal: termInfo(t), error: null };
  },
  killTerminal: async (id: string) => {
    await latency();
    const at = terminals.findIndex((t) => t.id === id);
    if (at >= 0) terminals.splice(at, 1);
    return { success: true };
  },
  subscribeTerminal: async (id: string) => {
    await latency(60);
    const t = terminals.find((x) => x.id === id);
    if (!t) return { terminalId: id, error: "Terminal not found" };
    const bytes = encoder.encode(t.buffer);
    for (const fn of streamHandlers) fn({ terminalId: id, type: "restore", data: bytes });
    return { terminalId: id, error: null };
  },
  unsubscribeTerminal: () => {},
  sendTerminalInput: (id: string, msg: { type: string; data?: string }) => {
    const t = terminals.find((x) => x.id === id);
    if (t && msg.type === "input" && msg.data) input(t, msg.data);
  },
  onTerminalStreamEvent: (fn: (e: unknown) => void) => {
    streamHandlers.add(fn);
    return () => streamHandlers.delete(fn);
  },
};
