// Release ordering comes from the shared module, not npm `semver`: a downstream
// rebuild tag (`1.3.5-acme.2`) is formally a prerelease and plain semver would rank
// it below `1.3.5`, so an update between two rebuilds reads as "up to date".
import { compareVersionStrings, parseVersion } from "@frogg/protocol/release-version";
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

export interface ElectronUpdateFeed {
  url: string;
  /** The classic app only follows stable releases. */
  channel: "electron-latest";
}

/** Published JSON selects a version-pinned feed; payload names and hashes come from its manifests. */
export async function resolveElectronUpdateFeed(input: {
  override?: string;
  releaseBase: string | null;
  currentVersion?: string;
  fetchDescriptor?: (url: string) => Promise<unknown | null>;
}): Promise<ElectronUpdateFeed | null> {
  const url = resolveElectronUpdateUrl(input.override, input.releaseBase);
  if (!url) return null;
  if (new URL(url).protocol !== "https:") throw new Error("Electron update URL must use HTTPS.");
  const latest: ElectronUpdateFeed = { url, channel: "electron-latest" };
  // An explicit generic feed owns its routing; GitHub's latest alias only ever names a stable release.
  if (input.override?.trim()) return latest;
  const base = new URL(input.releaseBase!);
  if (base.hostname !== "github.com" || !/^\/[^/]+\/[^/]+\/releases\/?$/.test(base.pathname))
    return latest;
  const raw = await (input.fetchDescriptor ?? fetchReleaseDescriptor)(`${latest.url}/release.json`);
  if (raw === null) return latest;
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
  if (descriptor.channel !== "stable") {
    throw new Error("Stable update feed points to a prerelease.");
  }
  return {
    url: `${input.releaseBase!.replace(/\/$/, "")}/download/v${descriptor.version}`,
    channel: "electron-latest",
  };
}
