import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BrandManifestSchema,
  resolveBrandManifest,
} from "../../../packages/branding/src/schema.js";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const outputRoot = path.join(root, ".generated/branding");
export const uiOutput = path.join(root, "apps/ui/.generated/branding");

export function resolveBrand(directory?: string) {
  const selected = path.resolve(root, directory ?? process.env.FROGG_BRAND_DIR ?? "brands/frogg");
  const manifest = BrandManifestSchema.parse(
    JSON.parse(readFileSync(path.join(selected, "brand.json"), "utf8")),
  );
  const official = realpathSync(selected) === realpathSync(path.join(root, "brands/frogg"));
  const brand = resolveBrandManifest(manifest);
  if (
    !official &&
    (brand.id === "frogg" ||
      [brand.cliName, brand.desktopBinaryName, brand.scheme].some((name) =>
        ["frogg"].includes(name),
      ) ||
      [".frogg"].includes(brand.homeDir) ||
      ["FROGG"].includes(brand.envPrefix) ||
      brand.applicationId.startsWith("app.frogg.") ||
      brand.applicationId.startsWith("sh.frogg.") ||
      ["frogg-daemon", "frogg"].includes(brand.serviceName) ||
      brand.launchdLabel.startsWith("app.frogg.") ||
      brand.launchdLabel.startsWith("sh.frogg."))
  ) {
    throw new Error(
      "Custom brands must use independent identities; Frogg/Frogg identities are reserved",
    );
  }
  const hash = createHash("sha256");
  // The fingerprint has to match across runners: the release exports the web UI
  // once and every desktop runner checks the stamp, and a Windows checkout has
  // CRLF text (core.autocrlf) and backslash paths. Hash text with LF endings,
  // leave binaries (git's test: a NUL byte) untouched, and hash POSIX paths.
  const contents = (file: string | URL): Buffer => {
    const data = readFileSync(file);
    return data.includes(0)
      ? data
      : Buffer.from(data.toString("latin1").replaceAll("\r\n", "\n"), "latin1");
  };
  hash.update("frogg-brand-generator-v1\0");
  hash.update(JSON.stringify({ ...manifest, assets: Object.keys(manifest.assets).sort() }));
  const assetFiles: Record<string, string> = {};
  for (const [key, value] of Object.entries(manifest.assets)) {
    const file = path.resolve(selected, value);
    assetFiles[key] = file;
    hash.update(key).update(contents(file));
  }
  for (const file of readdirSync(path.dirname(fileURLToPath(import.meta.url)))
    .filter((name) => name.endsWith(".mts"))
    .sort()) {
    hash.update(contents(new URL(file, import.meta.url)));
  }
  function hashTree(treeDirectory: string): void {
    for (const entry of readdirSync(path.join(root, treeDirectory), { withFileTypes: true }).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      if (entry.name === "generated") continue;
      const file = path.posix.join(treeDirectory, entry.name);
      hash.update(file);
      if (entry.isDirectory()) hashTree(file);
      else if (entry.isFile()) hash.update(contents(path.join(root, file)));
    }
  }
  hashTree("packages/branding/src");
  hashTree("packages/branding/templates");
  const version: string = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")).version;
  hash.update(version);
  for (const file of [
    "install.sh",
    "uninstall.sh",
    "install-docker.sh",
    "uninstall-docker.sh",
    "probe.sh.in",
  ])
    hash.update(contents(path.join(root, "deploy", file)));
  if (official) {
    for (const assetDirectory of ["apps/ui/assets/images", "apps/ui/public"]) {
      for (const file of readdirSync(path.join(root, assetDirectory), { withFileTypes: true })
        .filter((entry) => entry.isFile())
        .sort((a, b) => a.name.localeCompare(b.name))) {
        hash.update(contents(path.join(root, assetDirectory, file.name)));
      }
    }
  }
  return { brand, manifest, assetFiles, selected, version, fingerprint: hash.digest("hex") };
}
export type BrandBuild = ReturnType<typeof resolveBrand>;
