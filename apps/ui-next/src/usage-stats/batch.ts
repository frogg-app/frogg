import {
  USAGE_STATS_SCHEMA_VERSION,
  checkUsageStatsBatch,
  mapUsageOs,
  type UsageEvent,
  type UsageStatsBatch,
} from "@frogg/protocol/usage-stats/events";

/** Pure batch building for the app's usage statistics, kept free of React Native for tests. */
export interface AppIdentity {
  product: string;
  version: string;
  os: string;
  platform: string;
}

/** `Frogg-Next` → `frogg-next`; anything that is still not a slug falls back to `app`. */
export function productSlug(prefix: string | undefined): string {
  const slug = (prefix ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return /^[a-z0-9]/.test(slug) ? slug : "app";
}

export function buildAppBatch(
  installId: string,
  app: AppIdentity,
  events: UsageEvent[],
  now: Date = new Date(),
): UsageStatsBatch | null {
  if (events.length === 0) return null;
  return checkUsageStatsBatch({
    schema: USAGE_STATS_SCHEMA_VERSION,
    installId,
    source: "app",
    client: {
      product: app.product,
      version: app.version,
      os: mapUsageOs(app.os),
      platform: productSlug(app.platform),
    },
    sentAt: now.toISOString(),
    events: events.slice(0, 200),
  });
}

export function newInstallId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // RFC 4122 v4 from Math.random: only used where the crypto polyfill is missing.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    return (ch === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}
