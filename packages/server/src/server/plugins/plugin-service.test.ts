import { promises as fs } from "node:fs";
import path from "node:path";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_PLUGIN_POLICY,
  PluginService,
  type PluginBrandPolicy,
  type PluginServiceEvent,
} from "./plugin-service.js";
import { generatePluginRepoKeyPair } from "./signing.js";
import {
  greetCode,
  startFixtureRepo,
  tempDir,
  writeFixturePlugin,
  type FixtureRepo,
} from "./test-fixtures.js";

const logger = pino({ level: "silent" });
const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).toReversed()) await fn();
});

async function setup(opts: { policy?: Partial<PluginBrandPolicy>; brandRepo?: boolean } = {}) {
  const official = await startFixtureRepo();
  cleanups.push(() => official.close());
  let brand: FixtureRepo | null = null;
  if (opts.brandRepo) {
    brand = await startFixtureRepo();
    cleanups.push(() => brand!.close());
  }
  const home = await tempDir("frogg-plugins-home-");
  cleanups.push(() => fs.rm(home, { recursive: true, force: true }));
  const events: PluginServiceEvent[] = [];
  const make = () => {
    const service = new PluginService({
      froggHome: home,
      logger,
      officialRepo: { name: "Official", url: official.url, publicKey: official.keys.publicKey },
      policy: {
        ...DEFAULT_PLUGIN_POLICY,
        ...(brand
          ? { repos: [{ name: "Brand", url: brand.url, publicKey: brand.keys.publicKey }] }
          : {}),
        ...opts.policy,
      },
      autoUpdateIntervalMs: 0,
      devReloadDebounceMs: 50,
    });
    service.onEvent((e) => events.push(e));
    cleanups.push(() => service.stop());
    return service;
  };
  return { official, brand, home, events, service: make(), make };
}

describe("PluginService install flow", () => {
  it("installs from a signed repo, runs the plugin and persists state", async () => {
    const { official, service, home, events, make } = await setup();
    await official.publish([{ id: "fx.hello", version: "1.0.0" }]);
    await service.start();

    const catalog = await service.getCatalog();
    expect(catalog.plugins.map((p) => p.id)).toEqual(["fx.hello"]);
    expect(catalog.plugins[0]!.latest?.version).toBe("1.0.0");

    await expect(
      service.install({ id: "fx.hello", repoUrl: official.url, grantedCapabilities: ["rpc"] }),
    ).rejects.toMatchObject({ code: "forbidden" });

    const installed = await service.install({
      id: "fx.hello",
      repoUrl: official.url,
      grantedCapabilities: ["rpc", "ui.contribute"],
    });
    expect(installed).toMatchObject({
      id: "fx.hello",
      version: "1.0.0",
      status: "active",
      source: "official",
    });
    expect(await service.callRpc("fx.hello", "fx.greet", { a: 1 })).toEqual({
      tag: "1.0.0",
      params: { a: 1 },
    });
    expect(events).toContainEqual({
      type: "plugins.changed",
      payload: { pluginId: "fx.hello", reason: "installed" },
    });

    const state = JSON.parse(await fs.readFile(path.join(home, "plugins", "state.json"), "utf8"));
    expect(state.installed["fx.hello"]).toMatchObject({ version: "1.0.0", enabled: true });

    // Survives a restart.
    await service.stop();
    const again = make();
    await again.start();
    expect(again.list().plugins[0]).toMatchObject({ id: "fx.hello", status: "active" });

    await again.setEnabled("fx.hello", false);
    await expect(again.callRpc("fx.hello", "fx.greet", {})).rejects.toMatchObject({
      code: "not_active",
    });
    await again.setEnabled("fx.hello", true);

    await again.uninstall("fx.hello");
    expect(again.list().plugins).toEqual([]);
    expect(await again.hasInstalledFiles("fx.hello", "1.0.0")).toBe(false);
  });

  it("updates, requiring consent for added capabilities", async () => {
    const { official, service } = await setup();
    await official.publish([{ id: "fx.hello", version: "1.0.0" }]);
    await service.start();
    await service.install({
      id: "fx.hello",
      repoUrl: official.url,
      grantedCapabilities: ["rpc", "ui.contribute"],
    });
    await official.publish([
      { id: "fx.hello", version: "1.1.0", capabilities: ["rpc", "ui.contribute", "network"] },
    ]);

    await service.getCatalog(true);
    expect(service.list().plugins[0]!.updateAvailable).toBe("1.1.0");
    await expect(service.update({ id: "fx.hello" })).rejects.toMatchObject({
      code: "consent_required",
      capabilities: ["network"],
    });
    const updated = await service.update({ id: "fx.hello", grantedCapabilities: ["network"] });
    expect(updated).toMatchObject({ version: "1.1.0", status: "active" });
    expect(await service.callRpc("fx.hello", "fx.greet", null)).toMatchObject({ tag: "1.1.0" });
    expect(await service.hasInstalledFiles("fx.hello", "1.0.0")).toBe(false);
  });

  it("rejects a repo whose signature does not verify", async () => {
    const { official, service } = await setup();
    await official.publish([{ id: "fx.hello", version: "1.0.0" }]);
    // Re-sign with a different key: the pinned key no longer matches.
    const other = generatePluginRepoKeyPair();
    const { signPluginIndexFile } = await import("./tooling.js");
    await signPluginIndexFile(path.join(official.outDir, "index.json"), other.privateKey);
    await service.start();
    const catalog = await service.getCatalog(true);
    expect(catalog.plugins).toEqual([]);
    expect(catalog.repos[0]!.error).toMatch(/Signature/);
    await expect(
      service.install({
        id: "fx.hello",
        repoUrl: official.url,
        grantedCapabilities: ["rpc", "ui.contribute"],
      }),
    ).rejects.toMatchObject({ code: "signature_invalid" });
  });

  it("rejects a tarball whose sha256 does not match", async () => {
    const { official, service } = await setup();
    await official.publish([{ id: "fx.hello", version: "1.0.0" }]);
    const tgz = path.join(official.outDir, "fx.hello-1.0.0.tgz");
    await fs.appendFile(tgz, "tamper");
    await service.start();
    await expect(
      service.install({
        id: "fx.hello",
        repoUrl: official.url,
        grantedCapabilities: ["rpc", "ui.contribute"],
      }),
    ).rejects.toMatchObject({ code: "hash_mismatch" });
    expect(service.list().plugins).toEqual([]);
  });

  it("rejects a tarball whose manifest does not match the index entry", async () => {
    const { official, service } = await setup();
    await official.publish([{ id: "fx.hello", version: "1.0.0" }]);
    const indexFile = path.join(official.outDir, "index.json");
    const index = JSON.parse(await fs.readFile(indexFile, "utf8"));
    index.plugins[0].versions[0].capabilities = ["rpc"];
    await fs.writeFile(indexFile, JSON.stringify(index));
    const { signPluginIndexFile } = await import("./tooling.js");
    await signPluginIndexFile(indexFile, official.keys.privateKey);
    await service.start();
    await expect(
      service.install({ id: "fx.hello", repoUrl: official.url, grantedCapabilities: ["rpc"] }),
    ).rejects.toMatchObject({ code: "manifest_mismatch" });
  });

  it("contains a plugin that throws on activate or in an RPC", async () => {
    const { official, service } = await setup();
    await official.publish([
      {
        id: "fx.boom",
        version: "1.0.0",
        code: "export default function () { throw new Error('kaboom'); }",
      },
      {
        id: "fx.rpcfail",
        version: "1.0.0",
        code: "export default function (ctx) { ctx.rpc.handle('x', () => { throw new Error('bad'); }); }",
      },
    ]);
    await service.start();
    const boom = await service.install({
      id: "fx.boom",
      repoUrl: official.url,
      grantedCapabilities: ["rpc", "ui.contribute"],
    });
    expect(boom).toMatchObject({ status: "error", error: "kaboom" });
    await service.install({
      id: "fx.rpcfail",
      repoUrl: official.url,
      grantedCapabilities: ["rpc", "ui.contribute"],
    });
    await expect(service.callRpc("fx.rpcfail", "x", null)).rejects.toMatchObject({
      code: "plugin_error",
      message: "bad",
    });
    await expect(service.callRpc("fx.rpcfail", "missing", null)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("gates ctx by granted capabilities and exposes contributions and settings", async () => {
    const { official, service } = await setup();
    const code = `export default function (ctx) {
      ctx.rpc.handle("fx.probe", async () => ({
        hasAgents: ctx.agents !== undefined,
        hasSettings: ctx.settings !== undefined,
        heading: await ctx.settings.get("heading"),
      }));
      ctx.ui.setBadge("notes", "3");
    }`;
    await official.publish([
      {
        id: "fx.notes",
        version: "1.0.0",
        code,
        capabilities: ["rpc", "ui.contribute", "settings.store"],
        contributes: {
          panels: [{ id: "notes", title: "Notes", kind: "markdown" }],
          settings: [
            { key: "heading", title: "Heading", type: "string" },
            { key: "token", title: "Token", type: "secret" },
          ],
        },
      },
    ]);
    await service.start();
    await service.install({
      id: "fx.notes",
      repoUrl: official.url,
      grantedCapabilities: ["rpc", "ui.contribute", "settings.store"],
    });
    await service.setSettings("fx.notes", { heading: "Pinned", token: "s3cret" });
    expect(await service.callRpc("fx.notes", "fx.probe", null)).toEqual({
      hasAgents: false,
      hasSettings: true,
      heading: "Pinned",
    });
    expect(await service.getSettings("fx.notes")).toMatchObject({
      values: { heading: "Pinned", token: "" },
    });
    await expect(service.setSettings("fx.notes", { heading: 5 })).rejects.toMatchObject({
      code: "invalid_request",
    });
    await expect(service.setSettings("fx.notes", { other: "x" })).rejects.toMatchObject({
      code: "invalid_request",
    });
    const [contrib] = service.getContributions();
    expect(contrib).toMatchObject({
      pluginId: "fx.notes",
      panels: [{ id: "notes" }],
      badges: { notes: "3" },
    });
  });
});

describe("PluginService brand policy", () => {
  it("filters and blocks by allow/deny globs", async () => {
    const { official, service } = await setup({ policy: { allow: ["fx.*"], deny: ["fx.bad"] } });
    await official.publish([
      { id: "fx.good", version: "1.0.0" },
      { id: "fx.bad", version: "1.0.0" },
      { id: "other.thing", version: "1.0.0" },
    ]);
    await service.start();
    expect((await service.getCatalog()).plugins.map((p) => p.id)).toEqual(["fx.good"]);
    await expect(
      service.install({
        id: "fx.bad",
        repoUrl: official.url,
        grantedCapabilities: ["rpc", "ui.contribute"],
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("disables everything when plugins are off", async () => {
    const { service } = await setup({ policy: { enabled: false } });
    await service.start();
    expect(service.enabled).toBe(false);
    expect(service.list()).toMatchObject({ plugins: [], policy: { enabled: false } });
    expect(() => service.listRepos()).toThrow(/disabled/);
  });

  it("omits the official repo when the brand turns it off, and lists brand repos", async () => {
    const { service, brand } = await setup({ policy: { officialRepo: false }, brandRepo: true });
    await service.start();
    expect(service.listRepos().map((r) => [r.tier, r.url, r.removable])).toEqual([
      ["brand", brand!.url, false],
    ]);
  });

  it("allows user repos only when the brand does, pinning the key on first use", async () => {
    const locked = await setup();
    await locked.service.start();
    const userRepo = await startFixtureRepo();
    cleanups.push(() => userRepo.close());
    await userRepo.publish([{ id: "fx.user", version: "1.0.0" }]);
    await expect(locked.service.addRepo({ url: userRepo.url })).rejects.toMatchObject({
      code: "forbidden",
    });

    const open = await setup({ policy: { allowUserRepos: true } });
    await open.service.start();
    const repo = await open.service.addRepo({ url: userRepo.url });
    expect(repo).toMatchObject({
      tier: "user",
      publicKey: userRepo.keys.publicKey,
      removable: true,
      name: "Fixture repo",
    });
    await expect(open.service.addRepo({ url: userRepo.url })).rejects.toMatchObject({
      code: "already_installed",
    });
    const other = await startFixtureRepo();
    cleanups.push(() => other.close());
    await other.publish([{ id: "fx.o", version: "1.0.0" }]);
    await expect(
      open.service.addRepo({ url: other.url, publicKey: generatePluginRepoKeyPair().publicKey }),
    ).rejects.toMatchObject({ code: "signature_invalid" });
    await open.service.install({
      id: "fx.user",
      repoUrl: userRepo.url,
      grantedCapabilities: ["rpc", "ui.contribute"],
    });
    expect(open.service.list().plugins[0]).toMatchObject({ source: "user" });
    await open.service.removeRepo(userRepo.url);
    expect(open.service.listRepos().map((r) => r.tier)).toEqual(["official"]);
  });

  it("forbids developer mode when the brand does", async () => {
    const { service } = await setup({ policy: { developerMode: "forbidden" } });
    await service.start();
    await expect(service.setDeveloperMode(true)).rejects.toMatchObject({ code: "forbidden" });
    await expect(service.devLink("/tmp/x")).rejects.toMatchObject({ code: "forbidden" });
  });

  it("installs preinstalled plugins on start, preferring brand repos, and keeps them", async () => {
    const { brand, official, service } = await setup({
      brandRepo: true,
      policy: { preinstalled: [{ id: "acme.tool", version: "^1" }] },
    });
    await brand!.publish([{ id: "acme.tool", version: "1.2.0" }]);
    await brand!.publish([{ id: "acme.tool", version: "2.0.0" }]);
    await official.publish([{ id: "acme.tool", version: "1.9.0" }]);
    await service.start();
    await service.installPreinstalled();
    expect(service.list().plugins[0]).toMatchObject({
      id: "acme.tool",
      version: "1.2.0",
      source: "brand",
      preinstalled: true,
    });
    await expect(service.uninstall("acme.tool")).rejects.toMatchObject({ code: "forbidden" });

    // autoUpdate brand-repos: follows the preinstalled range, not 2.0.0.
    await brand!.publish([{ id: "acme.tool", version: "1.3.0" }]);
    expect(await service.runAutoUpdate()).toEqual(["acme.tool"]);
    expect(service.list().plugins[0]!.version).toBe("1.3.0");
  });

  it("auto-updates only brand-repo plugins in brand-repos mode", async () => {
    const { official, service } = await setup();
    await official.publish([{ id: "fx.hello", version: "1.0.0" }]);
    await service.start();
    await service.install({
      id: "fx.hello",
      repoUrl: official.url,
      grantedCapabilities: ["rpc", "ui.contribute"],
    });
    await official.publish([{ id: "fx.hello", version: "1.1.0" }]);
    expect(await service.runAutoUpdate()).toEqual([]);
  });

  it("auto-updates everything in all mode but never adds capabilities silently", async () => {
    const { official, service } = await setup({ policy: { autoUpdate: "all" } });
    await official.publish([{ id: "fx.hello", version: "1.0.0" }]);
    await service.start();
    await service.install({
      id: "fx.hello",
      repoUrl: official.url,
      grantedCapabilities: ["rpc", "ui.contribute"],
    });
    await official.publish([
      { id: "fx.hello", version: "1.1.0", capabilities: ["rpc", "ui.contribute", "network"] },
    ]);
    expect(await service.runAutoUpdate()).toEqual([]);
    await official.publish([{ id: "fx.hello", version: "1.1.0" }]);
    expect(await service.runAutoUpdate()).toEqual(["fx.hello"]);
  });
});

describe("PluginService dev links", () => {
  it("links a local folder and hot-reloads on change", async () => {
    const { service } = await setup();
    await service.start();
    const root = await tempDir("frogg-plugin-dev-");
    cleanups.push(() => fs.rm(root, { recursive: true, force: true }));
    const dir = await writeFixturePlugin(root, {
      id: "fx.dev",
      version: "0.1.0",
      code: greetCode("one"),
    });

    await expect(service.devLink(dir)).rejects.toMatchObject({ code: "forbidden" });
    await service.setDeveloperMode(true);
    await expect(service.devLink("relative/path")).rejects.toMatchObject({
      code: "invalid_request",
    });
    const linked = await service.devLink(dir);
    expect(linked).toMatchObject({ id: "fx.dev", source: "dev", devPath: dir, status: "active" });
    expect(await service.callRpc("fx.dev", "fx.greet", null)).toMatchObject({ tag: "one" });

    await fs.writeFile(path.join(dir, "dist", "daemon.js"), greetCode("two"));
    const greet = () =>
      service.callRpc("fx.dev", "fx.greet", null).then(
        (r) => (r as { tag?: string }).tag,
        () => null,
      );
    await expect.poll(greet, { timeout: 5000, interval: 50 }).toBe("two");

    await service.devUnlink("fx.dev");
    expect(service.list().plugins).toEqual([]);
  });
});
