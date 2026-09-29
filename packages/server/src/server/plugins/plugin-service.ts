// The daemon's plugin system: brand policy, repositories, install/update/uninstall, dev links
// with hot reload, and the running plugin set. Session handlers are thin wrappers over this.
import { promises as fs, watch as fsWatch, type FSWatcher } from "node:fs";
import path from "node:path";
import type pino from "pino";
import {
  PLUGIN_MANIFEST_FILENAME,
  SUPPORTED_PLUGIN_API_VERSIONS,
  addedCapabilities,
  isSupportedPluginApiVersion,
  type PluginManifest,
  type PluginSettingValue,
} from "@frogg/protocol/plugins/manifest";
import {
  OFFICIAL_PLUGIN_REPO,
  comparePluginVersions,
  isPluginIdAllowed,
  pickPluginVersion,
  type PluginIndex,
  type PluginIndexEntry,
  type PluginIndexVersion,
} from "@frogg/protocol/plugins/repo-index";
import type {
  PluginCatalogEntry,
  PluginContributionSet,
  PluginInstalled,
  PluginPolicy,
  PluginRepo,
  PluginsChangedMessage,
  PluginsNotifyMessage,
} from "@frogg/protocol/plugins/rpc-schemas";
import type { PluginNotifyLevel } from "@frogg/protocol/plugins/api-v1";
import { PluginServiceError } from "./errors.js";
import {
  assertRepoUrl,
  fetchRepoPublicKey,
  fetchVerifiedIndex,
  fetchVerifiedTarball,
  type FetchLike,
} from "./repo-client.js";
import { PluginRuntime, type PluginAgentBridge } from "./runtime.js";
import { PluginSettingsFile } from "./settings-store.js";
import { PluginStateStore, type InstalledPluginRecord } from "./state-store.js";
import { isValidPublicKey } from "./signing.js";
import { writeTarEntries } from "./tar.js";
import { assertManifestMatches, readManifestFromTarball, readPluginManifest } from "./tooling.js";

export interface PluginBrandPolicy {
  enabled: boolean;
  officialRepo: boolean;
  repos: readonly { name: string; url: string; publicKey: string }[];
  allowUserRepos: boolean;
  developerMode: "allowed" | "forbidden";
  allow: readonly string[];
  deny: readonly string[];
  preinstalled: readonly { id: string; version: string | null }[];
  autoUpdate: "off" | "brand-repos" | "all";
}

export const DEFAULT_PLUGIN_POLICY: PluginBrandPolicy = {
  enabled: true,
  officialRepo: true,
  repos: [],
  allowUserRepos: false,
  developerMode: "allowed",
  allow: [],
  deny: [],
  preinstalled: [],
  autoUpdate: "brand-repos",
};

export type PluginServiceEvent = PluginsChangedMessage | PluginsNotifyMessage;

export interface PluginServiceOptions {
  froggHome: string;
  logger: pino.Logger;
  policy: PluginBrandPolicy;
  fetch?: FetchLike;
  agents?: PluginAgentBridge | null;
  /** Override the compiled-in official repo (tests). */
  officialRepo?: { name: string; url: string; publicKey: string };
  /** Auto-update poll interval; 0 disables polling. Default 6h. */
  autoUpdateIntervalMs?: number;
  indexCacheTtlMs?: number;
  /** Watch dev-linked folders for changes. Default true. */
  watchDevLinks?: boolean;
  devReloadDebounceMs?: number;
}

interface ResolvedRepo {
  url: string;
  name: string;
  tier: "official" | "brand" | "user";
  publicKey: string;
  removable: boolean;
}

interface LoadedPlugin {
  manifest: PluginManifest;
  rootDir: string;
  dev: boolean;
  record: InstalledPluginRecord | null;
  runtime: PluginRuntime | null;
  status: string;
  error: string | null;
}

interface CachedIndex {
  index: PluginIndex | null;
  fetchedAt: number;
  error: string | null;
}

const DEFAULT_AUTO_UPDATE_MS = 6 * 60 * 60 * 1000;

function isValidSettingValue(
  field: { type: string; options?: { value: string }[] },
  value: unknown,
): boolean {
  switch (field.type) {
    case "string":
    case "secret":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "boolean":
      return typeof value === "boolean";
    case "select":
      return typeof value === "string" && (field.options ?? []).some((o) => o.value === value);
    default:
      return false;
  }
}

function sameUrl(a: string, b: string): boolean {
  return a.replace(/\/+$/, "") === b.replace(/\/+$/, "");
}

export class PluginService {
  readonly pluginsDir: string;
  private readonly state: PluginStateStore;
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly indexes = new Map<string, CachedIndex>();
  private readonly listeners = new Set<(event: PluginServiceEvent) => void>();
  private readonly watchers = new Map<
    string,
    { watcher: FSWatcher; timer: NodeJS.Timeout | null }
  >();
  private readonly settingsFiles = new Map<string, PluginSettingsFile>();
  private readonly fetchImpl: FetchLike;
  private readonly logger: pino.Logger;
  private autoUpdateTimer: NodeJS.Timeout | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private started = false;

  constructor(private readonly opts: PluginServiceOptions) {
    this.pluginsDir = path.join(opts.froggHome, "plugins");
    this.logger = opts.logger.child({ module: "plugins" });
    this.state = new PluginStateStore(this.pluginsDir, this.logger);
    this.fetchImpl = opts.fetch ?? ((url, init) => fetch(url, init));
  }

  get enabled(): boolean {
    return this.opts.policy.enabled;
  }

  // ---------------------------------------------------------------- lifecycle

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.state.load();
    if (!this.enabled) return;
    await this.exclusive(async () => {
      for (const record of Object.values(this.state.get().installed))
        await this.loadInstalled(record);
      if (this.devModeActive()) {
        for (const link of this.state.get().devLinks)
          await this.loadDevLink(link.path).catch(() => undefined);
      }
    });
    void this.installPreinstalled().catch((err) =>
      this.logger.warn({ err }, "preinstalling plugins failed"),
    );
    const interval = this.opts.autoUpdateIntervalMs ?? DEFAULT_AUTO_UPDATE_MS;
    if (interval > 0 && this.opts.policy.autoUpdate !== "off") {
      this.autoUpdateTimer = setInterval(() => {
        void this.runAutoUpdate().catch((err) =>
          this.logger.warn({ err }, "plugin auto-update failed"),
        );
      }, interval);
      this.autoUpdateTimer.unref?.();
    }
  }

  async stop(): Promise<void> {
    if (this.autoUpdateTimer) clearInterval(this.autoUpdateTimer);
    this.autoUpdateTimer = null;
    for (const id of Array.from(this.watchers.keys())) this.unwatch(id);
    await Promise.all([...this.plugins.values()].map((p) => p.runtime?.deactivate()));
    this.plugins.clear();
    this.started = false;
  }

  onEvent(listener: (event: PluginServiceEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: PluginServiceEvent): void {
    for (const l of this.listeners) {
      try {
        l(event);
      } catch (err) {
        this.logger.warn({ err }, "plugin event listener threw");
      }
    }
  }

  private changed(pluginId: string | null, reason: string): void {
    this.emit({ type: "plugins.changed", payload: { pluginId, reason } });
  }

  /** Serializes mutations so concurrent installs/links cannot interleave on disk. */
  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  // ------------------------------------------------------------------ policy

  private requireEnabled(): void {
    if (!this.enabled)
      throw new PluginServiceError("forbidden", "Plugins are disabled for this build");
  }

  private devModeActive(): boolean {
    return this.opts.policy.developerMode === "allowed" && this.state.get().developerMode;
  }

  private isAllowed(id: string): boolean {
    return isPluginIdAllowed(id, this.opts.policy);
  }

  getPolicy(): PluginPolicy {
    return {
      enabled: this.enabled,
      allowUserRepos: this.opts.policy.allowUserRepos,
      developerMode: this.opts.policy.developerMode,
      developerModeEnabled: this.devModeActive(),
      apiVersions: [...SUPPORTED_PLUGIN_API_VERSIONS],
    };
  }

  // ------------------------------------------------------------------- repos

  private repos(): ResolvedRepo[] {
    const out: ResolvedRepo[] = [];
    const official = this.opts.officialRepo ?? OFFICIAL_PLUGIN_REPO;
    if (this.opts.policy.officialRepo)
      out.push({ ...official, tier: "official", removable: false });
    for (const r of this.opts.policy.repos) out.push({ ...r, tier: "brand", removable: false });
    if (this.opts.policy.allowUserRepos) {
      for (const r of this.state.get().userRepos) {
        out.push({
          url: r.url,
          name: r.name,
          publicKey: r.publicKey,
          tier: "user",
          removable: true,
        });
      }
    }
    return out;
  }

  private findRepo(url: string): ResolvedRepo | null {
    return this.repos().find((r) => sameUrl(r.url, url)) ?? null;
  }

  private repoView(repo: ResolvedRepo): PluginRepo {
    const cached = this.indexes.get(repo.url);
    return {
      url: repo.url,
      name: repo.name,
      tier: repo.tier,
      publicKey: repo.publicKey,
      removable: repo.removable,
      pluginCount: cached?.index ? cached.index.plugins.length : null,
      lastFetchedAt: cached ? new Date(cached.fetchedAt).toISOString() : null,
      error: cached?.error ?? null,
    };
  }

  listRepos(): PluginRepo[] {
    this.requireEnabled();
    return this.repos().map((r) => this.repoView(r));
  }

  async addRepo(input: { url: string; publicKey?: string; name?: string }): Promise<PluginRepo> {
    this.requireEnabled();
    if (!this.opts.policy.allowUserRepos)
      throw new PluginServiceError("forbidden", "This build does not allow adding repositories");
    const url = assertRepoUrl(input.url.trim(), false).toString();
    if (this.findRepo(url))
      throw new PluginServiceError("already_installed", `Repository already added: ${url}`);
    let publicKey = input.publicKey?.trim();
    if (publicKey && !isValidPublicKey(publicKey))
      throw new PluginServiceError(
        "invalid_request",
        "publicKey must be base64 of a raw 32-byte ed25519 key",
      );
    // TOFU: pin the key the repo serves now; the user sees it in the response.
    publicKey ??= await fetchRepoPublicKey(this.fetchImpl, url);
    const index = await fetchVerifiedIndex(this.fetchImpl, url, publicKey);
    this.indexes.set(url, { index, fetchedAt: Date.now(), error: null });
    const name = input.name?.trim() || index.name;
    await this.exclusive(() =>
      this.state.update((s) => {
        s.userRepos.push({ url, name, publicKey: publicKey!, addedAt: new Date().toISOString() });
      }),
    );
    this.changed(null, "repos");
    return this.repoView(this.findRepo(url)!);
  }

  async removeRepo(url: string): Promise<void> {
    this.requireEnabled();
    const repo = this.findRepo(url);
    if (!repo) throw new PluginServiceError("not_found", `No repository ${url}`);
    if (!repo.removable)
      throw new PluginServiceError("forbidden", "Built-in repositories cannot be removed");
    await this.exclusive(() =>
      this.state.update((s) => {
        s.userRepos = s.userRepos.filter((r) => !sameUrl(r.url, url));
      }),
    );
    this.indexes.delete(repo.url);
    this.changed(null, "repos");
  }

  private async getIndex(repo: ResolvedRepo, refresh: boolean): Promise<PluginIndex> {
    const ttl = this.opts.indexCacheTtlMs ?? 10 * 60 * 1000;
    const cached = this.indexes.get(repo.url);
    if (!refresh && cached?.index && Date.now() - cached.fetchedAt < ttl) return cached.index;
    try {
      const index = await fetchVerifiedIndex(this.fetchImpl, repo.url, repo.publicKey);
      this.indexes.set(repo.url, { index, fetchedAt: Date.now(), error: null });
      return index;
    } catch (err) {
      this.indexes.set(repo.url, {
        index: null,
        fetchedAt: Date.now(),
        error: (err as Error).message,
      });
      throw err;
    }
  }

  async getCatalog(
    refresh = false,
  ): Promise<{ plugins: PluginCatalogEntry[]; repos: PluginRepo[] }> {
    this.requireEnabled();
    const repos = this.repos();
    await Promise.all(repos.map((r) => this.getIndex(r, refresh).catch(() => undefined)));
    const plugins: PluginCatalogEntry[] = [];
    for (const repo of repos) {
      const index = this.indexes.get(repo.url)?.index;
      if (!index) continue;
      for (const entry of index.plugins) {
        if (!this.isAllowed(entry.id)) continue;
        plugins.push(this.catalogEntry(repo, index, entry));
      }
    }
    return { plugins, repos: repos.map((r) => this.repoView(r)) };
  }

  private catalogEntry(
    repo: ResolvedRepo,
    _index: PluginIndex,
    entry: PluginIndexEntry,
  ): PluginCatalogEntry {
    const versions = [...entry.versions]
      .sort((a, b) => comparePluginVersions(b.version, a.version))
      .map((v) => ({
        version: v.version,
        apiVersion: v.apiVersion,
        scope: v.scope,
        capabilities: v.capabilities,
        compatible: isSupportedPluginApiVersion(v.apiVersion),
        publishedAt: v.publishedAt ?? null,
        tarball: v.tarball,
        sha256: v.sha256,
      }));
    const latestRaw = pickPluginVersion(entry.versions, undefined, isSupportedPluginApiVersion);
    const meta = latestRaw ?? entry.versions[0]!;
    return {
      id: entry.id,
      name: meta.name ?? entry.id,
      description: meta.description ?? null,
      author: meta.author ?? null,
      homepage: meta.homepage ?? null,
      category: entry.category ?? null,
      repoUrl: repo.url,
      repoName: repo.name,
      tier: repo.tier,
      latest: latestRaw ? (versions.find((v) => v.version === latestRaw.version) ?? null) : null,
      versions,
      installedVersion: this.plugins.get(entry.id)?.manifest.version ?? null,
    };
  }

  // ------------------------------------------------------------------- views

  private granted(p: LoadedPlugin): readonly string[] {
    return p.dev ? p.manifest.capabilities : (p.record?.grantedCapabilities ?? []);
  }

  private origin(
    p: LoadedPlugin,
  ): Pick<PluginInstalled, "source" | "repoUrl" | "devPath" | "enabled"> {
    if (p.dev) return { source: "dev", repoUrl: null, devPath: p.rootDir, enabled: true };
    return {
      source: p.record?.tier ?? "user",
      repoUrl: p.record?.repoUrl ?? null,
      devPath: null,
      enabled: p.record?.enabled ?? false,
    };
  }

  private view(p: LoadedPlugin): PluginInstalled {
    const m = p.manifest;
    return {
      id: m.id,
      name: m.name,
      version: m.version,
      apiVersion: m.apiVersion,
      scope: m.scope,
      description: m.description ?? null,
      author: m.author ?? null,
      homepage: m.homepage ?? null,
      ...this.origin(p),
      status: p.status,
      error: p.error,
      capabilities: m.capabilities,
      grantedCapabilities: [...this.granted(p)],
      updateAvailable: p.dev || !p.record ? null : this.cachedUpdate(p.record),
      preinstalled: p.record?.preinstalled === true,
      installedAt: p.record?.installedAt ?? null,
    };
  }

  private cachedUpdate(record: InstalledPluginRecord): string | null {
    const index = this.indexes.get(this.findRepo(record.repoUrl)?.url ?? record.repoUrl)?.index;
    const entry = index?.plugins.find((e) => e.id === record.id);
    if (!entry) return null;
    const best = pickPluginVersion(
      entry.versions,
      this.rangeFor(record),
      isSupportedPluginApiVersion,
    );
    return best && comparePluginVersions(best.version, record.version) > 0 ? best.version : null;
  }

  private rangeFor(record: InstalledPluginRecord): string | undefined {
    if (!record.preinstalled) return undefined;
    return this.opts.policy.preinstalled.find((p) => p.id === record.id)?.version ?? undefined;
  }

  list(): { plugins: PluginInstalled[]; policy: PluginPolicy } {
    if (!this.enabled) return { plugins: [], policy: this.getPolicy() };
    const plugins = [...this.plugins.values()]
      .map((p) => this.view(p))
      .sort((a, b) => a.id.localeCompare(b.id));
    return { plugins, policy: this.getPolicy() };
  }

  private require(id: string): LoadedPlugin {
    const p = this.plugins.get(id);
    if (!p) throw new PluginServiceError("not_found", `Plugin ${id} is not installed`);
    return p;
  }

  // ----------------------------------------------------------------- running

  private settingsFor(id: string): PluginSettingsFile {
    let s = this.settingsFiles.get(id);
    if (!s) {
      s = new PluginSettingsFile(this.dataDir(id));
      this.settingsFiles.set(id, s);
    }
    return s;
  }

  private dataDir(id: string): string {
    return path.join(this.pluginsDir, "data", id);
  }

  private installDir(id: string, version: string): string {
    return path.join(this.pluginsDir, id, version);
  }

  private async startRuntime(p: LoadedPlugin, granted: readonly string[]): Promise<void> {
    await p.runtime?.deactivate();
    p.runtime = null;
    if (!isSupportedPluginApiVersion(p.manifest.apiVersion)) {
      p.status = "incompatible";
      p.error = `apiVersion ${p.manifest.apiVersion} is not supported (host supports ${SUPPORTED_PLUGIN_API_VERSIONS.join(", ")})`;
      return;
    }
    if (!this.isAllowed(p.manifest.id)) {
      p.status = "blocked";
      p.error = "Blocked by this build's plugin policy";
      return;
    }
    if (!p.dev && !p.record?.enabled) {
      p.status = "disabled";
      p.error = null;
      return;
    }
    if (
      !p.manifest.entry?.daemon ||
      p.manifest.scope === "client" ||
      p.manifest.scope === "build"
    ) {
      p.status = "inactive";
      p.error = null;
      return;
    }
    const runtime = new PluginRuntime({
      manifest: p.manifest,
      rootDir: p.rootDir,
      dataDir: this.dataDir(p.manifest.id),
      dev: p.dev,
      granted,
      settings: this.settingsFor(p.manifest.id),
      agents: this.opts.agents ?? null,
      logger: this.logger,
      hooks: {
        notify: (pluginId, message, level: PluginNotifyLevel) =>
          this.emit({ type: "plugins.notify", payload: { pluginId, message, level } }),
        badgesChanged: (pluginId) => this.changed(pluginId, "contributions"),
        refreshPanel: (pluginId) => this.changed(pluginId, "contributions"),
      },
    });
    p.runtime = runtime;
    await runtime.activate();
    p.status = runtime.status;
    p.error = runtime.error;
  }

  private async loadInstalled(record: InstalledPluginRecord): Promise<void> {
    const rootDir = this.installDir(record.id, record.version);
    let manifest: PluginManifest;
    try {
      manifest = await readPluginManifest(rootDir);
    } catch (err) {
      this.logger.warn({ err, pluginId: record.id }, "installed plugin is unreadable");
      // Keep a placeholder so the user can see and uninstall it.
      manifest = {
        id: record.id,
        name: record.id,
        version: record.version,
        apiVersion: 1,
        scope: "daemon",
        capabilities: [],
      } as PluginManifest;
      this.plugins.set(record.id, {
        manifest,
        rootDir,
        dev: false,
        record,
        runtime: null,
        status: "error",
        error: (err as Error).message,
      });
      return;
    }
    const p: LoadedPlugin = {
      manifest,
      rootDir,
      dev: false,
      record,
      runtime: null,
      status: "inactive",
      error: null,
    };
    this.plugins.set(record.id, p);
    await this.startRuntime(p, record.grantedCapabilities);
  }

  // ----------------------------------------------------------------- install

  private async resolveVersion(
    repo: ResolvedRepo,
    id: string,
    range: string | undefined,
    refresh: boolean,
  ) {
    const index = await this.getIndex(repo, refresh);
    const entry = index.plugins.find((e) => e.id === id);
    if (!entry) throw new PluginServiceError("not_found", `${id} is not in ${repo.name}`);
    const version = pickPluginVersion(entry.versions, range, isSupportedPluginApiVersion);
    if (!version) {
      const any = pickPluginVersion(entry.versions, range);
      if (any)
        throw new PluginServiceError(
          "incompatible",
          `${id} ${any.version} needs plugin API v${any.apiVersion}, which this host does not support`,
        );
      throw new PluginServiceError("not_found", `No version of ${id} matches ${range ?? "latest"}`);
    }
    return version;
  }

  /** Download, verify, extract. Returns the extracted directory and manifest. */
  private async fetchAndExtract(
    id: string,
    v: PluginIndexVersion,
  ): Promise<{ dir: string; manifest: PluginManifest }> {
    const tgz = await fetchVerifiedTarball(this.fetchImpl, v.tarball, v.sha256);
    let manifest: PluginManifest;
    let entries;
    try {
      ({ manifest, entries } = readManifestFromTarball(tgz, v.tarball));
      assertManifestMatches(
        manifest,
        { id, version: v.version, scope: v.scope, capabilities: v.capabilities },
        v.tarball,
      );
    } catch (err) {
      throw new PluginServiceError("manifest_mismatch", (err as Error).message);
    }
    if (!isSupportedPluginApiVersion(manifest.apiVersion)) {
      throw new PluginServiceError(
        "incompatible",
        `${id} needs plugin API v${manifest.apiVersion}`,
      );
    }
    const dir = this.installDir(id, v.version);
    const staging = `${dir}.staging-${process.pid}-${Date.now()}`;
    try {
      await writeTarEntries(entries, staging);
      await fs.rm(dir, { recursive: true, force: true });
      await fs.rename(staging, dir);
    } catch (err) {
      await fs.rm(staging, { recursive: true, force: true });
      throw err;
    }
    return { dir, manifest };
  }

  private assertInstallable(scope: string): void {
    if (scope === "build")
      throw new PluginServiceError(
        "invalid_request",
        "build-scope plugins are applied by the brand build pipeline",
      );
    if (scope === "client")
      throw new PluginServiceError(
        "invalid_request",
        "client-scope plugins are installed on the client, not the host",
      );
  }

  async install(input: {
    id: string;
    version?: string;
    repoUrl: string;
    grantedCapabilities: readonly string[];
    preinstalled?: boolean;
  }): Promise<PluginInstalled> {
    this.requireEnabled();
    const { id } = input;
    if (!this.isAllowed(id))
      throw new PluginServiceError(
        "forbidden",
        `${id} is not allowed by this build's plugin policy`,
      );
    const repo = this.findRepo(input.repoUrl);
    if (!repo) throw new PluginServiceError("not_found", `Unknown repository ${input.repoUrl}`);
    return this.exclusive(async () => {
      const existing = this.plugins.get(id);
      if (existing?.dev)
        throw new PluginServiceError("already_installed", `${id} is dev-linked; unlink it first`);
      if (existing)
        throw new PluginServiceError("already_installed", `${id} is already installed; use update`);
      const v = await this.resolveVersion(repo, id, input.version, true);
      this.assertInstallable(v.scope);
      const missing = v.capabilities.filter((c) => !input.grantedCapabilities.includes(c));
      if (missing.length)
        throw new PluginServiceError(
          "forbidden",
          `Capabilities not granted: ${missing.join(", ")}`,
          missing,
        );
      await this.fetchAndExtract(id, v);
      const record: InstalledPluginRecord = {
        id,
        version: v.version,
        tier: repo.tier,
        repoUrl: repo.url,
        grantedCapabilities: [...v.capabilities],
        enabled: true,
        installedAt: new Date().toISOString(),
        ...(input.preinstalled ? { preinstalled: true } : {}),
      };
      await this.state.update((s) => {
        s.installed[id] = record;
      });
      await this.loadInstalled(record);
      this.changed(id, "installed");
      return this.view(this.require(id));
    });
  }

  async update(input: {
    id: string;
    version?: string;
    grantedCapabilities?: readonly string[];
  }): Promise<PluginInstalled> {
    this.requireEnabled();
    return this.exclusive(async () => {
      const p = this.require(input.id);
      if (p.dev || !p.record)
        throw new PluginServiceError("invalid_request", `${input.id} is dev-linked`);
      const record = p.record;
      const repo = this.findRepo(record.repoUrl);
      if (!repo)
        throw new PluginServiceError(
          "not_found",
          `Repository ${record.repoUrl} is no longer configured`,
        );
      const v = await this.resolveVersion(
        repo,
        record.id,
        input.version ?? this.rangeFor(record),
        true,
      );
      if (v.version === record.version) return this.view(p);
      this.assertInstallable(v.scope);
      const added = addedCapabilities(record.grantedCapabilities, v.capabilities);
      const granted = new Set([
        ...record.grantedCapabilities,
        ...(input.grantedCapabilities ?? []),
      ]);
      const missing = added.filter((c) => !granted.has(c));
      if (missing.length) {
        throw new PluginServiceError(
          "consent_required",
          `${record.id} ${v.version} adds capabilities: ${missing.join(", ")}`,
          missing,
        );
      }
      await this.fetchAndExtract(record.id, v);
      await p.runtime?.deactivate();
      const oldVersion = record.version;
      const next: InstalledPluginRecord = {
        ...record,
        version: v.version,
        grantedCapabilities: [...v.capabilities],
      };
      await this.state.update((s) => {
        s.installed[record.id] = next;
      });
      await this.loadInstalled(next);
      await fs.rm(this.installDir(record.id, oldVersion), { recursive: true, force: true });
      this.changed(record.id, "updated");
      return this.view(this.require(record.id));
    });
  }

  async uninstall(id: string): Promise<void> {
    this.requireEnabled();
    await this.exclusive(async () => {
      const p = this.require(id);
      if (p.dev) throw new PluginServiceError("invalid_request", `${id} is dev-linked; use unlink`);
      if (p.record?.preinstalled && this.opts.policy.preinstalled.some((e) => e.id === id)) {
        throw new PluginServiceError(
          "forbidden",
          `${id} is preinstalled by this build; disable it instead`,
        );
      }
      await p.runtime?.deactivate();
      this.plugins.delete(id);
      await this.state.update((s) => {
        delete s.installed[id];
      });
      await fs.rm(path.join(this.pluginsDir, id), { recursive: true, force: true });
      await fs.rm(this.dataDir(id), { recursive: true, force: true });
      this.settingsFiles.delete(id);
      this.changed(id, "uninstalled");
    });
  }

  async setEnabled(id: string, enabled: boolean): Promise<PluginInstalled> {
    this.requireEnabled();
    return this.exclusive(async () => {
      const p = this.require(id);
      if (p.dev || !p.record)
        throw new PluginServiceError(
          "invalid_request",
          `${id} is dev-linked; unlink it to stop it`,
        );
      const next = { ...p.record, enabled };
      await this.state.update((s) => {
        s.installed[id] = next;
      });
      p.record = next;
      await this.startRuntime(p, next.grantedCapabilities);
      this.changed(id, enabled ? "enabled" : "disabled");
      return this.view(p);
    });
  }

  // ------------------------------------------------- preinstall / auto-update

  /** Installs every runtime-scope `preinstalled` plugin that is missing. Brand policy is consent. */
  async installPreinstalled(): Promise<void> {
    if (!this.enabled) return;
    for (const want of this.opts.policy.preinstalled) {
      if (this.plugins.has(want.id)) continue;
      const all = this.repos();
      const repos = [
        ...all.filter((r) => r.tier === "brand"),
        ...all.filter((r) => r.tier === "official"),
      ];
      for (const repo of repos) {
        let v: PluginIndexVersion;
        try {
          v = await this.resolveVersion(repo, want.id, want.version ?? undefined, false);
        } catch {
          continue;
        }
        if (v.scope === "build" || v.scope === "client") break;
        try {
          await this.install({
            id: want.id,
            version: v.version,
            repoUrl: repo.url,
            grantedCapabilities: v.capabilities,
            preinstalled: true,
          });
        } catch (err) {
          this.logger.warn({ err, pluginId: want.id }, "preinstalling plugin failed");
        }
        break;
      }
    }
  }

  /** Updates plugins the brand's autoUpdate mode covers, skipping any that add capabilities. */
  async runAutoUpdate(): Promise<string[]> {
    const mode = this.opts.policy.autoUpdate;
    if (!this.enabled || mode === "off") return [];
    const updated: string[] = [];
    for (const p of Array.from(this.plugins.values())) {
      const record = p.record;
      if (p.dev || !record) continue;
      if (mode === "brand-repos" && record.tier !== "brand") continue;
      const repo = this.findRepo(record.repoUrl);
      if (!repo) continue;
      try {
        const v = await this.resolveVersion(repo, record.id, this.rangeFor(record), true);
        if (comparePluginVersions(v.version, record.version) <= 0) continue;
        if (addedCapabilities(record.grantedCapabilities, v.capabilities).length) continue;
        await this.update({ id: record.id, version: v.version });
        updated.push(record.id);
      } catch (err) {
        this.logger.warn({ err, pluginId: record.id }, "auto-update failed");
      }
    }
    return updated;
  }

  // --------------------------------------------------------------- dev links

  async setDeveloperMode(enabled: boolean): Promise<PluginPolicy> {
    this.requireEnabled();
    if (enabled && this.opts.policy.developerMode === "forbidden") {
      throw new PluginServiceError("forbidden", "Developer mode is disabled for this build");
    }
    await this.exclusive(async () => {
      await this.state.update((s) => {
        s.developerMode = enabled;
      });
      if (enabled) {
        for (const link of this.state.get().devLinks)
          await this.loadDevLink(link.path).catch(() => undefined);
      } else {
        for (const p of Array.from(this.plugins.values()))
          if (p.dev) await this.dropDev(p.manifest.id);
      }
    });
    this.changed(null, "policy");
    return this.getPolicy();
  }

  private requireDevMode(): void {
    this.requireEnabled();
    if (!this.devModeActive())
      throw new PluginServiceError("forbidden", "Turn on developer mode to link local plugins");
  }

  async devLink(dirInput: string): Promise<PluginInstalled> {
    this.requireDevMode();
    if (!path.isAbsolute(dirInput))
      throw new PluginServiceError("invalid_request", "path must be absolute on the host");
    const dir = path.resolve(dirInput);
    return this.exclusive(async () => {
      const id = await this.loadDevLink(dir, true);
      await this.state.update((s) => {
        s.devLinks = [...s.devLinks.filter((l) => l.path !== dir), { path: dir }];
      });
      this.changed(id, "installed");
      return this.view(this.require(id));
    });
  }

  private async loadDevLink(dir: string, strict = false): Promise<string> {
    let manifest: PluginManifest;
    try {
      manifest = await readPluginManifest(dir);
    } catch (err) {
      this.logger.warn({ err, dir }, "dev-linked plugin has an invalid manifest");
      throw new PluginServiceError("invalid_request", (err as Error).message);
    }
    const existing = this.plugins.get(manifest.id);
    if (existing && (!existing.dev || existing.rootDir !== dir)) {
      if (strict)
        throw new PluginServiceError(
          "already_installed",
          `${manifest.id} is already ${existing.dev ? "linked from " + existing.rootDir : "installed"}`,
        );
      return manifest.id;
    }
    const p: LoadedPlugin = existing ?? {
      manifest,
      rootDir: dir,
      dev: true,
      record: null,
      runtime: null,
      status: "inactive",
      error: null,
    };
    p.manifest = manifest;
    this.plugins.set(manifest.id, p);
    await this.startRuntime(p, manifest.capabilities);
    this.watch(manifest.id, dir);
    return manifest.id;
  }

  private async dropDev(id: string): Promise<void> {
    const p = this.plugins.get(id);
    if (!p?.dev) return;
    this.unwatch(id);
    await p.runtime?.deactivate();
    this.plugins.delete(id);
  }

  async devUnlink(id: string): Promise<void> {
    this.requireEnabled();
    await this.exclusive(async () => {
      const p = this.plugins.get(id);
      const linkPath = p?.dev ? p.rootDir : null;
      if (!linkPath) throw new PluginServiceError("not_found", `${id} is not dev-linked`);
      await this.dropDev(id);
      await this.state.update((s) => {
        s.devLinks = s.devLinks.filter((l) => l.path !== linkPath);
      });
      this.changed(id, "uninstalled");
    });
  }

  /** Reloads a dev-linked plugin: re-reads the manifest and re-imports its entry. */
  async reloadDev(id: string): Promise<void> {
    await this.exclusive(async () => {
      const p = this.plugins.get(id);
      if (!p?.dev) return;
      try {
        const manifest = await readPluginManifest(p.rootDir);
        if (manifest.id !== id) {
          await this.dropDev(id);
          await this.loadDevLink(p.rootDir).catch(() => undefined);
          return;
        }
        p.manifest = manifest;
        await this.startRuntime(p, manifest.capabilities);
      } catch (err) {
        await p.runtime?.deactivate();
        p.runtime = null;
        p.status = "error";
        p.error = (err as Error).message;
      }
    });
    this.changed(id, "reloaded");
  }

  private watch(id: string, dir: string): void {
    if (this.opts.watchDevLinks === false || this.watchers.has(id)) return;
    try {
      const entry: { watcher: FSWatcher; timer: NodeJS.Timeout | null } = {
        watcher: null as unknown as FSWatcher,
        timer: null,
      };
      entry.watcher = fsWatch(dir, { recursive: true, persistent: false }, (_event, filename) => {
        const name = filename ? String(filename) : "";
        if (
          name.startsWith("node_modules") ||
          name.startsWith(".git") ||
          name.includes(`${path.sep}node_modules${path.sep}`)
        )
          return;
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          void this.reloadDev(id);
        }, this.opts.devReloadDebounceMs ?? 300);
      });
      entry.watcher.on("error", (err) =>
        this.logger.warn({ err, id }, "dev plugin watcher failed"),
      );
      this.watchers.set(id, entry);
    } catch (err) {
      this.logger.warn({ err, dir }, "could not watch dev-linked plugin; hot reload is off");
    }
  }

  private unwatch(id: string): void {
    const w = this.watchers.get(id);
    if (!w) return;
    if (w.timer) clearTimeout(w.timer);
    w.watcher.close();
    this.watchers.delete(id);
  }

  // ------------------------------------------------------ rpc & contributions

  async callRpc(
    pluginId: string,
    method: string,
    params: unknown,
    clientId?: string,
  ): Promise<unknown> {
    this.requireEnabled();
    const p = this.require(pluginId);
    if (!p.runtime) throw new PluginServiceError("not_active", `Plugin ${pluginId} is ${p.status}`);
    return p.runtime.call(method, params, clientId ? { clientId } : {});
  }

  getContributions(): PluginContributionSet[] {
    this.requireEnabled();
    const out: PluginContributionSet[] = [];
    for (const p of this.plugins.values()) {
      const c = p.manifest.contributes;
      if (!c || p.status !== "active") continue;
      const granted = this.granted(p);
      if (
        !granted.includes("ui.contribute") &&
        !granted.includes("rpc") &&
        !granted.includes("settings.store")
      )
        continue;
      out.push({
        pluginId: p.manifest.id,
        pluginName: p.manifest.name,
        dev: p.dev,
        commands: c.commands ?? [],
        sessionActions: c.sessionActions ?? [],
        panels: c.panels ?? [],
        settings: c.settings ?? [],
        badges: p.runtime?.badgeMap ?? {},
      });
    }
    return out.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
  }

  async getSettings(id: string) {
    this.requireEnabled();
    const p = this.require(id);
    const fields = p.manifest.contributes?.settings ?? [];
    const stored = await this.settingsFor(id).all();
    const values: Record<string, unknown> = {};
    for (const f of fields) {
      if (!(f.key in stored)) continue;
      values[f.key] = f.type === "secret" ? "" : stored[f.key];
    }
    return { fields, values };
  }

  async setSettings(id: string, values: Record<string, unknown>): Promise<void> {
    this.requireEnabled();
    const p = this.require(id);
    if (!this.granted(p).includes("settings.store"))
      throw new PluginServiceError("forbidden", `${id} has no settings store`);
    const fields = new Map((p.manifest.contributes?.settings ?? []).map((f) => [f.key, f]));
    const clean: Record<string, PluginSettingValue> = {};
    for (const [key, value] of Object.entries(values)) {
      const field = fields.get(key);
      if (!field)
        throw new PluginServiceError("invalid_request", `${key} is not a setting of ${id}`);
      if (value === null) {
        clean[key] = null;
        continue;
      }
      const ok = isValidSettingValue(field, value);
      if (!ok)
        throw new PluginServiceError("invalid_request", `${key} must be a valid ${field.type}`);
      clean[key] = value as PluginSettingValue;
    }
    await this.settingsFor(id).setMany(clean);
    this.changed(id, "settings");
  }

  /** Test hook: whether a plugin's manifest file exists in its install dir. */
  async hasInstalledFiles(id: string, version: string): Promise<boolean> {
    return fs.access(path.join(this.installDir(id, version), PLUGIN_MANIFEST_FILENAME)).then(
      () => true,
      () => false,
    );
  }
}
