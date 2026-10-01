// ed25519 signing and sha256 hashing for plugin repositories. Keys travel as base64:
// public keys are the raw 32 bytes, private keys the raw 32-byte seed. Node's KeyObject
// needs DER, so we wrap/unwrap with the fixed SPKI/PKCS8 prefixes for Ed25519.
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";

const SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const PKCS8_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");

export interface PluginRepoKeyPair {
  publicKey: string;
  privateKey: string;
}

export class PluginKeyError extends Error {}

function decodeRaw32(b64: string, what: string): Buffer {
  const raw = Buffer.from(b64.trim(), "base64");
  if (raw.length !== 32 || raw.toString("base64") !== b64.trim()) {
    throw new PluginKeyError(`${what} must be base64 of 32 raw bytes`);
  }
  return raw;
}

export function generatePluginRepoKeyPair(): PluginRepoKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ type: "spki", format: "der" });
  const pkcs8 = privateKey.export({ type: "pkcs8", format: "der" });
  return {
    publicKey: spki.subarray(SPKI_PREFIX.length).toString("base64"),
    privateKey: pkcs8.subarray(PKCS8_PREFIX.length).toString("base64"),
  };
}

export function publicKeyFromPrivateKey(privateKeyB64: string): string {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, decodeRaw32(privateKeyB64, "private key")]),
    format: "der",
    type: "pkcs8",
  });
  const spki = createPublicKey(key).export({ type: "spki", format: "der" });
  return spki.subarray(SPKI_PREFIX.length).toString("base64");
}

/** Detached signature over `data`, base64. */
export function signPluginIndex(data: Uint8Array, privateKeyB64: string): string {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_PREFIX, decodeRaw32(privateKeyB64, "private key")]),
    format: "der",
    type: "pkcs8",
  });
  return sign(null, data, key).toString("base64");
}

/** True only when `signatureB64` is a valid ed25519 signature of `data` under `publicKeyB64`. */
export function verifyPluginIndexSignature(
  data: Uint8Array,
  signatureB64: string,
  publicKeyB64: string,
): boolean {
  try {
    const key = createPublicKey({
      key: Buffer.concat([SPKI_PREFIX, decodeRaw32(publicKeyB64, "public key")]),
      format: "der",
      type: "spki",
    });
    const signature = Buffer.from(signatureB64.trim(), "base64");
    if (signature.length !== 64) return false;
    return verify(null, data, key, signature);
  } catch {
    return false;
  }
}

export function sha256Hex(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function isValidPublicKey(b64: string): boolean {
  try {
    decodeRaw32(b64, "public key");
    return true;
  } catch {
    return false;
  }
}
