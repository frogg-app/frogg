import { brand } from "@frogg/branding";
import { brandEnv } from "@frogg/branding/identity";
import { compareVersions, isStableVersion, parseVersion } from "@frogg/protocol/release-version";
import { z } from "zod";

/**
 * Finds the newest published beta release on the brand's GitHub repository.
 * Shared by the beta channel service (daemon install) and its status RPC,
 * which clients also read for the beta desktop download.
 */

const ReleaseAssetSchema = z.object({
  name: z.string(),
  browser_download_url: z.string(),
  /** GitHub's own checksum, `sha256:<hex>`. */
  digest: z.string().nullable().optional(),
});

const ReleaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  html_url: z.string().optional(),
  published_at: z.string().nullable().optional(),
  assets: z.array(ReleaseAssetSchema).default([]),
});

export type BetaReleaseAsset = z.infer<typeof ReleaseAssetSchema>;

export interface BetaRelease {
  version: string;
  tagName: string;
  htmlUrl: string | null;
  publishedAt: string | null;
  assets: BetaReleaseAsset[];
}

export interface BetaReleaseSourceOptions {
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const RELEASES_PER_PAGE = 50;
const DEFAULT_TIMEOUT_MS = 20_000;

export function resolveReleasesApi(env: NodeJS.ProcessEnv = process.env): string | null {
  return brandEnv(brand, env, "RELEASES_API") || brand.distribution.releasesApi || null;
}

export function releaseToken(env: NodeJS.ProcessEnv = process.env): string | null {
  return brandEnv(brand, env, "GITHUB_TOKEN") || null;
}

function headers(token: string | null): Record<string, string> {
  return {
    accept: "application/vnd.github+json",
    "x-github-api-version": "2022-11-28",
    "user-agent": `${brand.id}-daemon`,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** A published prerelease whose version suffix starts with a channel name. */
export function isBetaRelease(release: {
  tag_name: string;
  draft?: boolean;
  prerelease?: boolean;
}) {
  if (release.draft) return false;
  if (release.prerelease !== true) return false;
  return parseVersion(release.tag_name) !== null && !isStableVersion(release.tag_name);
}

/** Newest beta by version order (not API order), or the exact `version` when given. */
export function selectBetaRelease(releases: unknown, version?: string): BetaRelease | null {
  const parsed = z.array(ReleaseSchema).safeParse(releases);
  if (!parsed.success) throw new Error("release listing returned unexpected JSON");
  const wanted = version ? (parseVersion(version)?.raw ?? null) : null;
  if (version && !wanted) throw new Error(`not a version: ${version}`);
  let best: { parsed: NonNullable<ReturnType<typeof parseVersion>>; release: BetaRelease } | null =
    null;
  for (const release of parsed.data) {
    if (!isBetaRelease(release)) continue;
    const v = parseVersion(release.tag_name);
    if (!v) continue;
    if (wanted && v.raw !== wanted) continue;
    if (best && compareVersions(v, best.parsed) <= 0) continue;
    best = {
      parsed: v,
      release: {
        version: v.raw,
        tagName: release.tag_name,
        htmlUrl: release.html_url ?? null,
        publishedAt: release.published_at ?? null,
        assets: release.assets,
      },
    };
  }
  return best?.release ?? null;
}

export async function fetchBetaRelease(
  options: BetaReleaseSourceOptions & { version?: string } = {},
): Promise<BetaRelease | null> {
  const env = options.env ?? process.env;
  if (brand.distribution.updateMode === "disabled") {
    throw new Error(`Updates are disabled for ${brand.name}`);
  }
  const api = resolveReleasesApi(env);
  if (!api) throw new Error("No release API is configured for this build");
  const separator = api.includes("?") ? "&" : "?";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await (options.fetchImpl ?? fetch)(
      `${api}${separator}per_page=${RELEASES_PER_PAGE}`,
      { headers: headers(releaseToken(env)), signal: controller.signal },
    );
    if (!response.ok) throw new Error(`release lookup failed: HTTP ${response.status}`);
    return selectBetaRelease(await response.json(), options.version);
  } finally {
    clearTimeout(timer);
  }
}

/** Downloads a release asset (installer scripts are small). */
export async function downloadReleaseAsset(
  asset: BetaReleaseAsset,
  options: BetaReleaseSourceOptions = {},
): Promise<Buffer> {
  const env = options.env ?? process.env;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    // The token is for the repository host only, never a mirror.
    const token =
      new URL(asset.browser_download_url).hostname === "github.com" ? releaseToken(env) : null;
    const response = await (options.fetchImpl ?? fetch)(asset.browser_download_url, {
      headers: {
        "user-agent": `${brand.id}-daemon`,
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`download of ${asset.name} failed: HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
