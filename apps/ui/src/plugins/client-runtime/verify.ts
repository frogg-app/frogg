import {
  isSupportedPluginApiVersion,
  PluginManifestSchema,
  type PluginManifest,
} from "@frogg/protocol/plugins/manifest";
import {
  PLUGIN_INDEX_SIGNATURE_SUFFIX,
  PluginIndexSchema,
  pickPluginVersion,
  type PluginIndex,
  type PluginIndexVersion,
} from "@frogg/protocol/plugins/repo-index";
import { ClientPluginError } from "./errors";
import { readTarGz, type TarFile } from "./tar";

/**
 * Device-side integrity for client plugin halves, mirroring the daemon's install path with
 * WebCrypto: the repo index must carry a valid ed25519 signature from the repo's pinned key, the
 * tarball must match the signed sha256, and the manifest inside must match the signed entry.
 */

export type FetchLike = (url: string) => Promise<Response>;

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.trim());
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  return toHex(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
}

/** Verifies a detached ed25519 signature (base64) over `data` with a base64 raw public key. */
export async function verifyEd25519(
  data: Uint8Array,
  signatureBase64: string,
  publicKeyBase64: string,
): Promise<boolean> {
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      base64ToBytes(publicKeyBase64) as BufferSource,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
  } catch {
    throw new ClientPluginError(
      "incompatible",
      "This app cannot verify ed25519 signatures, so it cannot install plugins",
    );
  }
  let signature: Uint8Array;
  try {
    signature = base64ToBytes(signatureBase64);
  } catch {
    return false;
  }
  return crypto.subtle.verify(
    { name: "Ed25519" },
    key,
    signature as BufferSource,
    data as BufferSource,
  );
}

async function fetchBytes(fetchImpl: FetchLike, url: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetchImpl(url);
  } catch (error) {
    throw new ClientPluginError(
      "fetch_failed",
      `${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (!response.ok) throw new ClientPluginError("fetch_failed", `${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

/** Fetches `index.json` and its `.sig`, verifies the signature, then parses. */
export async function fetchVerifiedIndex(
  fetchImpl: FetchLike,
  repo: { url: string; publicKey: string },
): Promise<PluginIndex> {
  const [indexBytes, sigBytes] = await Promise.all([
    fetchBytes(fetchImpl, repo.url),
    fetchBytes(fetchImpl, repo.url + PLUGIN_INDEX_SIGNATURE_SUFFIX),
  ]);
  const signature = new TextDecoder().decode(sigBytes).trim();
  if (!(await verifyEd25519(indexBytes, signature, repo.publicKey))) {
    throw new ClientPluginError(
      "signature_invalid",
      `${repo.url}: index signature does not match the repository key`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(indexBytes));
  } catch {
    throw new ClientPluginError("invalid_request", `${repo.url}: index is not JSON`);
  }
  const parsed = PluginIndexSchema.safeParse(json);
  if (!parsed.success) {
    throw new ClientPluginError("invalid_request", `${repo.url}: index is malformed`);
  }
  return parsed.data;
}

export function resolveIndexVersion(
  index: PluginIndex,
  id: string,
  version: string | undefined,
): PluginIndexVersion {
  const entry = index.plugins.find((p) => p.id === id);
  if (!entry) throw new ClientPluginError("not_found", `${id} is not in ${index.name}`);
  const picked = pickPluginVersion(entry.versions, version, isSupportedPluginApiVersion);
  if (picked) return picked;
  const any = pickPluginVersion(entry.versions, version);
  if (any) {
    throw new ClientPluginError(
      "incompatible",
      `${id} ${any.version} needs plugin API v${any.apiVersion}`,
    );
  }
  throw new ClientPluginError("not_found", `No version of ${id} matches ${version ?? "latest"}`);
}

/** Lists what differs between a tarball's manifest and its signed index entry. */
export function manifestMismatches(
  manifest: PluginManifest,
  expected: { id: string; version: string; scope: string; capabilities: readonly string[] },
): string[] {
  const problems: string[] = [];
  if (manifest.id !== expected.id) problems.push(`id ${manifest.id} != ${expected.id}`);
  if (manifest.version !== expected.version) {
    problems.push(`version ${manifest.version} != ${expected.version}`);
  }
  if (manifest.scope !== expected.scope) {
    problems.push(`scope ${manifest.scope} != ${expected.scope}`);
  }
  const a = [...manifest.capabilities].sort().join(",");
  const b = [...expected.capabilities].sort().join(",");
  if (a !== b) problems.push(`capabilities [${a}] != [${b}]`);
  return problems;
}

export interface ClientPluginBundle {
  manifest: PluginManifest;
  /** Source of `entry.client`: one self-contained ES module. */
  entrySource: string;
}

/** Reads the manifest and the client entry out of unpacked plugin files. */
export function bundleFromFiles(
  files: readonly { path: string; data: Uint8Array | string }[],
): ClientPluginBundle {
  const text = (data: Uint8Array | string) =>
    typeof data === "string" ? data : new TextDecoder().decode(data);
  const manifestFile = files.find((f) => f.path === "frogg-plugin.json");
  if (!manifestFile) {
    throw new ClientPluginError("manifest_mismatch", "frogg-plugin.json is missing");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text(manifestFile.data));
  } catch {
    throw new ClientPluginError("manifest_mismatch", "frogg-plugin.json is not JSON");
  }
  const parsed = PluginManifestSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ClientPluginError(
      "manifest_mismatch",
      `frogg-plugin.json is invalid: ${parsed.error.issues[0]?.message ?? "unknown"}`,
    );
  }
  const manifest = parsed.data;
  if (manifest.scope !== "client" && manifest.scope !== "hybrid") {
    throw new ClientPluginError("invalid_request", `${manifest.id} has no client half`);
  }
  if (!isSupportedPluginApiVersion(manifest.apiVersion)) {
    throw new ClientPluginError(
      "incompatible",
      `${manifest.id} needs plugin API v${manifest.apiVersion}`,
    );
  }
  const entryPath = (manifest.entry?.client ?? "").replace(/^\.\//, "");
  const entry = files.find((f) => f.path === entryPath);
  if (!entry) {
    throw new ClientPluginError("manifest_mismatch", `entry.client ${entryPath} is missing`);
  }
  return { manifest, entrySource: text(entry.data) };
}

export interface VerifiedClientPlugin extends ClientPluginBundle {
  indexVersion: PluginIndexVersion;
}

/**
 * The whole device-side install check: signed index → version → sha256 → manifest match.
 * Returns the verified manifest and client entry; nothing is stored or run here.
 */
export async function fetchVerifiedClientPlugin(input: {
  fetch: FetchLike;
  repo: { url: string; publicKey: string };
  id: string;
  version?: string;
}): Promise<VerifiedClientPlugin> {
  const index = await fetchVerifiedIndex(input.fetch, input.repo);
  const indexVersion = resolveIndexVersion(index, input.id, input.version);
  if (indexVersion.scope !== "client" && indexVersion.scope !== "hybrid") {
    throw new ClientPluginError("invalid_request", `${input.id} has no client half`);
  }
  const tarball = await fetchBytes(input.fetch, indexVersion.tarball);
  const digest = await sha256Hex(tarball);
  if (digest !== indexVersion.sha256) {
    throw new ClientPluginError(
      "hash_mismatch",
      `${indexVersion.tarball}: sha256 ${digest} does not match the signed index`,
    );
  }
  const files: TarFile[] = await readTarGz(tarball);
  const bundle = bundleFromFiles(files);
  const problems = manifestMismatches(bundle.manifest, { id: input.id, ...indexVersion });
  if (problems.length > 0) {
    throw new ClientPluginError(
      "manifest_mismatch",
      `${indexVersion.tarball}: manifest does not match index: ${problems.join("; ")}`,
    );
  }
  return { ...bundle, indexVersion };
}
