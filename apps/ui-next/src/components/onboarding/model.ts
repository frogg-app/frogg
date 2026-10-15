// First-run onboarding: the steps, the two profile questions and how the answers tailor the flow.
// Pure data and functions, so the tailoring is testable without rendering anything.

/** How technical the user says they are: decides how much each step explains. */
export type Level = "new" | "some" | "expert";
/** What they mostly work on (several allowed): decides which tools and settings get pointed at. */
export type Work = "web" | "backend" | "mobile" | "data" | "infra" | "explore";

export type StepId =
  | "level"
  | "work"
  | "host"
  | "providers"
  | "session"
  | "concepts"
  | "settings"
  | "done";

export interface StepMeta {
  id: StepId;
  /** Short name in the step list. */
  label: string;
  /** Set up something on the host, so it can complete itself (host online, provider ready). */
  setup?: boolean;
}

export const STEPS: readonly StepMeta[] = [
  { id: "level", label: "About you" },
  { id: "work", label: "Your work" },
  { id: "host", label: "Connect a host", setup: true },
  { id: "providers", label: "Agent providers", setup: true },
  { id: "session", label: "First session", setup: true },
  { id: "concepts", label: "Key concepts" },
  { id: "settings", label: "Settings for you" },
  { id: "done", label: "Ready" },
];

export const STEP_IDS: readonly StepId[] = STEPS.map((x) => x.id);
/** Steps that count toward progress ("done" is the finish line, not a task). */
export const TASKS: readonly StepId[] = STEP_IDS.filter((id) => id !== "done");

export const LEVELS: ReadonlyArray<{ id: Level; title: string; sub: string }> = [
  {
    id: "new",
    title: "New to this",
    sub: "Walk me through it. Explain hosts, agents and worktrees as we go.",
  },
  {
    id: "some",
    title: "Comfortable",
    sub: "I use an editor and git daily. Short explanations, then let me work.",
  },
  {
    id: "expert",
    title: "Expert",
    sub: "I run agents already. Show me where things are and get out of the way.",
  },
];

export const WORKS: ReadonlyArray<{ id: Work; title: string; sub: string }> = [
  { id: "web", title: "Web & front end", sub: "Sites, apps, UI" },
  { id: "backend", title: "Back end & APIs", sub: "Services, databases" },
  { id: "mobile", title: "Mobile & desktop", sub: "Native and Electron apps" },
  { id: "data", title: "Data & ML", sub: "Notebooks, pipelines, models" },
  { id: "infra", title: "Infra & DevOps", sub: "Servers, CI, deploys" },
  { id: "explore", title: "Exploring", sub: "Learning, side projects" },
];

/** Where the next step is, skipping ones already done unless the user went back on purpose. */
export function nextStep(from: StepId, done: ReadonlySet<StepId>, level: Level | null): StepId {
  const at = STEP_IDS.indexOf(from);
  for (const id of STEP_IDS.slice(at + 1)) {
    // Experts skip set-up steps that already finished themselves; everyone else sees them ticked.
    if (level === "expert" && done.has(id) && STEPS.find((x) => x.id === id)?.setup) continue;
    return id;
  }
  return "done";
}

export function prevStep(from: StepId): StepId {
  const at = STEP_IDS.indexOf(from);
  return STEP_IDS[Math.max(0, at - 1)];
}

/** One concept card. `deep` is extra detail shown only to people who asked to be walked through. */
export interface Concept {
  id: string;
  title: string;
  body: string;
  deep?: string;
  /** Rail tool or settings page it lives in, for the "Show me" link. */
  tool?: "sessions" | "scm" | "terminals" | "hosts" | "prs" | "tasks" | "files";
  page?: string;
}

const CORE: Concept[] = [
  {
    id: "sessions",
    title: "Sessions",
    body: "A session is one agent working in one folder. It keeps running on the host when you close the app.",
    deep: "Sessions that need you (a permission, a question) rise to the top of the list and badge the rail. Open one to read its transcript and reply.",
    tool: "sessions",
  },
  {
    id: "worktrees",
    title: "Worktrees",
    body: "Start a session on a new branch and Frogg gives it its own git worktree, so agents never edit your checkout.",
    deep: "A worktree is a second working copy of the same repository. Several agents can each have one and work in parallel without stepping on each other.",
    page: "worktrees",
  },
  {
    id: "permissions",
    title: "Permissions",
    body: "Agents ask before they run commands or edit files. The permission mode decides how often they ask.",
    deep: "Start on Ask or Plan while you learn what an agent does; move to auto-accepting edits once you trust it on a project.",
    page: "modes",
  },
  {
    id: "tools",
    title: "Tools",
    body: "The rail holds the tools around a session: files, source control, terminals, PRs and CI, tasks.",
    deep: "Each tool opens beside the session it relates to. ⌘K (Ctrl+K) opens the command palette when you know what you want.",
    tool: "files",
  },
  {
    id: "hosts",
    title: "Hosts",
    body: "The daemon on a host runs the agents. This app is a client: connect it to as many hosts as you like.",
    deep: "Pair your phone with the same host to follow sessions and answer permissions away from your desk.",
    tool: "hosts",
  },
];

const BY_WORK: Record<Work, Concept> = {
  web: {
    id: "scripts",
    title: "Dev servers",
    body: "Define dev servers in frogg.json and each worktree runs them on its own ports.",
    page: "scripts",
  },
  backend: {
    id: "terminals",
    title: "Terminals",
    body: "Terminals run on the host beside the agent, in the same checkout, and survive reconnects.",
    tool: "terminals",
  },
  mobile: {
    id: "prs",
    title: "PRs & CI",
    body: "Follow pull requests and CI runs for the session's branch without leaving the app.",
    tool: "prs",
  },
  data: {
    id: "files",
    title: "Files",
    body: "Browse and preview files on the host, including large outputs the agent wrote.",
    tool: "files",
  },
  infra: {
    id: "multi-host",
    title: "Many hosts",
    body: "Every saved host stays connected; sessions from all of them show together.",
    tool: "hosts",
  },
  explore: {
    id: "ask",
    title: "Just ask",
    body: "No project needed: ask a question from Home and an agent answers in a scratch session.",
    tool: "sessions",
  },
};

/** Concept cards for this profile: the core set, trimmed for experts, plus one per kind of work. */
export function conceptsFor(level: Level | null, work: readonly Work[]): Concept[] {
  const core = level === "expert" ? CORE.filter((c) => c.id !== "tools") : CORE;
  const extra: Concept[] = [];
  for (const w of work) {
    const c = BY_WORK[w];
    if (!extra.some((x) => x.id === c.id) && !core.some((x) => x.id === c.id)) extra.push(c);
  }
  return [...core, ...extra];
}

/** Whether a concept shows its `deep` paragraph. */
export const showDeep = (level: Level | null) => level === "new";

export interface SettingTip {
  page: string;
  label: string;
  why: string;
}

const TIP: Record<string, SettingTip> = {
  modes: {
    page: "modes",
    label: "Permission modes",
    why: "Choose how often agents ask before acting.",
  },
  notify: {
    page: "notify",
    label: "Notifications & inbox",
    why: "Get told when an agent needs you or finishes.",
  },
  providers: {
    page: "providers",
    label: "Providers & models",
    why: "Default models, and providers you don't use.",
  },
  keys: { page: "keys", label: "Keyboard shortcuts", why: "Palette, new session, approve, deny." },
  worktrees: {
    page: "worktrees",
    label: "Worktrees",
    why: "Where worktrees live and what runs when one is created.",
  },
  tools: {
    page: "tools",
    label: "Tools, skills & prompts",
    why: "MCP servers, skills and reusable prompts.",
  },
  scripts: {
    page: "scripts",
    label: "Scripts & services",
    why: "Dev servers and their ports per worktree.",
  },
  ci: { page: "ci", label: "CI & release streams", why: "Which CI and branches to follow." },
  devices: {
    page: "devices",
    label: "Devices & access",
    why: "Pair a phone, review who can reach this host.",
  },
  security: { page: "security", label: "Security", why: "LAN trust, password and claim mode." },
  terminals: {
    page: "terminals",
    label: "Terminal profiles",
    why: "Shells and environments for host terminals.",
  },
  resources: {
    page: "resources",
    label: "Resources & storage",
    why: "Disk and memory the host's agents use.",
  },
  usage: { page: "usage", label: "Usage & limits", why: "Plan usage meters and warnings." },
};

const LEVEL_TIPS: Record<Level, string[]> = {
  new: ["modes", "notify", "providers"],
  some: ["modes", "notify", "worktrees"],
  expert: ["keys", "worktrees", "tools"],
};

const WORK_TIPS: Record<Work, string[]> = {
  web: ["scripts"],
  backend: ["terminals", "scripts"],
  mobile: ["ci", "devices"],
  data: ["resources", "terminals"],
  infra: ["security", "devices", "ci"],
  explore: ["usage"],
};

/** Settings pages worth a look for this profile, most relevant first, at most `max`. */
export function settingsFor(level: Level | null, work: readonly Work[], max = 6): SettingTip[] {
  const ids = [...LEVEL_TIPS[level ?? "some"], ...work.flatMap((w) => WORK_TIPS[w])];
  return [...new Set(ids)].slice(0, max).map((id) => TIP[id]);
}

/** Count of finished tasks, for the progress bar. */
export function progressOf(done: ReadonlySet<StepId>): { done: number; total: number } {
  return { done: TASKS.filter((id) => done.has(id)).length, total: TASKS.length };
}

const STARTERS: Record<Work, string> = {
  web: "Find accessibility problems on the main page and fix the worst one",
  backend: "Add input validation and a test to one API endpoint",
  mobile: "Explain how navigation is structured in this app",
  data: "Summarise the data files here and suggest a first analysis",
  infra: "Review the CI config and suggest ways to make it faster",
  explore: "Explain how this project is organised",
};
const FALLBACK = [
  "Explain how this project is organised",
  "Find a small bug and fix it with a test",
];

/** Up to three starter prompts for the picked kinds of work. */
export function startersFor(work: readonly Work[]): string[] {
  const picked = work.map((w) => STARTERS[w]);
  return [...new Set([...picked, ...FALLBACK])].slice(0, 3);
}

export interface Live {
  online: boolean;
  providerReady: boolean;
  hasSession: boolean;
}

/**
 * Which steps are done: what the user finished by hand plus what the host shows is already set
 * up, the way VS Code walkthrough steps tick themselves when their completion event fires.
 */
export function doneSet(seen: readonly StepId[], live: Live): Set<StepId> {
  const done = new Set(seen);
  if (live.online) done.add("host");
  if (live.providerReady) done.add("providers");
  if (live.hasSession) done.add("session");
  return done;
}
