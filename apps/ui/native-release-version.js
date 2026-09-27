const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z]+(?:\.[0-9A-Za-z]+)*))?$/;
const stableIosBuildSlot = 999;
/** Release candidates sort after every beta of the same version, so their builds do too. */
const rcIosBuildSlotBase = 500;
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
const FDROID_ABI_VERSION_CODE_SUFFIXES = {
  "armeabi-v7a": 1,
  "arm64-v8a": 2,
  x86: 3,
  x86_64: 4,
};

/**
 * The iOS build slot for a version's channel part: `beta.N` (and other early channels) take N,
 * `rc.N` takes 500 + N, and a release takes 999. A fork's build counter (`.acme.2`) does not
 * change native numbers: Android accepts an update with an equal versionCode, and the beta and
 * stable builds are separate apps with their own sequences.
 */
function iosBuildSlot(version, suffix) {
  if (!suffix) return stableIosBuildSlot;
  const [channel, number] = suffix.split(".");
  if (!UPSTREAM_CHANNELS.has(channel.toLowerCase())) return stableIosBuildSlot;
  const n = Number(number);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`Cannot derive an iOS build number without a channel number: ${version}`);
  }
  if (channel.toLowerCase() === "rc") {
    if (n > stableIosBuildSlot - rcIosBuildSlotBase - 1) {
      throw new Error(`iOS rc number must be between 1 and 498: ${version}`);
    }
    return rcIosBuildSlotBase + n;
  }
  if (n >= rcIosBuildSlotBase) {
    throw new Error(`iOS beta number must be between 1 and 499: ${version}`);
  }
  return n;
}

function getNativeReleaseVersion(version) {
  const match = versionPattern.exec(version);
  if (!match) {
    throw new Error(`Cannot derive native release version from unsupported version: ${version}`);
  }

  const [, majorText, minorText, patchText, suffix] = match;
  const major = Number(majorText);
  const minor = Number(minorText);
  const patch = Number(patchText);

  if (minor > 999 || patch > 999) {
    throw new Error(`Cannot derive collision-free native version from: ${version}`);
  }
  const buildSlot = iosBuildSlot(version, suffix);

  const versionCode = major * 1_000_000 + minor * 1_000 + patch;
  if (
    !Number.isSafeInteger(versionCode) ||
    versionCode <= 0 ||
    versionCode * 10 + 9 > 2_100_000_000
  ) {
    throw new Error(`Derived Android versionCode is out of range: ${versionCode}`);
  }

  const iosBuildNumber = versionCode * 1_000 + buildSlot;
  if (!Number.isSafeInteger(iosBuildNumber)) {
    throw new Error(`Derived iOS buildNumber is out of range: ${iosBuildNumber}`);
  }

  return {
    appVersion: `${major}.${minor}.${patch}`,
    androidVersionCode: versionCode,
    iosBuildNumber: String(iosBuildNumber),
  };
}

function getFdroidVersionCodes(version) {
  const { androidVersionCode } = getNativeReleaseVersion(version);
  return Object.entries(FDROID_ABI_VERSION_CODE_SUFFIXES).map(([abi, suffix]) => ({
    abi,
    versionCode: androidVersionCode * 10 + suffix,
  }));
}

module.exports = {
  FDROID_ABI_VERSION_CODE_SUFFIXES,
  getFdroidVersionCodes,
  getNativeReleaseVersion,
};
