import type { PluginManifest } from "@frogg/protocol/plugins/manifest";

/**
 * One client plugin installed on this device: a `client`-scope plugin, or the client half of a
 * `hybrid` plugin whose daemon half lives on a host.
 */
export interface ClientPluginRecord {
  id: string;
  version: string;
  /** "official" | "brand" | "user" | "dev" */
  source: string;
  /** Repo the tarball came from; null for dev links. */
  repoUrl: string | null;
  /** Absolute folder of a dev link (desktop only); null otherwise. */
  devPath: string | null;
  enabled: boolean;
  grantedCapabilities: string[];
  manifest: PluginManifest;
  /** The verified client entry module. Re-read from disk for dev links. */
  entrySource: string;
  /** Device-local `ctx.settings` values. */
  settings: Record<string, unknown>;
  installedAt: string;
}

const ID_PATTERN = /^[a-z0-9]+(\.[a-z0-9-]+)+$/;

export function isValidClientPluginId(id: string): boolean {
  return ID_PATTERN.test(id) && id.length <= 128;
}

/** Shape check for records read back from storage; anything else is dropped. */
export function isClientPluginRecord(value: unknown): value is ClientPluginRecord {
  if (typeof value !== "object" || value === null) return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.id === "string" &&
    isValidClientPluginId(r.id) &&
    typeof r.version === "string" &&
    typeof r.source === "string" &&
    typeof r.enabled === "boolean" &&
    Array.isArray(r.grantedCapabilities) &&
    typeof r.manifest === "object" &&
    r.manifest !== null &&
    typeof r.entrySource === "string" &&
    typeof r.settings === "object" &&
    r.settings !== null
  );
}
