import { channelOfVersion, releaseLineOfVersion } from "./release-channel.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { RUST_CLIENT_FEED, rustClientChecksumsName } from "./rust-client-assets.mjs";
import { pathToFileURL } from "node:url";
import {
  froggNextArtifactPrefix,
  froggNextChecksumsName,
  froggNextFeedNames,
  froggNextFeedPrefix,
} from "../../packages/branding/src/artifact-contract.mjs";
import { buildElectronReleaseManifests } from "./electron-release-manifests.mjs";

/**
 * Which client a release carries, by release line: stable tags ship the classic app (apps/desktop +
 * apps/ui), `-beta.N` tags from `main` ship it as frogg beta (the brand's beta client identity),
 * `-next.N` tags from `frogg-next` ship Frogg Next (apps/ui-next), or no client at all for a brand
 * that opts out of Frogg Next. Every release carries the daemon bundles.
 */
export const RELEASE_CLIENTS = Object.freeze(["classic", "classic-beta", "frogg-next", "none"]);

const CLIENTS_BY_LINE = Object.freeze({
  stable: ["classic"],
  beta: ["classic-beta"],
  next: ["frogg-next", "none"],
});

/** The client a version's release carries unless the brand opts out of Frogg Next. */
export function defaultClientForVersion(version) {
  return CLIENTS_BY_LINE[releaseLineOfVersion(version)][0];
}

/** @param {string} version @param {string} client */
export function assertClientForVersion(version, client) {
  if (!RELEASE_CLIENTS.includes(client)) throw new Error(`Unknown release client: ${client}`);
  const line = releaseLineOfVersion(version);
  if (!CLIENTS_BY_LINE[line].includes(client))
    throw new Error(
      `A ${line} release cannot carry the ${client} client: stable releases ship the classic app, -beta.N frogg beta, -next.N Frogg Next`,
    );
}

/** Product discovery is stable; packaging adapters supply versioned update protocols. */
export async function buildReleaseMetadata(options) {
  const channel = channelOfVersion(options.version);
  const client = options.client ?? defaultClientForVersion(options.version);
  const classic = client === "classic" || client === "classic-beta";
  assertClientForVersion(options.version, client);
  const descriptor = {
    schemaVersion: 1,
    version: options.version,
    channel,
    client,
    updatePaths: classic
      ? {
          "electron-updater": await buildElectronReleaseManifests(options),
          "tauri-updater": manual(
            "Install this release manually: the installed updater cannot replace the new application layout safely.",
          ),
        }
      : // A frogg beta from before 1.6.14-beta.4 takes the newest prerelease of any kind, so it
        // can land here; it finds no classic payloads and says where its own releases are.
        {
          "electron-updater": manual(
            `This prerelease ships ${options.next?.name ?? "Frogg Next"}, not the classic app. Install the newest -beta release from the release page, or use the stable app.`,
          ),
          "tauri-updater": manual("Install this release manually."),
        },
    ...(client === "frogg-next"
      ? { froggNext: froggNextAssets(options.version, options.next) }
      : {}),
    ...(client === "frogg-next" && (options.nextRs === "signed" || options.nextRs === "unsigned")
      ? { froggNextRs: rustClientAssets(options.version, options.nextRs === "signed") }
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

/**
 * What the Rust client (rust-client.yml) uploaded to a `-next.N`: its checksum list always, the
 * Tauri updater feed only when its bundles were signed. Absent when that job did not succeed.
 */
function rustClientAssets(version, signed) {
  return {
    checksums: rustClientChecksumsName(version),
    ...(signed ? { feed: RUST_CLIENT_FEED } : {}),
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
      "next-rs": { type: "string" },
      "retain-desktop-from": { type: "string" },
    },
  });
  if (!values.version || !values.out) throw new Error("Required: --version --out");
  const client = values.client ?? defaultClientForVersion(values.version);
  if ((client === "classic" || client === "classic-beta") && !values.assets)
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
  await buildReleaseMetadata({
    ...values,
    nextRs: values["next-rs"],
    client,
    next: brand?.next,
    platformVersions,
  });
}
