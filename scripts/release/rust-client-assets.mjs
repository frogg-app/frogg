// Release assets of the Rust client, Frogg Next RS (apps/client, .github/workflows/rust-client.yml).
//
// Renames the Tauri bundles of every platform to Frogg-Next-RS-<version>-<platform>-<arch>.<ext>,
// writes Frogg-Next-RS-<version>-SHA256SUMS and, when the bundles carry updater signatures (built
// with FROGG_NEXT_RS_UPDATER_KEY), frogg-next-rs-latest.json: Tauri v2's static updater manifest.
// The app's updater (apps/client/src-tauri/src/updates.rs) picks the newest release of its channel
// that carries that feed.
//
//   node scripts/release/rust-client-assets.mjs --in <bundles> --out <dir> --version <v>
//     [--repo owner/name] [--tag vX.Y.Z-next.N] [--pub-date <iso>]
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

export const RUST_CLIENT_PREFIX = "Frogg-Next-RS";
export const RUST_CLIENT_FEED = "frogg-next-rs-latest.json";

export const rustClientChecksumsName = (version) => `${RUST_CLIENT_PREFIX}-${version}-SHA256SUMS`;

/**
 * Bundle kinds by file suffix: the release name's `<platform>-<arch>.<ext>` and, for the bundles
 * the updater installs, the Tauri platform keys of the feed (`<os>-<arch>` and the installer form).
 */
const KINDS = [
  { suffix: ".deb", name: "linux-x64.deb" },
  {
    suffix: ".AppImage",
    name: "linux-x64.AppImage",
    feed: ["linux-x86_64", "linux-x86_64-appimage"],
  },
  { suffix: ".exe", name: "windows-x64.exe", feed: ["windows-x86_64", "windows-x86_64-nsis"] },
  { suffix: ".dmg", name: "macos-arm64.dmg" },
  {
    suffix: ".app.tar.gz",
    name: "macos-arm64.app.tar.gz",
    feed: ["darwin-aarch64", "darwin-aarch64-app"],
  },
  { suffix: ".apk", name: "android-universal.apk" },
];

const kindOf = (file) => KINDS.find(({ suffix }) => file.endsWith(suffix));

/**
 * Maps bundle paths to release asset names. Signatures (`<bundle>.sig`) follow their bundle; a
 * second bundle of the same kind is an error, since both would claim one release name.
 * @param {string[]} files
 * @param {string} version
 * @returns {{ source: string, name: string }[]}
 */
export function planRustClientAssets(files, version) {
  const plan = [];
  const taken = new Map();
  for (const source of files) {
    const base = path.basename(source);
    const signature = base.endsWith(".sig");
    const kind = kindOf(signature ? base.slice(0, -4) : base);
    if (!kind) continue;
    const name = `${RUST_CLIENT_PREFIX}-${version}-${kind.name}${signature ? ".sig" : ""}`;
    if (taken.has(name))
      throw new Error(`Two bundles for ${name}: ${taken.get(name)} and ${source}`);
    taken.set(name, source);
    plan.push({ source, name });
  }
  return plan.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Tauri v2's static updater JSON for the signed bundles among `names`, or null when none is signed.
 * @param {{ version: string, names: string[], signatures: Record<string, string>,
 *   repo: string, tag: string, pubDate: string }} options
 */
export function buildRustClientFeed({ version, names, signatures, repo, tag, pubDate }) {
  const platforms = {};
  for (const kind of KINDS.filter(({ feed }) => feed)) {
    const name = `${RUST_CLIENT_PREFIX}-${version}-${kind.name}`;
    const signature = signatures[`${name}.sig`];
    if (!names.includes(name) || !signature) continue;
    const url = `https://github.com/${repo}/releases/download/${tag}/${name}`;
    for (const key of kind.feed) platforms[key] = { signature: signature.trim(), url };
  }
  if (!Object.keys(platforms).length) return null;
  return {
    version,
    notes: `Frogg Next RS ${version}: https://github.com/${repo}/releases/tag/${tag}`,
    pub_date: pubDate,
    platforms,
  };
}

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      version: { type: "string" },
      repo: { type: "string", default: "frogg-app/frogg" },
      tag: { type: "string" },
      "pub-date": { type: "string" },
    },
  });
  if (!values.in || !values.out || !values.version)
    throw new Error("Usage: --in <bundles> --out <dir> --version <version>");
  const { version } = values;
  const tag = values.tag ?? `v${version}`;
  const plan = planRustClientAssets(walk(values.in), version);
  if (!plan.some(({ name }) => !name.endsWith(".sig")))
    throw new Error(`No Frogg Next RS bundles under ${values.in}`);
  mkdirSync(values.out, { recursive: true });
  const signatures = {};
  for (const { source, name } of plan) {
    copyFileSync(source, path.join(values.out, name));
    if (name.endsWith(".sig")) signatures[name] = readFileSync(source, "utf8");
  }
  const names = plan.map(({ name }) => name);
  const sums = names
    .map((name) => {
      const digest = createHash("sha256").update(readFileSync(path.join(values.out, name)));
      return `${digest.digest("hex")}  ${name}\n`;
    })
    .join("");
  writeFileSync(path.join(values.out, rustClientChecksumsName(version)), sums);
  const feed = buildRustClientFeed({
    version,
    names,
    signatures,
    repo: values.repo,
    tag,
    pubDate: values["pub-date"] ?? new Date().toISOString(),
  });
  if (feed) {
    writeFileSync(path.join(values.out, RUST_CLIENT_FEED), `${JSON.stringify(feed, null, 2)}\n`);
    console.log(`${RUST_CLIENT_FEED}: ${Object.keys(feed.platforms).join(", ")}`);
  } else {
    console.log(`No updater signatures: no ${RUST_CLIENT_FEED}.`);
  }
  for (const name of names) console.log(name);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
