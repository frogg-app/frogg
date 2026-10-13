import { PluginRequestError } from "@frogg/client/internal/daemon-client";
import { isRemoteControlCapability } from "@frogg/protocol/plugins/manifest";
import { useEffect } from "react";
import { create } from "zustand";
import { setPref } from "../prefs";
import { getClient, onHostSwitch, useDaemon } from "./store";

type Client = NonNullable<ReturnType<typeof getClient>>;
export type InstalledPlugin = Awaited<ReturnType<Client["pluginsList"]>>["plugins"][number];
export type PluginPolicy = Awaited<ReturnType<Client["pluginsList"]>>["policy"];
export type CatalogPlugin = Awaited<ReturnType<Client["pluginsGetCatalog"]>>["plugins"][number];
export type PluginRepo = Awaited<ReturnType<Client["pluginsReposList"]>>["repos"][number];

/** The plugin that switches the host's built-in Companion on (daemon: `contributes.features`). */
export const COMPANION_PLUGIN_ID = "frogg.companion";

interface PluginGate {
  /** Whether the connected host runs the Companion (its plugin is in, or plugins are off). */
  companion: boolean;
  /** The plugin to install before the host runs the Companion, or null when none is missing. */
  companionPlugin: { id: string; repoUrl: string } | null;
}

const LOCKED: PluginGate = { companion: false, companionPlugin: null };
export const usePluginGate = create<PluginGate>(() => LOCKED);
onHostSwitch(() => usePluginGate.setState(LOCKED));

interface CompanionCapability {
  enabled: boolean;
  reason: string;
  plugin?: { id: string; repoUrl: string };
}

/**
 * Reads the gate from `server_info.capabilities.companion`, as apps/ui does: the daemon decides
 * (an enabled official or brand plugin contributing the `companion` feature, or plugins switched
 * off by the brand) and names the plugin while it is missing. No capability, no Companion.
 */
export function refreshPluginGate(): void {
  const info = getClient()?.getLastServerInfoMessage() as {
    capabilities?: { companion?: CompanionCapability };
  } | null;
  const cap = info?.capabilities?.companion;
  usePluginGate.setState({ companion: !!cap && !cap.plugin, companionPlugin: cap?.plugin ?? null });
}

/** Keeps the gate current while mounted: on connect and on every server_info push. */
export function useWatchPluginGate(): void {
  const conn = useDaemon((s) => s.conn);
  const url = useDaemon((s) => s.url);
  useEffect(() => {
    if (conn !== "online" || !getClient()) return;
    ensureWatcher();
    refreshPluginGate();
  }, [conn, url]);
}

// --- Shared plugin lists -----------------------------------------------------------------------

/** What the store loads: installed plugins (+ policy), the catalog, and the repository list. */
export type PluginData = "installed" | "catalog" | "repos";

interface PluginsState {
  /** Installed plugins, or null until loaded. */
  installed: InstalledPlugin[] | null;
  policy: PluginPolicy | null;
  /** Catalog across every source, or null until loaded. */
  catalog: CatalogPlugin[] | null;
  /** Sources that failed to fetch or verify while building the catalog. */
  catalogErrors: PluginRepo[];
  /** Configured plugin repositories, or null until loaded. */
  repos: PluginRepo[] | null;
  /** The last load failure per list. */
  errors: Partial<Record<PluginData, string>>;
  /** Bumped per plugin when the host reports its settings changed. */
  settingsRev: Record<string, number>;
}

const EMPTY: PluginsState = {
  installed: null,
  policy: null,
  catalog: null,
  catalogErrors: [],
  repos: null,
  errors: {},
  settingsRev: {},
};

/**
 * The host's plugins, shared by the Plugins tool, the settings Plugins page and anything else
 * that lists them. Kept live by `plugins.changed`; refetched on reconnect and host switch.
 */
export const usePlugins = create<PluginsState>(() => EMPTY);

const FETCH: Record<PluginData, (c: Client) => Promise<Partial<PluginsState>>> = {
  installed: async (c) => {
    const r = await c.pluginsList();
    return { installed: r.plugins, policy: r.policy };
  },
  catalog: async (c) => {
    const r = await c.pluginsGetCatalog();
    return { catalog: r.plugins, catalogErrors: r.repos.filter((x) => x.error) };
  },
  repos: async (c) => ({ repos: (await c.pluginsReposList()).repos }),
};
const KINDS = Object.keys(FETCH) as PluginData[];
const LOADED: Record<PluginData, (s: PluginsState) => boolean> = {
  installed: (s) => s.installed !== null,
  catalog: (s) => s.catalog !== null,
  repos: (s) => s.repos !== null,
};

/** Mounted readers per list; a change nobody is watching only marks the list stale. */
const watchers: Record<PluginData, number> = { installed: 0, catalog: 0, repos: 0 };
const stale = new Set<PluginData>();
const inflight: Partial<Record<PluginData, Promise<void>>> = {};
const again = new Set<PluginData>();
let generation = 0;
let watched: Client | null = null;
let unwatch: (() => void) | null = null;

function setError(kind: PluginData, error: string | null): void {
  usePlugins.setState((s) => {
    const errors = { ...s.errors };
    if (error) errors[kind] = error;
    else delete errors[kind];
    return { errors };
  });
}

/**
 * Loads one list, sharing the request in flight. With `fresh` (a change event, a refresh) a call
 * that lands mid-request queues a single rerun, so the result is never older than the change.
 */
export function refreshPlugins(kind: PluginData, fresh = true): Promise<void> {
  const running = inflight[kind];
  if (running) {
    if (fresh) again.add(kind);
    return running;
  }
  const c = getClient();
  if (!c) return Promise.resolve();
  if (!c.supportsPlugins()) {
    setError(kind, "This host's daemon has no plugin support.");
    return Promise.resolve();
  }
  const mine = generation;
  const run = (async () => {
    try {
      do {
        again.delete(kind);
        stale.delete(kind);
        try {
          const patch = await FETCH[kind](c);
          if (mine !== generation) return;
          usePlugins.setState(patch);
          setError(kind, null);
        } catch (e) {
          if (mine !== generation) return;
          setError(kind, describePluginError(e));
        }
      } while (again.has(kind));
    } finally {
      if (mine === generation) delete inflight[kind];
    }
  })();
  inflight[kind] = run;
  return run;
}

/** Refetches a list now if anyone shows it, otherwise on the next mount. */
function invalidate(kind: PluginData): void {
  if (watchers[kind] > 0) void refreshPlugins(kind);
  else if (LOADED[kind](usePlugins.getState())) stale.add(kind);
}

/** What each `plugins.changed` reason touches. Unknown reasons refetch the installed list. */
function onPluginsChanged(pluginId: string | null, reason: string): void {
  // Badges and panel refreshes; the lists don't carry contributions.
  if (reason === "contributions") return;
  if (reason === "settings") {
    if (pluginId)
      usePlugins.setState((s) => ({
        settingsRev: { ...s.settingsRev, [pluginId]: (s.settingsRev[pluginId] ?? 0) + 1 },
      }));
    return;
  }
  if (reason === "repos") {
    invalidate("repos");
    invalidate("catalog");
    return;
  }
  // The catalog carries installedVersion and updateAvailable, so it follows installs too.
  invalidate("installed");
  invalidate("catalog");
  if (reason === "policy") invalidate("repos");
}

/** One subscription per client: plugin changes feed the lists, server_info feeds the gate. */
function ensureWatcher(): void {
  const c = getClient();
  if (!c || c === watched) return;
  unwatch?.();
  watched = c;
  unwatch = c.subscribeRawMessages((m) => {
    if (m.type === "status") refreshPluginGate();
    else if (m.type === "plugins.changed") {
      refreshPluginGate();
      onPluginsChanged(m.payload.pluginId, m.payload.reason);
    }
  });
}

/** Empties the store and drops the subscription; the next reader loads from the current host. */
export function resetPlugins(): void {
  generation += 1;
  unwatch?.();
  unwatch = null;
  watched = null;
  stale.clear();
  again.clear();
  for (const k of KINDS) delete inflight[k];
  usePlugins.setState(EMPTY);
}
onHostSwitch(resetPlugins);

// Events missed while offline: everything loaded is stale once the link drops.
useDaemon.subscribe((s, prev) => {
  if (s.conn === prev.conn || s.conn === "online") return;
  const st = usePlugins.getState();
  for (const k of KINDS) if (LOADED[k](st)) stale.add(k);
});

/** Registers a reader of `kind`: loads it when missing or stale and keeps it live until released. */
export function watchPlugins(kind: PluginData): () => void {
  watchers[kind] += 1;
  ensureWatcher();
  const st = usePlugins.getState();
  if (stale.has(kind) || !LOADED[kind](st)) void refreshPlugins(kind, stale.has(kind));
  let held = true;
  return () => {
    if (held) watchers[kind] -= 1;
    held = false;
  };
}

/** `watchPlugins` while mounted and online; reloads after a reconnect or host switch. */
export function useWatchPlugins(kind: PluginData, enabled = true): void {
  const conn = useDaemon((s) => s.conn);
  const url = useDaemon((s) => s.url);
  useEffect(() => {
    if (!enabled || conn !== "online" || !getClient()) return;
    return watchPlugins(kind);
  }, [kind, enabled, conn, url]);
}

/** Refetches every list someone is showing (the Plugins tool's refresh button). */
export function refreshWatchedPlugins(): void {
  for (const k of KINDS) if (watchers[k] > 0) void refreshPlugins(k);
}

function upsertInstalled(p: InstalledPlugin | null | undefined): void {
  if (!p) return;
  usePlugins.setState((s) => {
    const list = s.installed ?? [];
    const at = list.findIndex((x) => x.id === p.id);
    const installed = at < 0 ? [...list, p] : list.map((x) => (x.id === p.id ? p : x));
    const catalog = s.catalog?.map((c) =>
      c.id === p.id ? { ...c, installedVersion: p.version } : c,
    );
    return { installed, catalog: catalog ?? null };
  });
}

function patchInstalled(id: string, patch: Partial<InstalledPlugin>): void {
  usePlugins.setState((s) => ({
    installed: s.installed?.map((x) => (x.id === id ? { ...x, ...patch } : x)) ?? null,
  }));
}

function needClient(): Client {
  const c = getClient();
  if (!c) throw new Error("Host is not connected.");
  return c;
}

/**
 * This client's own changes show at once; the host's `plugins.changed` then refetches and
 * reconciles. A failed change refetches so the optimistic value never sticks.
 */
async function optimistic<T>(
  id: string,
  patch: Partial<InstalledPlugin> | null,
  fn: (c: Client) => Promise<T>,
): Promise<T> {
  const c = needClient();
  if (patch) patchInstalled(id, patch);
  try {
    return await fn(c);
  } catch (e) {
    void refreshPlugins("installed");
    throw e;
  }
}

export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  const r = await optimistic(id, { enabled }, (c) => c.pluginsSetEnabled(id, enabled));
  upsertInstalled(r.plugin);
}

export async function setPluginRemoteControl(id: string, on: boolean): Promise<void> {
  const r = await optimistic(id, { remoteControl: on }, (c) => c.pluginsSetRemoteControl(id, on));
  upsertInstalled(r.plugin);
}

export async function installPlugin(
  input: Parameters<Client["pluginsInstall"]>[0],
): Promise<InstalledPlugin | null> {
  const r = await optimistic(input.id, null, (c) => c.pluginsInstall(input));
  upsertInstalled(r.plugin);
  noteInstalled(r.plugin);
  return r.plugin ?? null;
}

export async function updatePlugin(input: Parameters<Client["pluginsUpdate"]>[0]): Promise<void> {
  const r = await optimistic(input.id, null, (c) => c.pluginsUpdate(input));
  upsertInstalled(r.plugin);
}

export async function uninstallPlugin(id: string): Promise<void> {
  await optimistic(id, null, (c) => c.pluginsUninstall(id));
  usePlugins.setState((s) => ({
    installed: s.installed?.filter((x) => x.id !== id) ?? null,
    catalog: s.catalog?.map((c) => (c.id === id ? { ...c, installedVersion: null } : c)) ?? null,
  }));
}

export async function unlinkDevPlugin(id: string): Promise<void> {
  await optimistic(id, null, (c) => c.pluginsDevUnlink(id));
  usePlugins.setState((s) => ({ installed: s.installed?.filter((x) => x.id !== id) ?? null }));
}

export async function addPluginRepo(url: string, publicKey?: string): Promise<void> {
  const r = await needClient().pluginsReposAdd({ url, publicKey });
  if (!r.repo) throw new Error("Repository was not added.");
  const repo = r.repo;
  usePlugins.setState((s) => ({
    repos: s.repos?.some((x) => x.url === repo.url) ? s.repos : [...(s.repos ?? []), repo],
  }));
}

export async function removePluginRepo(url: string): Promise<void> {
  const r = await needClient().pluginsReposRemove(url);
  if (!r.success) throw new Error("Source could not be removed.");
  usePlugins.setState((s) => ({ repos: s.repos?.filter((x) => x.url !== url) ?? null }));
}

/** Installing the Companion plugin is the opt-in, so this device turns the Companion on too. */
export function noteInstalled(plugin: { features?: string[] } | null | undefined): void {
  if (plugin?.features?.includes("companion")) setPref("companion", true);
}

/** Installs the plugin the host names for the Companion (it asks for no capabilities). */
export async function installCompanionPlugin(): Promise<void> {
  const plugin = usePluginGate.getState().companionPlugin;
  if (!getClient() || !plugin) return;
  await installPlugin({ id: plugin.id, repoUrl: plugin.repoUrl, grantedCapabilities: [] });
}

/** Plain-English capability names, matching apps/ui's `plugins.capabilities` copy. */
const CAPABILITY_LABELS: Record<string, string> = {
  network: "Make network requests",
  "filesystem.workspace": "Read and write files in workspaces",
  "process.spawn": "Run programs on the host",
  "agent.read": "Read agent sessions and their events",
  "agent.write": "Send messages to agents",
  "settings.store": "Store its own settings",
  "ui.contribute": "Add commands, buttons and panels",
  rpc: "Answer requests from the app",
  "ui.view": "Show its own views in the app",
  "media.microphone": "Use the microphone",
  "media.audio": "Play audio",
  composer: "Add composer buttons and insert text",
  speech: "Use the host's speech recognition and voices",
  "agent.manage": "Start, stop and archive agents",
  "agent.permissions": "Approve or deny agents' permission requests",
  "workspaces.read": "See projects and workspaces",
  "todos.read": "Read project to-dos",
  "todos.write": "Create and update project to-dos",
  "ui.external": "Open links in your browser",
};

/** A capability's label; one this build doesn't know shows its id. */
export const describeCapability = (c: string): string => CAPABILITY_LABELS[c] ?? c;
export { isRemoteControlCapability };

/** True when the plugin was granted a capability that only works with remote control on. */
export function wantsRemoteControl(p: {
  remoteControl?: boolean;
  grantedCapabilities: string[];
}): boolean {
  return p.remoteControl !== undefined && p.grantedCapabilities.some(isRemoteControlCapability);
}

const ERRORS: Record<string, string> = {
  not_found: "Not found.",
  invalid_request: "The request was invalid.",
  forbidden: "Not allowed.",
  consent_required: "This update needs new permissions.",
  signature_invalid: "The repository signature did not verify.",
  hash_mismatch: "The download did not match its checksum.",
  manifest_mismatch: "The plugin did not match its repository entry.",
  fetch_failed: "Could not download from the repository.",
  incompatible: "Not compatible with this host.",
  already_installed: "Already installed.",
  plugin_error: "The plugin reported an error.",
  not_active: "The plugin is not running.",
  timeout: "The request timed out.",
  internal: "Something went wrong on the host.",
  already_resolved: "Already answered elsewhere.",
};

/** A plugin RPC failure in plain words, with the host's detail after it. */
export function describePluginError(e: unknown): string {
  if (e instanceof PluginRequestError) {
    const summary = ERRORS[e.code];
    if (!summary) return e.message;
    return e.message && e.message !== summary ? `${summary} ${e.message}` : summary;
  }
  return e instanceof Error ? e.message : String(e);
}
