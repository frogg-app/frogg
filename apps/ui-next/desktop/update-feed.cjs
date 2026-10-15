// Pure parts of the desktop updater: which release to update from, and how this install updates.
const semver = require("semver");
const { feedFileNames } = require("./identity.cjs");

/**
 * How this install takes an update. Windows (NSIS) and a Linux AppImage install in place. The Mac
 * build is ad-hoc signed, which Squirrel.Mac refuses to swap in, and a .deb belongs to the
 * system package manager, so both only offer the new installer for download.
 */
function updateMode({ platform, isPackaged, isAppImage }) {
  if (!isPackaged) return "disabled";
  if (platform === "win32") return "install";
  if (platform === "linux") return isAppImage ? "install" : "download";
  if (platform === "darwin") return "download";
  return "disabled";
}

const prerelease = (version) => semver.prerelease(version) !== null;

/**
 * The newest published release this install can move to: a prerelease build follows
 * prereleases, a stable build follows stable releases. It must carry this platform's feed, so a
 * release whose Frogg Next builds are still uploading (or failed) is skipped.
 */
function selectRelease(releases, { identity, platform, currentVersion }) {
  const feed = feedFileNames(identity)[platform];
  if (!feed) return null;
  const wantPrerelease = prerelease(currentVersion);
  let best = null;
  for (const release of releases) {
    if (!release || release.draft) continue;
    const version = semver.valid(String(release.tag_name ?? "").replace(/^v/i, ""));
    if (!version) continue;
    if ((release.prerelease === true || prerelease(version)) !== wantPrerelease) continue;
    if (!(release.assets ?? []).some((asset) => asset.name === feed)) continue;
    if (!best || semver.gt(version, best.version)) best = { release, version };
  }
  if (!best) return null;
  return {
    version: best.version,
    tag: best.release.tag_name,
    feedUrl: `https://github.com/${identity.repository}/releases/download/${best.release.tag_name}`,
    releaseUrl: best.release.html_url ?? null,
    notes: typeof best.release.body === "string" ? best.release.body.trim() || null : null,
    assets: best.release.assets ?? [],
  };
}

/** The installer a download-mode update hands the user: the Mac dmg for this arch, or the deb. */
function downloadAsset(release, { identity, platform, arch }) {
  const prefix = `${identity.artifactPrefix}-${release.version}-`;
  const suffixes = { darwin: `mac-${arch}.dmg`, linux: "linux-x86_64.deb" };
  const suffix = suffixes[platform];
  if (!suffix) return null;
  const asset = release.assets.find((a) => a.name === `${prefix}${suffix}`);
  return asset?.browser_download_url ?? null;
}

const isNewer = (candidate, current) =>
  Boolean(semver.valid(candidate) && semver.valid(current) && semver.gt(candidate, current));

module.exports = { downloadAsset, isNewer, selectRelease, updateMode };
