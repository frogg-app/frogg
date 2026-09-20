import { brand } from "@frogg/branding";
import type { ReleaseChannel } from "@/hooks/use-settings";
import type { AndroidInstallerInfo } from "@/mobile/updates/android-app-installer";

/** The published Android ABIs, plus the all-in-one build the release job can emit. */
const APK_ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86", "universal"] as const;

// Frogg-1.5.17-android-arm64-v8a.apk, ...-arm64-v8a-unsigned.apk (debug-signed),
// ...-arm64-v8a-development-unsigned.apk (the `.debug` application id).
const APK_ASSET_PATTERN = new RegExp(
  `^(?<prefix>.+)-(?<version>\\d+\\.\\d+\\.\\d+(?:-beta\\.\\d+)?)-android-(?<abi>${APK_ABIS.join("|")})(?<identity>-development)?(?<flavour>-unsigned|-debug)?\\.apk$`,
);

export interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

export interface GithubRelease {
  tag_name: string;
  body?: string | null;
  html_url?: string | null;
  draft?: boolean;
  prerelease?: boolean;
  published_at?: string | null;
  assets?: GithubReleaseAsset[];
}

export interface MobileUpdateAsset {
  name: string;
  url: string;
  size: number;
  abi: string;
  /** Signed with the Android debug key, as every published APK is for now. */
  debugSigned: boolean;
}

export interface MobileAppUpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string | null;
  latestVersion: string | null;
  notes: string | null;
  releaseUrl: string | null;
  publishedAt: string | null;
  asset: MobileUpdateAsset | null;
  /**
   * An APK for this device exists but carries a different signing key, so Android
   * would reject it over the installed app. Reported instead of "no download" so
   * the reason is visible.
   */
  signatureMismatch: boolean;
  checkedAt: number;
}

export interface ParsedApkAssetName {
  version: string;
  abi: string;
  /** The `.debug` application id built from the development variant. */
  development: boolean;
  debugSigned: boolean;
}

export function normalizeVersion(value: string | null | undefined): string | null {
  const trimmed = value?.trim().replace(/^v/i, "");
  return trimmed ? trimmed : null;
}

function versionParts(version: string): { numbers: number[]; beta: number | null } {
  const [core, beta] = version.split("-beta.");
  return {
    numbers: core.split(".").map((part) => Number.parseInt(part, 10) || 0),
    beta: beta === undefined ? null : Number.parseInt(beta, 10) || 0,
  };
}

/** Ordinary semver ordering for the versions this project publishes: 1.2.3 and 1.2.3-beta.4. */
export function compareReleaseVersions(left: string, right: string): number {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < Math.max(a.numbers.length, b.numbers.length); index++) {
    const difference = (a.numbers[index] ?? 0) - (b.numbers[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (a.beta === b.beta) return 0;
  // A release outranks its own betas.
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta > b.beta ? 1 : -1;
}

export function isNewerVersion(candidate: string | null, current: string | null): boolean {
  if (!candidate) return false;
  if (!current) return true;
  return compareReleaseVersions(candidate, current) > 0;
}

export function parseApkAssetName(name: string): ParsedApkAssetName | null {
  const groups = APK_ASSET_PATTERN.exec(name)?.groups;
  if (!groups || groups.flavour === "-debug") return null;
  if (groups.prefix !== brand.artifactPrefix) return null;
  return {
    version: groups.version,
    abi: groups.abi,
    development: groups.identity === "-development",
    debugSigned: groups.flavour === "-unsigned",
  };
}

function toUpdateAsset(asset: GithubReleaseAsset, parsed: ParsedApkAssetName): MobileUpdateAsset {
  return {
    name: asset.name,
    url: asset.browser_download_url,
    size: asset.size,
    abi: parsed.abi,
    debugSigned: parsed.debugSigned,
  };
}

/**
 * Picks the APK this device can actually install: the first device ABI with a
 * published build (the universal APK last), built for the installed application
 * id. Android only replaces an app with a package carrying the same signing key,
 * so a build whose signing flavour differs is reported separately rather than
 * offered as an install that would fail.
 */
export function selectApkAsset(
  assets: readonly GithubReleaseAsset[],
  installer: Pick<AndroidInstallerInfo, "supportedAbis" | "debugSigned" | "packageName">,
): { asset: MobileUpdateAsset | null; signatureMismatch: boolean } {
  const wantsDevelopment = installer.packageName.endsWith(".debug");
  const candidates = assets.flatMap((asset) => {
    const parsed = parseApkAssetName(asset.name);
    if (!parsed || parsed.development !== wantsDevelopment) return [];
    return [toUpdateAsset(asset, parsed)];
  });

  const abiOrder = [...installer.supportedAbis, "universal"];
  for (const abi of abiOrder) {
    const forAbi = candidates.filter((candidate) => candidate.abi === abi);
    if (forAbi.length === 0) continue;
    const matching = forAbi.find((candidate) => candidate.debugSigned === installer.debugSigned);
    if (matching) return { asset: matching, signatureMismatch: false };
    return { asset: null, signatureMismatch: true };
  }
  return { asset: null, signatureMismatch: false };
}

/** The newest published release for the channel; betas are beta-channel only. */
export function selectRelease(
  releases: readonly GithubRelease[],
  channel: ReleaseChannel,
): GithubRelease | null {
  let best: { release: GithubRelease; version: string } | null = null;
  for (const release of releases) {
    if (release.draft) continue;
    const version = normalizeVersion(release.tag_name);
    if (!version) continue;
    const isPrerelease = release.prerelease === true || version.includes("-beta.");
    if (isPrerelease && channel !== "beta") continue;
    if (!best || compareReleaseVersions(version, best.version) > 0) {
      best = { release, version };
    }
  }
  return best?.release ?? null;
}

export interface CheckMobileAppUpdateInput {
  releases: readonly GithubRelease[];
  channel: ReleaseChannel;
  currentVersion: string | null;
  installer: Pick<AndroidInstallerInfo, "supportedAbis" | "debugSigned" | "packageName">;
  checkedAt: number;
}

export function resolveMobileAppUpdate(
  input: CheckMobileAppUpdateInput,
): MobileAppUpdateCheckResult {
  const currentVersion = normalizeVersion(input.currentVersion);
  const release = selectRelease(input.releases, input.channel);
  const latestVersion = normalizeVersion(release?.tag_name ?? null);
  const hasUpdate = isNewerVersion(latestVersion, currentVersion);
  const selection = hasUpdate
    ? selectApkAsset(release?.assets ?? [], input.installer)
    : { asset: null, signatureMismatch: false };

  return {
    hasUpdate,
    currentVersion,
    latestVersion,
    notes: release?.body?.trim() || null,
    releaseUrl: release?.html_url ?? null,
    publishedAt: release?.published_at ?? null,
    asset: selection.asset,
    signatureMismatch: selection.signatureMismatch,
    checkedAt: input.checkedAt,
  };
}

/** Where the update check reads published releases from, or null for an unbranded fork. */
export const RELEASES_API_URL = brand.distribution.releasesApi;
export const RELEASES_PAGE_URL = brand.distribution.releaseBase;

export async function fetchPublishedReleases(
  fetchImpl: typeof fetch = fetch,
): Promise<GithubRelease[]> {
  if (!RELEASES_API_URL) return [];
  const response = await fetchImpl(`${RELEASES_API_URL}?per_page=20`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!response.ok) {
    throw new Error(`${response.status}`);
  }
  const payload: unknown = await response.json();
  return Array.isArray(payload) ? (payload as GithubRelease[]) : [];
}
