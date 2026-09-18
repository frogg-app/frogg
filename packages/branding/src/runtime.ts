import { resolvedBrand } from "./generated/brand.js";
import { releaseVersion } from "./generated/release.js";
import type { Brand } from "./schema.js";

function freeze(value: object): void {
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") freeze(child);
  }
  Object.freeze(value);
}
freeze(resolvedBrand);
export const brand: Brand = resolvedBrand;
export const brandIdentity = Object.freeze({
  id: brand.id,
  name: brand.name,
  applicationId: brand.applicationId,
});

/**
 * The version of this build as published, when a downstream rebuild stamped one
 * (`1.4.1-acme.2`). Null for a build that ships the workspace version as-is, which
 * is every upstream build.
 */
export const release = Object.freeze({ version: releaseVersion });
