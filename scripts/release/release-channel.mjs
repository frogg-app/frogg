// Which channel a version ships on, for scripts that cannot import @frogg/protocol. The rule
// matches packages/protocol/src/release-version.ts (release-channel.test.mjs checks the two agree):
// a suffix that starts with an upstream channel name (`beta.3`, `rc.1`) is a prerelease and
// ships as the beta build; any other suffix (`acme.2`) is a downstream rebuild of a release and
// ships as stable.
//
//   1.8.0-beta.3  1.8.0-beta.3.acme.1  1.8.0-rc.1.acme.1   beta
//   1.8.0         1.8.0-acme.1                              stable
//
// The channel part always comes first. `1.8.0-acme.1.beta.1` is a stable rebuild, not a beta.

export const UPSTREAM_CHANNELS = Object.freeze([
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

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;

/**
 * Splits a version into its core, its upstream channel part (`beta.3`) and its downstream
 * build part (`acme.1`). Returns null for anything that is not a release version.
 */
export function parseChannelVersion(value) {
  const match = VERSION.exec(String(value).trim());
  if (!match) return null;
  const [, major, minor, patch, suffix] = match;
  const identifiers = suffix ? suffix.split(".") : [];
  let boundary = 0;
  if (identifiers.length && UPSTREAM_CHANNELS.includes(identifiers[0].toLowerCase())) {
    boundary = 1;
    while (
      boundary < identifiers.length &&
      (/^\d+$/.test(identifiers[boundary]) ||
        UPSTREAM_CHANNELS.includes(identifiers[boundary].toLowerCase()))
    ) {
      boundary += 1;
    }
  }
  const upstream = identifiers.slice(0, boundary).join(".") || null;
  const downstream = identifiers.slice(boundary).join(".") || null;
  return {
    version: String(value).trim().replace(/^v/, ""),
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    core: `${major}.${minor}.${patch}`,
    upstream,
    downstream,
  };
}

/** "beta" when the version carries an upstream channel part, else "stable". */
export function channelOfVersion(value) {
  const parsed = parseChannelVersion(value);
  if (!parsed) throw new Error(`Not a release version: ${value}`);
  return parsed.upstream ? "beta" : "stable";
}
