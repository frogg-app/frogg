import { compareVersionStrings, isStableVersion } from "@frogg/protocol/release-version";

/**
 * Which published APK this install updates to. Ported from the classic app's
 * apps/ui/src/mobile/updates/mobile-updates.ts: same asset names and signing match, but the
 * artifact prefix is Frogg Next's (from the brand) and the channel follows the installed build,
 * so today's prerelease builds only ever take prereleases.
 */

const APK_ABIS = ["arm64-v8a", "armeabi-v7a", "x86_64", "x86", "universal"] as const;
const APK_ASSET = new RegExp(
  `^(?<prefix>.+)-(?<version>\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z]+(?:\\.[0-9A-Za-z]+)*)?)-android-(?<abi>${APK_ABIS.join("|")})(?<flavour>-unsigned|-debug)?\\.apk$`,
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
  assets?: GithubReleaseAsset[];
}

export interface InstallerInfo {
  /** Device ABIs, most preferred first. */
  supportedAbis: string[];
  /** The installed build carries the publicly known Android debug certificate. */
  debugSigned: boolean;
}

export interface ApkAsset {
  name: string;
  url: string;
  size: number;
}

export interface ApkUpdate {
  hasUpdate: boolean;
  latestVersion: string | null;
  releaseUrl: string | null;
  notes: string | null;
  asset: ApkAsset | null;
  /** An APK for this device exists but with the other signing key, so Android would refuse it. */
  signatureMismatch: boolean;
}

const normalize = (v: string | null | undefined) => v?.trim().replace(/^v/i, "") || null;

export function parseApkName(name: string, prefix: string) {
  const g = APK_ASSET.exec(name)?.groups;
  if (!g || g.flavour === "-debug" || g.prefix !== prefix) return null;
  return { version: g.version ?? "", abi: g.abi ?? "", debugSigned: g.flavour === "-unsigned" };
}

/** Newest non-draft release on the installed build's channel (prerelease or stable). */
export function selectRelease(
  releases: readonly GithubRelease[],
  currentVersion: string,
): GithubRelease | null {
  const wantPrerelease = !isStableVersion(currentVersion);
  let best: { release: GithubRelease; version: string } | null = null;
  for (const release of releases) {
    const version = normalize(release.tag_name);
    if (release.draft || !version) continue;
    if ((release.prerelease === true || !isStableVersion(version)) !== wantPrerelease) continue;
    if (!best || compareVersionStrings(version, best.version) > 0) best = { release, version };
  }
  return best?.release ?? null;
}

/** The first device ABI with a build signed like this install (the universal APK last). */
export function selectApk(
  assets: readonly GithubReleaseAsset[],
  prefix: string,
  installer: InstallerInfo,
): { asset: ApkAsset | null; signatureMismatch: boolean } {
  const candidates = assets.flatMap((a) => {
    const parsed = parseApkName(a.name, prefix);
    return parsed
      ? [{ asset: { name: a.name, url: a.browser_download_url, size: a.size }, ...parsed }]
      : [];
  });
  for (const abi of [...installer.supportedAbis, "universal"]) {
    const forAbi = candidates.filter((c) => c.abi === abi);
    if (!forAbi.length) continue;
    const match = forAbi.find((c) => c.debugSigned === installer.debugSigned);
    return match
      ? { asset: match.asset, signatureMismatch: false }
      : { asset: null, signatureMismatch: true };
  }
  return { asset: null, signatureMismatch: false };
}

export function resolveApkUpdate(input: {
  releases: readonly GithubRelease[];
  currentVersion: string;
  prefix: string;
  installer: InstallerInfo;
}): ApkUpdate {
  const release = selectRelease(input.releases, input.currentVersion);
  const latestVersion = normalize(release?.tag_name);
  const hasUpdate = Boolean(
    latestVersion && compareVersionStrings(latestVersion, input.currentVersion) > 0,
  );
  const picked = hasUpdate
    ? selectApk(release?.assets ?? [], input.prefix, input.installer)
    : { asset: null, signatureMismatch: false };
  return {
    hasUpdate,
    latestVersion,
    releaseUrl: release?.html_url ?? null,
    notes: release?.body?.trim() || null,
    ...picked,
  };
}
