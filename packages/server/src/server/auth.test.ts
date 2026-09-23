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
    expect(decision.ok && decision.via).toBe("device");
    expect(decision.ok && decision.device?.name).toBe("Phone");
    expect(decision.ok && decision.device?.role).toBe("operator");

    // Revoking the last device drops the credential and unclaims the daemon.
    store.revokeDevice(minted.credentialId);
    expect(
      await authorizeBearerAsync(auth, requestFrom(SOCKETS.public), minted.credential),
    ).toEqual({ ok: false, reason: "unclaimed" });
  });
});
