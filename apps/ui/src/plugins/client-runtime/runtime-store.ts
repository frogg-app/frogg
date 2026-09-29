import { create } from "zustand";
import { brand } from "@frogg/branding";
import { isPluginIdAllowed } from "@frogg/protocol/plugins/repo-index";
import { PluginManifestSchema } from "@frogg/protocol/plugins/manifest";
import { createClientPluginBridge, type ClientPluginNotifyLevel } from "./bridge";
import type { ClientPluginChannel } from "./channel";
import { ClientPluginError } from "./errors";
import { startIframeSandbox } from "./iframe-sandbox";
import type { ClientPluginRecord } from "./records";
import { getClientPluginStorage, type ClientPluginStorage } from "./storage";
import { bundleFromFiles, fetchVerifiedClientPlugin, type FetchLike } from "./verify";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";

/** active | starting | error | disabled | blocked */
export type ClientPluginRunState = "starting" | "active" | "error" | "disabled" | "blocked";

export interface ClientPluginStatus {
  state: ClientPluginRunState;
  error: string | null;
}

/** Hooks the runtime needs from the app; set once by ClientPluginRuntimeHost. */
export interface ClientPluginRuntimeDeps {
  notify: (pluginId: string, message: string, level: ClientPluginNotifyLevel) => void;
  /** The plugin's daemon half, on a connected host where it is active. */
  rpcCall: (pluginId: string, method: string, params: unknown) => Promise<unknown>;
  fetch: FetchLike;
}

let deps: ClientPluginRuntimeDeps = {
  notify: () => undefined,
  rpcCall: () => Promise.reject(new ClientPluginError("not_active", "No host")),
  fetch: (url) => fetch(url),
};

export function setClientPluginRuntimeDeps(next: Partial<ClientPluginRuntimeDeps>): void {
  deps = { ...deps, ...next };
}

interface Running {
  channel: ClientPluginChannel;
  dispose: () => void;
}
const running = new Map<string, Running>();

interface State {
  loaded: boolean;
  loadError: string | null;
  records: ClientPluginRecord[];
  status: Record<string, ClientPluginStatus>;
  /** Contribution methods each running plugin answers with ctx.rpc.handle. */
  handled: Record<string, readonly string[]>;
}

export const useClientPluginsStore = create<State>(() => ({
  loaded: false,
  loadError: null,
  records: [],
  status: {},
  handled: {},
}));

const set = useClientPluginsStore.setState;
const get = useClientPluginsStore.getState;

function setStatus(id: string, status: ClientPluginStatus): void {
  set((s) => ({ status: { ...s.status, [id]: status } }));
}

function requireStorage(): ClientPluginStorage {
  const storage = getClientPluginStorage();
  if (!storage) {
    throw new ClientPluginError("incompatible", "Client plugins are not supported on this device");
  }
  return storage;
}

export function isBlockedByBrand(id: string): boolean {
  return !brand.plugins.enabled || !isPluginIdAllowed(id, brand.plugins);
}

async function persist(record: ClientPluginRecord): Promise<void> {
  await requireStorage().put(record);
  set((s) => ({ records: [...s.records.filter((r) => r.id !== record.id), record] }));
}

function stop(id: string): void {
  running.get(id)?.dispose();
  running.delete(id);
  set((s) => {
    const handled = { ...s.handled };
    delete handled[id];
    return { handled };
  });
}

async function devSource(record: ClientPluginRecord): Promise<string> {
  if (!record.devPath) return record.entrySource;
  const folder = await invokeDesktopCommand<{ manifest: string; entrySource: string | null }>(
    "client_plugins_read_folder",
    { path: record.devPath },
  );
  return folder.entrySource ?? record.entrySource;
}

async function start(record: ClientPluginRecord): Promise<void> {
  stop(record.id);
  if (isBlockedByBrand(record.id)) {
    setStatus(record.id, { state: "blocked", error: null });
    return;
  }
  if (!record.enabled) {
    setStatus(record.id, { state: "disabled", error: null });
    return;
  }
  setStatus(record.id, { state: "starting", error: null });
  const id = record.id;
  const bridge = createClientPluginBridge({
    pluginId: id,
    capabilities: record.grantedCapabilities,
    log: (level, message, data) => {
      const line = `[plugin ${id}] ${message}`;
      if (level === "error") console.error(line, data ?? "");
      else if (level === "warn") console.warn(line, data ?? "");
      else console.info(line, data ?? "");
    },
    settings: {
      read: () => get().records.find((r) => r.id === id)?.settings ?? {},
      write: async (next) => {
        const current = get().records.find((r) => r.id === id);
        if (current) await persist({ ...current, settings: next });
      },
    },
    rpcCall: (method, params) => {
      const current = get().records.find((r) => r.id === id);
      if (current?.manifest.scope !== "hybrid") {
        return Promise.reject(
          new ClientPluginError("not_active", `${id} has no daemon half to call`),
        );
      }
      return deps.rpcCall(id, method, params);
    },
    notify: (message, level) => deps.notify(id, message, level),
  });
  try {
    const code = record.devPath ? await devSource(record) : record.entrySource;
    const sandbox = await startIframeSandbox({
      code,
      info: {
        id,
        version: record.version,
        dev: record.source === "dev",
        capabilities: record.grantedCapabilities,
      },
      bridge,
      onHandledChange: (methods) => set((s) => ({ handled: { ...s.handled, [id]: [...methods] } })),
    });
    running.set(id, sandbox);
    set((s) => ({ handled: { ...s.handled, [id]: [...sandbox.channel.handledMethods()] } }));
    setStatus(id, { state: "active", error: null });
  } catch (error) {
    setStatus(id, {
      state: "error",
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/** Reads installed client plugins from device storage and starts the enabled ones. */
export async function loadClientPlugins(): Promise<void> {
  const storage = getClientPluginStorage();
  if (!storage) {
    set({ loaded: true });
    return;
  }
  try {
    const records = await storage.list();
    set({ records, loaded: true, loadError: null });
    await Promise.all(records.map((record) => start(record)));
  } catch (error) {
    set({ loaded: true, loadError: error instanceof Error ? error.message : String(error) });
  }
}

export interface InstallFromRepoInput {
  repo: { url: string; publicKey: string; tier: string };
  id: string;
  version?: string;
  grantedCapabilities: readonly string[];
}

/** Fetches, verifies, stores and starts a client plugin (or a hybrid plugin's client half). */
export async function installClientPlugin(
  input: InstallFromRepoInput,
): Promise<ClientPluginRecord> {
  if (isBlockedByBrand(input.id)) {
    throw new ClientPluginError("forbidden", `${input.id} is not allowed by this build`);
  }
  const verified = await fetchVerifiedClientPlugin({
    fetch: deps.fetch,
    repo: input.repo,
    id: input.id,
    version: input.version,
  });
  const missing = verified.manifest.capabilities.filter(
    (cap) => !input.grantedCapabilities.includes(cap),
  );
  if (missing.length > 0) {
    throw new ClientPluginError("consent_required", `Not granted: ${missing.join(", ")}`);
  }
  const previous = get().records.find((r) => r.id === input.id);
  const record: ClientPluginRecord = {
    id: input.id,
    version: verified.manifest.version,
    source: input.repo.tier,
    repoUrl: input.repo.url,
    devPath: null,
    enabled: true,
    grantedCapabilities: [...verified.manifest.capabilities],
    manifest: verified.manifest,
    entrySource: verified.entrySource,
    settings: previous?.settings ?? {},
    installedAt: new Date().toISOString(),
  };
  await persist(record);
  await start(record);
  return record;
}

/** Desktop developer mode: link a local plugin folder. Skips integrity checks; DEV badge. */
export async function linkClientPluginFolder(path: string): Promise<ClientPluginRecord> {
  const folder = await invokeDesktopCommand<{
    path: string;
    manifest: string;
    entrySource: string | null;
  }>("client_plugins_read_folder", { path });
  const files = [{ path: "frogg-plugin.json", data: folder.manifest }];
  const raw = PluginManifestSchema.safeParse(safeJson(folder.manifest));
  const entryPath = raw.success ? (raw.data.entry?.client ?? "").replace(/^\.\//, "") : "";
  if (folder.entrySource !== null) files.push({ path: entryPath, data: folder.entrySource });
  const bundle = bundleFromFiles(files);
  if (isBlockedByBrand(bundle.manifest.id)) {
    throw new ClientPluginError("forbidden", `${bundle.manifest.id} is not allowed by this build`);
  }
  const existing = get().records.find((r) => r.id === bundle.manifest.id);
  if (existing && existing.source !== "dev") {
    throw new ClientPluginError(
      "already_installed",
      `${bundle.manifest.id} is already installed from a repository`,
    );
  }
  const record: ClientPluginRecord = {
    id: bundle.manifest.id,
    version: bundle.manifest.version,
    source: "dev",
    repoUrl: null,
    devPath: folder.path,
    enabled: true,
    grantedCapabilities: [...bundle.manifest.capabilities],
    manifest: bundle.manifest,
    entrySource: bundle.entrySource,
    settings: existing?.settings ?? {},
    installedAt: new Date().toISOString(),
  };
  await persist(record);
  await start(record);
  return record;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Restarts a plugin; dev links re-read their folder first. */
export async function reloadClientPlugin(id: string): Promise<void> {
  const record = get().records.find((r) => r.id === id);
  if (!record) return;
  if (record.devPath) {
    await linkClientPluginFolder(record.devPath);
    return;
  }
  await start(record);
}

export async function setClientPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const record = get().records.find((r) => r.id === id);
  if (!record) throw new ClientPluginError("not_found", `${id} is not installed on this device`);
  const next = { ...record, enabled };
  await persist(next);
  await start(next);
}

export async function uninstallClientPlugin(id: string): Promise<void> {
  stop(id);
  await requireStorage().remove(id);
  set((s) => {
    const status = { ...s.status };
    delete status[id];
    return { records: s.records.filter((r) => r.id !== id), status };
  });
}

/** True when this device's copy of `pluginId` answers `method` itself. */
export function clientPluginHandles(pluginId: string, method: string): boolean {
  return running.get(pluginId)?.channel.handles(method) === true;
}

export function invokeClientPlugin(
  pluginId: string,
  method: string,
  params: unknown,
): Promise<unknown> {
  const sandbox = running.get(pluginId);
  if (!sandbox) {
    return Promise.reject(
      new ClientPluginError("not_active", `${pluginId} is not running on this device`),
    );
  }
  return sandbox.channel.invoke(method, params);
}
