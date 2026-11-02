// Release ordering comes from the shared module, not npm `semver`: a downstream
// rebuild tag (`1.3.5-acme.2`) is formally a prerelease and plain semver would rank
// it below `1.3.5`, so an update between two rebuilds reads as "up to date".
import {
  compareVersionStrings,
  isStableVersion,
  parseVersion,
} from "@frogg/protocol/release-version";
import {
  fetchReleaseDescriptor,
  parseReleaseDescriptor,
  selectElectronUpdatePath,
} from "./release-descriptor.js";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

/** electron-updater reads this config for download cache metadata even with setFeedURL. */
export function writeElectronUpdateConfig(
  userDataPath: string,
  updateUrl: string,
  cacheName: string,
): string {
  const url = new URL(updateUrl);
  if (url.protocol !== "https:") throw new Error("Electron update URL must use HTTPS.");
  const directory = path.join(userDataPath, "updater");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const destination = path.join(directory, "app-update.yml");
  const temporary = `${destination}.${randomUUID()}.tmp`;
  // JSON is valid YAML and escapes URLs/cache names without interpolation hazards.
  writeFileSync(
    temporary,
    JSON.stringify({ provider: "generic", url: updateUrl, updaterCacheDirName: cacheName }),
    { mode: 0o600 },
  );
  renameSync(temporary, destination);
  return destination;
}

/** App-only production releases share a branded feed; metadata channels stay Electron-specific. */
export function resolveElectronUpdateUrl(
  override: string | undefined,
  releaseBase: string | null,
): string | null {
  return (
    override?.trim() || (releaseBase ? `${releaseBase.replace(/\/$/, "")}/latest/download` : null)
  );
}

export const UPDATE_RATE_LIMITED_MESSAGE =
  "GitHub is rate-limiting update checks from this network. Try again in a few minutes.";

/** GitHub answers a throttled feed request with 429 and an HTML page the user should not see. */
export function isUpdateRateLimitError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if ("statusCode" in error && error.statusCode === 429) return true;
  return error instanceof Error && /^429\b|\(429\)/.test(error.message);
}

/** Which classic build this is: the stable app, or frogg beta (`-beta.N` prereleases). */
export type AppReleaseChannel = "stable" | "beta";

export interface ElectronUpdateFeed {
  url: string;
  channel: "electron-latest" | "electron-beta";
}

/** electron-updater's Windows feed file per channel; the release must carry it to qualify. */
export const ELECTRON_BETA_FEED = "electron-beta.yml";

async function fetchPublishedReleases(url: string): Promise<unknown> {
  const response = await fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Release discovery failed (${response.status}).`);
  return response.json();
}

/**
 * The newest published prerelease carrying frogg beta's feed. Every prerelease line shares one
 * release list (frogg beta on `-beta.N`, Frogg Next on `-next.N`), so a release only counts when
 * it has this client's own `electron-beta.yml`.
 */
export function selectBetaRelease(releases: unknown): { tag: string; version: string } | null {
  if (!Array.isArray(releases)) throw new Error("Unexpected release discovery response.");
  const candidates = releases
    .flatMap((release: unknown) => {
      if (!release || typeof release !== "object") return [];
      const value = release as Record<string, unknown>;
      if (value.draft !== false || typeof value.tag_name !== "string") return [];
      const version = parseVersion(value.tag_name)?.raw;
      if (!version || isStableVersion(version)) return [];
      const assets = Array.isArray(value.assets) ? value.assets : [];
      const hasFeed = assets.some(
        (asset: unknown) =>
          !!asset &&
          typeof asset === "object" &&
          (asset as Record<string, unknown>).name === ELECTRON_BETA_FEED,
      );
      return hasFeed ? [{ tag: value.tag_name, version }] : [];
    })
    .sort((a, b) => -compareVersionStrings(a.version, b.version));
  return candidates[0] ?? null;
}

/** Published JSON selects a version-pinned feed; payload names and hashes come from its manifests. */
export async function resolveElectronUpdateFeed(input: {
  override?: string;
  releaseBase: string | null;
  /** The build's own channel (brand.channel). Default stable. */
  releaseChannel?: AppReleaseChannel;
  currentVersion?: string;
  fetchReleases?: (url: string) => Promise<unknown>;
  fetchDescriptor?: (url: string) => Promise<unknown | null>;
}): Promise<ElectronUpdateFeed | null> {
  const beta = input.releaseChannel === "beta";
  const url = resolveElectronUpdateUrl(input.override, input.releaseBase);
  if (!url) return null;
  if (new URL(url).protocol !== "https:") throw new Error("Electron update URL must use HTTPS.");
  const latest: ElectronUpdateFeed = { url, channel: beta ? "electron-beta" : "electron-latest" };
  // An explicit generic feed owns its routing; GitHub's latest alias only ever names a stable release.
  if (input.override?.trim()) return latest;
  const base = new URL(input.releaseBase!);
  const repository = /^\/([^/]+)\/([^/]+)\/releases\/?$/.exec(base.pathname);
  if (base.hostname !== "github.com" || !repository) return latest;
  let selected = latest;
  if (beta) {
    const release = selectBetaRelease(
      await (input.fetchReleases ?? fetchPublishedReleases)(
        `https://api.github.com/repos/${repository[1]}/${repository[2]}/releases?per_page=100`,
      ),
    );
    if (!release) throw new Error("No published beta release is available.");
    selected = {
      url: `${input.releaseBase!.replace(/\/$/, "")}/download/${encodeURIComponent(release.tag)}`,
      channel: "electron-beta",
    };
  }
  const raw = await (input.fetchDescriptor ?? fetchReleaseDescriptor)(
    `${selected.url}/release.json`,
  );
  if (raw === null) return selected;
  const descriptor = parseReleaseDescriptor(raw);
  const update = selectElectronUpdatePath(descriptor);
  if (
    !input.currentVersion ||
    !parseVersion(input.currentVersion) ||
    compareVersionStrings(input.currentVersion, update.minimumClientVersion) < 0
  ) {
    throw new Error(
      `This release requires a manual upgrade from clients older than ${update.minimumClientVersion}.`,
    );
  }
  if (!beta && descriptor.channel !== "stable") {
    throw new Error("Stable update feed points to a prerelease.");
  }
  if (beta && descriptor.channel !== "beta") {
    throw new Error("Beta update feed points to a stable release.");
  }
  const pinned = `${input.releaseBase!.replace(/\/$/, "")}/download/v${descriptor.version}`;
  if (beta && pinned !== selected.url) {
    throw new Error("Release descriptor version does not match the selected release.");
  }
  return { url: pinned, channel: update.channel };
}
