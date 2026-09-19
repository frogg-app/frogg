import { brand } from "@frogg/branding";
import { matchesBrand, type BrandIdentity } from "@frogg/branding/identity";
import { daemonHttpJson } from "../daemon-http.js";

/**
 * Post-restart verification: the daemon on the same listen address must
 * report the expected version on `GET /api/identity` and answer
 * `GET /api/health`. Anything else after the deadline is a failed update.
 */
export const DEFAULT_VERIFY_TIMEOUT_MS = 90_000;
const POLL_INTERVAL_MS = 1000;
/** Mirrors `IDENTITY_PRODUCT` in the server's identity route. */
const IDENTITY_PRODUCT = "frogg";

/**
 * `foreign_listener`: the listen address is answered by a daemon of another
 * product (for example the pre-rename FDE service still registered on the same
 * port). The installed bundle is not at fault, so the caller must not roll back.
 */
export type VerifyFailureKind = "unhealthy" | "foreign_listener" | "not_running";

export type VerifyResult =
  | { ok: true; elapsedMs: number }
  | { ok: false; reason: string; kind: VerifyFailureKind };

/** Consecutive foreign answers before the wait gives up instead of timing out. */
const FOREIGN_POLLS_BEFORE_FAIL = 15;

export interface VerifyDaemonOptions {
  httpBase: string;
  expectedVersion: string;
  timeoutMs?: number;
  /** Optional liveness probe; false after the grace period ends the wait early. */
  isRunning?: () => Promise<boolean>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

interface IdentityShape {
  product?: unknown;
  version?: unknown;
  brand?: BrandIdentity;
}

interface HealthShape {
  status?: unknown;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface DaemonProbeResult {
  version: string;
  healthy: boolean;
  /**
   * Set when the answering daemon belongs to another product. `version` then
   * describes that daemon, not this install.
   */
  foreign?: { product: string; brand: string };
}

export type DaemonProbe = (httpBase: string) => Promise<DaemonProbeResult>;

function describeForeign(identity: IdentityShape): DaemonProbeResult["foreign"] {
  const product = typeof identity.product === "string" ? identity.product : "";
  const brandId =
    identity.brand && typeof identity.brand === "object" && typeof identity.brand.id === "string"
      ? identity.brand.id
      : "";
  // `/api/identity` names the product ("frogg" in every brand build); the
  // pre-rename daemon says "fde". A missing product predates the field.
  const productMatches = product === "" || product === IDENTITY_PRODUCT;
  if (productMatches && matchesBrand(brand, identity.brand)) return undefined;
  return { product: product || "unknown", brand: brandId || product || "unknown" };
}

export async function probeDaemon(httpBase: string): Promise<DaemonProbeResult> {
  let gatewayVersion: string | null = null;
  const identity = await daemonHttpJson<IdentityShape>({
    base: httpBase,
    path: "/api/identity",
    onResponse(response) {
      gatewayVersion = response.headers.get("x-frogg-gateway-version");
    },
  });
  const health = await daemonHttpJson<HealthShape>({
    base: httpBase,
    path: "/api/health",
  });
  const foreign = describeForeign(identity);
  return {
    version: gatewayVersion ?? (typeof identity.version === "string" ? identity.version : ""),
    healthy: health.status === "ok" && !foreign,
    ...(foreign ? { foreign } : {}),
  };
}

export async function waitForDaemonVersion(
  options: VerifyDaemonOptions,
  probe: DaemonProbe = probeDaemon,
): Promise<VerifyResult> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const started = now();
  const deadline = started + timeoutMs;
  const gracePeriodEnd = started + Math.min(10_000, timeoutMs / 3);
  let lastReason = "daemon did not answer";
  let deadPolls = 0;
  let foreignPolls = 0;
  while (now() < deadline) {
    try {
      const result = await probe(options.httpBase);
      if (result.foreign) {
        foreignPolls += 1;
        lastReason = `${options.httpBase} is answered by another daemon (${
          result.foreign.brand
        } ${result.version || "unknown version"}), not this install; stop that service so ${
          brand.name
        } can bind the port`;
        if (foreignPolls >= FOREIGN_POLLS_BEFORE_FAIL) {
          return { ok: false, kind: "foreign_listener", reason: lastReason };
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      foreignPolls = 0;
      if (result.version === options.expectedVersion && result.healthy) {
        return { ok: true, elapsedMs: now() - started };
      }
      lastReason =
        result.version !== options.expectedVersion
          ? `daemon reports version ${result.version || "unknown"}, expected ${
              options.expectedVersion
            }`
          : "daemon health check did not report ok";
    } catch (error) {
      lastReason = error instanceof Error ? error.message : String(error);
    }
    if (options.isRunning && now() > gracePeriodEnd) {
      deadPolls = (await options.isRunning()) ? 0 : deadPolls + 1;
      if (deadPolls >= 3) {
        return {
          ok: false,
          kind: "not_running",
          reason: `daemon process is not running (${lastReason})`,
        };
      }
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return {
    ok: false,
    kind: foreignPolls > 0 ? "foreign_listener" : "unhealthy",
    reason: `timed out after ${Math.round(timeoutMs / 1000)}s: ${lastReason}`,
  };
}
