// Read-only view of a Claude Code config dir's installed plugins against the local copy of their
// marketplaces, so Frogg can show which have updates due. Never writes to the config dir and never
// refreshes a marketplace: that stays Claude Code's job.
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { comparePluginVersions } from "@frogg/protocol/plugins/repo-index";
import type { ClaudePluginSource, ClaudePluginStatus } from "@frogg/protocol/messages";
import { resolveProviderAccountConfigDir } from "./provider-account-env.js";
import type { ProviderAccountStore } from "./provider-account-store.js";

/** Marketplaces Claude Code auto-updates by default; others default to off. */
const AUTO_UPDATE_BY_DEFAULT = new Set(["claude-plugins-official", "anthropic-agent-skills"]);

type Json = Record<string, unknown>;

async function readJson(file: string): Promise<Json | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Json) : null;
  } catch {
    return null;
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

interface MarketplaceInfo {
  name: string;
  autoUpdate: boolean;
  lastUpdated: string | null;
  installLocation: string | null;
}

export interface ClaudeAutoUpdateEnv {
  DISABLE_AUTOUPDATER?: string;
  FORCE_AUTOUPDATE_PLUGINS?: string;
}

/** Whether Claude Code would update this marketplace's plugins when it starts. */
export function marketplaceAutoUpdates(
  name: string,
  declared: unknown,
  env: ClaudeAutoUpdateEnv = {},
): boolean {
  // DISABLE_AUTOUPDATER turns plugin updates off too, unless FORCE_AUTOUPDATE_PLUGINS keeps them.
  if (env.DISABLE_AUTOUPDATER && !env.FORCE_AUTOUPDATE_PLUGINS) return false;
  return typeof declared === "boolean" ? declared : AUTO_UPDATE_BY_DEFAULT.has(name);
}

/**
 * An update is due when the marketplace declares a newer version than the installed one. Without
 * a declared version (most marketplace entries carry none) nothing can be said.
 */
export function isUpdateDue(installed: string | null, latest: string | null): boolean {
  if (!latest || !installed || installed === latest) return false;
  return comparePluginVersions(latest, installed) > 0;
}

async function readMarketplaces(
  pluginsDir: string,
  env: ClaudeAutoUpdateEnv,
): Promise<Map<string, MarketplaceInfo>> {
  const known = (await readJson(path.join(pluginsDir, "known_marketplaces.json"))) ?? {};
  const out = new Map<string, MarketplaceInfo>();
  for (const [name, raw] of Object.entries(known)) {
    const entry = raw && typeof raw === "object" ? (raw as Json) : {};
    out.set(name, {
      name,
      autoUpdate: marketplaceAutoUpdates(name, entry.autoUpdate, env),
      lastUpdated: str(entry.lastUpdated),
      installLocation: str(entry.installLocation),
    });
  }
  return out;
}

interface MarketplaceEntry {
  version: string | null;
  description: string | null;
}

/** Plugin entry from the marketplace manifest, falling back to the plugin's own plugin.json. */
async function marketplaceEntry(
  market: MarketplaceInfo | undefined,
  name: string,
  manifests: Map<string, Json[]>,
): Promise<MarketplaceEntry | null> {
  if (!market?.installLocation) return null;
  let plugins = manifests.get(market.name);
  if (!plugins) {
    const manifest = await readJson(
      path.join(market.installLocation, ".claude-plugin", "marketplace.json"),
    );
    plugins = Array.isArray(manifest?.plugins) ? (manifest.plugins as Json[]) : [];
    manifests.set(market.name, plugins);
  }
  const entry = plugins.find((p) => p && p.name === name);
  if (!entry) return null;
  let version = str(entry.version);
  let description = str(entry.description);
  const source = str(entry.source);
  if ((!version || !description) && source?.startsWith("./")) {
    const base = path.resolve(market.installLocation);
    const root = path.resolve(base, source);
    if (root.startsWith(base + path.sep)) {
      const own = await readJson(path.join(root, ".claude-plugin", "plugin.json"));
      version ??= str(own?.version);
      description ??= str(own?.description);
    }
  }
  return { version, description };
}

/** Installed plugins of one Claude config dir; empty when it has none. */
export async function readClaudePluginStatus(
  configDir: string,
  env: ClaudeAutoUpdateEnv = {},
): Promise<Pick<ClaudePluginSource, "plugins" | "marketplaces">> {
  const pluginsDir = path.join(configDir, "plugins");
  const markets = await readMarketplaces(pluginsDir, env);
  const installed = await readJson(path.join(pluginsDir, "installed_plugins.json"));
  const byId =
    installed?.plugins && typeof installed.plugins === "object" ? (installed.plugins as Json) : {};
  const manifests = new Map<string, Json[]>();
  const plugins: ClaudePluginStatus[] = [];
  for (const [id, raw] of Object.entries(byId)) {
    const at = id.lastIndexOf("@");
    const name = at > 0 ? id.slice(0, at) : id;
    const marketplace = at > 0 ? id.slice(at + 1) : "";
    const market = markets.get(marketplace);
    const entry = await marketplaceEntry(market, name, manifests);
    const installs = Array.isArray(raw) ? (raw as Json[]) : [];
    for (const install of installs) {
      const installedVersion = str(install.version);
      const latestVersion = entry?.version ?? null;
      plugins.push({
        id,
        name,
        marketplace,
        scope: str(install.scope) ?? "user",
        projectPath: str(install.projectPath),
        description: entry?.description ?? null,
        installedVersion,
        latestVersion,
        updateDue: isUpdateDue(installedVersion, latestVersion),
        autoUpdate: market?.autoUpdate ?? false,
        lastUpdated: str(install.lastUpdated),
      });
    }
  }
  plugins.sort((a, b) => Number(b.updateDue) - Number(a.updateDue) || a.id.localeCompare(b.id));
  const marketplaces = [...markets.values()]
    .map(({ name, autoUpdate, lastUpdated }) => ({ name, autoUpdate, lastUpdated }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { plugins, marketplaces };
}

type AccountStore = Pick<
  ProviderAccountStore,
  "list" | "getCapability" | "activeAccountIds" | "findAccount" | "primaryConfigDir"
>;

/**
 * Every Claude plugins folder this host's agents launch against: the primary config dir plus each
 * Claude account's. Accounts whose `plugins` folder links to the same place are grouped.
 */
export async function listClaudePluginSources(
  store: AccountStore,
  env: ClaudeAutoUpdateEnv = {},
): Promise<ClaudePluginSource[]> {
  const primary = store.primaryConfigDir("claude") ?? path.join(os.homedir(), ".claude");
  const dirs: { configDir: string; accountId: string | null; accountName: string | null }[] = [];
  const accounts = store.list("claude", { includeImplicitDefault: true });
  if (accounts.length === 0) dirs.push({ configDir: primary, accountId: null, accountName: null });
  for (const account of accounts) {
    dirs.push({
      configDir: resolveProviderAccountConfigDir(store, "claude", account.id) ?? primary,
      accountId: account.id,
      accountName: account.name,
    });
  }
  const groups = new Map<string, ClaudePluginSource>();
  for (const d of dirs) {
    const pluginsDir = path.join(d.configDir, "plugins");
    const key = await fs.realpath(pluginsDir).catch(() => pluginsDir);
    let group = groups.get(key);
    if (!group) {
      group = {
        configDir: d.configDir,
        accountIds: [],
        accountNames: [],
        ...(await readClaudePluginStatus(d.configDir, env)),
      };
      groups.set(key, group);
    }
    if (d.accountId) group.accountIds.push(d.accountId);
    if (d.accountName) group.accountNames.push(d.accountName);
  }
  return [...groups.values()];
}
