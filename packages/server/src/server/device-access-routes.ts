import express, { type RequestHandler } from "express";
import type { Logger } from "pino";

import {
  DeviceClaimRequestSchema,
  IdentityProofRequestSchema,
  PairingRequestCreateSchema,
  PasswordLoginRequestSchema,
  daemonKeyFingerprint,
  type DeviceClaimResponse,
  type DeviceRole,
} from "@frogg/protocol/device-access";
import { deriveSharedKey, encrypt, importPublicKey } from "@frogg/relay/e2ee";
import type { KeyPair } from "@frogg/relay/e2ee";

import { clientKey, verifyDaemonPassword, type DaemonAuthConfig } from "./auth.js";
import type { ClaimStore, MintedPrincipal, PairedVia } from "./claim-store.js";
import type { ClaimOfferStore } from "./claim-offer-store.js";
import type { PairingCodeStore } from "./pairing-code-store.js";
import type { PairingRequestStore } from "./pairing-request-store.js";

/**
 * The device-access HTTP surface (packages/protocol/src/device-access.ts):
 *
 * - `POST /api/identity/proof`   prove the daemon holds the key behind the
 *                                fingerprint in the pairing link
 * - `POST /api/setup/claim`      redeem an offer token, a pairing code, or
 *                                claim an unclaimed daemon in claim mode
 * - `POST /api/setup/request`    ask an owner for access, `GET …/:pollId` polls
 * - `POST /api/auth/login`       exchange the daemon password for a device
 *
 * All of them are public routes (they are how a device gets its first
 * credential), so every one of them is throttled per client address.
 */
export interface DeviceAccessDependencies {
  serverId: string;
  daemonKeyPair: KeyPair;
  daemonPublicKeyB64: string;
  claimStore: ClaimStore;
  offers: ClaimOfferStore;
  pairingCodes: PairingCodeStore;
  pairingRequests: PairingRequestStore;
  auth: DaemonAuthConfig;
  /** `daemon.auth.claimMode`. */
  claimMode: () => boolean;
  onPaired?: (input: { minted: MintedPrincipal; via: PairedVia }) => void;
  logger: Logger;
}

const DEFAULT_DEVICE_NAME = "Paired device";

function fingerprintOf(deps: DeviceAccessDependencies): string {
  return daemonKeyFingerprint(deps.daemonPublicKeyB64);
}

function claimResponse(
  deps: DeviceAccessDependencies,
  minted: MintedPrincipal,
): DeviceClaimResponse {
  return {
    serverId: deps.serverId,
    principalId: minted.principalId,
    credentialId: minted.credentialId,
    credential: minted.credential,
    role: minted.role,
    deviceName: minted.deviceName,
    fingerprint: fingerprintOf(deps),
    permissions: minted.permissions,
  };
}

function mint(
  deps: DeviceAccessDependencies,
  input: { deviceName: string; role: DeviceRole; via: PairedVia },
): DeviceClaimResponse {
  const minted = deps.claimStore.mintPrincipal({
    label: input.deviceName,
    deviceName: input.deviceName,
    role: input.role,
    pairedVia: input.via,
  });
  deps.logger.info(
    { principalId: minted.principalId, role: input.role, via: input.via },
    "Device paired",
  );
  deps.onPaired?.({ minted, via: input.via });
  return claimResponse(deps, minted);
}

/**
 * Two-way authorisation: the client sends a challenge and an ephemeral public
 * key, and gets back the daemon's public key plus the challenge sealed to the
 * shared secret. Only the holder of the daemon's secret key can produce it, so
 * a client that checked the fingerprint from the pairing link knows it is
 * talking to the daemon it was shown and not a LAN impostor.
 */
export function createIdentityProofHandler(deps: DeviceAccessDependencies): RequestHandler {
  return (req, res) => {
    const parsed = IdentityProofRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid identity proof request" });
      return;
    }
    let proofB64: string;
    try {
      const shared = deriveSharedKey(
        deps.daemonKeyPair.secretKey,
        importPublicKey(parsed.data.clientPublicKeyB64),
      );
      const challenge = Buffer.from(parsed.data.challengeB64, "base64");
      if (challenge.length === 0) throw new Error("empty challenge");
      proofB64 = Buffer.from(encrypt(shared, challenge.toString("base64"))).toString("base64");
    } catch {
      res.status(400).json({ error: "Invalid client key or challenge" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.json({
      serverId: deps.serverId,
      daemonPublicKeyB64: deps.daemonPublicKeyB64,
      fingerprint: fingerprintOf(deps),
      proofB64,
    });
  };
}

export function createDeviceClaimHandler(deps: DeviceAccessDependencies): RequestHandler {
  return (req, res) => {
    const parsed = DeviceClaimRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid claim request" });
      return;
    }
    const key = clientKey(req, deps.auth);
    if (deps.auth.limiter?.isBlocked(key)) {
      res.status(429).json({ error: "Too many failed attempts" });
      return;
    }
    const { token, pairingCode, claim } = parsed.data;
    const ways = [token, pairingCode, claim].filter((value) => value !== undefined).length;
    if (ways !== 1) {
      res.status(400).json({ error: "Send exactly one of token, pairingCode or claim" });
      return;
    }
    const deviceName = parsed.data.deviceName ?? parsed.data.label ?? DEFAULT_DEVICE_NAME;

    if (token !== undefined) {
      if (!deps.offers.consume(token)) {
        deps.auth.limiter?.recordFailure(key);
        deps.logger.warn("Rejected pairing claim with an unknown, used, or expired token");
        res.status(403).json({ error: "Invalid or expired claim token" });
        return;
      }
      deps.auth.limiter?.recordSuccess(key);
      // An offer is handed out by someone who already administers the daemon,
      // so it pairs an owner — this is also the legacy first-run claim path.
      res.status(201).json(mint(deps, { deviceName, role: "owner", via: "claim" }));
      return;
    }

    if (pairingCode !== undefined) {
      const redeemed = deps.pairingCodes.redeem(pairingCode);
      if (!redeemed) {
        deps.auth.limiter?.recordFailure(key);
        res.status(403).json({ error: "Invalid or expired pairing code" });
        return;
      }
      deps.auth.limiter?.recordSuccess(key);
      res.status(201).json(mint(deps, { deviceName, role: redeemed.role, via: "code" }));
      return;
    }

    // Claim mode: the first client to reach an unclaimed daemon becomes its
    // owner. Once claimed, this path is closed forever (short of a reset).
    if (!deps.claimMode()) {
      res.status(409).json({ error: "This daemon is not in claim mode" });
      return;
    }
    if (deps.claimStore.isClaimed()) {
      deps.auth.limiter?.recordFailure(key);
      res.status(409).json({ error: "This daemon has already been claimed" });
      return;
    }
    res.status(201).json(mint(deps, { deviceName, role: "owner", via: "claim" }));
  };
}

export function createPairingRequestCreateHandler(deps: DeviceAccessDependencies): RequestHandler {
  return (req, res) => {
    const parsed = PairingRequestCreateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid pairing request" });
      return;
    }
    const key = clientKey(req, deps.auth);
    if (deps.auth.limiter?.isBlocked(key)) {
      res.status(429).json({ error: "Too many failed attempts" });
      return;
    }
    if (!deps.claimStore.isClaimed()) {
      res.status(409).json({ error: "This daemon has not been claimed yet" });
      return;
    }
    const created = deps.pairingRequests.create({
      deviceName: parsed.data.deviceName,
      remoteAddress: req.socket?.remoteAddress ?? null,
    });
    if (!created) {
      // Bounded so an unauthenticated caller cannot flood an owner's screen.
      res.status(429).json({ error: "Too many pending pairing requests" });
      return;
    }
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({
      pollId: created.pollId,
      matchCode: created.matchCode,
      expiresAt: created.expiresAt,
    });
  };
}

export function createPairingRequestPollHandler(deps: DeviceAccessDependencies): RequestHandler {
  return (req, res) => {
    const pollId = req.params.pollId ?? "";
    const state = deps.pairingRequests.poll(pollId);
    res.setHeader("Cache-Control", "no-store");
    if (!state) {
      res.status(200).json({ status: "expired" });
      return;
    }
    if (state.status === "approved") {
      res.json({
        status: "approved",
        result: mint(deps, { deviceName: state.name, role: state.role, via: "approval" }),
      });
      return;
    }
    res.json(state);
  };
}

/**
 * Password login mints a device credential, so a client never has to hold the
 * password itself: it logs in once and keeps a revocable per-device token.
 */
export function createPasswordLoginHandler(deps: DeviceAccessDependencies): RequestHandler {
  return (req, res) => {
    void (async () => {
      const parsed = PasswordLoginRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: "Invalid login request" });
        return;
      }
      const key = clientKey(req, deps.auth);
      if (deps.auth.limiter?.isBlocked(key)) {
        res.status(429).json({ error: "Too many failed attempts" });
        return;
      }
      const password = deps.auth.password;
      if (!password) {
        res.status(409).json({ error: "This daemon has no password configured" });
        return;
      }
      if (!(await verifyDaemonPassword(parsed.data.password, password))) {
        deps.auth.limiter?.recordFailure(key);
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      deps.auth.limiter?.recordSuccess(key);
      // Knowing the password is knowing the daemon's administrative secret.
      res.status(201).json(
        mint(deps, {
          deviceName: parsed.data.deviceName ?? DEFAULT_DEVICE_NAME,
          role: "owner",
          via: "password",
        }),
      );
    })();
  };
}

export function mountDeviceAccessRoutes(
  app: express.Application,
  deps: DeviceAccessDependencies,
): void {
  const json = express.json({ limit: "8kb" });
  app.post("/api/identity/proof", json, createIdentityProofHandler(deps));
  app.post("/api/setup/request", json, createPairingRequestCreateHandler(deps));
  app.get("/api/setup/request/:pollId", createPairingRequestPollHandler(deps));
  app.post("/api/auth/login", json, createPasswordLoginHandler(deps));
}
