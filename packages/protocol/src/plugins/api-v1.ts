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
  | "rpc"
  | "ui.view"
  | "media.microphone"
  | "media.audio"
  | "composer"
  | "speech";

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
