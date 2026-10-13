// The plugin API v2 members of `ctx`: host info, the wider agents API, permissions, workspaces and
// to-dos. Every member is gated twice: on the granted capability, and for agent.manage,
// agent.permissions and todos.write on the owner's remote-control switch, read at call time so the
// switch takes effect without restarting the plugin. Writes are audit-logged with their actor.
import type {
  PluginActorOptions,
  PluginAgentsApi,
  PluginAttentionEvent,
  PluginCapabilityName,
  PluginDisposable,
  PluginHostInfo,
  PluginPermissionRequest,
  PluginPermissionResolved,
  PluginPermissionsApi,
  PluginTodosApi,
  PluginWorkspacesApi,
} from "@frogg/protocol/plugins/api-v1";
import { PluginServiceError } from "./errors.js";
import type {
  PluginAgentBridge,
  PluginAuditEntry,
  PluginTodosBridge,
  PluginWorkspacesBridge,
} from "./runtime.js";

export interface RuntimeV2Deps {
  pluginId: string;
  has(cap: PluginCapabilityName): boolean;
  remoteControl(): boolean;
  onRemoteControlChange(listener: (enabled: boolean) => void): () => void;
  track(fn: () => void): PluginDisposable;
  guard<A extends unknown[]>(what: string, fn: (...args: A) => void): (...args: A) => void;
  audit(entry: Omit<PluginAuditEntry, "pluginId" | "at">): void;
  host: {
    version: string;
    apiVersions: readonly number[];
    features: readonly string[];
  };
  agents: PluginAgentBridge | null;
  subscribeAttention: ((listener: (event: PluginAttentionEvent) => void) => () => void) | null;
  workspaces: PluginWorkspacesBridge | null;
  todos: PluginTodosBridge | null;
}

const MAX_ACTOR = 200;

function forbidden(cap: string): PluginServiceError {
  return new PluginServiceError("forbidden", `capability ${cap} not granted`);
}

function unavailable(what: string): PluginServiceError {
  return new PluginServiceError("not_active", `${what} is not available on this host`);
}

export function requireActor(options: PluginActorOptions | undefined): string {
  const actor = options?.actor;
  if (typeof actor !== "string" || !actor.trim())
    throw new PluginServiceError(
      "invalid_request",
      'this call needs { actor }, e.g. { actor: "discord:1234" }',
    );
  return actor.trim().slice(0, MAX_ACTOR);
}

export function buildHostInfo(deps: RuntimeV2Deps): PluginHostInfo {
  return {
    version: deps.host.version,
    apiVersions: [...deps.host.apiVersions],
    features: [...deps.host.features],
    get remoteControl() {
      return deps.remoteControl();
    },
    onRemoteControlChange: (listener) =>
      deps.track(deps.onRemoteControlChange(deps.guard("remote control", listener))),
  };
}

/** Rejects unless `cap` is granted and, for remote-control capabilities, switched on. */
export function gate(
  deps: Pick<RuntimeV2Deps, "has" | "remoteControl" | "pluginId">,
  cap: PluginCapabilityName,
  remote: boolean,
): void {
  if (!deps.has(cap)) throw forbidden(cap);
  if (remote && !deps.remoteControl())
    throw new PluginServiceError(
      "forbidden",
      `remote control is off for ${deps.pluginId}; the host owner can turn it on under Plugins`,
    );
}

function async<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return fn();
  } catch (err) {
    return Promise.reject(err);
  }
}

/** The v2 additions to `ctx.agents`, merged over the v1 members by the runtime. */
export function buildAgentsV2(
  deps: RuntimeV2Deps,
): Omit<PluginAgentsApi, "list" | "get" | "onEvent" | "sendMessage"> {
  const agents = () => {
    if (!deps.agents) throw unavailable("The agent API");
    return deps.agents;
  };
  const read = <T>(fn: () => Promise<T>) =>
    async(() => {
      gate(deps, "agent.read", false);
      return fn();
    });
  const manage = <T>(
    op: string,
    target: string,
    options: PluginActorOptions,
    fn: () => Promise<T>,
  ) =>
    async(async () => {
      gate(deps, "agent.manage", true);
      const actor = requireActor(options);
      const result = await fn();
      deps.audit({ actor, op, target });
      return result;
    });
  return {
    getTimeline: (agentId, options) => read(() => agents().getTimeline(agentId, options)),
    getLastAssistantMessage: (agentId) => read(() => agents().getLastAssistantMessage(agentId)),
    getDiffStat: (agentId) => read(() => agents().getDiffStat(agentId)),
    listProviders: () => read(() => agents().listProviders()),
    onAttention: (listener, options) => {
      gate(deps, "agent.read", false);
      if (!deps.subscribeAttention) throw unavailable("Attention events");
      const force = options?.force === true;
      const safe = deps.guard("attention", listener);
      return deps.track(
        deps.subscribeAttention((event) => {
          if (event.clientActive && !force) return;
          safe(event);
        }),
      );
    },
    create: (input) =>
      manage("agents.create", input?.workspaceId ?? "", input, async () => {
        if (!input || typeof input.prompt !== "string" || !input.prompt.trim())
          throw new PluginServiceError("invalid_request", "prompt is required");
        if (typeof input.provider !== "string" || !input.provider)
          throw new PluginServiceError("invalid_request", "provider is required");
        if (typeof input.workspaceId !== "string" || !input.workspaceId)
          throw new PluginServiceError("invalid_request", "workspaceId is required");
        return agents().create(input);
      }),
    cancel: (agentId, options) =>
      manage("agents.cancel", agentId, options, () => agents().cancel(agentId)),
    archive: (agentId, options) =>
      manage("agents.archive", agentId, options, () => agents().archive(agentId)),
  };
}

export function buildPermissionsV2(deps: RuntimeV2Deps): PluginPermissionsApi {
  const agents = () => {
    if (!deps.agents) throw unavailable("The permissions API");
    return deps.agents;
  };
  let requestListeners: Set<(r: PluginPermissionRequest) => void> | null = null;
  let resolvedListeners: Set<(r: PluginPermissionResolved) => void> | null = null;
  let unsubscribe: (() => void) | null = null;
  // One host subscription per plugin, fanned out; events are dropped while remote control is off
  // so a plugin cannot watch approvals it is not allowed to answer.
  const ensure = () => {
    if (unsubscribe) return;
    requestListeners = new Set();
    resolvedListeners = new Set();
    unsubscribe = agents().subscribePermissions(
      (request) => {
        if (!deps.remoteControl()) return;
        for (const l of requestListeners ?? []) l(request);
      },
      (resolved) => {
        if (!deps.remoteControl()) return;
        for (const l of resolvedListeners ?? []) l(resolved);
      },
    );
    deps.track(() => {
      unsubscribe?.();
      unsubscribe = null;
    });
  };
  return {
    list: (agentId) =>
      async(() => {
        gate(deps, "agent.permissions", true);
        return agents().listPermissions(agentId);
      }),
    onRequest: (listener) => {
      if (!deps.has("agent.permissions")) throw forbidden("agent.permissions");
      ensure();
      const safe = deps.guard("permission request", listener);
      requestListeners!.add(safe);
      return deps.track(() => requestListeners?.delete(safe));
    },
    onResolved: (listener) => {
      if (!deps.has("agent.permissions")) throw forbidden("agent.permissions");
      ensure();
      const safe = deps.guard("permission resolved", listener);
      resolvedListeners!.add(safe);
      return deps.track(() => resolvedListeners?.delete(safe));
    },
    respond: (agentId, requestId, decision, options) =>
      async(async () => {
        gate(deps, "agent.permissions", true);
        const actor = requireActor(options);
        if (decision !== "allow" && decision !== "deny" && decision !== "always")
          throw new PluginServiceError("invalid_request", "decision must be allow, deny or always");
        const message =
          typeof options?.message === "string" ? options.message.slice(0, 2000) : undefined;
        await agents().respondToPermission(agentId, requestId, decision, message);
        deps.audit({
          actor,
          op: `permissions.${decision}`,
          target: `${agentId}/${requestId}`,
        });
      }),
  };
}

export function buildWorkspacesV2(deps: RuntimeV2Deps): PluginWorkspacesApi {
  const ws = () => {
    if (!deps.workspaces) throw unavailable("The workspaces API");
    return deps.workspaces;
  };
  const read = <T>(fn: () => Promise<T>) =>
    async(() => {
      gate(deps, "workspaces.read", false);
      return fn();
    });
  return {
    listProjects: () => read(() => ws().listProjects()),
    list: (projectId) => read(() => ws().list(projectId)),
    get: (workspaceId) => read(() => ws().get(workspaceId)),
  };
}

export function buildTodosV2(deps: RuntimeV2Deps): PluginTodosApi {
  const todos = () => {
    if (!deps.todos) throw unavailable("The to-dos API");
    return deps.todos;
  };
  const read = <T>(fn: () => Promise<T>) =>
    async(() => {
      gate(deps, "todos.read", false);
      return fn();
    });
  const write = <T>(
    op: string,
    target: string,
    options: PluginActorOptions,
    fn: (actor: string) => Promise<T>,
  ) =>
    async(async () => {
      gate(deps, "todos.write", true);
      const actor = requireActor(options);
      const result = await fn(actor);
      deps.audit({ actor, op, target });
      return result;
    });
  return {
    list: (projectId, filter) => read(() => todos().list(projectId, filter)),
    get: (projectId, todoId) => read(() => todos().get(projectId, todoId)),
    onChange: (listener) => {
      gate(deps, "todos.read", false);
      return deps.track(todos().subscribe(deps.guard("todo", listener)));
    },
    create: (projectId, input, options) =>
      write("todos.create", projectId, options, () => todos().create(projectId, input)),
    update: (projectId, todoId, patch, options) =>
      write("todos.update", `${projectId}/${todoId}`, options, () =>
        todos().update(projectId, todoId, patch),
      ),
    setStatus: (projectId, todoId, status, options) =>
      write("todos.set_status", `${projectId}/${todoId}`, options, (actor) =>
        todos().setStatus(projectId, todoId, status, `Status set to ${status} by ${actor}`),
      ),
    addNote: (projectId, todoId, note, options) =>
      write("todos.add_note", `${projectId}/${todoId}`, options, (actor) =>
        todos().addNote(projectId, todoId, `${note}\n— ${actor}`),
      ),
  };
}
