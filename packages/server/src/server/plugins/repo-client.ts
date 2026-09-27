// Fetches and verifies repository indexes and plugin tarballs (integrity steps 1 and 2).
import {
  PLUGIN_INDEX_PUBLIC_KEY_SUFFIX,
  PLUGIN_INDEX_SIGNATURE_SUFFIX,
  PluginIndexSchema,
  type PluginIndex,
} from "@frogg/protocol/plugins/repo-index";
import { isValidPublicKey, sha256Hex, verifyPluginIndexSignature } from "./signing.js";
import { MAX_PLUGIN_TARBALL_BYTES } from "./tar.js";
import { PluginServiceError } from "./errors.js";

export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const MAX_INDEX_BYTES = 10 * 1024 * 1024;

export function assertRepoUrl(url: string, allowInsecure: boolean): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new PluginServiceError("invalid_request", `Not a URL: ${url}`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (
    parsed.protocol !== "https:" &&
    !(allowInsecure && (parsed.protocol === "http:" || parsed.protocol === "file:")) &&
    !(parsed.protocol === "http:" && loopback)
  ) {
    throw new PluginServiceError("invalid_request", `Repository URLs must use https: ${url}`);
  }
  return parsed;
}

async function fetchBytes(
  fetchImpl: FetchLike,
  url: string,
  limit: number,
  timeoutMs: number,
): Promise<Buffer> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch (err) {
    throw new PluginServiceError(
      "fetch_failed",
      `Could not fetch ${url}: ${(err as Error).message}`,
    );
  }
  if (!res.ok)
    throw new PluginServiceError("fetch_failed", `Could not fetch ${url}: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > limit)
    throw new PluginServiceError("fetch_failed", `${url} exceeds ${limit} bytes`);
  return buf;
}

export async function fetchRepoPublicKey(fetchImpl: FetchLike, indexUrl: string): Promise<string> {
  const key = (await fetchBytes(fetchImpl, indexUrl + PLUGIN_INDEX_PUBLIC_KEY_SUFFIX, 1024, 15_000))
    .toString("utf8")
    .trim();
  if (!isValidPublicKey(key)) {
    throw new PluginServiceError(
      "invalid_request",
      `${indexUrl}${PLUGIN_INDEX_PUBLIC_KEY_SUFFIX} is not a base64 ed25519 public key`,
    );
  }
  return key;
}

/** Fetches index.json + .sig, verifies the signature against `publicKey`, then parses. */
export async function fetchVerifiedIndex(
  fetchImpl: FetchLike,
  indexUrl: string,
  publicKey: string,
): Promise<PluginIndex> {
  const [bytes, sig] = await Promise.all([
    fetchBytes(fetchImpl, indexUrl, MAX_INDEX_BYTES, 30_000),
    fetchBytes(fetchImpl, indexUrl + PLUGIN_INDEX_SIGNATURE_SUFFIX, 1024, 30_000),
  ]);
  if (!verifyPluginIndexSignature(bytes, sig.toString("utf8"), publicKey)) {
    throw new PluginServiceError("signature_invalid", `Signature check failed for ${indexUrl}`);
  }
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new PluginServiceError("fetch_failed", `${indexUrl} is not valid JSON`);
  }
  const parsed = PluginIndexSchema.safeParse(raw);
  if (!parsed.success)
    throw new PluginServiceError("fetch_failed", `${indexUrl} is not a valid plugin index`);
  return parsed.data;
}

/** Downloads a tarball and verifies its sha256 before anything reads it. */
export async function fetchVerifiedTarball(
  fetchImpl: FetchLike,
  url: string,
  sha256: string,
): Promise<Buffer> {
  const bytes = await fetchBytes(fetchImpl, url, MAX_PLUGIN_TARBALL_BYTES, 120_000);
  if (sha256Hex(bytes) !== sha256.toLowerCase()) {
    throw new PluginServiceError("hash_mismatch", `sha256 mismatch for ${url}`);
  }
  return bytes;
}
