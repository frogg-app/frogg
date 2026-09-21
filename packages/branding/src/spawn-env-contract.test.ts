import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBrandManifest } from "./schema.js";
import { brandEnv, normalizeBrandEnvironment } from "./identity.js";

/**
 * Environment variables cross process boundaries in two namespaces, and a
 * writer that picks the wrong one fails silently.
 *
 *   external  `<PREFIX>_FOO`  what a user sets, and what `brandEnv` reads
 *   internal  `FROGG_FOO`     what `normalizeBrandEnvironment` maps onto, and
 *                             what a direct `env.FROGG_FOO` reads
 *
 * Under the stock brand the two are the same string, so no stock-brand test
 * can tell a correct writer from a broken one. These cases use a brand whose
 * prefix is ACME, where the distinction is real, and pin the pairing rule that
 * every spawn site has to follow:
 *
 *   callee reads `brandEnv(...)`              -> write `<PREFIX>_FOO`
 *   callee calls normalizeBrandEnvironment    -> write `<PREFIX>_FOO`
 *   callee reads `env.FROGG_FOO` and does not
 *     normalise                               -> write `FROGG_FOO`
 */
const acme = resolveBrandManifest({
  schemaVersion: 1,
  id: "acme",
  name: "Acme Studio",
  applicationId: "com.acme.studio",
  daemonPort: 10099,
  assets: { icon: "icon.png" },
});

const frogg = resolveBrandManifest({
  schemaVersion: 1,
  id: "frogg",
  name: "Frogg",
  applicationId: "sh.frogg.app",
  daemonPort: 9999,
  assets: { icon: "icon.png" },
});

/** An already-running branded process: it normalised its own env at startup. */
function parentEnv(extra: Record<string, string | undefined> = {}) {
  const env: Record<string, string | undefined> = { ACME_HOME: "/inherited/home", ...extra };
  normalizeBrandEnvironment(acme, env);
  return env;
}

test("normalize maps the branded namespace on and keeps the branded key", () => {
  const env: Record<string, string | undefined> = { ACME_LISTEN: "0.0.0.0:6798" };
  normalizeBrandEnvironment(acme, env);
  assert.equal(env.FROGG_LISTEN, "0.0.0.0:6798");
  assert.equal(env.ACME_LISTEN, "0.0.0.0:6798");
});

test("normalize drops an inherited upstream key rather than honouring it", () => {
  const env: Record<string, string | undefined> = { FROGG_LISTEN: "0.0.0.0:6798" };
  normalizeBrandEnvironment(acme, env);
  assert.equal(env.FROGG_LISTEN, undefined);
});

test("normalize is a no-op for the stock brand, which is why mismatches hide there", () => {
  const env: Record<string, string | undefined> = { FROGG_LISTEN: "0.0.0.0:6798" };
  normalizeBrandEnvironment(frogg, env);
  assert.equal(env.FROGG_LISTEN, "0.0.0.0:6798");
});

test("spawning a normalising callee: an internal-name override is deleted before it is read", () => {
  const child = parentEnv({ FROGG_LISTEN: "0.0.0.0:6798" });
  assert.equal(child.FROGG_LISTEN, undefined);
});

test("spawning a normalising callee: a brand-prefixed override survives", () => {
  const child: Record<string, string | undefined> = {
    ACME_HOME: "/h",
    ACME_LISTEN: "0.0.0.0:6798",
  };
  normalizeBrandEnvironment(acme, child);
  assert.equal(child.FROGG_LISTEN, "0.0.0.0:6798");
});

test("spawning a brandEnv reader: an internal-name override is never found", () => {
  const child = { ...parentEnv(), FROGG_INSTALL_DIR: "/wanted" };
  assert.equal(brandEnv(acme, child, "INSTALL_DIR"), undefined);
});

test("spawning a brandEnv reader: a brand-prefixed override is found", () => {
  const child = { ...parentEnv(), ACME_INSTALL_DIR: "/wanted" };
  assert.equal(brandEnv(acme, child, "INSTALL_DIR"), "/wanted");
});

test("spawning a brandEnv reader: an internal-name override loses to the inherited value", () => {
  // The failure mode that hides longest: identical in the common case, wrong
  // the moment the caller actually means to override something.
  assert.equal(
    brandEnv(acme, { ...parentEnv(), FROGG_HOME: "/override" }, "HOME"),
    "/inherited/home",
  );
  assert.equal(brandEnv(acme, { ...parentEnv(), ACME_HOME: "/override" }, "HOME"), "/override");
});
