// Which branch cuts which release. main cuts stable, beta cuts -beta.N of
// the next minor; the release scripts and release.yml both enforce this.
import { parseReleaseVersion } from "./release-version-utils.mjs";

export const STABLE_BRANCH = "main";
export const BETA_BRANCH = "beta";

const STABLE_MODES = new Set(["patch", "minor", "major", "promote"]);
const BETA_MODES = new Set(["beta-patch", "beta-minor", "beta-major", "beta-next"]);

export function requiredBranchForMode(mode) {
  if (STABLE_MODES.has(mode)) return STABLE_BRANCH;
  if (BETA_MODES.has(mode)) return BETA_BRANCH;
  throw new Error(`Unknown release mode "${mode}".`);
}

export function requiredBranchForVersion(version) {
  return parseReleaseVersion(version).isPrerelease ? BETA_BRANCH : STABLE_BRANCH;
}

export function assertBranchForMode(mode, branch) {
  const required = requiredBranchForMode(mode);
  if (branch !== required) {
    throw new Error(
      `${mode} releases are cut from ${required}; you are on ${branch || "(detached)"}.`,
    );
  }
}

// Compares major.minor.patch only, ignoring any prerelease suffix.
export function compareCoreVersions(a, b) {
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  return 0;
}

export function assertStableBelowBeta(nextStable, betaVersion) {
  if (!betaVersion) return;
  const beta = parseReleaseVersion(betaVersion);
  if (!beta.isPrerelease) return;
  if (compareCoreVersions(parseReleaseVersion(nextStable), beta) >= 0) {
    throw new Error(
      `Stable ${nextStable} would reach beta ${beta.baseVersion}. Ship that line with release:promote instead.`,
    );
  }
}
