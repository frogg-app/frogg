import { brand } from "@frogg/branding";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import {
  OFFICIAL_PLUGIN_REPO,
  isPluginIdAllowed,
  pickPluginVersion,
  type PluginIndexVersion,
} from "@frogg/protocol/plugins/repo-index";
import { isSupportedPluginApiVersion } from "@frogg/protocol/plugins/manifest";
import { ClientPluginError } from "./errors";
import { fetchVerifiedIndex, type FetchLike } from "./verify";

export interface ClientRepo {
  url: string;
  name: string;
  /** official | brand | user */
  tier: string;
  publicKey: string;
}

/**
 * Repositories this device trusts, and with which key. Official and brand keys are compiled
 * into this build and always win; user repos come from connected hosts, which pinned their keys
 * on add (TOFU), so a host can add a repo but never swap the key of an official or brand one.
 */
export function compiledRepos(): ClientRepo[] {
  const repos: ClientRepo[] = [];
  if (brand.plugins.officialRepo) repos.push({ ...OFFICIAL_PLUGIN_REPO, tier: "official" });
  for (const r of brand.plugins.repos) repos.push({ ...r, tier: "brand" });
  return repos;
}

export function mergeRepos(hostRepos: readonly ClientRepo[]): ClientRepo[] {
  const merged = new Map<string, ClientRepo>();
  for (const repo of compiledRepos()) merged.set(repo.url, repo);
  if (brand.plugins.allowUserRepos) {
    for (const repo of hostRepos) {
      if (repo.tier === "user" && !merged.has(repo.url)) merged.set(repo.url, repo);
    }
  }
  return [...merged.values()];
}

export async function hostUserRepos(clients: readonly DaemonClient[]): Promise<ClientRepo[]> {
  const lists = await Promise.allSettled(clients.map((client) => client.pluginsReposList()));
  return lists.flatMap((result) =>
    result.status === "fulfilled"
      ? result.value.repos.map((r) => ({
          url: r.url,
          name: r.name,
          tier: r.tier,
          publicKey: r.publicKey,
        }))
      : [],
  );
}

/** The trusted key for `repoUrl`, or not_found when this device has no trust anchor for it. */
export function findRepo(repos: readonly ClientRepo[], repoUrl: string): ClientRepo {
  const repo = repos.find((r) => r.url === repoUrl);
  if (!repo) {
    throw new ClientPluginError("not_found", `${repoUrl} is not a repository this app trusts`);
  }
  return repo;
}

export interface ClientCatalogEntry {
  id: string;
  name: string;
  description: string | null;
  category: string | null;
  repo: ClientRepo;
  latest: PluginIndexVersion;
}

export interface ClientCatalog {
  entries: ClientCatalogEntry[];
  failures: { repo: ClientRepo; error: string }[];
}

/** Client-scope plugins across every trusted repo, each index signature-checked on device. */
export async function fetchClientCatalog(
  fetchImpl: FetchLike,
  repos: readonly ClientRepo[],
): Promise<ClientCatalog> {
  const results = await Promise.allSettled(
    repos.map(async (repo) => ({ repo, index: await fetchVerifiedIndex(fetchImpl, repo) })),
  );
  const entries: ClientCatalogEntry[] = [];
  const failures: ClientCatalog["failures"] = [];
  results.forEach((result, i) => {
    if (result.status === "rejected") {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      failures.push({ repo: repos[i]!, error });
      return;
    }
    const { repo, index } = result.value;
    for (const plugin of index.plugins) {
      if (!isPluginIdAllowed(plugin.id, brand.plugins)) continue;
      const clientVersions = plugin.versions.filter((v) => v.scope === "client");
      const latest = pickPluginVersion(clientVersions, undefined, isSupportedPluginApiVersion);
      if (!latest) continue;
      entries.push({
        id: plugin.id,
        name: latest.name ?? plugin.id,
        description: latest.description ?? null,
        category: plugin.category ?? null,
        repo,
        latest,
      });
    }
  });
  return { entries, failures };
}
