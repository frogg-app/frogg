/** Pure shared naming contract: Node release tools, application code, and Rust generation. */
export const legacyArtifactCutoff = "0.2.16";

/** @param {string} version */
export function isLegacyArtifactVersion(version) {
  const parts = version.split(/[+-]/)[0].split(".").map(Number);
  const cutoff = legacyArtifactCutoff.split(".").map(Number);
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return false;
  for (let i = 0; i < 3; i++) {
    if (parts[i] !== cutoff[i]) return parts[i] < cutoff[i];
  }
  return false;
}

/** @param {import('./schema.js').Brand} brand @param {string} version @param {string} platform @param {string} arch */
export function legacyDaemonArtifactName(brand, version, platform, arch) {
  return `${brand.daemonArtifactPrefix}-${version}-${platform}-${arch}.${platform === "win" ? "zip" : "tar.gz"}`;
}

/** @param {import('./schema.js').Brand} brand @param {string} version @param {string} platform @param {string} arch */
export function daemonArtifactName(brand, version, platform, arch) {
  if (!brand.legacyFrogg || isLegacyArtifactVersion(version))
    return legacyDaemonArtifactName(brand, version, platform, arch);
  const publicPlatform = platform === "darwin" ? "mac" : platform;
  const publicArch = arch === "x64" && platform !== "win" ? "x86_64" : arch;
  return `${brand.artifactPrefix}-${version}-${publicPlatform}-${publicArch}-daemon.${platform === "win" ? "zip" : "tar.gz"}`;
}

/** @param {string} suffix */
export function legacyDesktopSuffix(suffix) {
  return suffix.replace(/^linux-x86_64\.deb/, "amd64.deb").replace(/^(win|linux|mac)-/, "");
}

/** @param {import('./schema.js').Brand} brand @param {string} version @param {string} suffix */
export function desktopArtifactName(brand, version, suffix) {
  const resolved =
    brand.legacyFrogg && isLegacyArtifactVersion(version) ? legacyDesktopSuffix(suffix) : suffix;
  return `${brand.artifactPrefix}-${version}-${resolved}`;
}

export const desktopArtifactSuffixes = [
  "win-x64-setup.zip",
  "win-x64-portable.zip",
  "linux-x86_64.AppImage",
  "linux-x86_64.deb",
  "mac-aarch64.dmg",
  "mac-x86_64.dmg",
  "mac-aarch64.app.tar.gz",
  "mac-x86_64.app.tar.gz",
];

/**
 * Frogg Next (apps/ui-next) is the client prerelease tags ship, under the brand's `next` identity
 * (`brand.next.artifactPrefix`, "Frogg-Next" for upstream frogg). Its installers and
 * electron-updater feeds (`<feedPrefix>-latest*.yml`) never share a name with the classic app's
 * (`<artifactPrefix>-*`, `electron-latest*.yml`), so neither client can pick up the other's update.
 */
export const froggNextArtifactPrefix = "Frogg-Next";
export const froggNextFeedPrefix = "frogg-next";

/** @param {string} version @param {string} suffix @param {string} [prefix] the brand's `next.artifactPrefix` */
export function froggNextArtifactName(version, suffix, prefix = froggNextArtifactPrefix) {
  return `${prefix}-${version}-${suffix}`;
}

/**
 * @param {string} name @param {unknown} [prefix] the brand's `next.artifactPrefix`; anything but a
 * string (an array index, when passed straight to `filter`) means the upstream prefix.
 */
export function isFroggNextArtifact(name, prefix) {
  return name.startsWith(`${typeof prefix === "string" ? prefix : froggNextArtifactPrefix}-`);
}

/** electron-updater feed files of Frogg Next, Windows first. @param {string} [feedPrefix] */
export function froggNextFeedNames(feedPrefix = froggNextFeedPrefix) {
  return ["", "-mac", "-linux"].map((platform) => `${feedPrefix}-latest${platform}.yml`);
}

/** The checksum list the Frogg Next release job uploads. @param {string} version @param {string} [prefix] */
export function froggNextChecksumsName(version, prefix = froggNextArtifactPrefix) {
  return froggNextArtifactName(version, "SHA256SUMS", prefix);
}
