// Generates crypto test vectors from the TypeScript relay implementation (tweetnacl), so the
// Rust port is checked byte for byte against it. Run from the repo root:
//   node apps/client/core/tests/vectors/gen-vectors.mjs > apps/client/core/tests/vectors/relay-crypto.json
import { createRequire } from "node:module";
import { createHash } from "node:crypto";

const require = createRequire(
  new URL("../../../../../packages/relay/package.json", import.meta.url),
);
const nacl = require("tweetnacl");

const b64 = (bytes) => Buffer.from(bytes).toString("base64");
const b64url = (bytes) =>
  Buffer.from(bytes).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const seeded = (seed, n) => {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = (seed * 31 + i * 7) & 0xff;
  return out;
};

const cases = [];
for (let seed = 1; seed <= 4; seed += 1) {
  const a = nacl.box.keyPair.fromSecretKey(seeded(seed, 32));
  const b = nacl.box.keyPair.fromSecretKey(seeded(seed + 100, 32));
  const shared = nacl.box.before(b.publicKey, a.secretKey);
  const nonce = seeded(seed + 200, 24);
  const plaintexts = [
    "",
    '{"type":"session","message":{"type":"ping"}}',
    "héllo wörld ✓",
    b64(seeded(seed + 300, 97)),
  ];
  const sealed = plaintexts.map((text) => {
    const bytes = new TextEncoder().encode(text);
    const ct = nacl.box.after(bytes, nonce, shared);
    const bundle = new Uint8Array(24 + ct.length);
    bundle.set(nonce, 0);
    bundle.set(ct, 24);
    return { plaintext: text, bundleB64: b64(bundle) };
  });
  cases.push({
    aSecretB64: b64(a.secretKey),
    aPublicB64: b64(a.publicKey),
    bSecretB64: b64(b.secretKey),
    bPublicB64: b64(b.publicKey),
    sharedB64: b64(shared),
    fingerprint: `sha256:${b64url(createHash("sha256").update(a.publicKey).digest())}`,
    sealed,
  });
}

console.log(JSON.stringify({ generatedBy: "tweetnacl", cases }, null, 2));
