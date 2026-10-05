// Loads, activates and deactivates one daemon-side plugin with an error boundary, and builds
// its capability-gated `ctx`. Plugins run in-process: gating limits the API surface, it is not
// a sandbox (see docs/plans/plugins.md).
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promises as fs } from "node:fs";
import type pino from "pino";
import type {
  PluginAgentEvent,
  PluginAgentSummary,
  PluginCapabilityName,
  PluginContext,
  PluginDisposable,
  PluginModule,
  PluginNotifyLevel,
  PluginRpcContext,
  PluginRpcHandler,
  PluginSpeechAvailability,
  PluginSynthesis,
  PluginTranscribeInput,
  PluginTranscription,
} from "@frogg/protocol/plugins/api-v1";
import { isPluginCapability, type PluginManifest } from "@frogg/protocol/plugins/manifest";
import { PluginServiceError } from "./errors.js";
import type { PluginSettingsFile } from "./settings-store.js";

export interface PluginAgentBridge {
  list(): Promise<PluginAgentSummary[]>;
  get(agentId: string): Promise<PluginAgentSummary | null>;
  subscribe(listener: (event: PluginAgentEvent) => void): () => void;
  sendMessage(agentId: string, text: string): Promise<void>;
}

export interface PluginSpeechBridge {
  available(): PluginSpeechAvailability;
  transcribe(input: PluginTranscribeInput): Promise<PluginTranscription>;
  synthesize(text: string, options?: { speed?: number }): Promise<PluginSynthesis>;
}

export interface PluginRuntimeHooks {
  notify(pluginId: string, message: string, level: PluginNotifyLevel): void;
  emitEvent(pluginId: string, event: string, data: unknown): void;
  badgesChanged(pluginId: string): void;
  refreshPanel(pluginId: string, panelId: string): void;
}

export interface PluginRuntimeOptions {
  manifest: PluginManifest;
  rootDir: string;
  dataDir: string;
  dev: boolean;
  granted: readonly string[];
  settings: PluginSettingsFile;
  agents: PluginAgentBridge | null;
  speech?: PluginSpeechBridge | null;
  hooks: PluginRuntimeHooks;
  logger: pino.Logger;
  activateTimeoutMs?: number;
  rpcTimeoutMs?: number;
}

let importNonce = 0;
const MAX_EVENT_BYTES = 256 * 1024;
const MAX_SYNTHESIZE_CHARS = 4000;

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new PluginServiceError("timeout", `${what} timed out after ${ms}ms`)),
        ms,
      );
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}

function disposable(fn: () => void): PluginDisposable {
  let done = false;
  return {
    dispose: () => {
      if (!done) {
        done = true;
        fn();
      }
    },
  };
}

export class PluginRuntime {
  readonly id: string;
  private readonly rpc = new Map<string, PluginRpcHandler>();
  private readonly badges = new Map<string, string>();
  private readonly cleanups = new Set<() => void>();
  private module: PluginModule | null = null;
  private abort = new AbortController();
  status: "inactive" | "active" | "error" = "inactive";
  error: string | null = null;

  constructor(private readonly opts: PluginRuntimeOptions) {
    this.id = opts.manifest.id;
  }

  get badgeMap(): Record<string, string> {
    return Object.fromEntries(this.badges);
  }

  private has(cap: PluginCapabilityName): boolean {
    return this.opts.granted.includes(cap);
  }

  private track(fn: () => void): PluginDisposable {
    const d = disposable(() => {
      this.cleanups.delete(fn);
      fn();
    });
    this.cleanups.add(fn);
    return d;
  }

  private guard<A extends unknown[]>(what: string, fn: (...args: A) => void): (...args: A) => void {
    return (...args: A) => {
      try {
        fn(...args);
      } catch (err) {
        this.opts.logger.warn({ err, pluginId: this.id }, `plugin ${what} listener threw`);
      }
    };
  }

  buildContext(): PluginContext {
    const { manifest, logger, hooks } = this.opts;
    const log = logger.child({ pluginId: manifest.id });
    const ctx: Partial<PluginContext> = {
      apiVersion: 1,
      signal: this.abort.signal,
      log: {
        debug: (m, d) => log.debug(d ?? {}, m),
        info: (m, d) => log.info(d ?? {}, m),
        warn: (m, d) => log.warn(d ?? {}, m),
        error: (m, d) => log.error(d ?? {}, m),
      },
      plugin: {
        id: manifest.id,
        version: manifest.version,
        dataDir: this.opts.dataDir,
        dev: this.opts.dev,
        capabilities: this.opts.granted.filter(isPluginCapability),
      },
    };
    if (this.has("settings.store")) {
      const s = this.opts.settings;
      ctx.settings = {
        get: async <T>(key: string) => (await s.get(key)) as T | undefined,
        set: (key, value) => s.setMany({ [key]: value ?? null }),
        delete: (key) => s.setMany({ [key]: null }),
        all: () => s.all(),
        onChange: (listener) => this.track(s.onChange(this.guard("settings", listener))),
      };
    }
    const agents = this.opts.agents;
    if (agents && (this.has("agent.read") || this.has("agent.write"))) {
      const denied = (cap: string) => () =>
        Promise.reject(new PluginServiceError("forbidden", `capability ${cap} not granted`));
      ctx.agents = {
        list: this.has("agent.read") ? () => agents.list() : denied("agent.read"),
        get: this.has("agent.read") ? (id) => agents.get(id) : denied("agent.read"),
        onEvent: (listener) => {
          if (!this.has("agent.read"))
            throw new PluginServiceError("forbidden", "capability agent.read not granted");
          return this.track(agents.subscribe(this.guard("agent", listener)));
        },
        sendMessage: this.has("agent.write")
          ? async (id, text) => {
              if (typeof text !== "string" || !text.trim())
                throw new PluginServiceError("invalid_request", "text is required");
              await agents.sendMessage(id, text);
            }
          : denied("agent.write"),
      };
    }
    if (this.has("rpc")) {
      ctx.rpc = {
        handle: (method, handler) => {
          if (typeof method !== "string" || !method || typeof handler !== "function") {
            throw new PluginServiceError(
              "invalid_request",
              "rpc.handle(method, handler) requires a method name and function",
            );
          }
          this.rpc.set(method, handler);
          return this.track(() => {
            if (this.rpc.get(method) === handler) this.rpc.delete(method);
          });
        },
      };
      ctx.events = {
        emit: (event, data) => {
          if (typeof event !== "string" || !event || event.length > 128) {
            throw new PluginServiceError("invalid_request", "events.emit(event) needs a name");
          }
          let json: unknown;
          try {
            json = data === undefined ? null : JSON.parse(JSON.stringify(data));
          } catch {
            throw new PluginServiceError("invalid_request", "event data must be JSON");
          }
          if (JSON.stringify(json).length > MAX_EVENT_BYTES) {
            throw new PluginServiceError("invalid_request", "event data is too large");
          }
          hooks.emitEvent(manifest.id, event, json);
        },
      };
    }
    if (this.has("speech")) {
      const speech = this.opts.speech ?? null;
      const unavailable = () =>
        Promise.reject(new PluginServiceError("not_active", "This host has no speech backend"));
      ctx.speech = {
        available: async () => speech?.available() ?? { stt: false, tts: false },
        transcribe: (input) => {
          if (!speech) return unavailable();
          if (
            !input ||
            typeof input.pcm16 !== "string" ||
            !Number.isInteger(input.sampleRate) ||
            input.sampleRate < 8000 ||
            input.sampleRate > 96000
          ) {
            return Promise.reject(
              new PluginServiceError(
                "invalid_request",
                "transcribe({ pcm16, sampleRate }) needs base64 PCM16 and a rate in 8000..96000",
              ),
            );
          }
          return speech.transcribe(input);
        },
        synthesize: (text, options) => {
          if (!speech) return unavailable();
          if (typeof text !== "string" || !text.trim()) {
            return Promise.reject(new PluginServiceError("invalid_request", "text is required"));
          }
          return speech.synthesize(text.slice(0, MAX_SYNTHESIZE_CHARS), options);
        },
      };
    }
    if (this.has("ui.contribute")) {
      ctx.ui = {
        setBadge: (id, text) => {
          if (text === null || text === "") this.badges.delete(id);
          else this.badges.set(id, String(text).slice(0, 32));
          hooks.badgesChanged(manifest.id);
        },
        notify: (message, level = "info") =>
          hooks.notify(manifest.id, String(message).slice(0, 500), level),
        refreshPanel: (panelId) => hooks.refreshPanel(manifest.id, panelId),
      };
    }
    return ctx as PluginContext;
  }

  async activate(): Promise<void> {
    const entry = this.opts.manifest.entry?.daemon;
    if (!entry) {
      this.status = "inactive";
      return;
    }
    const file = path.resolve(this.opts.rootDir, entry);
    if (!file.startsWith(path.resolve(this.opts.rootDir) + path.sep)) {
      throw new PluginServiceError("invalid_request", "entry.daemon escapes the plugin directory");
    }
    try {
      await fs.mkdir(this.opts.dataDir, { recursive: true });
      // A fresh query string defeats the ESM cache so dev reloads pick up rebuilt code.
      const url = `${pathToFileURL(file).href}?v=${++importNonce}`;
      const mod =
        (await withTimeout(
          import(url) as Promise<PluginModule>,
          this.opts.activateTimeoutMs ?? 15_000,
          "import",
        )) ?? {};
      const activate = typeof mod.default === "function" ? mod.default : mod.activate;
      if (typeof activate !== "function")
        throw new Error("entry module must export activate(ctx) as default or named export");
      this.module = mod;
      await withTimeout(
        Promise.resolve().then(() => activate(this.buildContext())),
        this.opts.activateTimeoutMs ?? 15_000,
        "activate",
      );
      this.status = "active";
      this.error = null;
    } catch (err) {
      this.status = "error";
      this.error = err instanceof Error ? err.message : String(err);
      this.opts.logger.warn({ err, pluginId: this.id }, "plugin failed to activate");
      await this.deactivate().catch(() => undefined);
      this.status = "error";
    }
  }

  async deactivate(): Promise<void> {
    const mod = this.module;
    this.module = null;
    this.abort.abort();
    try {
      if (mod && typeof mod.deactivate === "function") {
        await withTimeout(
          Promise.resolve().then(() => mod.deactivate!()),
          5_000,
          "deactivate",
        );
      }
    } catch (err) {
      this.opts.logger.warn({ err, pluginId: this.id }, "plugin deactivate failed");
    } finally {
      for (const fn of Array.from(this.cleanups)) {
        try {
          fn();
        } catch {
          // ignore
        }
      }
      this.cleanups.clear();
      this.rpc.clear();
      this.badges.clear();
      this.abort = new AbortController();
      if (this.status === "active") this.status = "inactive";
    }
  }

  async call(method: string, params: unknown, context: PluginRpcContext): Promise<unknown> {
    if (this.status !== "active")
      throw new PluginServiceError("not_active", `Plugin ${this.id} is not active`);
    const handler = this.rpc.get(method);
    if (!handler)
      throw new PluginServiceError("not_found", `Plugin ${this.id} has no RPC method ${method}`);
    let result: unknown;
    try {
      result = await withTimeout(
        Promise.resolve().then(() => handler(params, context)),
        this.opts.rpcTimeoutMs ?? 30_000,
        `${this.id} ${method}`,
      );
    } catch (err) {
      if (err instanceof PluginServiceError && err.code === "timeout") throw err;
      throw new PluginServiceError(
        "plugin_error",
        err instanceof Error ? err.message : String(err),
      );
    }
    // Results cross the wire as JSON; drop anything that is not.
    try {
      return result === undefined ? undefined : (JSON.parse(JSON.stringify(result)) as unknown);
    } catch {
      throw new PluginServiceError(
        "plugin_error",
        `${method} returned a value that is not JSON-serializable`,
      );
    }
  }
}
