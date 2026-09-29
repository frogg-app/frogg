import { ClientPluginError } from "./errors";

/**
 * The app side of a client plugin's `ctx`: every call the sandbox makes lands here as
 * `{ op, args }` and is checked against the granted capabilities before it touches anything.
 * Pure, so it can be tested without a DOM.
 */

export type ClientPluginLogLevel = "debug" | "info" | "warn" | "error";
export type ClientPluginNotifyLevel = "info" | "success" | "warning" | "error";

export interface ClientPluginBridgeDeps {
  pluginId: string;
  capabilities: readonly string[];
  log: (level: ClientPluginLogLevel, message: string, data?: unknown) => void;
  settings: {
    read: () => Record<string, unknown>;
    write: (next: Record<string, unknown>) => Promise<void>;
  };
  /** The plugin's daemon half via the host's plugins.rpc.call; rejects when none is reachable. */
  rpcCall: (method: string, params: unknown) => Promise<unknown>;
  notify: (message: string, level: ClientPluginNotifyLevel) => void;
}

export const CLIENT_PLUGIN_OPS = [
  "log",
  "settings.get",
  "settings.set",
  "settings.delete",
  "settings.all",
  "rpc.call",
  "ui.notify",
] as const;
export type ClientPluginOp = (typeof CLIENT_PLUGIN_OPS)[number];

const OP_CAPABILITY: Record<ClientPluginOp, string | null> = {
  log: null,
  "settings.get": "settings.store",
  "settings.set": "settings.store",
  "settings.delete": "settings.store",
  "settings.all": "settings.store",
  "rpc.call": "rpc",
  "ui.notify": "ui.contribute",
};

const LOG_LEVELS: ReadonlySet<string> = new Set(["debug", "info", "warn", "error"]);
const NOTIFY_LEVELS: ReadonlySet<string> = new Set(["info", "success", "warning", "error"]);
const MAX_KEY = 128;
const MAX_MESSAGE = 2000;
const MAX_SETTINGS_BYTES = 1024 * 1024;

function asArgs(args: unknown): Record<string, unknown> {
  return typeof args === "object" && args !== null ? (args as Record<string, unknown>) : {};
}

function requireString(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    throw new ClientPluginError("invalid_request", `${name} must be a non-empty string`);
  }
  return value;
}

/** Only JSON survives into the settings store. */
function toJson(value: unknown): unknown {
  if (value === undefined) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    throw new ClientPluginError("invalid_request", "settings values must be JSON");
  }
}

export function isClientPluginOp(op: unknown): op is ClientPluginOp {
  return typeof op === "string" && (CLIENT_PLUGIN_OPS as readonly string[]).includes(op);
}

export function createClientPluginBridge(deps: ClientPluginBridgeDeps) {
  const granted = new Set(deps.capabilities);
  let writes: Promise<void> = Promise.resolve();

  async function updateSettings(mutate: (current: Record<string, unknown>) => void) {
    const previous = writes;
    const run = (async () => {
      await previous;
      const next = { ...deps.settings.read() };
      mutate(next);
      if (JSON.stringify(next).length > MAX_SETTINGS_BYTES) {
        throw new ClientPluginError("invalid_request", "settings store is full");
      }
      await deps.settings.write(next);
    })();
    writes = run.catch(() => undefined);
    await run;
  }

  async function handle(op: unknown, rawArgs: unknown): Promise<unknown> {
    if (!isClientPluginOp(op)) {
      throw new ClientPluginError("invalid_request", `Unknown plugin API call ${String(op)}`);
    }
    const capability = OP_CAPABILITY[op];
    if (capability && !granted.has(capability)) {
      throw new ClientPluginError(
        "forbidden",
        `${deps.pluginId} was not granted the "${capability}" capability`,
      );
    }
    const args = asArgs(rawArgs);
    switch (op) {
      case "log": {
        const level = LOG_LEVELS.has(String(args.level))
          ? (args.level as ClientPluginLogLevel)
          : "info";
        deps.log(level, String(args.message ?? "").slice(0, MAX_MESSAGE), args.data);
        return null;
      }
      case "settings.get":
        return deps.settings.read()[requireString(args.key, "key", MAX_KEY)] ?? null;
      case "settings.all":
        return { ...deps.settings.read() };
      case "settings.set": {
        const key = requireString(args.key, "key", MAX_KEY);
        const value = toJson(args.value);
        await updateSettings((next) => {
          next[key] = value;
        });
        return null;
      }
      case "settings.delete": {
        const key = requireString(args.key, "key", MAX_KEY);
        await updateSettings((next) => {
          delete next[key];
        });
        return null;
      }
      case "rpc.call":
        return deps.rpcCall(requireString(args.method, "method", 128), toJson(args.params ?? {}));
      case "ui.notify": {
        const level = NOTIFY_LEVELS.has(String(args.level))
          ? (args.level as ClientPluginNotifyLevel)
          : "info";
        deps.notify(requireString(args.message, "message", MAX_MESSAGE), level);
        return null;
      }
    }
  }

  return { handle };
}

export type ClientPluginBridge = ReturnType<typeof createClientPluginBridge>;
