import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BetaAppService, type BetaAppDeps, type BetaAppInstallProgress } from "./service.js";

const API = "https://api.github.com/repos/frogg-app/frogg/releases";
const PAYLOAD = Buffer.from("beta appimage payload ".repeat(1000));
const ASSET = "frogg-beta-1.6.5-beta.1-linux-x86_64.AppImage";
const DL = "https://github.com/frogg-app/frogg/releases/download/v1.6.5-beta.1";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "beta-app-test-"));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function releases(sha = createHash("sha256").update(PAYLOAD).digest("hex"), name = ASSET) {
  return {
    [`${API}?per_page=100`]: () =>
      Response.json([
        { tag_name: "v1.7.0-beta.1", draft: true, assets: [] },
        {
          tag_name: "v1.6.5-beta.1",
          draft: false,
          assets: [
            {
              name,
              browser_download_url: `${DL}/${name}`,
              size: PAYLOAD.length,
            },
            {
              name: "SHA256SUMS-desktop",
              browser_download_url: `${DL}/SHA256SUMS-desktop`,
              size: 1,
            },
          ],
        },
      ]),
    [`${DL}/SHA256SUMS-desktop`]: () => new Response(`${sha}  ${name}\n`),
    [`${DL}/${name}`]: () => new Response(PAYLOAD),
  } as Record<string, () => Response>;
}

function makeService(overrides: Partial<BetaAppDeps> = {}, routes = releases()) {
  const events: BetaAppInstallProgress[] = [];
  const spawned: string[][] = [];
  const service = new BetaAppService({
    identity: {
      channel: "stable",
      releasesApi: API,
      beta: {
        id: "frogg-beta",
        name: "frogg beta",
        applicationId: "sh.frogg.app.beta",
        artifactPrefix: "frogg-beta",
      },
      stable: {
        name: "frogg",
        applicationId: "sh.frogg.app",
        artifactPrefix: "frogg",
      },
    },
    platform: "linux",
    arch: "x64",
    homeDir: path.join(root, "home"),
    tempDir: root,
    fetch: (async (input: string | URL | Request) => {
      const route = routes[String(input)];
      return route ? route() : new Response("missing", { status: 404 });
    }) as typeof fetch,
    run: async () => {
      throw new Error("not found");
    },
    spawnDetached: (command, args) => spawned.push([command, ...args]),
    emit: (progress) => events.push(progress),
    ...overrides,
  });
  return { service, events, spawned };
}

describe("BetaAppService", () => {
  it("installs the verified AppImage beside the stable app and launches it", async () => {
    const { service, events, spawned } = makeService();
    expect(await service.getStatus()).toMatchObject({
      supported: true,
      installed: false,
    });

    const result = await service.install();
    const target = path.join(root, "home", "Applications", "frogg-beta.AppImage");
    expect(result).toMatchObject({
      version: "1.6.5-beta.1",
      assetName: ASSET,
      installPath: target,
    });
    expect(await fs.readFile(target)).toEqual(PAYLOAD);
    // Windows has no executable mode bits; the AppImage only ever runs on Linux.
    if (process.platform !== "win32") {
      expect((await fs.stat(target)).mode & 0o111).not.toBe(0);
    }
    expect(spawned).toEqual([[target]]);
    expect(events.map((event) => event.phase)).toContain("downloading");
    expect(events.at(-1)).toMatchObject({
      phase: "launched",
      receivedBytes: PAYLOAD.length,
    });

    expect(await service.getStatus()).toMatchObject({
      installed: true,
      installedVersion: "1.6.5-beta.1",
    });
    await service.open();
    expect(spawned).toEqual([[target], [target]]);
    // Nothing left behind in the download directory.
    expect((await fs.readdir(root)).filter((entry) => entry.includes("installer"))).toEqual([]);
  });

  it("discards a download whose checksum does not match", async () => {
    const { service, events, spawned } = makeService({}, releases("0".repeat(64)));
    await expect(service.install()).rejects.toThrow(/Checksum mismatch/);
    expect(events.at(-1)?.phase).toBe("failed");
    expect(spawned).toEqual([]);
    await expect(fs.access(path.join(root, "home", "Applications"))).rejects.toThrow();
  });

  it("refuses when no checksum is published", async () => {
    const routes = releases();
    routes[`${DL}/SHA256SUMS-desktop`] = () => new Response("");
    const { service } = makeService({}, routes);
    await expect(service.install()).rejects.toThrow(/no checksum/);
  });

  it("cancels an in-flight download", async () => {
    const routes = releases();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    routes[`${DL}/${ASSET}`] = () =>
      new Response(
        new ReadableStream({
          async pull(controller) {
            controller.enqueue(new Uint8Array(PAYLOAD.subarray(0, 100)));
            await gate;
            controller.close();
          },
        }),
      );
    const { service, events } = makeService({}, routes);
    const pending = service.install();
    while (!events.some((event) => event.phase === "downloading")) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    await expect(service.install()).rejects.toThrow(/already running/);
    expect(service.cancelInstall()).toBe(true);
    release();
    await expect(pending).rejects.toThrow(/cancelled/);
    expect(events.at(-1)?.phase).toBe("cancelled");
    expect(service.cancelInstall()).toBe(false);
  });

  it("is unsupported when running the beta app itself", async () => {
    const { service } = makeService({
      identity: {
        channel: "beta",
        releasesApi: API,
        beta: {
          id: "frogg-beta",
          name: "frogg beta",
          applicationId: "sh.frogg.app.beta",
          artifactPrefix: "frogg-beta",
        },
        stable: {
          name: "frogg",
          applicationId: "sh.frogg.app",
          artifactPrefix: "frogg",
        },
      },
    });
    expect(await service.getStatus()).toMatchObject({
      supported: false,
      unsupportedReason: "running-beta",
    });
    await expect(service.install()).rejects.toThrow(/already the beta app/);
  });

  it("macOS: copies only a bundle carrying the beta application id", async () => {
    const apps = path.join(root, "Applications");
    const calls: string[][] = [];
    const bundleId = { value: "sh.frogg.app" };
    const dmg = "frogg-beta-1.6.5-beta.1-mac-arm64.dmg";
    const routes = releases(createHash("sha256").update(PAYLOAD).digest("hex"), dmg);
    const { service, spawned } = makeService(
      {
        platform: "darwin",
        arch: "arm64",
        macApplicationsDir: apps,
        run: async (command, args) => {
          calls.push([command, ...args]);
          if (command === "plutil") return `${bundleId.value}\n`;
          return "";
        },
      },
      routes,
    );
    await expect(service.install()).rejects.toThrow(/does not contain frogg beta/);
    expect(calls.some(([command]) => command === "ditto")).toBe(false);
    expect(calls.at(-1)?.slice(0, 2)).toEqual(["hdiutil", "detach"]);

    bundleId.value = "sh.frogg.app.beta";
    const result = await service.install();
    const target = path.join(apps, "frogg beta.app");
    expect(result.installPath).toBe(target);
    expect(calls.find(([command]) => command === "ditto")?.[2]).toBe(target);
    expect(spawned).toEqual([["open", "-n", target]]);
  });
});
