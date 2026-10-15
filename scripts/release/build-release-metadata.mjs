import { channelOfVersion } from "./release-channel.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import {
  froggNextArtifactPrefix,
  froggNextChecksumsName,
  froggNextFeedNames,
  froggNextFeedPrefix,
} from "../../packages/branding/src/artifact-contract.mjs";
import { buildElectronReleaseManifests } from "./electron-release-manifests.mjs";

/**
 * Which client a release carries. Stable tags ship the classic app (apps/desktop + apps/ui);
 * prerelease tags ship Frogg Next (apps/ui-next), or no client at all for a brand that opts out
 * of Frogg Next. Every release carries the daemon bundles.
 */
export const RELEASE_CLIENTS = Object.freeze(["classic", "frogg-next", "none"]);

/** @param {string} version @param {string} client */
export function assertClientForVersion(version, client) {
  if (!RELEASE_CLIENTS.includes(client)) throw new Error(`Unknown release client: ${client}`);
  const channel = channelOfVersion(version);
  if ((client === "classic") !== (channel === "stable"))
    throw new Error(
      `A ${channel} release cannot carry the ${client} client: stable releases ship the classic app, prereleases ship Frogg Next`,
    );
}

/** Product discovery is stable; packaging adapters supply versioned update protocols. */
export async function buildReleaseMetadata(options) {
  const channel = channelOfVersion(options.version);
  const client = options.client ?? (channel === "stable" ? "classic" : "frogg-next");
  assertClientForVersion(options.version, client);
  const descriptor = {
    schemaVersion: 1,
    version: options.version,
    channel,
    client,
    updatePaths:
      client === "classic"
        ? {
            "electron-updater": await buildElectronReleaseManifests(options),
            "tauri-updater": manual(
              "Install this release manually: the installed updater cannot replace the new application layout safely.",
            ),
          }
        : // An installed classic beta app that still looks at prereleases finds no classic
          // payloads here, and says so instead of failing on a missing feed.
          {
            "electron-updater": manual(
              `This prerelease ships ${options.next?.name ?? "Frogg Next"}, not the classic app. Install it from the release page, or use the stable app.`,
            ),
            "tauri-updater": manual("Install this release manually."),
          },
    ...(client === "frogg-next"
      ? { froggNext: froggNextAssets(options.version, options.next) }
      : {}),
  };
  await mkdir(options.out, { recursive: true });
  await writeFile(
    path.join(options.out, "release.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`,
  );
  return descriptor;
}

function manual(message) {
  return { mode: "manual", message };
}

/** The Frogg Next feed and checksum files `ui-next-desktop.yml` uploads to a prerelease. */
function froggNextAssets(version, next = {}) {
  const artifactPrefix = next.artifactPrefix ?? froggNextArtifactPrefix;
  return {
    artifactPrefix,
    feeds: froggNextFeedNames(next.feedPrefix ?? froggNextFeedPrefix),
    checksums: froggNextChecksumsName(version, artifactPrefix),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      version: { type: "string" },
      client: { type: "string" },
      brand: { type: "string" },
      assets: { type: "string" },
      out: { type: "string" },
      "retain-desktop-from": { type: "string" },
    },
  });
  if (!values.version || !values.out) throw new Error("Required: --version --out");
  const client =
    values.client ?? (channelOfVersion(values.version) === "stable" ? "classic" : "frogg-next");
  if (client === "classic" && !values.assets)
    throw new Error("Required for the classic client: --assets");
  const brand = values.brand ? JSON.parse(await readFile(values.brand, "utf8")) : null;
  const platformVersions = {};
  if (values["retain-desktop-from"]) {
    const previous = JSON.parse(await readFile(values["retain-desktop-from"], "utf8"));
    for (const platform of ["-linux", "-mac"]) {
      const entry = previous.updatePaths?.["electron-updater"]?.platforms?.[platform];
      if (!entry) throw new Error(`Missing previous platform: ${platform}`);
      platformVersions[platform] = entry.version ?? previous.version;
    }
  }
  await buildReleaseMetadata({ ...values, client, next: brand?.next, platformVersions });
}
