import { isStableVersion } from "@frogg/protocol/release-version";
import { valid } from "semver";

export interface ReleaseDescriptor {
  schemaVersion: 1;
  version: string;
  channel: "stable" | "beta";
  updatePaths: object;
}

/** `release.json` `client` values that carry the classic app: stable releases and frogg beta. */
const CLASSIC_CLIENTS: ReadonlySet<unknown> = new Set(["classic", "classic-beta"]);

/** Missing descriptors identify older releases; other failures remain visible. */
export async function fetchReleaseDescriptor(url: string): Promise<unknown | null> {
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Release descriptor failed (${response.status}).`);
  return response.json();
}

export function parseReleaseDescriptor(value: unknown): ReleaseDescriptor {
  if (
    !value ||
    typeof value !== "object" ||
    !("schemaVersion" in value) ||
    value.schemaVersion !== 1 ||
    !("version" in value) ||
    typeof value.version !== "string" ||
    !valid(value.version) ||
    !("channel" in value) ||
    (value.channel !== "stable" && value.channel !== "beta") ||
    !("updatePaths" in value) ||
    !value.updatePaths ||
    typeof value.updatePaths !== "object" ||
    Array.isArray(value.updatePaths)
  ) {
    throw new Error("Unsupported release descriptor schema, version, channel or update paths.");
  }
  // A fork rebuild (1.8.0-acme.2) is a stable release; only a channel part makes a beta.
  if (value.channel !== (isStableVersion(value.version) ? "stable" : "beta"))
    throw new Error("Release channel does not match its version.");
  // Releases name the client they carry; older ones have no `client` and are classic. A Frogg
  // Next prerelease is not an update for this app.
  if ("client" in value && value.client !== undefined && !CLASSIC_CLIENTS.has(value.client))
    throw new Error("This release does not carry this app. Install it from the release page.");
  return {
    schemaVersion: 1,
    version: value.version,
    channel: value.channel,
    updatePaths: value.updatePaths,
  };
}

/** This client implements one update protocol; other clients select their own adapter. */
export function selectElectronUpdatePath(descriptor: ReleaseDescriptor): {
  minimumClientVersion: string;
  channel: "electron-latest" | "electron-beta";
} {
  const paths = descriptor.updatePaths;
  if (
    !("electron-updater" in paths) ||
    !paths["electron-updater"] ||
    typeof paths["electron-updater"] !== "object"
  ) {
    throw new Error("This release has no compatible automatic update path. Install it manually.");
  }
  const update = paths["electron-updater"];
  if ("mode" in update && update.mode === "manual") {
    const message =
      "message" in update && typeof update.message === "string"
        ? update.message
        : "Install this release manually.";
    throw new Error(message);
  }
  if (
    !("mode" in update) ||
    update.mode !== "automatic" ||
    !("minimumClientVersion" in update) ||
    typeof update.minimumClientVersion !== "string" ||
    !valid(update.minimumClientVersion) ||
    !("channel" in update) ||
    (update.channel !== "electron-latest" && update.channel !== "electron-beta")
  ) {
    throw new Error("Invalid electron-updater update path.");
  }
  if (update.channel !== (descriptor.channel === "beta" ? "electron-beta" : "electron-latest"))
    throw new Error("Update path channel mismatch.");
  return { minimumClientVersion: update.minimumClientVersion, channel: update.channel };
}
