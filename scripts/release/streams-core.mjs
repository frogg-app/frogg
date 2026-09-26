// Version rules for the two release streams. Pure: the CLI in streams.mjs reads the versions
// from git and hands them here.
//
//   development branch  X.Y.0-beta.N  every landed change can ship as the next beta
//   stable branch       X.Y.Z         patches (backported fixes), and promotions of a beta line
//
// A beta line is always ahead of stable, so a stable patch can never overtake it and the beta
// app never sees its own version come back as a stable release.
import { formatReleaseVersion, parseReleaseVersion } from "./release-version-utils.mjs";

function core(version) {
  const parsed = parseReleaseVersion(version);
  return { major: parsed.major, minor: parsed.minor, patch: parsed.patch };
}

export function compareCore(a, b) {
  const left = core(a);
  const right = core(b);
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  return 0;
}

function maxCore(...versions) {
  return versions.filter(Boolean).reduce((best, version) =>
    !best || compareCore(version, best) > 0 ? version : best,
  );
}

/**
 * The next beta for the development branch.
 *
 * - An open line ahead of stable continues: 1.6.0-beta.3 → 1.6.0-beta.4.
 * - A fork whose upstream is ahead starts that upstream line, so fork releases carry the
 *   upstream version they ship: upstream 1.7.0 merged → 1.7.0-beta.1.
 * - Otherwise a new minor line opens above both: stable 1.6.2 → 1.7.0-beta.1. `major` opens
 *   the next major instead.
 */
export function nextBetaVersion({ developmentVersion, stableVersion, upstreamVersion, major }) {
  const development = parseReleaseVersion(developmentVersion);
  const stable = stableVersion ?? null;
  const ahead = (base) => !stable || compareCore(base, stable) > 0;
  const openLine = development.isBeta && ahead(development.baseVersion) ? development : null;
  const upstreamBase = upstreamVersion ? parseReleaseVersion(upstreamVersion).baseVersion : null;
  const upstreamLine = upstreamBase && ahead(upstreamBase) ? upstreamBase : null;

  if (major) {
    const openMajor =
      openLine &&
      openLine.minor === 0 &&
      openLine.patch === 0 &&
      (!stable || openLine.major > core(stable).major);
    if (openMajor) {
      return formatReleaseVersion({
        ...core(openLine.baseVersion),
        prerelease: `beta.${openLine.betaNumber + 1}`,
      });
    }
    const from = core(maxCore(development.baseVersion, stable, upstreamBase));
    return `${from.major + 1}.0.0-beta.1`;
  }
  if (openLine && (!upstreamLine || compareCore(openLine.baseVersion, upstreamLine) >= 0)) {
    return formatReleaseVersion({
      ...core(openLine.baseVersion),
      prerelease: `beta.${openLine.betaNumber + 1}`,
    });
  }
  if (upstreamLine) return `${upstreamLine}-beta.1`;
  const from = core(maxCore(development.baseVersion, stable));
  return formatReleaseVersion({ major: from.major, minor: from.minor + 1, patch: 0, prerelease: "beta.1" });
}

/** Promoting ships the development branch's beta line as its stable version. */
export function promotionVersion({ developmentVersion, stableVersion }) {
  const development = parseReleaseVersion(developmentVersion);
  if (!development.isBeta) {
    throw new Error(
      `The development branch is on ${developmentVersion}, not a beta. Cut one with release:beta first.`,
    );
  }
  if (stableVersion && compareCore(development.baseVersion, stableVersion) <= 0) {
    throw new Error(
      `Beta line ${development.baseVersion} is not ahead of stable ${stableVersion}; nothing to promote.`,
    );
  }
  return development.baseVersion;
}

/** A stable patch must stay below the open beta line. */
export function assertStablePatch({ nextStable, developmentVersion }) {
  const development = parseReleaseVersion(developmentVersion);
  if (development.isBeta && compareCore(nextStable, development.baseVersion) >= 0) {
    throw new Error(
      `Stable ${nextStable} would reach the beta line ${development.baseVersion}. Promote it instead.`,
    );
  }
}

/** Files every release cut rewrites. Merges resolve them by restamping the version. */
const VERSION_OWNED = [
  /^package\.json$/,
  /^(?:apps|packages)\/[^/]+\/package\.json$/,
  /^package-lock\.json$/,
  /^apps\/daemon-rs\/Cargo\.(?:toml|lock)$/,
  /^deploy\/nix\/npm-deps\.hash$/,
];

export function isVersionOwnedFile(file) {
  return VERSION_OWNED.some((pattern) => pattern.test(file));
}

/** Release cut commits carry nothing but a version; they never need propagating. */
export function isReleaseCutSubject(subject) {
  return /^chore\(release\): (?:cut|promote) /.test(subject);
}
