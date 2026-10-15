// Frogg Next's identity comes from the brand (`next` in .generated/branding/brand.json): the
// prerelease "Frogg Next" variant now, the stable identity once Frogg Next replaces the classic
// app. Each key falls back to today's Frogg Next value when the brand leaves it out.
const { readFileSync } = require("node:fs");

const DEFAULT_IDENTITY = Object.freeze({
  name: "Frogg Next",
  applicationId: "app.frogg.next",
  scheme: "frogg-next",
  userDataDir: "Frogg Next",
  artifactPrefix: "Frogg-Next",
  desktopBinaryName: "frogg-next",
  feedPrefix: "frogg-next",
  /** GitHub `owner/name` whose releases carry the installers and update feeds. */
  repository: "frogg-app/frogg",
  /** The daemon a fresh install looks for: the normal `frogg` daemon on this machine. */
  defaultDaemon: "127.0.0.1:9999",
});

const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : null);

/** Resolves the Frogg Next identity from a parsed brand.json (or null for the defaults). */
function resolveIdentity(brand) {
  const next = brand && typeof brand.next === "object" && brand.next ? brand.next : {};
  const identity = { ...DEFAULT_IDENTITY };
  for (const key of Object.keys(DEFAULT_IDENTITY)) {
    const value = text(next[key]);
    if (value) identity[key] = value;
  }
  const repository = text(brand?.distribution?.repository);
  if (repository && !text(next.repository)) identity.repository = repository;
  if (Number.isInteger(brand?.daemonPort) && !text(next.defaultDaemon))
    identity.defaultDaemon = `127.0.0.1:${brand.daemonPort}`;
  return identity;
}

/** Electron-updater feed file names, one per OS family. */
function feedFileNames(identity) {
  return {
    win32: `${identity.feedPrefix}-latest.yml`,
    darwin: `${identity.feedPrefix}-latest-mac.yml`,
    linux: `${identity.feedPrefix}-latest-linux.yml`,
  };
}

/** The packaged shell reads the identity.json the build wrote beside main.cjs. */
function loadPackagedIdentity(file) {
  try {
    return resolveIdentity({ next: JSON.parse(readFileSync(file, "utf8")) });
  } catch {
    return resolveIdentity(null);
  }
}

module.exports = { DEFAULT_IDENTITY, feedFileNames, loadPackagedIdentity, resolveIdentity };
