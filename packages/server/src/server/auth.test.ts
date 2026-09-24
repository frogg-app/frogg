import { mkdtempSync, rmSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createAccessPolicy, type DaemonAccessPolicy } from "./access-policy.js";
import type { DaemonAuthConfig } from "./auth.js";
import { createClaimStore } from "./claim-store.js";
import {
  authorizeBearerAsync,
  extractHttpBearerToken,
  extractWsBearerProtocol,
  extractWsBearerToken,
  authorizeAgentMcpRequest,
  deriveAgentMcpToken,
  hashDaemonPassword,
  isBearerTokenValidAsync,
  isBearerTokenValid,
  requestNeedsBearer,
  shouldBypassBearerAuth,
  verifyAgentMcpToken,
  hasRealCredential,
  requiredRoleForHttpRoute,
  throttleKeyForAddress,
  createServiceProxyAuthorizer,
} from "./auth.js";
import { createAuthFailureLimiter } from "./auth-rate-limit.js";

const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

describe("daemon bearer validator", () => {
  test("allows any token when no password is configured", () => {
    expect(isBearerTokenValid({ password: undefined, token: null })).toBe(true);
    expect(isBearerTokenValid({ password: undefined, token: "anything" })).toBe(true);
  });

  test("accepts the plaintext token against the bcrypt hash and rejects missing or wrong tokens", async () => {
    expect(
      await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "correct-password" }),
    ).toBe(true);
    expect(isBearerTokenValid({ password: CORRECT_PASSWORD_HASH, token: "correct-password" })).toBe(
      true,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: null })).toBe(
      false,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "wrong" })).toBe(
      false,
    );
  });

  test("hashes a password with scrypt and still verifies legacy bcrypt hashes", () => {
    const hash = hashDaemonPassword("correct-password");

    expect(hash).toMatch(/^scrypt\$\d+\$\d+\$\d+\$/);
    // Salted: the same password hashes differently every time.
    expect(hashDaemonPassword("correct-password")).not.toBe(hash);
    expect(isBearerTokenValid({ password: hash, token: "correct-password" })).toBe(true);
    expect(isBearerTokenValid({ password: hash, token: "wrong" })).toBe(false);
    expect(isBearerTokenValid({ password: CORRECT_PASSWORD_HASH, token: "correct-password" })).toBe(
      true,
    );
  });

  test("extracts HTTP bearer tokens", () => {
    expect(extractHttpBearerToken("Bearer secret")).toBe("secret");
    expect(extractHttpBearerToken("Basic secret")).toBeNull();
    expect(extractHttpBearerToken(undefined)).toBeNull();
  });

  test("extracts WebSocket frogg bearer subprotocol tokens", () => {
    const protocol = extractWsBearerProtocol("chat, frogg.bearer.secret.with.dots");

    expect(protocol).toBe("frogg.bearer.secret.with.dots");
    expect(extractWsBearerToken(protocol)).toBe("secret.with.dots");
    expect(extractWsBearerToken("frogg.other.secret")).toBeNull();
  });

  test("bypasses bearer auth for preflight, liveness, and capability-token routes", () => {
    // Preflight is always bypassed regardless of path.
    expect(shouldBypassBearerAuth("OPTIONS", "/api/status")).toBe(true);
    // Unauthenticated liveness probe.
    expect(shouldBypassBearerAuth("GET", "/api/health")).toBe(true);
    // Guarded by its own single-use download token, not the daemon password.
    expect(shouldBypassBearerAuth("GET", "/api/files/download")).toBe(true);
    // Guarded by its own per-daemon-run capability token (see
    // isAgentMcpRequestAuthorized), not the daemon password.
    expect(shouldBypassBearerAuth("POST", "/mcp/agents")).toBe(true);
    // Everything else stays behind the daemon password.
    expect(shouldBypassBearerAuth("GET", "/api/status")).toBe(false);
    expect(shouldBypassBearerAuth("POST", "/api/files/upload")).toBe(false);
  });
});

describe("agent MCP request authorizer", () => {
  const CAPABILITY_TOKEN = "cap-token-abc123";
  const req = { headers: {}, socket: { remoteAddress: "127.0.0.1" } } as unknown as IncomingMessage;

  function authorize(authorizationHeader: string | undefined, auth?: DaemonAuthConfig) {
    return authorizeAgentMcpRequest({
      auth,
      req,
      capabilityToken: CAPABILITY_TOKEN,
      authorizationHeader,
    });
  }

  test("rejects an unauthenticated request even when no password is configured", async () => {
    // Regression: the endpoint used to be wide open whenever no password was
    // set, and it drives agents and terminals.
    expect(await authorize(undefined)).toEqual({ ok: false, status: 401 });
    expect(await authorize("Bearer nope")).toEqual({ ok: false, status: 401 });
  });

  test("accepts the run capability token with no caller agent", async () => {
    expect(await authorize(`Bearer ${CAPABILITY_TOKEN}`)).toEqual({
      ok: true,
      callerAgentId: null,
    });
  });

  test("takes the caller agent from a per-agent token, not the query string", async () => {
    const token = deriveAgentMcpToken(CAPABILITY_TOKEN, "agent-7");
    expect(await authorize(`Bearer ${token}`)).toEqual({ ok: true, callerAgentId: "agent-7" });
    expect(verifyAgentMcpToken(CAPABILITY_TOKEN, `${token}x`)).toBeNull();
    expect(await authorize(`Bearer ${token}x`)).toEqual({ ok: false, status: 401 });
  });

  test("accepts a valid daemon-password bearer", async () => {
    expect(await authorize("Bearer correct-password", { password: CORRECT_PASSWORD_HASH })).toEqual(
      { ok: true, callerAgentId: null },
    );
  });

  test("throttles repeated bad passwords", async () => {
    const auth: DaemonAuthConfig = {
      password: CORRECT_PASSWORD_HASH,
      limiter: createAuthFailureLimiter({ maxFailures: 3 }),
    };
    expect(await authorize("Bearer wrong", auth)).toEqual({ ok: false, status: 401 });
    expect(await authorize("Bearer wrong", auth)).toEqual({ ok: false, status: 401 });
    expect(await authorize("Bearer wrong", auth)).toEqual({ ok: false, status: 401 });
    // Blocked now, and the correct password is not even checked.
    expect(await authorize("Bearer wrong", auth)).toEqual({ ok: false, status: 429 });
    expect(await authorize("Bearer correct-password", auth)).toEqual({ ok: false, status: 429 });
  });
});

describe("bearer requirement by client locality", () => {
  interface MatrixCase {
    trustLan: boolean;
    password: string | undefined;
    client: "loopback" | "lan" | "public";
    needsBearer: boolean;
  }

  const SOCKETS: Record<MatrixCase["client"], string> = {
    loopback: "127.0.0.1",
    lan: "::ffff:192.168.1.10",
    public: "203.0.113.5",
  };

  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function policyFor(trustLan: boolean): DaemonAccessPolicy {
    const home = mkdtempSync(path.join(tmpdir(), "frogg-auth-matrix-"));
    homes.push(home);
    return createAccessPolicy({
      claimStore: createClaimStore(home),
      getTrustedProxies: () => ["loopback"],
      getTrustLan: () => trustLan,
    });
  }

  function requestFrom(address: string, forwardedFor?: string): IncomingMessage {
    return {
      headers: forwardedFor ? { "x-forwarded-for": forwardedFor } : {},
      socket: { remoteAddress: address },
    } as unknown as IncomingMessage;
  }

  const MATRIX: MatrixCase[] = [
    // trustLan on (the default): loopback and the LAN are open, the internet is not.
    { trustLan: true, password: undefined, client: "loopback", needsBearer: false },
    { trustLan: true, password: undefined, client: "lan", needsBearer: false },
    { trustLan: true, password: undefined, client: "public", needsBearer: true },
    // trustLan off: only loopback is open.
    { trustLan: false, password: undefined, client: "loopback", needsBearer: false },
    { trustLan: false, password: undefined, client: "lan", needsBearer: true },
    { trustLan: false, password: undefined, client: "public", needsBearer: true },
    // A password is the opt-in lock for everyone, whatever trustLan says.
    { trustLan: true, password: CORRECT_PASSWORD_HASH, client: "loopback", needsBearer: true },
    { trustLan: true, password: CORRECT_PASSWORD_HASH, client: "lan", needsBearer: true },
    { trustLan: true, password: CORRECT_PASSWORD_HASH, client: "public", needsBearer: true },
    { trustLan: false, password: CORRECT_PASSWORD_HASH, client: "loopback", needsBearer: true },
    { trustLan: false, password: CORRECT_PASSWORD_HASH, client: "lan", needsBearer: true },
    { trustLan: false, password: CORRECT_PASSWORD_HASH, client: "public", needsBearer: true },
  ];

  test.each(MATRIX)(
    "trustLan=$trustLan password=$password client=$client -> needsBearer=$needsBearer",
    async ({ trustLan, password, client, needsBearer }) => {
      const auth = { password, access: policyFor(trustLan) };
      const req = requestFrom(SOCKETS[client]);
      expect(requestNeedsBearer(auth, req)).toBe(needsBearer);
      const withoutToken = await authorizeBearerAsync(auth, req, null);
      expect(withoutToken.ok).toBe(!needsBearer);
      if (password) {
        expect(await authorizeBearerAsync(auth, req, "correct-password")).toEqual({
          ok: true,
          principal: { kind: "password" },
        });
        expect(await authorizeBearerAsync(auth, req, "wrong")).toEqual({
          ok: false,
          reason: "invalid_token",
        });
      } else if (needsBearer) {
        // Unclaimed and no password: nothing can authenticate yet.
        expect(withoutToken).toEqual({ ok: false, reason: "unclaimed" });
      }
    },
  );

  test("a forwarded client is classified by its forwarded address but is never loopback", () => {
    const trusting = { password: undefined, access: policyFor(true) };
    // A reverse proxy can place a client on the LAN...
    const lanBehindProxy = requestFrom("127.0.0.1", "192.168.1.10");
    expect(trusting.access.clientLocality(lanBehindProxy)).toBe("lan");
    expect(trusting.access.isLoopbackClient(lanBehindProxy)).toBe(false);
    expect(requestNeedsBearer(trusting, lanBehindProxy)).toBe(false);
    expect(
      requestNeedsBearer({ password: undefined, access: policyFor(false) }, lanBehindProxy),
    ).toBe(true);

    // ...but it can never hand a caller loopback, which is the one locality
    // that stays trusted with the LAN untrusted.
    const spoofed = requestFrom("127.0.0.1", "127.0.0.1");
    expect(trusting.access.clientLocality(spoofed)).toBe("public");
    expect(trusting.access.isLoopbackClient(spoofed)).toBe(false);
    expect(requestNeedsBearer(trusting, spoofed)).toBe(true);
  });

  test("claim mode untrusts the LAN and loopback stays open", () => {
    const home = mkdtempSync(path.join(tmpdir(), "frogg-auth-claim-"));
    homes.push(home);
    const access = createAccessPolicy({
      claimStore: createClaimStore(home),
      getTrustedProxies: () => ["loopback"],
      getTrustLan: () => true,
      getClaimMode: () => true,
    });
    expect(access.claimMode()).toBe(true);
    expect(access.trustLan()).toBe(false);
    expect(requestNeedsBearer({ password: undefined, access }, requestFrom(SOCKETS.lan))).toBe(
      true,
    );
    expect(requestNeedsBearer({ password: undefined, access }, requestFrom(SOCKETS.loopback))).toBe(
      false,
    );
  });

  test("a paired device credential identifies its device and is accepted anywhere", async () => {
    const home = mkdtempSync(path.join(tmpdir(), "frogg-auth-device-"));
    homes.push(home);
    const store = createClaimStore(home);
    const minted = store.mintPrincipal({ label: "Phone", role: "operator", pairedVia: "code" });
    const auth = {
      password: undefined,
      access: createAccessPolicy({
        claimStore: store,
        getTrustedProxies: () => ["loopback"],
        getTrustLan: () => false,
      }),
    };
    const decision = await authorizeBearerAsync(
      auth,
      requestFrom(SOCKETS.public),
      minted.credential,
    );
    expect(decision.ok).toBe(true);
    expect(decision.ok && decision.principal.kind).toBe("device");
    const device =
      decision.ok && decision.principal.kind === "device" ? decision.principal.device : null;
    expect(device?.name).toBe("Phone");
    expect(device?.role).toBe("operator");

    // Revoking the last device drops the credential, but the claim is latched:
    // the daemon stays claimed, so the stale token is just invalid.
    store.revokeDevice(minted.credentialId);
    expect(
      await authorizeBearerAsync(auth, requestFrom(SOCKETS.public), minted.credential),
    ).toEqual({ ok: false, reason: "invalid_token" });
  });
});

describe("HTTP routes are role-gated, not just the WebSocket", () => {
  const homes: string[] = [];
  afterEach(() => {
    while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
  });

  function storeWithDevice(role: "owner" | "operator" | "viewer") {
    const home = mkdtempSync(path.join(tmpdir(), "frogg-auth-http-role-"));
    homes.push(home);
    const store = createClaimStore(home);
    const minted = store.mintPrincipal({ label: "Phone", role, pairedVia: "code" });
    return {
      credential: minted.credential,
      auth: {
        password: undefined,
        access: createAccessPolicy({
          claimStore: store,
          getTrustedProxies: () => ["loopback"],
          getTrustLan: () => false,
        }),
      },
    };
  }

  test("an offer mints an owner credential, so only an owner may ask for one", async () => {
    expect(requiredRoleForHttpRoute("/api/setup/offer")).toBe("owner");
    const viewer = storeWithDevice("viewer");
    const req = { headers: {}, socket: { remoteAddress: "203.0.113.5" } } as IncomingMessage;
    expect(await hasRealCredential(viewer.auth, req, viewer.credential, "owner")).toBe(false);
    const owner = storeWithDevice("owner");
    expect(await hasRealCredential(owner.auth, req, owner.credential, "owner")).toBe(true);
  });

  test("routes default to operator, so a new route is never viewer-open by accident", () => {
    expect(requiredRoleForHttpRoute("/api/something/new")).toBe("operator");
    expect(requiredRoleForHttpRoute("/api/status")).toBe("viewer");
  });
});

describe("failed-auth throttling is keyed on the resolved client address", () => {
  test("IPv6 collapses to its /64 so address rotation does not buy more attempts", () => {
    expect(throttleKeyForAddress("2001:db8:1:2:3:4:5:6")).toBe(
      throttleKeyForAddress("2001:db8:1:2:ffff:ffff:ffff:ffff"),
    );
    expect(throttleKeyForAddress("2001:db8:1:3::1")).not.toBe(
      throttleKeyForAddress("2001:db8:1:2::1"),
    );
  });

  test("IPv4 and IPv4-mapped addresses share one key", () => {
    expect(throttleKeyForAddress("::ffff:192.168.1.5")).toBe(throttleKeyForAddress("192.168.1.5"));
  });
});

describe("the service proxy is gated for every client that is not loopback", () => {
  const homes: string[] = [];
  afterEach(() => {
    while (homes.length) rmSync(homes.pop()!, { recursive: true, force: true });
  });

  function authFor(options: { trustLan: boolean; role?: "owner" | "operator" | "viewer" }) {
    const home = mkdtempSync(path.join(tmpdir(), "frogg-service-proxy-auth-"));
    homes.push(home);
    const store = createClaimStore(home);
    const minted = options.role
      ? store.mintPrincipal({ label: "Phone", role: options.role, pairedVia: "code" })
      : null;
    return {
      credential: minted?.credential ?? null,
      auth: {
        password: undefined,
        access: createAccessPolicy({
          claimStore: store,
          getTrustedProxies: () => ["loopback"],
          getTrustLan: () => options.trustLan,
        }),
      } satisfies DaemonAuthConfig,
    };
  }

  function request(address: string, credential?: string | null): IncomingMessage {
    return {
      headers: credential ? { authorization: `Bearer ${credential}` } : {},
      socket: { remoteAddress: address },
    } as unknown as IncomingMessage;
  }

  test("loopback keeps the ambient flow it always had", async () => {
    const { auth } = authFor({ trustLan: false });
    const authorize = createServiceProxyAuthorizer(auth);
    expect(await authorize(request("127.0.0.1"))).toBe(true);
    expect(await authorize(request("::1"))).toBe(true);
  });

  test("a LAN client is rejected even though trustLan is on", async () => {
    // This is the finding: trustLan defaults on, so locality trust alone would
    // have left every workspace dev server open to the local network.
    const { auth } = authFor({ trustLan: true });
    const authorize = createServiceProxyAuthorizer(auth);
    expect(await authorize(request("192.168.1.10"))).toBe(false);
    expect(await authorize(request("203.0.113.5"))).toBe(false);
  });

  test("a LAN or public client with a real device credential is allowed", async () => {
    const { auth, credential } = authFor({ trustLan: false, role: "viewer" });
    const authorize = createServiceProxyAuthorizer(auth);
    expect(await authorize(request("192.168.1.10", credential))).toBe(true);
    expect(await authorize(request("203.0.113.5", credential))).toBe(true);
    expect(await authorize(request("203.0.113.5", "not-the-credential"))).toBe(false);
  });

  test("a forwarded loopback address does not buy loopback trust", async () => {
    const { auth } = authFor({ trustLan: false });
    const authorize = createServiceProxyAuthorizer(auth);
    const forwarded = {
      headers: { "x-forwarded-for": "127.0.0.1" },
      socket: { remoteAddress: "127.0.0.1" },
    } as unknown as IncomingMessage;
    expect(await authorize(forwarded)).toBe(false);
  });

  test("without an access policy the gate stays open, as it was before", async () => {
    const authorize = createServiceProxyAuthorizer(undefined);
    expect(await authorize(request("203.0.113.5"))).toBe(true);
  });
});
