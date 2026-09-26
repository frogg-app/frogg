// Version rules for the two release streams. Pure: the CLI in streams.mjs reads the versions
// from git and hands them here.
//
//   development branch  X.Y.0-beta.N  every landed change can ship as the next beta
//   stable branch       X.Y.Z         patches (backported fixes), and promotions of a beta line
//
// A beta line is always ahead of stable, so a stable patch can never overtake it and the beta
// app never sees its own version come back as a stable release.
import { parseChannelVersion } from "./release-channel.mjs";
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
  return versions
    .filter(Boolean)
    .reduce((best, version) => (!best || compareCore(version, best) > 0 ? version : best));
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
  return formatReleaseVersion({
    major: from.major,
    minor: from.minor + 1,
    patch: 0,
    prerelease: "beta.1",
  });
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
  // Fork versions (1.9.0-rc.1.acme.1) keep upstream's core, so a patch cannot reach them.
  if (parseChannelVersion(developmentVersion)?.downstream) return;
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

// ---------------------------------------------------------------------------------------------
// Fork versions. A fork ships upstream's version with its own build counter after it, so its
// releases map one-to-one onto upstream's and never collide with them:
//
//   stable  1.8.0-acme.1, 1.8.0-acme.2 (a backported fix), then 1.9.0-acme.1
//   beta    1.9.0-beta.3.acme.1  a fork build of upstream's beta
//           1.9.0-rc.1.acme.2    a fork build of upstream's 1.9.0 release, before rollout
//
// The channel part comes first (see release-channel.mjs), so every beta sorts below the stable
// release it leads to, and `rc` sorts above upstream's betas of the same version.

function forkCounter(version, prefix) {
  if (!version?.startsWith(prefix)) return 0;
  const rest = version.slice(prefix.length);
  return /^\d+$/.test(rest) ? Number(rest) : 0;
}

function requireFork(parsed, label, value) {
  if (!parsed) throw new Error(`${label} ${value} is not a release version.`);
  return parsed;
}

/**
 * The next fork beta, from the upstream version its development branch last merged.
 * Continues the counter while that upstream version is unchanged.
 */
export function nextForkBetaVersion({ developmentVersion, upstreamVersion, suffix }) {
  const upstream = requireFork(parseChannelVersion(upstreamVersion), "Upstream", upstreamVersion);
  if (upstream.downstream) {
    throw new Error(
      `Upstream version ${upstreamVersion} carries a build suffix; expected upstream's own.`,
    );
  }
  const channel = upstream.upstream ?? "rc.1";
  const prefix = `${upstream.core}-${channel}.${suffix}.`;
  return `${prefix}${forkCounter(developmentVersion, prefix) + 1}`;
}

/** Promoting a fork beta ships its upstream version with the next stable build counter. */
export function forkPromotionVersion({ developmentVersion, stableVersion, suffix }) {
  const development = requireFork(
    parseChannelVersion(developmentVersion),
    "Development",
    developmentVersion,
  );
  if (!development.upstream) {
    throw new Error(
      `The development branch is on ${developmentVersion}, not a beta. Cut one with release:beta first.`,
    );
  }
  const stable = stableVersion ? parseChannelVersion(stableVersion) : null;
  if (stable && compareCoreParts(development, stable) < 0) {
    throw new Error(
      `Beta ${developmentVersion} is behind stable ${stableVersion}; nothing to promote.`,
    );
  }
  const prefix = `${development.core}-${suffix}.`;
  return `${prefix}${forkCounter(stableVersion, prefix) + 1}`;
}

/** A fork's stable patch is the next build of the same upstream version. */
export function nextForkPatchVersion({ stableVersion, suffix }) {
  const stable = requireFork(parseChannelVersion(stableVersion), "Stable", stableVersion);
  if (stable.upstream) throw new Error(`Stable is on ${stableVersion}, which is a beta.`);
  const prefix = `${stable.core}-${suffix}.`;
  return `${prefix}${forkCounter(stableVersion, prefix) + 1}`;
}

function compareCoreParts(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  return 0;
}
