import type { Brand } from "./schema.js";

export interface BrandIdentity {
  id: string;
  applicationId: string;
}

/** Map a branded environment namespace onto the stable internal FROGG names. */
export function normalizeBrandEnvironment(
  brand: Brand,
  env: Record<string, string | undefined>,
): void {
  const prefix = brand.envPrefix.replace(/_+$/, "");
  if (!prefix || prefix === "FROGG") return;
  const marker = `${prefix}_`;
  const branded = Object.entries(env).filter(([key]) => key.startsWith(marker));
  // Branded builds intentionally stop accepting the upstream namespace. That includes a value
  // inherited from another install on the same machine (a beta daemon started from a shell the
  // stable daemon spawned carries its FROGG_HOME): drop it first, so it can neither leak in nor
  // shadow this build's own setting.
  for (const key of Object.keys(env)) {
    if (key.startsWith("FROGG_") && !key.startsWith(marker)) delete env[key];
  }
  for (const [key, value] of branded) {
    env[`FROGG_${key.slice(marker.length)}`] = value;
  }
}
export function matchesBrand(expected: BrandIdentity, actual: unknown): boolean {
  if (actual === null || actual === undefined) return expected.id === "frogg";
  return (
    typeof actual === "object" &&
    "id" in actual &&
    "applicationId" in actual &&
    actual.id === expected.id &&
    actual.applicationId === expected.applicationId
  );
}

export function brandEnv(
  brand: Brand,
  env: Record<string, string | undefined>,
  suffix: string,
): string | undefined {
  const prefix = brand.envPrefix.replace(/_+$/, "");
  return (
    env[`${prefix}_${suffix}`]?.trim() ||
    (brand.legacyFrogg ? env[`FROGG_${suffix}`]?.trim() : undefined) ||
    undefined
  );
}

export function storageKey(brand: Brand, key: string): string {
  return `${brand.storagePrefix}${key}`;
}
