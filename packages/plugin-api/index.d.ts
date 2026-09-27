// GENERATED from packages/protocol/src/plugins/api-v1.ts by scripts/generate.mjs. Do not edit.
/**
 * Frogg plugin API v1 — the `ctx` a daemon-side plugin receives in `activate(ctx)`.
 *
 * Source of truth for the `@frogg/plugin-api` types package (packages/plugin-api), which is a
 * generated copy of this file. Keep it self-contained: no imports, types only. The daemon's
 * implementation is checked against these types, so any drift fails the server typecheck.
 *
 * Members exist on `ctx` only when the matching capability was granted; otherwise they are
 * absent (undefined) at runtime. Their types are non-optional for authoring convenience.
 */

export type PluginApiVersion = 1;

export type PluginCapabilityName =
  | "network"
  | "filesystem.workspace"
  | "process.spawn"
  | "agent.read"
  | "agent.write"
  | "settings.store"
  | "ui.contribute"
  | "rpc";

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

export interface PluginAgentSummary {
  id: string;
  provider: string;
  cwd: string;
  status: string;
  title?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface PluginAgentEvent {
  agentId: string;
  /** Known: "state", "timeline", "removed". */
  kind: string;
  agent?: PluginAgentSummary;
}

export interface PluginAgentsApi {
  /** `agent.read` */
  list(): Promise<PluginAgentSummary[]>;
  /** `agent.read` */
  get(agentId: string): Promise<PluginAgentSummary | null>;
  /** `agent.read` */
  onEvent(listener: (event: PluginAgentEvent) => void): PluginDisposable;
  /** `agent.write` — sends a user message to the agent. */
  sendMessage(agentId: string, text: string): Promise<void>;
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
  /** Aborted when the plugin is deactivated. */
  signal: AbortSignal;
}

export type PluginActivate = (ctx: PluginContext) => void | Promise<void>;
export type PluginDeactivate = () => void | Promise<void>;

export interface PluginModule {
  default?: PluginActivate;
  activate?: PluginActivate;
  deactivate?: PluginDeactivate;
}
