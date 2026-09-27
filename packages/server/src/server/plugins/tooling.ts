// Author and repository tooling shared by the CLI (`frogg plugins pack|index …`) and tests:
// manifest loading, deterministic packing, index building and offline verification.
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  PLUGIN_MANIFEST_FILENAME,
  PluginManifestSchema,
  type PluginManifest,
} from "@frogg/protocol/plugins/manifest";
import {
  PLUGIN_INDEX_PUBLIC_KEY_SUFFIX,
  PLUGIN_INDEX_SCHEMA_VERSION,
  PLUGIN_INDEX_SIGNATURE_SUFFIX,
  PluginIndexSchema,
  type PluginIndex,
  type PluginIndexEntry,
} from "@frogg/protocol/plugins/repo-index";
import { createTarGz, readTarGz, type TarEntry } from "./tar.js";
import {
  publicKeyFromPrivateKey,
  sha256Hex,
  signPluginIndex,
  verifyPluginIndexSignature,
} from "./signing.js";

export class PluginToolingError extends Error {}

function formatIssues(error: { issues: { path: PropertyKey[]; message: string }[] }): string {
  return error.issues
    .map((i) => `${i.path.map(String).join(".") || "(root)"}: ${i.message}`)
    .join("; ");
}

export function parsePluginManifest(raw: unknown, where: string): PluginManifest {
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success)
    throw new PluginToolingError(`${where}: invalid manifest: ${formatIssues(parsed.error)}`);
  return parsed.data;
}

export async function readPluginManifest(dir: string): Promise<PluginManifest> {
  const file = path.join(dir, PLUGIN_MANIFEST_FILENAME);
  let text: string;
  try {
    text = await fs.readFile(file, "utf8");
  } catch {
    throw new PluginToolingError(`${file}: not found`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    throw new PluginToolingError(`${file}: invalid JSON: ${(err as Error).message}`);
  }
  return parsePluginManifest(raw, file);
}

export function pluginTarballName(id: string, version: string): string {
  return `${id}-${version}.tgz`;
}

const TOP_LEVEL_DOCS = /^(readme|license|licence|changelog|notice)(\..*)?$/i;
const SKIP_DIRS = new Set(["node_modules", ".git"]);

async function walk(dir: string, rel: string, out: TarEntry[]): Promise<void> {
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(d.name)) continue;
    const abs = path.join(dir, d.name);
    const relPath = rel ? `${rel}/${d.name}` : d.name;
    if (d.isDirectory()) await walk(abs, relPath, out);
    else if (d.isFile()) {
      const stat = await fs.stat(abs);
      out.push({
        path: relPath,
        data: await fs.readFile(abs),
        mode: stat.mode & 0o111 ? 0o755 : 0o644,
      });
    }
  }
}

/**
 * Files that go into a tarball: the manifest, package.json, top-level README/LICENSE/CHANGELOG/NOTICE,
 * the top-level directory of every entry (usually `dist/`), and `assets/` when present.
 * Source, node_modules and build config stay out.
 */
export async function collectPluginFiles(
  dir: string,
  manifest: PluginManifest,
): Promise<TarEntry[]> {
  const entries: TarEntry[] = [];
  const topDirs = new Set<string>(["assets"]);
  for (const entry of [manifest.entry?.daemon, manifest.entry?.client]) {
    if (!entry) continue;
    const normalized = entry.replace(/^\.\//, "");
    try {
      await fs.access(path.join(dir, normalized));
    } catch {
      throw new PluginToolingError(`entry file ${entry} does not exist; build the plugin first`);
    }
    const parts = normalized.split("/");
    if (parts.length === 1) {
      entries.push({ path: normalized, data: await fs.readFile(path.join(dir, normalized)) });
    } else topDirs.add(parts[0]!);
  }
  for (const d of await fs.readdir(dir, { withFileTypes: true })) {
    // package.json rides along so Node resolves `type: module` for .js entries.
    if (
      d.isFile() &&
      (d.name === PLUGIN_MANIFEST_FILENAME ||
        d.name === "package.json" ||
        TOP_LEVEL_DOCS.test(d.name))
    ) {
      entries.push({ path: d.name, data: await fs.readFile(path.join(dir, d.name)) });
    } else if (d.isDirectory() && topDirs.has(d.name)) {
      await walk(path.join(dir, d.name), d.name, entries);
    }
  }
  const seen = new Set<string>();
  return entries.filter((e) => (seen.has(e.path) ? false : (seen.add(e.path), true)));
}

export interface PackResult {
  manifest: PluginManifest;
  file: string;
  sha256: string;
  bytes: number;
}

/** Validates the manifest and writes `<id>-<version>.tgz` and `<…>.tgz.sha256` to `outDir`. */
export async function packPlugin(dir: string, outDir: string): Promise<PackResult> {
  const manifest = await readPluginManifest(dir);
  const tgz = createTarGz(await collectPluginFiles(dir, manifest));
  const sha256 = sha256Hex(tgz);
  await fs.mkdir(outDir, { recursive: true });
  const file = path.join(outDir, pluginTarballName(manifest.id, manifest.version));
  await fs.writeFile(file, tgz);
  await fs.writeFile(`${file}.sha256`, `${sha256}  ${path.basename(file)}\n`);
  return { manifest, file, sha256, bytes: tgz.length };
}

/** Reads the manifest from inside a tarball (validating it). */
export function readManifestFromTarball(
  tgz: Uint8Array,
  where: string,
): { manifest: PluginManifest; entries: TarEntry[] } {
  const entries = readTarGz(tgz);
  const manifestEntry = entries.find((e) => e.path === PLUGIN_MANIFEST_FILENAME);
  if (!manifestEntry)
    throw new PluginToolingError(`${where}: no ${PLUGIN_MANIFEST_FILENAME} at the tarball root`);
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(manifestEntry.data).toString("utf8"));
  } catch (err) {
    throw new PluginToolingError(`${where}: invalid manifest JSON: ${(err as Error).message}`);
  }
  return { manifest: parsePluginManifest(raw, where), entries };
}

/** Plugin directories under `pluginsDir`: `<category>/<id>/` or flat `<id>/`. */
async function findPluginDirs(
  pluginsDir: string,
): Promise<{ dir: string; category: string | null }[]> {
  const found: { dir: string; category: string | null }[] = [];
  const hasManifest = (d: string) =>
    fs.access(path.join(d, PLUGIN_MANIFEST_FILENAME)).then(
      () => true,
      () => false,
    );
  for (const a of await fs.readdir(pluginsDir, { withFileTypes: true })) {
    if (!a.isDirectory()) continue;
    const first = path.join(pluginsDir, a.name);
    if (await hasManifest(first)) {
      found.push({ dir: first, category: null });
      continue;
    }
    for (const b of await fs.readdir(first, { withFileTypes: true })) {
      const second = path.join(first, b.name);
      if (b.isDirectory() && (await hasManifest(second)))
        found.push({ dir: second, category: a.name });
    }
  }
  return found.sort((x, y) => x.dir.localeCompare(y.dir));
}

export interface BuildIndexOptions {
  pluginsDir: string;
  tarballsDir: string;
  baseUrl: string;
  name: string;
  commit?: string;
  /** categories.json path; when given, every category directory must be declared. */
  categoriesFile?: string;
  now?: Date;
}

async function readCategories(file: string | undefined): Promise<Set<string> | null> {
  if (!file) return null;
  const raw = JSON.parse(await fs.readFile(file, "utf8")) as { categories?: { id: string }[] };
  return new Set((raw.categories ?? []).map((c) => c.id));
}

/** Builds index.json from plugin sources plus their packed tarballs. */
export async function buildPluginIndex(opts: BuildIndexOptions): Promise<PluginIndex> {
  const categories = await readCategories(opts.categoriesFile);
  const base = opts.baseUrl.endsWith("/") ? opts.baseUrl : `${opts.baseUrl}/`;
  const plugins: PluginIndexEntry[] = [];
  for (const { dir, category } of await findPluginDirs(opts.pluginsDir)) {
    const manifest = await readPluginManifest(dir);
    if (category && categories && !categories.has(category)) {
      throw new PluginToolingError(
        `${dir}: category "${category}" is not declared in ${opts.categoriesFile}`,
      );
    }
    const tarName = pluginTarballName(manifest.id, manifest.version);
    const tgz = await fs.readFile(path.join(opts.tarballsDir, tarName)).catch(() => {
      throw new PluginToolingError(
        `${tarName}: not found in ${opts.tarballsDir}; run frogg plugins pack`,
      );
    });
    const packed = readManifestFromTarball(tgz, tarName).manifest;
    assertManifestMatches(
      packed,
      {
        id: manifest.id,
        version: manifest.version,
        scope: manifest.scope,
        capabilities: manifest.capabilities,
      },
      tarName,
    );
    plugins.push({
      id: manifest.id,
      ...(category ? { category } : {}),
      versions: [
        {
          version: manifest.version,
          apiVersion: manifest.apiVersion,
          scope: manifest.scope,
          capabilities: manifest.capabilities,
          tarball: new URL(tarName, base).toString(),
          sha256: sha256Hex(tgz),
          ...(opts.commit ? { commit: opts.commit } : {}),
          name: manifest.name,
          ...(manifest.description ? { description: manifest.description } : {}),
          ...(manifest.author ? { author: manifest.author } : {}),
          ...(manifest.homepage ? { homepage: manifest.homepage } : {}),
        },
      ],
    });
  }
  const index = {
    schemaVersion: PLUGIN_INDEX_SCHEMA_VERSION,
    name: opts.name,
    generatedAt: (opts.now ?? new Date()).toISOString(),
    plugins,
  } as const;
  const parsed = PluginIndexSchema.safeParse(index);
  if (!parsed.success)
    throw new PluginToolingError(`generated index is invalid: ${formatIssues(parsed.error)}`);
  return parsed.data;
}

export function serializePluginIndex(index: PluginIndex): string {
  return JSON.stringify(index, null, 2) + "\n";
}

export interface ManifestExpectation {
  id: string;
  version: string;
  scope: string;
  capabilities: readonly string[];
}

/** Integrity step 3: the manifest inside the tarball must match the index entry. */
export function assertManifestMatches(
  manifest: PluginManifest,
  expected: ManifestExpectation,
  where: string,
): void {
  const same = (a: readonly string[], b: readonly string[]) =>
    a.length === b.length && [...a].sort().join(",") === [...b].sort().join(",");
  const problems: string[] = [];
  if (manifest.id !== expected.id) problems.push(`id ${manifest.id} != ${expected.id}`);
  if (manifest.version !== expected.version)
    problems.push(`version ${manifest.version} != ${expected.version}`);
  if (manifest.scope !== expected.scope)
    problems.push(`scope ${manifest.scope} != ${expected.scope}`);
  if (!same(manifest.capabilities, expected.capabilities)) {
    problems.push(
      `capabilities [${manifest.capabilities.join(", ")}] != [${expected.capabilities.join(", ")}]`,
    );
  }
  if (problems.length)
    throw new PluginToolingError(`${where}: manifest does not match index: ${problems.join("; ")}`);
}

/** Signs `indexFile`, writing `<indexFile>.sig` and `<indexFile>.pub`. */
export async function signPluginIndexFile(
  indexFile: string,
  privateKey: string,
): Promise<{ signature: string; publicKey: string }> {
  const bytes = await fs.readFile(indexFile);
  const parsed = PluginIndexSchema.safeParse(JSON.parse(bytes.toString("utf8")));
  if (!parsed.success)
    throw new PluginToolingError(`${indexFile}: invalid index: ${formatIssues(parsed.error)}`);
  const signature = signPluginIndex(bytes, privateKey);
  const publicKey = publicKeyFromPrivateKey(privateKey);
  await fs.writeFile(indexFile + PLUGIN_INDEX_SIGNATURE_SUFFIX, signature + "\n");
  await fs.writeFile(indexFile + PLUGIN_INDEX_PUBLIC_KEY_SUFFIX, publicKey + "\n");
  return { signature, publicKey };
}

export interface VerifyIndexResult {
  index: PluginIndex;
  checkedTarballs: number;
}

/** Offline verification for repo CI: signature, schema, and (optionally) every tarball. */
export async function verifyPluginIndexFile(
  indexFile: string,
  publicKey: string,
  tarballsDir?: string,
): Promise<VerifyIndexResult> {
  const bytes = await fs.readFile(indexFile);
  const sig = await fs.readFile(indexFile + PLUGIN_INDEX_SIGNATURE_SUFFIX, "utf8").catch(() => {
    throw new PluginToolingError(`${indexFile}${PLUGIN_INDEX_SIGNATURE_SUFFIX}: not found`);
  });
  if (!verifyPluginIndexSignature(bytes, sig, publicKey)) {
    throw new PluginToolingError(`${indexFile}: signature does not verify against the public key`);
  }
  const parsed = PluginIndexSchema.safeParse(JSON.parse(bytes.toString("utf8")));
  if (!parsed.success)
    throw new PluginToolingError(`${indexFile}: invalid index: ${formatIssues(parsed.error)}`);
  let checked = 0;
  if (tarballsDir) {
    for (const p of parsed.data.plugins) {
      for (const v of p.versions) {
        const name = path.posix.basename(new URL(v.tarball).pathname);
        const tgz = await fs.readFile(path.join(tarballsDir, name)).catch(() => {
          throw new PluginToolingError(`${name}: not found in ${tarballsDir}`);
        });
        if (sha256Hex(tgz) !== v.sha256)
          throw new PluginToolingError(`${name}: sha256 does not match index`);
        assertManifestMatches(
          readManifestFromTarball(tgz, name).manifest,
          { id: p.id, ...v },
          name,
        );
        checked += 1;
      }
    }
  }
  return { index: parsed.data, checkedTarballs: checked };
}
