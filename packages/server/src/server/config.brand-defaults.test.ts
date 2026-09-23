import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

// A locked-down brand: `daemon.bind` defaults to loopback and claim mode
// defaults on for any brand that is not upstream `frogg`. Under the stock
// brand both defaults are the permissive ones, so only a second brand can
// show that the manifest actually decides them.
vi.mock("@frogg/branding", async () => {
  const { resolveBrandManifest } = await import("@frogg/branding/schema");
  return {
    brand: resolveBrandManifest({
      schemaVersion: 1,
      id: "acme",
      name: "Acme Studio",
      applicationId: "com.acme.studio",
      daemonPort: 10099,
      assets: { icon: "icon.png" },
    }),
  };
});

const { loadConfig } = await import("./config.js");

const roots: string[] = [];

async function freshHome(): Promise<string> {
  const home = await mkdtemp(path.join(os.tmpdir(), "acme-brand-defaults-"));
  roots.push(home);
  return home;
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("a loopback brand binds loopback on a fresh install", async () => {
  const home = await freshHome();
  expect(loadConfig(home, { env: {} }).listen).toBe("127.0.0.1:10099");
});

test("initializing config.json leaves daemon.listen unset", async () => {
  const home = await freshHome();
  loadConfig(home, { env: {} });
  const written = JSON.parse(await readFile(path.join(home, "config.json"), "utf-8"));
  expect(written.daemon).not.toHaveProperty("listen");
});

test("an owner's daemon.listen beats the brand default", async () => {
  const home = await freshHome();
  await writeFile(
    path.join(home, "config.json"),
    JSON.stringify({ daemon: { listen: "0.0.0.0:10099" } }),
  );
  expect(loadConfig(home, { env: {} }).listen).toBe("0.0.0.0:10099");
});

test("the brand's own LISTEN env names the address", async () => {
  const home = await freshHome();
  expect(loadConfig(home, { env: { ACME_LISTEN: "0.0.0.0:7001" } }).listen).toBe("0.0.0.0:7001");
  expect(loadConfig(home, { env: { FROGG_LISTEN: "0.0.0.0:7001" } }).listen).toBe(
    "127.0.0.1:10099",
  );
});

test("PORT changes the port without widening the brand's bind host", async () => {
  const home = await freshHome();
  expect(loadConfig(home, { env: { PORT: "8123" } }).listen).toBe("127.0.0.1:8123");
});

test("claim mode defaults on for a locked-down brand and config.json wins", async () => {
  const onByBrand = await freshHome();
  expect(loadConfig(onByBrand, { env: {} }).claimMode).toBe(true);

  const off = await freshHome();
  await writeFile(
    path.join(off, "config.json"),
    JSON.stringify({ daemon: { auth: { claimMode: false } } }),
  );
  expect(loadConfig(off, { env: {} }).claimMode).toBe(false);
  // The override travels under the brand's own env prefix; the upstream name
  // belongs to another product and must not reach into this one.
  expect(loadConfig(off, { env: { ACME_CLAIM_MODE: "1" } }).claimMode).toBe(true);
  expect(loadConfig(off, { env: { FROGG_CLAIM_MODE: "1" } }).claimMode).toBe(false);
});
