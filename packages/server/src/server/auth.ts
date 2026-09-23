import { compare, compareSync } from "bcryptjs";
import {
  createHash,
  createHmac,
  randomBytes,
  scrypt,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import net from "node:net";
import type { IncomingMessage } from "node:http";
import type { RequestHandler } from "express";

import type { DeviceRole } from "@frogg/protocol/device-access";
import { defaultRoleForTransport, roleSatisfies } from "./authorization/roles.js";
import { DEFAULT_TRUST_LAN, isAuthRequired, type DaemonAccessPolicy } from "./access-policy.js";
import { hashCredential, type DeviceRecord } from "./claim-store.js";
import type { AuthFailureLimiter } from "./auth-rate-limit.js";

/** Kept for bcrypt hashes written by older daemons; new hashes use scrypt. */
export const DAEMON_PASSWORD_BCRYPT_COST = 12;
export const DAEMON_PASSWORD_MIN_LENGTH = 8;

export interface DaemonAuthConfig {
  /** bcrypt (legacy) or `scrypt$…` hash. */
  password?: string;
  /**
   * Paired-device credentials and client locality (loopback / trusted LAN /
   * public), attached by bootstrap. Without it only the password gates access
   * (the pre-pairing behavior).
   */
  access?: DaemonAccessPolicy;
  /** Failed-attempt throttling, keyed by client address. */
  limiter?: AuthFailureLimiter;
}

export interface BearerAuthRejectContext {
  path: string;
  method: string;
  hasToken: boolean;
}

interface BearerValidationInput {
  password: string | undefined;
  credentialHashes?: readonly string[];
  token: string | null;
}

// ---------------------------------------------------------------------------
// Password hashing: scrypt (N=2^15, r=8, p=1), `scrypt$<N>$<r>$<p>$<salt>$<hash>`.

const SCRYPT_N = 1 << 15;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEYLEN = 32;
const SCRYPT_MAXMEM = 64 * 1024 * 1024;
const SCRYPT_HASH_PATTERN = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9_-]+)\$([A-Za-z0-9_-]+)$/;
export const DAEMON_PASSWORD_HASH_PATTERN =
  /^(\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}|scrypt\$\d+\$\d+\$\d+\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+)$/;

export function hashDaemonPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function isLegacyPasswordHash(hash: string): boolean {
  return hash.startsWith("$2");
}

function parseScrypt(hash: string) {
  const match = SCRYPT_HASH_PATTERN.exec(hash);
  if (!match) return null;
  return {
    N: Number(match[1]),
    r: Number(match[2]),
    p: Number(match[3]),
    salt: Buffer.from(match[4]!, "base64url"),
    expected: Buffer.from(match[5]!, "base64url"),
  };
}

// Successful verifications are memoized per (hash, token digest) so the
// synchronous WebSocket upgrade path does not pay a KDF on every reconnect.
const verifiedPasswords = new Map<string, true>();
const VERIFIED_CACHE_LIMIT = 64;

function verifiedKey(hash: string, token: string): string {
  return `${hash}\u0000${createHash("sha256").update(token).digest("hex")}`;
}

function rememberVerified(key: string): void {
  verifiedPasswords.set(key, true);
  while (verifiedPasswords.size > VERIFIED_CACHE_LIMIT) {
    const first = verifiedPasswords.keys().next().value;
    if (first === undefined) break;
    verifiedPasswords.delete(first);
  }
}

export function verifyDaemonPasswordSync(token: string, hash: string): boolean {
  const key = verifiedKey(hash, token);
  if (verifiedPasswords.has(key)) return true;
  let ok = false;
  if (isLegacyPasswordHash(hash)) {
    ok = compareSync(token, hash);
  } else {
    const parsed = parseScrypt(hash);
    if (parsed) {
      const actual = scryptSync(token, parsed.salt, parsed.expected.length, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        maxmem: SCRYPT_MAXMEM,
      });
      ok = actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
    }
  }
  if (ok) rememberVerified(key);
  return ok;
}

export async function verifyDaemonPassword(token: string, hash: string): Promise<boolean> {
  const key = verifiedKey(hash, token);
  if (verifiedPasswords.has(key)) return true;
  let ok = false;
  if (isLegacyPasswordHash(hash)) {
    ok = await compare(token, hash);
  } else {
    const parsed = parseScrypt(hash);
    if (parsed) {
      const actual = await new Promise<Buffer>((resolve, reject) => {
        scrypt(
          token,
          parsed.salt,
          parsed.expected.length,
          { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: SCRYPT_MAXMEM },
          (error, derived) => {
            if (error) reject(error);
            else resolve(derived);
          },
        );
      });
      ok = actual.length === parsed.expected.length && timingSafeEqual(actual, parsed.expected);
    }
  }
  if (ok) rememberVerified(key);
  return ok;
}

// ---------------------------------------------------------------------------
// Bearer validation

function matchesCredential(token: string, credentialHashes: readonly string[]): boolean {
  const provided = Buffer.from(hashCredential(token), "hex");
  let matched = false;
  for (const hash of credentialHashes) {
    const expected = Buffer.from(hash, "hex");
    if (expected.length === provided.length && timingSafeEqual(provided, expected)) {
      matched = true;
    }
  }
  return matched;
}

export function isBearerTokenValid(input: BearerValidationInput): boolean {
  return isBearerTokenValidSync(input);
}

export async function isBearerTokenValidAsync(input: BearerValidationInput): Promise<boolean> {
  const hashes = input.credentialHashes ?? [];
  if (!input.password && hashes.length === 0) return true;
  if (input.token === null) return false;
  if (hashes.length > 0 && matchesCredential(input.token, hashes)) return true;
  return input.password ? verifyDaemonPassword(input.token, input.password) : false;
}

export function isBearerTokenValidSync(input: BearerValidationInput): boolean {
  const hashes = input.credentialHashes ?? [];
  if (!input.password && hashes.length === 0) return true;
  if (input.token === null) return false;
  if (hashes.length > 0 && matchesCredential(input.token, hashes)) return true;
  return input.password ? verifyDaemonPasswordSync(input.token, input.password) : false;
}

export function extractHttpBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const [scheme, ...tokenParts] = value.trim().split(/\s+/);
  if (scheme !== "Bearer" || tokenParts.length !== 1) return null;
  return tokenParts[0] ?? null;
}

export function extractWsBearerProtocol(value: string | undefined): string | null {
  if (!value) return null;
  for (const protocol of value.split(",")) {
    const trimmed = protocol.trim();
    const segments = trimmed.split(".");
    if (segments[0] === "frogg" && segments[1] === "bearer" && segments.length >= 3) {
      return trimmed;
    }
  }
  return null;
}

export function extractWsBearerToken(protocol: string | null): string | null {
  if (!protocol) return null;
  const segments = protocol.split(".");
  if (segments[0] !== "frogg" || segments[1] !== "bearer" || segments.length < 3) return null;
  return segments.slice(2).join(".");
}

/**
 * Who the daemon decided is talking to it. A paired device carries its own
 * credential, permissions and role; the daemon password and bearer-free trusted
 * clients (loopback, trusted LAN) have no device record and act as the owner.
 */
export type BearerPrincipal =
  | { kind: "device"; device: DeviceRecord }
  | { kind: "password" }
  | { kind: "trusted" };

/** How a connection authenticated. A paired device is always identified as one. */
export type BearerDecision =
  | { ok: true; principal: BearerPrincipal }
  | { ok: false; reason: "unclaimed" | "missing_token" | "invalid_token" | "rate_limited" };

type RequestLike = Pick<IncomingMessage, "headers" | "socket">;

/** Does this request need a bearer at all? (see access-policy.ts) */
export function requestNeedsBearer(auth: DaemonAuthConfig | undefined, req: RequestLike): boolean {
  return isAuthRequired({
    password: auth?.password,
    claimed: auth?.access?.isClaimed() ?? false,
    client: auth?.access ? auth.access.clientLocality(req) : "loopback",
    trustLan: auth?.access?.trustLan() ?? DEFAULT_TRUST_LAN,
  });
}

/**
 * The throttle key for a request. Keyed on the address the locality walk
 * resolves (so a reverse proxy throttles its real clients, not itself) and
 * collapsed to a /64 for IPv6, because a single host is routinely handed one
 * and could otherwise rotate addresses for unlimited attempts.
 */
export function clientKey(req: RequestLike, auth?: DaemonAuthConfig): string {
  const resolved = auth?.access?.clientAddress(req) ?? req.socket?.remoteAddress;
  return throttleKeyForAddress(resolved);
}

export function throttleKeyForAddress(address: string | undefined): string {
  if (!address) return "local";
  const normalized = address.trim().toLowerCase();
  const ipv4 = normalized.startsWith("::ffff:") ? normalized.slice("::ffff:".length) : normalized;
  if (net.isIPv4(ipv4)) return ipv4;
  if (!net.isIPv6(normalized)) return normalized;
  // Expand enough to take the routing prefix, whatever the compression.
  const groups = expandIpv6(normalized).slice(0, 4);
  return `${groups.join(":")}::/64`;
}

function expandIpv6(address: string): string[] {
  const [head = "", tail = ""] = address.split("::", 2);
  const left = head ? head.split(":") : [];
  const right = address.includes("::") && tail ? tail.split(":") : [];
  const missing = Math.max(0, 8 - left.length - right.length);
  const groups = address.includes("::")
    ? [...left, ...Array.from({ length: missing }, () => "0"), ...right]
    : address.split(":");
  return groups.map((group) => group.replace(/^0+(?=.)/u, "") || "0");
}

function resolveDevice(auth: DaemonAuthConfig | undefined, token: string): DeviceRecord | null {
  const device = auth?.access?.findDevice(token) ?? null;
  if (device) auth?.access?.touchDevice(device.id);
  return device;
}

/**
 * Everything but the password check. Returns a final decision, or the key to
 * throttle under when the token must still be checked against the password.
 */
function preDecide(
  auth: DaemonAuthConfig | undefined,
  req: RequestLike,
  token: string | null,
): BearerDecision | { key: string; token: string; password: string } {
  // A presented device credential always identifies the device, even where no
  // bearer is required, so presence and revocation see who it is.
  if (token !== null) {
    const device = resolveDevice(auth, token);
    if (device) return { ok: true, principal: { kind: "device", device } };
  }
  if (!requestNeedsBearer(auth, req)) return { ok: true, principal: { kind: "trusted" } };
  const key = clientKey(req, auth);
  if (auth?.limiter?.isBlocked(key)) return { ok: false, reason: "rate_limited" };
  const hasSecrets = Boolean(auth?.password) || (auth?.access?.isClaimed() ?? false);
  if (!hasSecrets) return { ok: false, reason: "unclaimed" };
  if (token === null) return { ok: false, reason: "missing_token" };
  if (!auth?.password) {
    auth?.limiter?.recordFailure(key);
    return { ok: false, reason: "invalid_token" };
  }
  return { key, token, password: auth.password };
}

function finishPassword(
  auth: DaemonAuthConfig | undefined,
  key: string,
  ok: boolean,
): BearerDecision {
  if (ok) {
    auth?.limiter?.recordSuccess(key);
    return { ok: true, principal: { kind: "password" } };
  }
  auth?.limiter?.recordFailure(key);
  return { ok: false, reason: "invalid_token" };
}

/**
 * Authorizes a credential that arrived inside a tunnel (relay), where the
 * daemon sees no HTTP headers and no real client address. There is no locality
 * to trust here: a tunnelled client is always remote, so it needs a paired
 * device credential or the daemon password, exactly like any other remote
 * client. An unclaimed, passwordless daemon has nothing to check against and
 * is reported as `unclaimed` so the client is told to pair first.
 */
export async function authorizeTunnelledCredential(
  auth: DaemonAuthConfig | undefined,
  token: string | null,
  clientKeyOverride = "relay",
): Promise<BearerDecision> {
  if (token !== null) {
    const device = resolveDevice(auth, token);
    if (device) return { ok: true, principal: { kind: "device", device } };
  }
  if (auth?.limiter?.isBlocked(clientKeyOverride)) return { ok: false, reason: "rate_limited" };
  const hasSecrets = Boolean(auth?.password) || (auth?.access?.isClaimed() ?? false);
  if (!hasSecrets) return { ok: false, reason: "unclaimed" };
  if (token === null) return { ok: false, reason: "missing_token" };
  if (!auth?.password) {
    auth?.limiter?.recordFailure(clientKeyOverride);
    return { ok: false, reason: "invalid_token" };
  }
  return finishPassword(auth, clientKeyOverride, await verifyDaemonPassword(token, auth.password));
}

export function authorizeBearerSync(
  auth: DaemonAuthConfig | undefined,
  req: RequestLike,
  token: string | null,
): BearerDecision {
  const pre = preDecide(auth, req, token);
  if ("ok" in pre) return pre;
  return finishPassword(auth, pre.key, verifyDaemonPasswordSync(pre.token, pre.password));
}

export async function authorizeBearerAsync(
  auth: DaemonAuthConfig | undefined,
  req: RequestLike,
  token: string | null,
): Promise<BearerDecision> {
  const pre = preDecide(auth, req, token);
  if ("ok" in pre) return pre;
  return finishPassword(auth, pre.key, await verifyDaemonPassword(pre.token, pre.password));
}

/**
 * True for a request that carries a real credential (device or password), not
 * locality trust, *and* whose credential is at least `minimumRole`. The role
 * check matters because some HTTP routes mint credentials: without it a viewer
 * device could promote itself by asking for an owner offer.
 */
export async function hasRealCredential(
  auth: DaemonAuthConfig | undefined,
  req: RequestLike,
  token: string | null,
  minimumRole: DeviceRole = "owner",
): Promise<boolean> {
  if (token === null) return false;
  const device = resolveDevice(auth, token);
  if (device) return roleSatisfies(device.role, minimumRole);
  const key = clientKey(req, auth);
  if (!auth?.password || auth.limiter?.isBlocked(key)) return false;
  const ok = await verifyDaemonPassword(token, auth.password);
  if (ok) auth.limiter?.recordSuccess(key);
  else auth.limiter?.recordFailure(key);
  return ok;
}

/**
 * Required device role per authenticated HTTP route, mirroring the inbound RPC
 * role map. Roles were a WebSocket-only control until this existed, which left
 * every HTTP route role-blind. Anything not listed here needs at least an
 * operator: a route that reads or changes daemon state is never a viewer's.
 */
const HTTP_ROUTE_ROLE: Record<string, DeviceRole> = {
  "/api/status": "viewer",
  "/api/files/download": "viewer",
  // Mints an owner credential, so only an owner may ask for one.
  "/api/setup/offer": "owner",
};

export const DEFAULT_HTTP_ROUTE_ROLE: DeviceRole = "operator";

export function requiredRoleForHttpRoute(path: string): DeviceRole {
  return HTTP_ROUTE_ROLE[path] ?? DEFAULT_HTTP_ROUTE_ROLE;
}

/** The role a decided principal carries; a non-device principal is the owner. */
export function roleForPrincipal(principal: BearerPrincipal): DeviceRole {
  return principal.kind === "device" ? principal.device.role : "owner";
}

export function createRequireBearerMiddleware(
  auth: DaemonAuthConfig | undefined,
  onReject?: (context: BearerAuthRejectContext) => void,
): RequestHandler {
  return (req, res, next) => {
    if (shouldBypassBearerAuth(req.method, req.path)) {
      next();
      return;
    }

    void (async () => {
      try {
        const token = extractHttpBearerToken(req.header("authorization"));
        const decision = await authorizeBearerAsync(auth, req, token);
        if (!decision.ok) {
          onReject?.({ path: req.path, method: req.method, hasToken: token !== null });
          if (decision.reason === "rate_limited") {
            res.status(429).json({ error: "Too many failed attempts" });
            return;
          }
          res.status(401).json({
            error: "Unauthorized",
            ...(decision.reason === "unclaimed" ? { setup: "unclaimed" } : {}),
          });
          return;
        }
        const required = requiredRoleForHttpRoute(req.path);
        if (!roleSatisfies(roleForPrincipal(decision.principal), required)) {
          onReject?.({ path: req.path, method: req.method, hasToken: token !== null });
          res.status(403).json({ error: "Forbidden" });
          return;
        }
        next();
      } catch (error) {
        next(error);
      }
    })();
  };
}

const SELF_AUTHENTICATING_ROUTES = new Set(["/api/files/download", "/mcp/agents"]);
const PUBLIC_ROUTES = new Set([
  "/api/health",
  "/api/identity",
  "/api/identity/proof",
  "/api/setup/status",
  "/api/setup/claim",
  "/api/setup/request",
  "/api/auth/login",
]);

function isBearerFreeRoute(path: string): boolean {
  if (path.startsWith("/api/setup/request/")) return true;
  return PUBLIC_ROUTES.has(path) || SELF_AUTHENTICATING_ROUTES.has(path);
}

export function shouldBypassBearerAuth(method: string, path: string): boolean {
  if (method === "OPTIONS") return true;
  return isBearerFreeRoute(path);
}

// ---------------------------------------------------------------------------
// Agent MCP endpoint

const AGENT_MCP_TOKEN_PREFIX = "fam1";

/**
 * Per-agent MCP bearer: `fam1.<agentId base64url>.<HMAC-SHA256(secret, agentId)>`.
 * The endpoint takes the caller identity from the token, never from the URL.
 */
export function deriveAgentMcpToken(secret: string, agentId: string): string {
  const id = Buffer.from(agentId, "utf8").toString("base64url");
  const mac = createHmac("sha256", secret).update(agentId, "utf8").digest("base64url");
  return `${AGENT_MCP_TOKEN_PREFIX}.${id}.${mac}`;
}

export function verifyAgentMcpToken(secret: string, token: string): string | null {
  const [prefix, id, mac, ...rest] = token.split(".");
  if (prefix !== AGENT_MCP_TOKEN_PREFIX || !id || !mac || rest.length > 0) return null;
  const agentId = Buffer.from(id, "base64url").toString("utf8");
  const expected = Buffer.from(deriveAgentMcpToken(secret, agentId).split(".")[2]!);
  const provided = Buffer.from(mac);
  return expected.length === provided.length && timingSafeEqual(expected, provided)
    ? agentId
    : null;
}

export type AgentMcpAuthorization =
  | { ok: true; callerAgentId: string | null }
  | { ok: false; status: 401 | 403 | 429 };

/** The role the `mcp` transport is admitted at; a lower-ranked device is refused. */
const MCP_MINIMUM_ROLE: DeviceRole = defaultRoleForTransport("mcp");

/**
 * Authorizes a request to /mcp/agents (exempt from the global bearer
 * middleware). Accepted: a per-agent token (caller = that agent), the
 * per-run capability token (no caller agent), a paired-device credential with
 * role operator or owner, or the daemon password. Nothing else, whatever the
 * client's locality: the endpoint drives agents and terminals.
 */
export async function authorizeAgentMcpRequest(input: {
  auth: DaemonAuthConfig | undefined;
  req: RequestLike;
  capabilityToken: string | null;
  authorizationHeader: string | undefined;
}): Promise<AgentMcpAuthorization> {
  const token = extractHttpBearerToken(input.authorizationHeader);
  if (token === null) return { ok: false, status: 401 };
  if (input.capabilityToken) {
    const agentId = verifyAgentMcpToken(input.capabilityToken, token);
    if (agentId) return { ok: true, callerAgentId: agentId };
    const provided = Buffer.from(token);
    const expected = Buffer.from(input.capabilityToken);
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) {
      return { ok: true, callerAgentId: null };
    }
  }
  const device = resolveDevice(input.auth, token);
  if (device) {
    return roleSatisfies(device.role, MCP_MINIMUM_ROLE)
      ? { ok: true, callerAgentId: null }
      : { ok: false, status: 403 };
  }
  const key = clientKey(input.req, input.auth);
  if (input.auth?.limiter?.isBlocked(key)) return { ok: false, status: 429 };
  if (input.auth?.password && (await verifyDaemonPassword(token, input.auth.password))) {
    input.auth.limiter?.recordSuccess(key);
    return { ok: true, callerAgentId: null };
  }
  input.auth?.limiter?.recordFailure(key);
  return { ok: false, status: 401 };
}

/** @deprecated kept for callers outside bootstrap; see authorizeAgentMcpRequest. */
export async function isAgentMcpRequestAuthorized(input: {
  password: string | undefined;
  capabilityToken: string | null;
  authorizationHeader: string | undefined;
}): Promise<boolean> {
  const result = await authorizeAgentMcpRequest({
    auth: input.password ? { password: input.password } : undefined,
    req: { headers: {}, socket: {} as IncomingMessage["socket"] },
    capabilityToken: input.capabilityToken,
    authorizationHeader: input.authorizationHeader,
  });
  return result.ok;
}
