import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { brandIdentity } from "@frogg/branding";
import { PackageVersionResolutionError, resolvePackageVersion } from "./package-version.js";

const SERVER_PACKAGE_NAME = "@frogg/server";

export class DaemonVersionResolutionError extends PackageVersionResolutionError {}

export function resolveDaemonVersion(moduleUrl: string = import.meta.url): string {
  const bundledVersion = resolveBundledDaemonVersion(moduleUrl);
  if (bundledVersion) return bundledVersion;

  try {
    return resolvePackageVersion({
      moduleUrl,
      packageName: SERVER_PACKAGE_NAME,
    });
  } catch (error) {
    if (error instanceof PackageVersionResolutionError) {
      throw new DaemonVersionResolutionError({
        moduleUrl,
        packageName: SERVER_PACKAGE_NAME,
      });
    }
    throw error;
  }
}

/**
 * A release bundle is stamped once in its top-level manifest. Prefer that version when the
 * manifest belongs to this product, so a downstream build such as `1.3.2-xx.1` is reported by
 * its daemon even if an internal workspace package retained the upstream version.
 */
function resolveBundledDaemonVersion(moduleUrl: string): string | null {
  let directory = path.dirname(fileURLToPath(moduleUrl));
  while (true) {
    const manifestPath = path.join(directory, "manifest.json");
    if (existsSync(manifestPath)) {
      const version = readBundleManifestVersion(manifestPath);
      if (version) return version;
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

function readBundleManifestVersion(manifestPath: string): string | null {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      version?: unknown;
      brand?: { id?: unknown; applicationId?: unknown };
    };
    if (typeof manifest.version !== "string" || manifest.version.trim().length === 0) return null;
    const manifestBrand = manifest.brand;
    if (
      !manifestBrand ||
      manifestBrand.id !== brandIdentity.id ||
      manifestBrand.applicationId !== brandIdentity.applicationId
    ) {
      return null;
    }
    return manifest.version.trim();
  } catch {
    return null;
  }
}
