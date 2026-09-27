// Pure release selection for the Developer "install the beta desktop app" action.
//
// The beta app is a separate install (own application id, name and data dir), so
// everything here resolves *beta* artifacts only: a stable release, a draft, or an
// asset without the beta artifact prefix is never selected.

import {
  artifactVersion,
  compareVersionStrings,
  isStableVersion,
  parseVersion,
} from "@frogg/protocol/release-version";

export interface BetaReleaseAsset {
  name: string;
  url: string;
  size: number | null;
}

export interface BetaRelease {
  tag: string;
  version: string;
  assets: BetaReleaseAsset[];
}

export type BetaInstallerKind = "nsis-exe" | "dmg" | "appimage";

export interface BetaInstallerAsset extends BetaReleaseAsset {
  kind: BetaInstallerKind;
}

/** Published checksum manifests, in preference order. */
export const DESKTOP_CHECKSUM_ASSET = "SHA256SUMS-desktop";
export const RELEASE_DESCRIPTOR_ASSET = "release.json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseAssets(value: unknown): BetaReleaseAsset[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const name = entry.name;
    const url = entry.browser_download_url;
    if (typeof name !== "string" || typeof url !== "string") return [];
    if (!url.startsWith("https://")) return [];
    const size = typeof entry.size === "number" && entry.size >= 0 ? entry.size : null;
    return [{ name, url, size }];
  });
}

/** Newest published (non-draft) beta release from a GitHub `/releases` response. */
export function selectLatestBetaRelease(releases: unknown): BetaRelease | null {
  if (!Array.isArray(releases)) throw new Error("Unexpected release discovery response.");
  const candidates = releases.flatMap((release: unknown): BetaRelease[] => {
    if (!isRecord(release)) return [];
    if (release.draft !== false || typeof release.tag_name !== "string") return [];
    const version = parseVersion(release.tag_name)?.raw;
    if (!version || isStableVersion(version)) return [];
    return [{ tag: release.tag_name, version, assets: parseAssets(release.assets) }];
  });
  candidates.sort((a, b) => -compareVersionStrings(a.version, b.version));
  return candidates[0] ?? null;
}

/**
 * Installer file names electron-builder publishes for this runtime, best first.
 * Mirrors `artifactName` in electron-builder.cjs plus the release renames
 * (`linux-x86_64.AppImage`). Windows on arm64 runs the x64 installer.
 */
export function betaInstallerCandidates(input: {
  artifactPrefix: string;
  version: string;
  platform: string;
  arch: string;
}): { name: string; kind: BetaInstallerKind }[] {
  const versions = [...new Set([input.version, artifactVersion(input.version)])];
  const names = (suffixes: string[], kind: BetaInstallerKind) =>
    versions.flatMap((version) =>
      suffixes.map((suffix) => ({
        name: `${input.artifactPrefix}-${version}-${suffix}`,
        kind,
      })),
    );
  switch (input.platform) {
    case "win32":
      return names(
        input.arch === "arm64" ? ["win-arm64.exe", "win-x64.exe"] : ["win-x64.exe"],
        "nsis-exe",
      );
    case "darwin":
      return names([input.arch === "arm64" ? "mac-arm64.dmg" : "mac-x64.dmg"], "dmg");
    case "linux":
      if (input.arch === "x64") {
        return names(["linux-x86_64.AppImage", "linux-x64.AppImage"], "appimage");
      }
      if (input.arch === "arm64") {
        return names(["linux-arm64.AppImage", "linux-aarch64.AppImage"], "appimage");
      }
      return [];
    default:
      return [];
  }
}

export function selectBetaInstallerAsset(input: {
  release: BetaRelease;
  artifactPrefix: string;
  platform: string;
  arch: string;
}): BetaInstallerAsset | null {
  const byName = new Map(input.release.assets.map((asset) => [asset.name, asset]));
  for (const candidate of betaInstallerCandidates({
    ...input,
    version: input.release.version,
  })) {
    const asset = byName.get(candidate.name);
    if (asset) return { ...asset, kind: candidate.kind };
  }
  return null;
}

/** `sha256sum` output: `<hex>  <name>` (binary mode `*name` accepted). */
export function parseSha256Sums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match) sums.set(match[2]!, match[1]!.toLowerCase());
  }
  return sums;
}

/** sha256 for `assetName` from a `release.json` descriptor, when it lists the file. */
export function sha256FromReleaseDescriptor(raw: unknown, assetName: string): string | null {
  const found: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isRecord(value)) return;
    if (value.url === assetName && typeof value.sha256 === "string") {
      if (/^[0-9a-fA-F]{64}$/.test(value.sha256)) found.push(value.sha256.toLowerCase());
    }
    Object.values(value).forEach(visit);
  };
  visit(raw);
  return found[0] ?? null;
}

/** Guard: never act on an asset that is not the beta sibling's artifact. */
export function assertBetaArtifact(input: {
  assetName: string;
  betaArtifactPrefix: string;
  stableArtifactPrefix: string;
}): void {
  if (input.betaArtifactPrefix === input.stableArtifactPrefix) {
    throw new Error("The beta and stable apps share an artifact prefix; refusing to install.");
  }
  if (!input.assetName.startsWith(`${input.betaArtifactPrefix}-`)) {
    throw new Error(`${input.assetName} is not a beta desktop artifact.`);
  }
}

export interface WindowsUninstallEntry {
  displayName: string;
  displayVersion: string | null;
  installLocation: string | null;
}

/** Parse `reg query ... /s` output into uninstall entries. */
export function parseWindowsUninstallEntries(output: string): WindowsUninstallEntry[] {
  const entries: WindowsUninstallEntry[] = [];
  let current: Record<string, string> | null = null;
  const flush = () => {
    if (current?.DisplayName) {
      entries.push({
        displayName: current.DisplayName,
        displayVersion: current.DisplayVersion ?? null,
        installLocation: current.InstallLocation ?? null,
      });
    }
  };
  for (const line of output.split(/\r?\n/)) {
    if (/^HKEY_/i.test(line.trim())) {
      flush();
      current = {};
      continue;
    }
    const match = /^\s+(\S+)\s+REG_\w+\s+(.*)$/.exec(line);
    if (match && current) current[match[1]!] = match[2]!.trim();
  }
  flush();
  return entries;
}
