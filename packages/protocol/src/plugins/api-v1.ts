/**
 * Frogg plugin API v1 and v2 — the `ctx` a daemon-side plugin receives in `activate(ctx)`.
 *
 * v2 is a strict superset of v1: a v1 plugin runs unchanged on a v2 host. Members marked "v2" exist
 * only for plugins whose manifest declares `apiVersion: 2` (see docs/plans/plugins-v2.md).
 *
 * Source of truth for the `@frogg/plugin-api` types package (packages/plugin-api), which is a
 * generated copy of this file. Keep it self-contained: no imports, types only. The daemon's
 * implementation is checked against these types, so any drift fails the server typecheck.
 *
 * Members exist on `ctx` only when the matching capability was granted; otherwise they are
 * absent (undefined) at runtime. Their types are non-optional for authoring convenience.
 */

export type PluginApiVersion = 1 | 2;

export type PluginCapabilityName =
  | "network"
  | "filesystem.workspace"
  | "process.spawn"
  | "agent.read"
  | "agent.write"
  | "settings.store"
  | "ui.contribute"
  | "rpc"
  | "ui.view"
  | "media.microphone"
  | "media.audio"
  | "composer"
  | "speech"
  // v2
  | "agent.manage"
  | "agent.permissions"
  | "workspaces.read"
  | "todos.read"
  | "todos.write"
  | "ui.external";

export type PluginJsonValue =
  | string
  | number
  | boolean
  | null
  | PluginJsonValue[]
  | { [key: string]: PluginJsonValue };

export interface PluginLogger {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export interface PluginInfo {
  id: string;
  version: string;
  /** Private writable directory for this plugin; survives updates. */
  dataDir: string;
  /** True for a dev-linked plugin. */
  dev: boolean;
  /** Capabilities the user granted. */
  capabilities: readonly PluginCapabilityName[];
}

/** Per-plugin key/value store (`settings.store`). Values are JSON. */
export interface PluginSettingsStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<Record<string, unknown>>;
  /** Fires after any key changes (from the plugin or the settings page). */
  onChange(listener: (key: string) => void): PluginDisposable;
}

export interface PluginDisposable {
  dispose(): void;
}

export interface PluginAgentUsage {
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  /** Only some providers report cost. */
  costUsd?: number;
  contextWindowUsedTokens?: number;
  contextWindowMaxTokens?: number;
}

export interface PluginAgentSummary {
  id: string;
  provider: string;
  cwd: string;
  status: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
  /** v2 */
  model?: string | null;
  /** v2 */
  workspaceId?: string | null;
  /** v2. Current branch of the agent's checkout, when known. */
  branch?: string | null;
  /** v2 */
  labels?: Record<string, string>;
  /** v2. Pull/merge request for the agent's branch, when known. */
  prUrl?: string | null;
  /** v2. Latest usage the provider reported. */
  usage?: PluginAgentUsage | null;
  /** v2 */
  requiresAttention?: boolean;
  /** v2. "finished" | "error" | "permission" while attention is required. */
  attentionReason?: string | null;
  /** v2. Number of permission requests waiting for an answer. */
  pendingPermissions?: number;
  /** v2 */
  lastError?: string | null;
}

/** v2. One agent timeline item, reduced to what integrations need. Reasoning is never exposed. */
export type PluginTimelineItem =
  | { type: "user_message"; text: string }
  | { type: "assistant_message"; text: string }
  | {
      type: "tool_call";
      callId: string;
      name: string;
      status: "running" | "completed" | "failed" | "canceled";
      /** Short human-readable gist (command, file, query), when the host can derive one. */
      summary?: string;
    }
  | { type: "plan"; text: string }
  | { type: "todo"; items: { text: string; completed: boolean }[] }
  | { type: "error"; message: string }
  | { type: "compaction" };

/** v2 */
export interface PluginTimelineEntry {
  /** Monotonic within one timeline epoch. */
  seq: number;
  timestamp: string;
  turnId?: string;
  item: PluginTimelineItem;
}

/** v2 */
export interface PluginTimelinePage {
  entries: PluginTimelineEntry[];
  /**
   * Opaque cursor positioned after the last entry returned. Persist it and pass it back to resume
   * after a restart without seeing entries twice.
   */
  cursor: string | null;
  /**
   * True when the passed cursor no longer applies (the timeline was rebuilt); `entries` then starts
   * from the oldest retained entry and callers should treat it as a fresh read.
   */
  reset: boolean;
  hasMore: boolean;
}

export interface PluginAgentEvent {
  agentId: string;
  /** Known: "state", "timeline", "removed". */
  kind: string;
  agent?: PluginAgentSummary;
  /** v2. The new item, on "timeline" events. */
  entry?: PluginTimelineEntry;
  /** v2. Resume point after `entry`; persist it and pass it to `getTimeline` after a restart. */
  cursor?: string;
}

/** v2 */
export type PluginAttentionReason = "finished" | "error" | "permission";

/** v2 */
export interface PluginAttentionEvent {
  agentId: string;
  reason: PluginAttentionReason;
  agent: PluginAgentSummary;
  /** Last assistant message, for "finished" and "error". */
  message: string | null;
  /**
   * True when a connected app is in active use, i.e. when the host suppressed the push
   * notification. Delivered to listeners only if they passed `{ force: true }`.
   */
  clientActive: boolean;
}

/** v2. Write calls name the external identity that caused them, e.g. "discord:123". */
export interface PluginActorOptions {
  actor: string;
}

/** v2. Attachment on a message sent to an agent. */
export interface PluginAttachment {
  name: string;
  /** e.g. "image/png", "text/markdown". Images are passed to the agent as images. */
  mime: string;
  /** base64 */
  data: string;
}

/** v2 */
export interface PluginSendMessageOptions {
  attachments?: PluginAttachment[];
  /** Defaults to "plugin:<id>". */
  actor?: string;
}

/** v2 (`agent.manage`) */
export interface PluginCreateAgentInput extends PluginActorOptions {
  /** Target workspace; the agent runs in its checkout. */
  workspaceId: string;
  provider: string;
  model?: string;
  modeId?: string;
  title?: string;
  /** Labels stored on the agent, e.g. { "discord.thread": "123" }. Keys are prefixed by nobody. */
  labels?: Record<string, string>;
  prompt: string;
}

/** v2 */
export interface PluginDiffStat {
  additions: number;
  deletions: number;
}

/** v2 */
export interface PluginProviderInfo {
  id: string;
  label: string;
  available: boolean;
}

export interface PluginAgentsApi {
  /** `agent.read` */
  list(): Promise<PluginAgentSummary[]>;
  /** `agent.read` */
  get(agentId: string): Promise<PluginAgentSummary | null>;
  /** `agent.read` */
  onEvent(listener: (event: PluginAgentEvent) => void): PluginDisposable;
  /**
   * `agent.write` — sends a user message to the agent. v2 adds `options`; for v2 plugins it is also
   * remote-controlled (rejects `forbidden` while the owner has remote control off), because the
   * message usually comes from an outside identity.
   */
  sendMessage(agentId: string, text: string, options?: PluginSendMessageOptions): Promise<void>;
  /**
   * v2, `agent.read`. Without a cursor returns the newest `limit` entries (default 50, max 500);
   * with one, the entries after it.
   */
  getTimeline(
    agentId: string,
    options?: { cursor?: string | null; limit?: number },
  ): Promise<PluginTimelinePage>;
  /** v2, `agent.read` */
  getLastAssistantMessage(agentId: string): Promise<string | null>;
  /** v2, `agent.read`. Uncommitted plus branch changes in the agent's checkout. */
  getDiffStat(agentId: string): Promise<PluginDiffStat | null>;
  /**
   * v2, `agent.read`. Fires when an agent finishes, errors or asks for permission. Skipped while
   * a connected app is in active use, like push notifications, unless `force` is set.
   */
  onAttention(
    listener: (event: PluginAttentionEvent) => void,
    options?: { force?: boolean },
  ): PluginDisposable;
  /** v2, `agent.read`. Providers this host can run. */
  listProviders(): Promise<PluginProviderInfo[]>;
  /** v2, `agent.manage`. Starts an agent with an initial prompt. */
  create(input: PluginCreateAgentInput): Promise<PluginAgentSummary>;
  /** v2, `agent.manage`. Cancels the current turn. */
  cancel(agentId: string, options: PluginActorOptions): Promise<void>;
  /** v2, `agent.manage` */
  archive(agentId: string, options: PluginActorOptions): Promise<void>;
}

/** v2 */
export interface PluginPermissionRequest {
  agentId: string;
  requestId: string;
  /** Tool or request name, e.g. "Bash". */
  name: string;
  /** "tool" | "plan" | "question" | "mode" | "other" */
  kind: string;
  title?: string;
  description?: string;
  /** Short preview of the tool input (command, path, plan text), truncated. */
  inputPreview?: string;
  /** True when "always" would add a standing rule (the provider suggested one). */
  canAlways: boolean;
  /** When the host saw the request; absent for requests listed after a daemon restart. */
  requestedAt?: string;
}

/** v2 */
export type PluginPermissionDecision = "allow" | "deny" | "always";

/** v2 */
export interface PluginPermissionResolved {
  agentId: string;
  requestId: string;
  behavior: "allow" | "deny";
}

/**
 * v2 (`agent.permissions`). `respond` rejects with code `already_resolved` when the request was
 * answered elsewhere first.
 */
export interface PluginPermissionsApi {
  list(agentId?: string): Promise<PluginPermissionRequest[]>;
  onRequest(listener: (request: PluginPermissionRequest) => void): PluginDisposable;
  onResolved(listener: (resolved: PluginPermissionResolved) => void): PluginDisposable;
  respond(
    agentId: string,
    requestId: string,
    decision: PluginPermissionDecision,
    options: PluginActorOptions & { message?: string },
  ): Promise<void>;
}

/** v2 */
export interface PluginProject {
  id: string;
  name: string;
  rootPath: string;
}

/** v2 */
export interface PluginWorkspace {
  id: string;
  projectId: string;
  title: string;
  cwd: string;
  branch: string | null;
  /** "local_checkout" | "worktree" | "directory" ... */
  kind: string;
}

/** v2 (`workspaces.read`). Archived workspaces and projects are excluded. */
export interface PluginWorkspacesApi {
  listProjects(): Promise<PluginProject[]>;
  list(projectId?: string): Promise<PluginWorkspace[]>;
  get(workspaceId: string): Promise<PluginWorkspace | null>;
}

/** v2. "backlog" | "ready" | "claimed" | "in_progress" | "review" | "done" | "blocked" */
export type PluginTodoStatus = string;
/** v2. "low" | "medium" | "high" | "urgent" */
export type PluginTodoPriority = string;

/** v2 */
export interface PluginTodo {
  id: string;
  projectId: string;
  title: string;
  description: string;
  category: string | null;
  priority: PluginTodoPriority;
  status: PluginTodoStatus;
  /** Agents currently holding a claim; claims are host-controlled. */
  claimedBy: { agentId: string; stale: boolean }[];
  progressCount: number;
  createdAt: string;
  updatedAt: string;
}

/** v2 */
export interface PluginTodoDetail extends PluginTodo {
  progress: { at: string; agentId?: string; note: string }[];
  plan: string | null;
}

/** v2 */
export interface PluginTodoChange {
  projectId: string;
  kind: "upsert" | "remove";
  todoId: string;
  todo: PluginTodo | null;
}

/** v2 */
export interface PluginTodoInput {
  title: string;
  description?: string;
  category?: string | null;
  priority?: PluginTodoPriority;
}

/** v2 (`todos.read` / `todos.write`) */
export interface PluginTodosApi {
  /** `todos.read` */
  list(projectId: string, filter?: { status?: PluginTodoStatus[] }): Promise<PluginTodo[]>;
  /** `todos.read` */
  get(projectId: string, todoId: string): Promise<PluginTodoDetail>;
  /** `todos.read` */
  onChange(listener: (change: PluginTodoChange) => void): PluginDisposable;
  /** `todos.write` */
  create(
    projectId: string,
    input: PluginTodoInput,
    options: PluginActorOptions,
  ): Promise<PluginTodo>;
  /** `todos.write` */
  update(
    projectId: string,
    todoId: string,
    patch: Partial<PluginTodoInput>,
    options: PluginActorOptions,
  ): Promise<PluginTodo>;
  /** `todos.write`. Cannot set "claimed"; claims belong to agents. */
  setStatus(
    projectId: string,
    todoId: string,
    status: PluginTodoStatus,
    options: PluginActorOptions,
  ): Promise<PluginTodo>;
  /** `todos.write`. Appends a progress note. */
  addNote(
    projectId: string,
    todoId: string,
    note: string,
    options: PluginActorOptions,
  ): Promise<void>;
}

/** v2. Always present on v2 plugins. */
export interface PluginHostInfo {
  /** Daemon version. */
  version: string;
  /** API versions this host supports. */
  apiVersions: readonly number[];
  /** Additive features beyond the base API version, e.g. "timeline.cursor". */
  features: readonly string[];
  /**
   * False while the owner has not enabled remote control for this plugin: `agent.manage`,
   * `agent.permissions` and `todos.write` calls reject with `forbidden` until it is.
   */
  remoteControl: boolean;
  /** Fires when the owner turns remote control on or off for this plugin. */
  onRemoteControlChange(listener: (enabled: boolean) => void): PluginDisposable;
}

export interface PluginRpcContext {
  /** Connected client's device id when known. */
  clientId?: string;
}

export type PluginRpcHandler = (
  params: unknown,
  context: PluginRpcContext,
) => unknown | Promise<unknown>;

export interface PluginRpcApi {
  /**
   * Registers a handler callable from clients via plugins.rpc.call. Command and session action
   * contributions invoke the method named by their id; panels invoke `panel.<id>.render` and
   * `panel.<id>.submit`.
   */
  handle(method: string, handler: PluginRpcHandler): PluginDisposable;
}

export type PluginNotifyLevel = "info" | "success" | "warning" | "error";

export interface PluginUiApi {
  /** Badge text on a declared contribution (panel/command/session action id); null clears. */
  setBadge(contributionId: string, text: string | null): void;
  /** Toast on connected clients. */
  notify(message: string, level?: PluginNotifyLevel): void;
  /** Ask clients to re-render a panel. */
  refreshPanel(panelId: string): void;
}

export interface PluginEventsApi {
  /**
   * Pushes an event to this plugin's client halves on every connected app (`rpc`). `data` must be
   * JSON. Clients receive it through `ctx.events.on(event, listener)`.
   */
  emit(event: string, data?: unknown): void;
}

export interface PluginSpeechAvailability {
  /** A speech-to-text backend is configured and ready. */
  stt: boolean;
  /** A text-to-speech backend is configured and ready. */
  tts: boolean;
}

export interface PluginTranscribeInput {
  /** Mono PCM16 little-endian samples, base64. */
  pcm16: string;
  /** Sample rate of `pcm16`; the host resamples to whatever its backend needs. */
  sampleRate: number;
  /** BCP 47 hint; defaults to the host's configured language. */
  language?: string;
}

export interface PluginTranscription {
  text: string;
  language?: string;
}

export interface PluginSynthesis {
  /** Encoded audio, base64. */
  audio: string;
  /** MIME type of `audio`, e.g. "audio/mpeg" or "audio/pcm;rate=24000". */
  format: string;
}

/** The host's configured voice backends (`speech`). */
export interface PluginSpeechApi {
  available(): Promise<PluginSpeechAvailability>;
  transcribe(input: PluginTranscribeInput): Promise<PluginTranscription>;
  synthesize(text: string, options?: { speed?: number }): Promise<PluginSynthesis>;
}

export interface PluginContext {
  apiVersion: PluginApiVersion;
  log: PluginLogger;
  plugin: PluginInfo;
  /** `settings.store` */
  settings: PluginSettingsStore;
  /** `agent.read` / `agent.write` */
  agents: PluginAgentsApi;
  /** `rpc` */
  rpc: PluginRpcApi;
  /** `ui.contribute` */
  ui: PluginUiApi;
  /** `rpc` */
  events: PluginEventsApi;
  /** `speech` */
  speech: PluginSpeechApi;
  /** Aborted when the plugin is deactivated. */
  signal: AbortSignal;
  /** v2 */
  host: PluginHostInfo;
  /** v2, `agent.permissions` */
  permissions: PluginPermissionsApi;
  /** v2, `workspaces.read` */
  workspaces: PluginWorkspacesApi;
  /** v2, `todos.read` / `todos.write` */
  todos: PluginTodosApi;
}

export type PluginActivate = (ctx: PluginContext) => void | Promise<void>;
export type PluginDeactivate = () => void | Promise<void>;

export interface PluginModule {
  default?: PluginActivate;
  activate?: PluginActivate;
  deactivate?: PluginDeactivate;
}

// ---------------------------------------------------------------------------
// Client half (scope `client`, or the client half of a `hybrid` plugin). Runs in a sandboxed
// iframe inside the desktop or web app with no access to the app's DOM or storage; every call
// below crosses a message channel to the app, which enforces the granted capabilities.

export interface ClientPluginInfo {
  id: string;
  version: string;
  /** True for a dev-linked plugin folder. */
  dev: boolean;
  /** Capabilities the user granted on this device. */
  capabilities: readonly PluginCapabilityName[];
}

/** Device-local key/value store (`settings.store`). Values are JSON. */
export interface ClientPluginSettingsStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  all(): Promise<Record<string, unknown>>;
}

export type ClientPluginRpcHandler = (params: unknown) => unknown | Promise<unknown>;

export interface ClientPluginRpcApi {
  /**
   * Answers a contribution method in the app (a command or session action id,
   * `panel.<id>.render`, `panel.<id>.submit`). A method the client half handles never reaches
   * the daemon half.
   */
  handle(method: string, handler: ClientPluginRpcHandler): PluginDisposable;
  /** Calls the plugin's daemon half (hybrid plugins) through the host's plugins.rpc.call. */
  call(method: string, params?: unknown): Promise<unknown>;
}

export interface ClientPluginUiApi {
  /** Toast in this app. */
  notify(message: string, level?: PluginNotifyLevel): void;
  /**
   * v2, `ui.external`. Opens an https URL in the system browser (desktop) or a new tab (web),
   * e.g. for OAuth consent. Resolves false when refused.
   */
  openExternal(url: string): Promise<boolean>;
}

export interface ClientPluginEventsApi {
  /**
   * Events from the plugin's daemon half (`ctx.events.emit` there) and from this plugin's other
   * sandboxes on this device (the background half and any open views).
   */
  on(event: string, listener: (data: unknown) => void): PluginDisposable;
  /** Delivers to this plugin's other sandboxes on this device. `data` must be JSON. */
  emit(event: string, data?: unknown): void;
}

export interface ClientPluginAudioChunk {
  /** Mono PCM16 little-endian samples, base64. */
  pcm16: string;
  sampleRate: number;
  /** RMS level of the chunk, 0..1. */
  level: number;
}

export interface ClientPluginMediaApi {
  /**
   * `media.microphone`. Asks the app to open the microphone (the app owns the permission prompt)
   * and streams 16 kHz chunks to `onAudio`. Rejects when the user declines or another feature owns it.
   */
  startCapture(): Promise<void>;
  stopCapture(): void;
  onAudio(listener: (chunk: ClientPluginAudioChunk) => void): PluginDisposable;
  /**
   * `media.audio`. Plays encoded audio (base64 + MIME type, as returned by the daemon's
   * `ctx.speech.synthesize`) and resolves when it finishes or is stopped. One clip at a time; a
   * new clip stops the previous one.
   */
  play(audio: { data: string; format: string }): Promise<void>;
  stopPlayback(): void;
}

export interface ClientPluginComposerApi {
  /** `composer`. Inserts text at the cursor of the focused composer. False when none is open. */
  insertText(text: string): Promise<boolean>;
}

/** Present in a view sandbox only. */
export interface ClientPluginViewInfo {
  /** The `contributes.views` id being rendered. */
  id: string;
  /** Closes this view. */
  close(): void;
}

export interface ClientPluginContext {
  apiVersion: PluginApiVersion;
  log: PluginLogger;
  plugin: ClientPluginInfo;
  /** `settings.store` */
  settings: ClientPluginSettingsStore;
  /** `rpc` */
  rpc: ClientPluginRpcApi;
  /** `ui.contribute` */
  ui: ClientPluginUiApi;
  /** `rpc` */
  events: ClientPluginEventsApi;
  /** `media.microphone` / `media.audio` */
  media: ClientPluginMediaApi;
  /** `composer` */
  composer: ClientPluginComposerApi;
  /** Set when this sandbox renders a view; absent in the background half. */
  view?: ClientPluginViewInfo;
}

export type ClientPluginActivate = (ctx: ClientPluginContext) => void | Promise<void>;

/**
 * Renders one `contributes.views` entry into `root`, a full-size element in the view's own
 * sandboxed iframe (typed `unknown` so the API needs no DOM lib; it is an `HTMLElement`). The
 * iframe is discarded when the view closes, so there is nothing to clean up.
 */
export type ClientPluginViewRender = (
  root: unknown,
  ctx: ClientPluginContext,
) => void | Promise<void>;

export interface ClientPluginModule {
  default?: ClientPluginActivate;
  activate?: ClientPluginActivate;
  /** View renderers keyed by `contributes.views` id. */
  views?: Record<string, ClientPluginViewRender>;
}
