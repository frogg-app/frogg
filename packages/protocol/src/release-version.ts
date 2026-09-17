/**
 * Release-version ordering, shared by every updater in the repo (the CLI's
 * daemon self-update, the desktop app's update feed and its bundled-daemon
 * check). One implementation, because two copies of this rule is exactly how
 * it breaks again.
 *
 * The subset of semver the release tags use: `MAJOR.MINOR.PATCH` with an
 * optional `-prerelease` suffix.
 *
 * ## Downstream rebuild suffixes
 *
 * A fork may rebuild an upstream release under a tag such as `v1.3.5-acme.2`: the
 * upstream version is unchanged, and `acme.2` counts *rebuilds of it*. Formally
 * that is a semver prerelease, which would sort `1.3.5-acme.2` BELOW plain
 * `1.3.5` — exactly backwards, and the reason an `acme.1` -> `acme.2` update was
 * reported as "already up to date". A downstream rebuild is newer than the
 * release it rebuilds, so the ordering rule here is:
 *
 *   1.3.5-beta.1 < 1.3.5-beta.2 < 1.3.5 < 1.3.5-acme.1 < 1.3.5-acme.2 < 1.3.6
 *
 * The two kinds of suffix are told apart by name, not by configuration, so any
 * fork's tag works with no setup: a prerelease whose first identifier is a
 * well-known *upstream channel* name (`alpha`, `beta`, `rc`, ...) keeps
 * standard semver ordering and sorts below the release; any other suffix is
 * read as a downstream rebuild counter and sorts above it. A rebuild of a
 * prerelease (`1.3.5-beta.1.acme.1`) carries both parts and is ordered by the
 * upstream part first.
 *
 * Downstream rebuilds do not change artifact *filenames* — those keep the bare
 * upstream version — so `artifactVersion` gives the version to build asset
 * names from, while `raw` stays the full tag version the daemon reports.
 */
export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  /** The whole prerelease suffix as written, or null. Kept for display and equality. */
  prerelease: string | null;
  /** The upstream channel part of the suffix (`beta.1`), or null for a plain/downstream-only release. */
  upstreamPrerelease: string | null;
  /** The downstream rebuild part of the suffix (`acme.2`), or null when this is an upstream build. */
  downstreamBuild: string | null;
  raw: string;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Prerelease channel names that mean "before the release", as upstream semver intends. */
const UPSTREAM_CHANNELS = new Set([
  "alpha",
  "beta",
  "rc",
  "pre",
  "preview",
  "next",
  "canary",
  "dev",
  "nightly",
  "snapshot",
]);

/**
 * Splits a prerelease suffix into its upstream channel part and its downstream
 * rebuild part. The upstream part runs from the start for as long as the
 * identifiers are channel names or the numbers that follow them; the first
 * unrecognised alphanumeric identifier begins the downstream part.
 */
function splitPrerelease(prerelease: string | null): {
  upstream: string | null;
  downstream: string | null;
} {
  if (prerelease === null) return { upstream: null, downstream: null };
  const identifiers = prerelease.split(".");
  if (!UPSTREAM_CHANNELS.has(identifiers[0]?.toLowerCase() ?? "")) {
    return { upstream: null, downstream: prerelease };
  }
  let boundary = 1;
  while (boundary < identifiers.length) {
    const identifier = identifiers[boundary] ?? "";
    if (/^\d+$/.test(identifier) || UPSTREAM_CHANNELS.has(identifier.toLowerCase())) {
      boundary += 1;
      continue;
    }
    break;
  }
  const upstream = identifiers.slice(0, boundary).join(".");
  const downstream = identifiers.slice(boundary).join(".");
  return { upstream, downstream: downstream.length > 0 ? downstream : null };
}

export function parseVersion(value: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) return null;
  const prerelease = match[4] ?? null;
  const { upstream, downstream } = splitPrerelease(prerelease);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease,
    upstreamPrerelease: upstream,
    downstreamBuild: downstream,
    raw: value.trim().replace(/^v/, ""),
  };
}

/** Dot-separated identifier comparison: numbers numerically and below strings, as semver specifies. */
function compareIdentifiers(a: string, b: string): number {
  const left = a.split(".");
  const right = b.split(".");
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const l = left[i];
    const r = right[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const ln = /^\d+$/.test(l) ? Number(l) : null;
    const rn = /^\d+$/.test(r) ? Number(r) : null;
    if (ln !== null && rn !== null) {
      if (ln !== rn) return ln - rn;
    } else if (ln !== null) {
      return -1;
    } else if (rn !== null) {
      return 1;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
}

/** An upstream prerelease sorts below its release, so absent (null) wins. */
function compareUpstreamPrerelease(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return compareIdentifiers(a, b);
}

/** A downstream rebuild sorts above the build it rebuilds, so absent (null) loses. */
function compareDownstreamBuild(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  return compareIdentifiers(a, b);
}

export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  const upstream = compareUpstreamPrerelease(a.upstreamPrerelease, b.upstreamPrerelease);
  if (upstream !== 0) return upstream;
  return compareDownstreamBuild(a.downstreamBuild, b.downstreamBuild);
}

/** `compareVersions` over raw strings; unparsable strings sort last. */
export function compareVersionStrings(a: string, b: string): number {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (pa && pb) return compareVersions(pa, pb);
  if (pa) return 1;
  if (pb) return -1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  return compareVersions(a, b) > 0;
}

/**
 * The version that release *artifact filenames* carry, which omits the
 * downstream rebuild counter: `1.3.5-acme.2` ships
 * `...-1.3.5-linux-x64.tar.gz`. Upstream prereleases keep their suffix.
 */
export function artifactVersion(version: string): string {
  const parsed = parseVersion(version);
  if (!parsed) return version.trim().replace(/^v/, "");
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.upstreamPrerelease ? `${base}-${parsed.upstreamPrerelease}` : base;
}

/** True when the version is an upstream (non-prerelease) release, ignoring any downstream rebuild counter. */
export function isStableVersion(version: string): boolean {
  const parsed = parseVersion(version);
  return parsed !== null && parsed.upstreamPrerelease === null;
}

/**
 * True when two versions are the same *upstream* release, ignoring any
 * downstream rebuild counter: `1.3.5` and `1.3.5-acme.2` match, `1.3.5` and
 * `1.3.5-beta.1` do not.
 *
 * Used where an artifact and its host must come from the same upstream release
 * but may legitimately disagree on the rebuild suffix — a downstream rebuild
 * stamps its full version into the daemon bundle manifest while the app keeps
 * reporting the bare `package.json` version.
 */
export function isSameUpstreamRelease(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return a.trim() === b.trim();
  return (
    left.major === right.major &&
    left.minor === right.minor &&
    left.patch === right.patch &&
    left.upstreamPrerelease === right.upstreamPrerelease
  );
}
