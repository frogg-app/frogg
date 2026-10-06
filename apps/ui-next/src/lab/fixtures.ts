// Fixture data for the component lab: sessions, timelines, providers and usage, shaped like
// the daemon's payloads. Everything here is invented; nothing is read from a host.
import type { ToolCallDetail } from "@frogg/protocol/agent-types";
import type { Agent, Placement, Session, TimelineEntry, TimelineItem } from "../daemon/types";

export type Permission = Agent["pendingPermissions"][number];

const MIN = 60_000;
export const ago = (mins: number) => new Date(Date.now() - mins * MIN).toISOString();
export const ahead = (mins: number) => new Date(Date.now() + mins * MIN).toISOString();

const MODES = [
  { id: "default", label: "Default", description: "Ask before edits and commands" },
  { id: "acceptEdits", label: "Accept edits", description: "Edit files without asking" },
  { id: "plan", label: "Plan", description: "Read-only until a plan is approved" },
];

export function agent(p: Partial<Agent> & { id: string }): Agent {
  const base = {
    provider: "claude",
    cwd: "/home/dev/frogg",
    model: "claude-opus-4-5",
    createdAt: ago(240),
    updatedAt: ago(4),
    lastUserMessageAt: ago(6),
    lastUsageAt: ago(5),
    status: "idle",
    capabilities: {
      supportsStreaming: true,
      supportsSessionPersistence: true,
      supportsDynamicModes: true,
      supportsMcpServers: true,
      supportsReasoningStream: true,
      supportsToolInvocations: true,
    },
    currentModeId: "default",
    availableModes: MODES,
    pendingPermissions: [],
    persistence: null,
    title: null,
    labels: {},
  };
  return { ...base, ...p } as Agent;
}

export function placement(project: string, branch: string | null): Placement {
  const cwd = `/home/dev/${project}`;
  return {
    projectKey: project,
    projectName: project,
    checkout: {
      cwd,
      isGit: true,
      currentBranch: branch,
      remoteUrl: `git@github.com:frogg-app/${project}.git`,
      worktreeRoot: cwd,
      isFroggOwnedWorktree: false,
      mainRepoRoot: null,
    },
  };
}

export const shellPermission: Permission = {
  id: "perm-shell",
  provider: "claude",
  name: "Bash",
  kind: "tool",
  title: "npm run test -- invoices",
  description: "Runs the invoice renderer tests (writes to coverage/).",
  input: { command: "npm run test -- invoices" },
  actions: [
    { id: "allow-session", label: "Allow for session", behavior: "allow" },
    { id: "accept", label: "Approve", behavior: "allow", variant: "primary" },
  ],
};

export const toolPermission: Permission = {
  id: "perm-edit",
  provider: "claude",
  name: "Edit",
  kind: "tool",
  title: "Edit src/billing/invoice.ts",
  description: "Replace the PDF page-break heuristic with measured line heights.",
};

export const planPermission: Permission = {
  id: "perm-plan",
  provider: "claude",
  name: "ExitPlanMode",
  kind: "plan",
  input: {
    plan: [
      "## Make the session cache cap configurable",
      "",
      "1. Add `sessionCache.maxEntries` to the daemon config schema (default 200).",
      "2. Read it in `SessionStore` and evict least-recently-used entries past the cap.",
      "3. Log each eviction at `debug` with the agent id and age.",
      "4. Cover eviction order and the config default with unit tests.",
    ].join("\n"),
  },
};

export const questionPermission: Permission = {
  id: "perm-question",
  provider: "claude",
  name: "AskUserQuestion",
  kind: "question",
  input: {
    questions: [
      {
        question: "Which storage should drafts use on Android?",
        header: "Draft storage",
        options: [
          { label: "AsyncStorage", description: "Simple, already a dependency" },
          { label: "SQLite", description: "Queryable; a new native module" },
          { label: "Files", description: "One JSON file per draft" },
        ],
      },
      {
        question: "Keep drafts after a session is archived?",
        header: "Retention",
        options: [{ label: "Yes, for 30 days" }, { label: "No, delete with the session" }],
      },
    ],
  },
};

const DIFF = [
  "--- a/src/store/session-store.ts",
  "+++ b/src/store/session-store.ts",
  "@@ -41,7 +41,12 @@ export class SessionStore {",
  "   private readonly entries = new Map<string, Entry>();",
  "-  private readonly max = 200;",
  "+  private readonly max: number;",
  "+",
  "+  constructor(config: DaemonConfig) {",
  "+    this.max = config.sessionCache?.maxEntries ?? 200;",
  "+  }",
  " ",
  "   set(id: string, entry: Entry): void {",
  "-    if (this.entries.size > this.max) this.entries.clear();",
  "+    if (this.entries.size >= this.max) this.evictOldest();",
].join("\n");

const READ = `import { describe, expect, it } from "vitest";
import { SessionStore } from "./session-store";

describe("SessionStore", () => {
  it("evicts the least recently used entry", () => {
    const store = new SessionStore({ sessionCache: { maxEntries: 2 } });
    store.set("a", entry());
    store.set("b", entry());
    store.get("a");
    store.set("c", entry());
    expect(store.has("b")).toBe(false);
  });
});
`;

export const toolDetails: Record<string, ToolCallDetail> = {
  read: { type: "read", filePath: "src/store/session-store.test.ts", content: READ, limit: 13 },
  edit: { type: "edit", filePath: "src/store/session-store.ts", unifiedDiff: DIFF },
  shell: {
    type: "shell",
    command: "npm run test -- session-store",
    output:
      " RUN  v3.2.4 /home/dev/frogg\n\n ✓ src/store/session-store.test.ts (6 tests) 14ms\n\n Test Files  1 passed (1)\n      Tests  6 passed (6)\n",
    exitCode: 0,
  },
  shellFailed: {
    type: "shell",
    command: "npm run typecheck",
    output:
      "src/store/session-store.ts:44:5 - error TS2322: Type 'number | undefined' is not assignable to type 'number'.\n\nFound 1 error.",
    exitCode: 2,
  },
  search: {
    type: "search",
    query: "maxEntries",
    toolName: "grep",
    numMatches: 4,
    content:
      "src/store/session-store.ts:44:    this.max = config.sessionCache?.maxEntries ?? 200;\npackages/protocol/src/messages.ts:2210:  maxEntries: z.number().int().positive().optional(),\ndocs/configuration.md:118:| `sessionCache.maxEntries` | 200 | Sessions kept in memory |",
  },
  glob: {
    type: "search",
    query: "src/**/*.test.ts",
    toolName: "glob",
    numFiles: 38,
    filePaths: ["src/store/session-store.test.ts", "src/store/config.test.ts"],
  },
  fetch: {
    type: "fetch",
    url: "https://developer.mozilla.org/en-US/docs/Web/API/Web_Animations_API",
    code: 200,
    result:
      "## Web Animations API\n\nThe **Web Animations API** lets you synchronise and time changes to a page's presentation.",
  },
  write: {
    type: "write",
    filePath: "docs/session-cache.md",
    content:
      "# Session cache\n\nThe daemon keeps up to `sessionCache.maxEntries` sessions in memory.\n",
  },
  subAgent: {
    type: "sub_agent",
    subAgentType: "Explore",
    description: "Find every reader of the session cache",
    log: "Searched 412 files\nFound 3 readers: SessionStore, AgentManager, the timeline projector",
    actions: [
      { index: 0, toolName: "Grep", summary: "SessionStore" },
      { index: 1, toolName: "Read", summary: "agent-manager.ts" },
      { index: 2, toolName: "Read", summary: "timeline-projector.ts" },
    ],
  },
  plan: {
    type: "plan",
    text: "Make the session cache cap configurable\n\n- schema\n- eviction\n- tests",
  },
  plainText: { type: "plain_text", label: "Skill", text: "Loaded skill frogg-dev" },
  worktree: {
    type: "worktree_setup",
    worktreePath: "/home/dev/.frogg/worktrees/session-cache",
    branchName: "feat/session-cache-cap",
    log: "$ npm ci\nadded 1412 packages in 21s\n$ npm run build:client\nbuilt in 3.1s",
    commands: [
      { index: 0, command: "npm ci", cwd: ".", log: "", status: "completed", exitCode: 0 },
      {
        index: 1,
        command: "npm run build:client",
        cwd: ".",
        log: "",
        status: "completed",
        exitCode: 0,
      },
    ],
  },
  unknown: { type: "unknown", input: { query: "frogg" }, output: { hits: 3 } },
};

let seq = 0;
export function entry(item: TimelineItem, turnId = "turn-1"): TimelineEntry {
  seq += 1;
  return {
    provider: "claude",
    item,
    turnId,
    timestamp: ago(10 - seq / 10),
    seqStart: seq,
    seqEnd: seq,
    sourceSeqRanges: [],
    collapsed: [],
  };
}

export function toolItem(
  callId: string,
  name: string,
  detail: ToolCallDetail,
  status: "running" | "completed" | "failed" = "completed",
  error: string | null = null,
): TimelineItem {
  return { type: "tool_call", callId, name, detail, status, error } as TimelineItem;
}

const REPLY = `The cache cap is now configurable. Summary of the change:

- **Config:** \`sessionCache.maxEntries\` (default \`200\`) in the daemon config schema.
- **Eviction:** least-recently-used entries go first, one at a time, instead of clearing the map.
- **Logging:** each eviction logs at \`debug\` with the agent id and its idle time.

\`\`\`ts
if (this.entries.size >= this.max) this.evictOldest();
\`\`\`

Tests cover eviction order and the default. Typecheck and the store suite pass.`;

export function previewTimeline(): TimelineEntry[] {
  return [
    entry({
      type: "user_message",
      text: "Make the session cache cap configurable via config.json and log evictions at debug.",
      messageId: "u1",
    }),
    entry({
      type: "reasoning",
      text: "The cap is hard-coded in SessionStore. I should find every reader before changing the constructor, then thread the config through.",
    }),
    entry(toolItem("c1", "Grep", toolDetails.search)),
    entry(toolItem("c2", "Read", toolDetails.read)),
    entry(toolItem("c3", "Edit", toolDetails.edit)),
    entry(toolItem("c4", "Bash", toolDetails.shellFailed, "failed", "exit code 2")),
    entry(toolItem("c5", "Edit", toolDetails.edit)),
    entry(toolItem("c6", "Bash", toolDetails.shell)),
    entry({
      type: "todo",
      items: [
        { text: "Add sessionCache.maxEntries to the schema", completed: true },
        { text: "Evict least-recently-used entries", completed: true },
        { text: "Log evictions at debug", completed: true },
        { text: "Document the key", completed: false },
      ],
    }),
    entry({ type: "assistant_message", text: REPLY, messageId: "a1" }),
  ];
}

// ---- sessions ----

export const ID = {
  preview: "s-preview",
  failed: "s-failed",
  needs: "s-needs",
  plan: "s-plan",
  question: "s-question",
  working: "s-working",
  review: "s-review",
  idle: "s-idle",
} as const;

function session(a: Agent, project: string, branch: string | null): Session {
  return { agent: a, project: placement(project, branch) };
}

export function sessions(): Record<string, Session> {
  const list: Session[] = [
    session(
      agent({
        id: ID.preview,
        title: "Preview chat",
        updatedAt: ago(3),
        requiresAttention: true,
        attentionReason: "finished",
      }),
      "frogg",
      "feat/session-cache-cap",
    ),
    session(
      agent({
        id: ID.failed,
        title: "Stripe webhook retries",
        status: "error",
        provider: "codex",
        model: "gpt-5-codex",
        lastError: "Error: 3 tests failed in webhooks.test.ts (timeout after 5000ms)",
        updatedAt: ago(12),
      }),
      "billing",
      "fix/webhook-retries",
    ),
    session(
      agent({
        id: ID.needs,
        title: "Invoice PDF renderer",
        status: "running",
        pendingPermissions: [shellPermission],
        attentionReason: "permission",
        requiresAttention: true,
        updatedAt: ago(1),
      }),
      "billing",
      "feat/invoice-pdf",
    ),
    session(
      agent({
        id: ID.plan,
        title: "Session cache eviction plan",
        status: "running",
        currentModeId: "plan",
        pendingPermissions: [planPermission],
        attentionReason: "permission",
        requiresAttention: true,
        updatedAt: ago(2),
      }),
      "frogg",
      "feat/session-cache-plan",
    ),
    session(
      agent({
        id: ID.question,
        title: "Android draft storage",
        status: "running",
        pendingPermissions: [questionPermission],
        attentionReason: "permission",
        requiresAttention: true,
        updatedAt: ago(7),
      }),
      "frogg",
      "feat/drafts",
    ),
    session(
      agent({ id: ID.working, title: "Interface redesign (ui-next)", status: "running" }),
      "frogg",
      "frogg-interface-design-mockups",
    ),
    session(
      agent({
        id: ID.review,
        title: "Bump lucide icons",
        requiresAttention: true,
        attentionReason: "finished",
        updatedAt: ago(25),
      }),
      "frogg",
      "chore/lucide",
    ),
    session(
      agent({ id: ID.idle, title: "Docs: pairing guide", updatedAt: ago(60 * 26) }),
      "website",
      "docs/pairing",
    ),
  ];
  return Object.fromEntries(list.map((x) => [x.agent.id, x]));
}

export function timelines(): Record<string, TimelineEntry[]> {
  const short = (text: string) => [
    entry({ type: "user_message", text, messageId: "u0" }),
    entry(toolItem("r0", "Read", toolDetails.read)),
  ];
  return {
    [ID.preview]: previewTimeline(),
    [ID.failed]: [
      ...short("Retry Stripe webhooks with exponential backoff."),
      entry(toolItem("f1", "Bash", toolDetails.shellFailed, "failed", "exit code 2")),
      entry({ type: "error", message: "Error: 3 tests failed in webhooks.test.ts" }),
    ],
    [ID.needs]: short("Render invoices to PDF with measured line heights."),
    [ID.plan]: short("Plan how to make the session cache cap configurable."),
    [ID.question]: short("Persist composer drafts on Android."),
    [ID.working]: [
      ...short("Build the component lab."),
      entry(toolItem("w1", "Bash", toolDetails.shell, "running")),
    ],
    [ID.review]: [
      ...short("Bump lucide-react-native to the latest minor."),
      entry({
        type: "assistant_message",
        text: "Bumped to 0.546.0; no icon renames.",
        messageId: "a0",
      }),
    ],
    [ID.idle]: short("Draft the pairing guide."),
  };
}

// ---- providers, projects, commands, accounts, usage ----

export const providers = {
  entries: [
    {
      provider: "claude",
      label: "Claude Code",
      status: "ready",
      enabled: true,
      defaultModeId: "default",
      modes: MODES,
      models: [
        {
          id: "claude-opus-4-5",
          label: "Opus 4.5",
          description: "Most capable",
          isDefault: true,
        },
        { id: "claude-sonnet-4-5", label: "Sonnet 4.5", description: "Fast and capable" },
        { id: "claude-haiku-4-5", label: "Haiku 4.5", description: "Fastest" },
      ],
    },
    {
      provider: "codex",
      label: "Codex",
      status: "ready",
      enabled: true,
      defaultModeId: "auto",
      modes: [
        { id: "auto", label: "Auto", description: "Edit and run in the workspace" },
        { id: "read-only", label: "Read only", description: "No writes" },
      ],
      models: [{ id: "gpt-5-codex", label: "GPT-5 Codex", isDefault: true }],
    },
  ],
};

export const projects = [
  {
    projectId: "p-frogg",
    projectKey: "frogg",
    projectDisplayName: "frogg",
    projectRootPath: "/home/dev/frogg",
    projectKind: "git",
  },
  {
    projectId: "p-billing",
    projectKey: "billing",
    projectDisplayName: "billing",
    projectRootPath: "/home/dev/billing",
    projectKind: "git",
  },
  {
    projectId: "p-notes",
    projectKey: "notes",
    projectDisplayName: "notes",
    projectRootPath: "/home/dev/notes",
    projectKind: "directory",
  },
];

export const commands = [
  { name: "compact", description: "Summarise the conversation to free context", kind: "command" },
  { name: "review", description: "Review the current diff", kind: "command" },
  { name: "init", description: "Write an AGENTS.md for this repository", kind: "command" },
  { name: "frogg-dev", description: "Build, run and test the Frogg monorepo", kind: "skill" },
  { name: "frogg-docs", description: "Update docs when code changes", kind: "skill" },
];

const acct = (
  id: string,
  provider: string,
  name: string,
  isActive: boolean,
  authenticated: boolean,
  tint: string,
) => ({
  id,
  provider,
  name,
  configDir: id.startsWith("default:") ? `~/.${provider}` : `~/.frogg/accounts/${provider}-${name}`,
  linkedFolders: [],
  createdAt: ago(60 * 24 * 30),
  authenticated,
  isActive,
  preferences: { color: tint },
});

export const accounts = [
  acct("default:claude", "claude", "work", true, true, "sky"),
  acct("claude-personal", "claude", "personal", false, true, "violet"),
  acct("default:codex", "codex", "default", true, true, "emerald"),
  acct("codex-acme", "codex", "acme", false, false, "orange"),
];

const win = (id: string, label: string, usedPct: number, resetMins: number) => ({
  id,
  label,
  usedPct,
  resetsAt: ahead(resetMins),
});

function usageBase(providerId: string, displayName: string, extra: object) {
  return {
    providerId,
    displayName,
    status: "available",
    planLabel: null,
    fetchedAt: ago(0),
    windows: [],
    balances: [],
    details: [],
    error: null,
    ...extra,
  };
}

export const usage: Record<string, object> = {
  "claude:default:claude": usageBase("claude", "Claude", {
    planLabel: "Max 20x",
    accountEmail: "dev@work.example",
    windows: [
      win("five_hour", "Session", 42, 72),
      win("weekly", "Weekly", 86, 3 * 1440),
      win("weekly_model_opus", "Opus weekly", 71, 3 * 1440),
    ],
  }),
  "claude:claude-personal": usageBase("claude", "Claude", {
    planLabel: "Pro",
    accountEmail: "dev@home.example",
    fetchedAt: ago(40),
    windows: [win("five_hour", "Session", 8, 190), win("weekly", "Weekly", 31, 5 * 1440)],
  }),
  "codex:default:codex": usageBase("codex", "Codex", {
    planLabel: "plus",
    accountEmail: "dev@openai.example",
    windows: [win("session", "Session", 63, 140), win("weekly", "Weekly", 54, 4 * 1440)],
    balances: [{ id: "credits", label: "Credits", remaining: 0, unit: "usd" }],
  }),
  "codex:codex-acme": usageBase("codex", "Codex", { status: "unavailable" }),
  copilot: usageBase("copilot", "GitHub Copilot", {
    planLabel: "individual",
    accountEmail: "dev",
    windows: [win("premium", "Premium requests", 23, 12 * 1440)],
  }),
  cursor: usageBase("cursor", "Cursor", { status: "unavailable" }),
};

// ---- source control ----

export function checkoutStatus(cwd: string) {
  return {
    cwd,
    error: null,
    requestId: "lab",
    isGit: true,
    isFroggOwnedWorktree: false,
    repoRoot: cwd,
    mainRepoRoot: null,
    currentBranch: "feat/session-cache-cap",
    isDirty: true,
    baseRef: "main",
    aheadBehind: { ahead: 2, behind: 0 },
    aheadOfOrigin: 2,
    behindOfOrigin: 0,
    hasRemote: true,
    remoteUrl: "git@github.com:frogg-app/frogg.git",
  };
}

const line = (type: "add" | "remove" | "context", content: string) => ({ type, content });
export const diffFiles = [
  {
    path: "src/store/session-store.ts",
    isNew: false,
    isDeleted: false,
    additions: 6,
    deletions: 2,
    hunks: [
      {
        oldStart: 41,
        oldCount: 7,
        newStart: 41,
        newCount: 12,
        lines: [
          line("context", "  private readonly entries = new Map<string, Entry>();"),
          line("remove", "  private readonly max = 200;"),
          line("add", "  private readonly max: number;"),
          line("add", ""),
          line("add", "  constructor(config: DaemonConfig) {"),
          line("add", "    this.max = config.sessionCache?.maxEntries ?? 200;"),
          line("add", "  }"),
          line("context", ""),
          line("context", "  set(id: string, entry: Entry): void {"),
          line("remove", "    if (this.entries.size > this.max) this.entries.clear();"),
          line("add", "    if (this.entries.size >= this.max) this.evictOldest();"),
        ],
      },
    ],
  },
  {
    path: "docs/session-cache.md",
    isNew: true,
    isDeleted: false,
    additions: 3,
    deletions: 0,
    hunks: [
      {
        oldStart: 0,
        oldCount: 0,
        newStart: 1,
        newCount: 3,
        lines: [
          line("add", "# Session cache"),
          line("add", ""),
          line("add", "The daemon keeps up to `sessionCache.maxEntries` sessions in memory."),
        ],
      },
    ],
  },
];
