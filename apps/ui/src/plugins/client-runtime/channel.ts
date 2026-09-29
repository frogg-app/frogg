import { ClientPluginError } from "./errors";
import type { ClientPluginBridge } from "./bridge";

/** Minimal MessagePort surface, so tests can drive the channel with Node's MessageChannel. */
export interface PortLike {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  start?(): void;
  close(): void;
}

export interface ClientPluginInitInfo {
  id: string;
  version: string;
  dev: boolean;
  capabilities: readonly string[];
}

export const DEFAULT_INVOKE_TIMEOUT_MS = 15_000;
export const ACTIVATE_TIMEOUT_MS = 10_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * The app end of one plugin sandbox's port: sends `init`, answers the sandbox's ctx calls through
 * the capability bridge, and invokes contribution methods the plugin registered.
 */
export class ClientPluginChannel {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private handled = new Set<string>();
  private closed = false;
  private readonly activation: Promise<void>;
  private settleActivation!: (error: Error | null) => void;

  constructor(
    private readonly port: PortLike,
    private readonly bridge: ClientPluginBridge,
    private readonly onHandledChange: (methods: ReadonlySet<string>) => void = () => undefined,
  ) {
    this.activation = new Promise<void>((resolve, reject) => {
      this.settleActivation = (error) => (error ? reject(error) : resolve());
    });
    // Callers that never await activation should not see an unhandled rejection.
    this.activation.catch(() => undefined);
    port.addEventListener("message", (event) => this.receive(event.data));
    port.start?.();
  }

  /** Loads and activates the plugin; rejects with plugin_error or timeout. */
  activate(
    code: string,
    info: ClientPluginInitInfo,
    timeoutMs = ACTIVATE_TIMEOUT_MS,
  ): Promise<void> {
    this.send({
      t: "init",
      code,
      info: { ...info, capabilities: [...info.capabilities] },
    });
    const timer = setTimeout(() => {
      this.settleActivation(
        new ClientPluginError("timeout", `${info.id} did not finish activating`),
      );
    }, timeoutMs);
    return this.activation.finally(() => clearTimeout(timer));
  }

  /** A MessagePort has no target origin; the port itself is the private channel. */
  private send(message: unknown): void {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    this.port.postMessage(message);
  }

  handledMethods(): ReadonlySet<string> {
    return this.handled;
  }

  handles(method: string): boolean {
    return this.handled.has(method);
  }

  invoke(method: string, params: unknown, timeoutMs = DEFAULT_INVOKE_TIMEOUT_MS): Promise<unknown> {
    if (this.closed) return Promise.reject(new ClientPluginError("not_active", "Plugin stopped"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ClientPluginError("timeout", `${method} did not answer in time`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.send({ t: "invoke", id, method, params });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new ClientPluginError("not_active", "Plugin stopped"));
    }
    this.pending.clear();
    this.settleActivation(new ClientPluginError("not_active", "Plugin stopped"));
    this.port.close();
  }

  private receive(data: unknown): void {
    if (this.closed || typeof data !== "object" || data === null) return;
    const m = data as Record<string, unknown>;
    switch (m.t) {
      case "call":
        void this.answerCall(m.id, m.op, m.args);
        return;
      case "result":
        this.settleInvoke(m);
        return;
      case "handled":
        this.handled = new Set(
          Array.isArray(m.methods)
            ? m.methods.filter((x): x is string => typeof x === "string")
            : [],
        );
        this.onHandledChange(this.handled);
        return;
      case "activated":
        this.settleActivation(null);
        return;
      case "failed":
        this.settleActivation(new ClientPluginError("plugin_error", String(m.error ?? "failed")));
        return;
      default:
    }
  }

  private async answerCall(id: unknown, op: unknown, args: unknown): Promise<void> {
    try {
      const value = await this.bridge.handle(op, args);
      if (!this.closed) this.send({ t: "result", id, ok: true, value: value ?? null });
    } catch (error) {
      if (!this.closed) {
        this.send({
          t: "result",
          id,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private settleInvoke(m: Record<string, unknown>): void {
    const p = typeof m.id === "number" ? this.pending.get(m.id) : undefined;
    if (!p) return;
    this.pending.delete(m.id as number);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.value);
    else p.reject(new ClientPluginError("plugin_error", String(m.error ?? "failed")));
  }
}
