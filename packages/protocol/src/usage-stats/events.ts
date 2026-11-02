import { z } from "zod";

/**
 * Opt-in usage statistics: the one wire format the app and the daemon send to a brand's
 * collector (`brand.json` `services.collectorUrl` + `/v1/events`). Every event name and every
 * property is on an allowlist, and property values are slugs, booleans or small counts, so a
 * batch cannot carry a prompt, code, a file path or any other free text. A batch that fails this
 * schema is dropped, never sent. The docs page "Usage statistics" mirrors this file.
 */
export const USAGE_STATS_SCHEMA_VERSION = 1;

/** A short identifier such as a provider id or panel name: never free text. */
export const UsageSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,39}$/);
const Count = z.number().int().min(0).max(100_000);

const event = <N extends string, P extends z.ZodRawShape>(name: N, props: P) =>
  z.strictObject({
    name: z.literal(name),
    /** ISO time the event happened, truncated to the minute by the sender. */
    at: z.iso.datetime(),
    props: z.strictObject(props),
  });

export const UsageEventSchema = z.discriminatedUnion("name", [
  /** The app started. */
  event("app_opened", {}),
  /** The app was used on a given day (sent at most once per day). */
  event("app_active", {}),
  /** A main view or side panel was opened, e.g. `tasks`, `scm`, `terminals`. */
  event("panel_opened", { panel: UsageSlugSchema }),
  /** A settings page was opened, e.g. `providers`, `about`. */
  event("settings_opened", { page: UsageSlugSchema }),
  /** A new agent session was started with this provider id. */
  event("session_started", { provider: UsageSlugSchema }),
  /** A host was added, by how it connects. */
  event("host_added", { transport: z.enum(["direct", "relay", "ssh", "local", "other"]) }),
  /** A bug report was sent; whether a redacted chat was attached. */
  event("bug_report_sent", { withChat: z.boolean() }),
  /** The daemon started, and how many providers it has enabled. */
  event("daemon_started", { providers: Count }),
  /** The daemon was running on a given day (sent at most once per day). */
  event("daemon_active", { providers: Count, hosts: Count.optional() }),
]);
export type UsageEvent = z.infer<typeof UsageEventSchema>;
export type UsageEventName = UsageEvent["name"];

export const UsageStatsBatchSchema = z.strictObject({
  schema: z.literal(USAGE_STATS_SCHEMA_VERSION),
  /**
   * A random id made on this device or daemon when statistics are first turned on, so builds
   * and active installs can be counted. It is not derived from the user, machine or account,
   * and turning statistics off deletes it.
   */
  installId: z.uuid(),
  source: z.enum(["app", "daemon"]),
  /** What sent it: product name, version, OS, and for the app its platform (web, desktop, android). */
  client: z.strictObject({
    product: UsageSlugSchema,
    version: z.string().regex(/^[0-9A-Za-z.+-]{1,40}$/),
    os: z.enum(["linux", "darwin", "win32", "android", "ios", "web", "other"]),
    platform: UsageSlugSchema.optional(),
  }),
  sentAt: z.iso.datetime(),
  events: z.array(UsageEventSchema).min(1).max(200),
});
export type UsageStatsBatch = z.infer<typeof UsageStatsBatchSchema>;

/** `<collectorUrl>/v1/events`, or null when the brand has no collector. */
export function usageStatsEndpoint(collectorUrl: string | null | undefined): string | null {
  const base = collectorUrl?.trim().replace(/\/+$/, "");
  return base ? `${base}/v1/events` : null;
}

/** `<collectorUrl>/v1/bug-reports`, or null when the brand has no collector. */
export function bugReportEndpoint(collectorUrl: string | null | undefined): string | null {
  const base = collectorUrl?.trim().replace(/\/+$/, "");
  return base ? `${base}/v1/bug-reports` : null;
}

/** Event times go out at minute precision, so a batch is not a fine-grained activity trace. */
export function usageEventTime(date: Date = new Date()): string {
  const copy = new Date(date.getTime());
  copy.setUTCSeconds(0, 0);
  return copy.toISOString();
}

export function mapUsageOs(os: string): UsageStatsBatch["client"]["os"] {
  const known = ["linux", "darwin", "win32", "android", "ios", "web"] as const;
  if ((known as readonly string[]).includes(os)) return os as (typeof known)[number];
  if (os === "macos") return "darwin";
  if (os === "windows") return "win32";
  return "other";
}

/** Validates a batch before it leaves the device; returns null when anything is off-schema. */
export function checkUsageStatsBatch(batch: unknown): UsageStatsBatch | null {
  const parsed = UsageStatsBatchSchema.safeParse(batch);
  return parsed.success ? parsed.data : null;
}
