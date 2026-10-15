import { channelOfVersion } from "./release-channel.mjs";
import { assertClientForVersion } from "./build-release-metadata.mjs";
import { electronUpdateProtocol } from "./verify-electron-update-path.mjs";
import { valid, lt, rcompare } from "semver";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

/**
 * `brand` (the generated brand.json, optional) names the two clients' asset families so a release
 * can be checked to carry only its own client's: the classic app on stable, Frogg Next on a
 * prerelease. `nextFeeds` holds the text of the Frogg Next feed files a prerelease names.
 */
export function verifyReleaseAssets({
  descriptor,
  manifests,
  release,
  previousDescriptor,
  brand,
  nextFeeds = {},
}) {
  if (
    descriptor.schemaVersion !== 1 ||
    !valid(descriptor.version) ||
    release.tag_name !== `v${descriptor.version}`
  )
    throw new Error("Release identity mismatch");
  if (descriptor.channel !== channelOfVersion(descriptor.version))
    throw new Error("Release channel mismatch");
  if (
    !descriptor.updatePaths ||
    typeof descriptor.updatePaths !== "object" ||
    Array.isArray(descriptor.updatePaths) ||
    !Object.keys(descriptor.updatePaths).length
  )
    throw new Error("Missing update paths");
  for (const protocol of Object.keys(previousDescriptor?.updatePaths ?? {})) {
    if (!Object.hasOwn(descriptor.updatePaths, protocol))
      throw new Error(`Missing upgrade path for previously supported protocol: ${protocol}`);
  }
  verifyRetainedPlatforms(descriptor, previousDescriptor);
  const assets = new Map(release.assets.map((asset) => [asset.name, asset]));
  for (const [protocol, update] of Object.entries(descriptor.updatePaths)) {
    verifyUpdateProtocol({ protocol, update, version: descriptor.version, manifests, assets });
  }
  if (!assets.has("release.json")) throw new Error("Release descriptor is not uploaded");
  // Releases cut before the single-identity model carry no `client`.
  if (descriptor.client !== undefined) {
    assertClientForVersion(descriptor.version, descriptor.client);
    verifyClientAssets({ descriptor, assets, brand, nextFeeds });
  }
}

const lower = (value) => value.toLowerCase();

function verifyClientAssets({ descriptor, assets, brand, nextFeeds }) {
  const names = [...assets.keys()];
  if (descriptor.client !== "frogg-next") {
    const nextPrefix = brand?.next?.artifactPrefix;
    const feedPrefix = brand?.next?.feedPrefix;
    const stray = names.filter(
      (name) =>
        (nextPrefix && lower(name).startsWith(lower(`${nextPrefix}-`))) ||
        (feedPrefix && name.startsWith(`${feedPrefix}-latest`)),
    );
    if (stray.length)
      throw new Error(`Frogg Next assets on a ${descriptor.client} release: ${stray.join(", ")}`);
    return;
  }
  verifyNoClassicAssets(descriptor.version, names, brand);
  const { feeds, checksums } = descriptor.froggNext ?? {};
  if (!Array.isArray(feeds) || !feeds.length || typeof checksums !== "string")
    throw new Error("Frogg Next release descriptor names no feeds or checksum list");
  for (const name of [...feeds, checksums]) {
    if (!assets.has(name)) throw new Error(`Frogg Next asset is not uploaded: ${name}`);
  }
  for (const feed of feeds) verifyNextFeed(feed, nextFeeds[feed], assets);
  verifyNextChecksums(checksums, nextFeeds[checksums], assets);
}

function verifyNoClassicAssets(version, names, brand) {
  const feeds = names.filter((name) => /^electron-(latest|beta)(-\w+)?\.yml$/.test(name));
  if (feeds.length)
    throw new Error(`Classic update feeds on a Frogg Next release: ${feeds.join(", ")}`);
  if (!brand) return;
  // The classic desktop and Android payloads share the brand prefix with the daemon bundles.
  const classic = names.filter(
    (name) =>
      lower(name).startsWith(lower(`${brand.artifactPrefix}-${version}-`)) &&
      !/-daemon\.(tar\.gz|zip)(\.sha256)?$/.test(name),
  );
  if (classic.length)
    throw new Error(`Classic app payloads on a Frogg Next release: ${classic.join(", ")}`);
}

/** Every payload an electron-updater feed names (`url:` / `path:`) is on the release. */
function verifyNextFeed(feed, text, assets) {
  if (typeof text !== "string") return;
  const payloads = [
    ...text.matchAll(/^\s*(?:-\s*)?(?:url|path):\s*['"]?([^'"\s]+)['"]?\s*$/gm),
  ].map((match) => match[1]);
  if (!payloads.length) throw new Error(`Frogg Next feed lists no payloads: ${feed}`);
  const missing = payloads.find((payload) => !assets.has(payload));
  if (missing) throw new Error(`${feed} names a missing payload: ${missing}`);
}

/** Every checksum line matches the SHA-256 digest GitHub reports for that asset. */
function verifyNextChecksums(name, text, assets) {
  if (typeof text !== "string") return;
  for (const line of text.split("\n").filter((entry) => entry.trim())) {
    const match = /^([a-f0-9]{64})\s+\*?(\S+)$/.exec(line.trim());
    if (!match) throw new Error(`Malformed checksum line in ${name}: ${line}`);
    const asset = assets.get(match[2]);
    if (!asset) throw new Error(`${name} names a missing asset: ${match[2]}`);
    if (asset.digest && asset.digest !== `sha256:${match[1]}`)
      throw new Error(`Checksum mismatch for ${match[2]}`);
  }
}

/** The Frogg Next feed and checksum files a prerelease names, as text, when uploaded. */
async function downloadNextFeeds({ gh, values, release, descriptor, directory }) {
  const { feeds = [], checksums } = descriptor.froggNext ?? {};
  const names = [...feeds, checksums];
  if (names.some((name) => typeof name !== "string" || path.basename(name) !== name))
    throw new Error("Invalid Frogg Next asset filename");
  const texts = {};
  for (const name of names.filter((entry) => release.assets.some((a) => a.name === entry))) {
    gh([
      "release",
      "download",
      values.tag,
      "--repo",
      values.repo,
      "--dir",
      directory,
      "--pattern",
      name,
    ]);
    texts[name] = await readFile(path.join(directory, name), "utf8");
  }
  return texts;
}

function verifyRetainedPlatforms(descriptor, previousDescriptor) {
  const platforms = descriptor.updatePaths["electron-updater"]?.platforms ?? {};
  for (const [platform, entry] of Object.entries(platforms)) {
    if (!entry.version || entry.version === descriptor.version) continue;
    const previous = previousDescriptor?.updatePaths?.["electron-updater"]?.platforms?.[platform];
    const previousVersion = previous?.version ?? previousDescriptor?.version;
    if (
      !previous ||
      entry.version !== previousVersion ||
      entry.manifest !== previous.manifest ||
      JSON.stringify(entry.files) !== JSON.stringify(previous.files)
    )
      throw new Error(`Retained platform differs from preceding release: ${platform}`);
  }
}

function verifyUpdateProtocol({ protocol, update, version, manifests, assets }) {
  if (!update || typeof update !== "object") throw new Error("Invalid update path");
  if (update.mode === "manual") {
    if (typeof update.message !== "string" || !update.message.trim())
      throw new Error("Manual update path requires migration instructions");
    return;
  }
  if (update.mode !== "automatic") throw new Error("Unknown update mode");
  const verify = Object.hasOwn(protocolVerifiers, protocol)
    ? protocolVerifiers[protocol]
    : undefined;
  if (!verify) throw new Error(`No publication verifier registered for ${protocol}`);
  verify.verifyMetadata({ version, update, manifests, assets });
}

const protocolVerifiers = { "electron-updater": electronUpdateProtocol };

function automaticUpdates(descriptor) {
  return Object.entries(descriptor.updatePaths)
    .filter(([, update]) => update.mode === "automatic")
    .map(([protocol, update]) => {
      const adapter = Object.hasOwn(protocolVerifiers, protocol)
        ? protocolVerifiers[protocol]
        : undefined;
      if (!adapter) throw new Error(`No publication verifier registered for ${protocol}`);
      return { adapter, update };
    });
}

export async function verifyReleasePayloads(descriptor, directory) {
  for (const { adapter, update } of automaticUpdates(descriptor))
    await adapter.verifyPayloads(update, directory);
}

export function listReleases(gh, repo) {
  const output = gh([
    "api",
    "--paginate",
    `repos/${repo}/releases?per_page=100`,
    "--jq",
    ".[] | @json",
  ]);
  return output.trim()
    ? output
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line))
    : [];
}

async function loadPreviousDescriptor(gh, repo, version, directory) {
  const releases = listReleases(gh, repo);
  const previous = releases
    .filter(
      (release) =>
        !release.draft &&
        valid(release.tag_name) &&
        lt(release.tag_name, version) &&
        // The previous release of the same build: betas update from betas, stable (fork
        // rebuilds included) from stable.
        channelOfVersion(release.tag_name) === channelOfVersion(version) &&
        (channelOfVersion(version) === "beta" || !release.prerelease),
    )
    .sort((a, b) => rcompare(a.tag_name, b.tag_name))[0];
  if (!previous?.assets.some((asset) => asset.name === "release.json")) return undefined;
  const destination = path.join(directory, "previous");
  gh([
    "release",
    "download",
    previous.tag_name,
    "--repo",
    repo,
    "--dir",
    destination,
    "--pattern",
    "release.json",
  ]);
  return JSON.parse(await readFile(path.join(destination, "release.json"), "utf8"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      repo: { type: "string" },
      tag: { type: "string" },
      brand: { type: "string" },
      "assets-dir": { type: "string" },
    },
  });
  if (
    !/^[\w.-]+\/[\w.-]+$/.test(values.repo ?? "") ||
    !/^v\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(values.tag ?? "")
  )
    throw new Error("Provide --repo OWNER/REPO --tag vVERSION");
  const gh = (args) => execFileSync("gh", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  const releases = listReleases(gh, values.repo);
  const release = releases.find((candidate) => candidate.tag_name === values.tag);
  if (!release) throw new Error(`Release not found: ${values.tag}`);
  const directory = await mkdtemp(path.join(os.tmpdir(), "frogg-release-verify-"));
  try {
    gh([
      "release",
      "download",
      values.tag,
      "--repo",
      values.repo,
      "--dir",
      directory,
      "--pattern",
      "release.json",
    ]);
    const descriptor = JSON.parse(await readFile(path.join(directory, "release.json"), "utf8"));
    const manifests = {};
    const names = automaticUpdates(descriptor).flatMap(({ adapter, update }) =>
      adapter.manifestNames(update),
    );
    for (const name of new Set(names)) {
      if (typeof name !== "string" || path.basename(name) !== name)
        throw new Error("Invalid manifest filename");
      gh([
        "release",
        "download",
        values.tag,
        "--repo",
        values.repo,
        "--dir",
        directory,
        "--pattern",
        name,
      ]);
      manifests[name] = JSON.parse(await readFile(path.join(directory, name), "utf8"));
    }
    const nextFeeds =
      descriptor.client === "frogg-next"
        ? await downloadNextFeeds({ gh, values, release, descriptor, directory })
        : {};
    const brand = values.brand ? JSON.parse(await readFile(values.brand, "utf8")) : undefined;
    const previousDescriptor = await loadPreviousDescriptor(
      gh,
      values.repo,
      descriptor.version,
      directory,
    );
    verifyReleaseAssets({ descriptor, manifests, release, previousDescriptor, brand, nextFeeds });
    if (!values["assets-dir"] && automaticUpdates(descriptor).length) {
      const payloadNames = automaticUpdates(descriptor).flatMap(({ adapter, update }) =>
        adapter.payloadNames(update),
      );
      if (payloadNames.some((name) => typeof name !== "string" || path.basename(name) !== name))
        throw new Error("Invalid payload filename");
      const patterns = payloadNames.flatMap((name) => ["--pattern", name]);
      gh([
        "release",
        "download",
        values.tag,
        "--repo",
        values.repo,
        "--dir",
        directory,
        ...patterns,
      ]);
    }
    await verifyReleasePayloads(descriptor, values["assets-dir"] ?? directory);
    console.log(
      descriptor.client === "frogg-next"
        ? `Verified ${values.tag}: Frogg Next feeds and checksums match the uploaded assets, and no classic app payloads are attached.`
        : `Verified ${values.tag}: exact desktop payload names, sizes and SHA-256/SHA-512 hashes match payload bytes and GitHub assets.`,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
