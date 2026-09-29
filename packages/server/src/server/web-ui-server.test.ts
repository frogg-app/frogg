import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestLogger } from "../test-utils/test-logger.js";
import { WebUiServer, type WebUiSettings } from "./web-ui-server.js";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function get(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on("error", reject);
  });
}

const INTERFACES = [
  { address: "127.0.0.1", name: "loopback" },
  { address: "192.168.1.17", name: "eth0" },
  { address: "0.0.0.0", name: "all" },
];

let root: string;
let current: WebUiServer | null = null;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "web-ui-server-"));
  await mkdir(path.join(root, "dist"));
  await writeFile(path.join(root, "dist", "index.html"), "<html><head></head></html>");
});

afterEach(async () => {
  await current?.stop();
  current = null;
  await rm(root, { recursive: true, force: true });
});

async function create(overrides: { settings?: Partial<WebUiSettings>; pinned?: boolean } = {}) {
  const saveSettings = vi.fn();
  const port = await freePort();
  const server = new WebUiServer({
    logger: createTestLogger(),
    distDir: path.join(root, "dist"),
    port,
    daemonPort: () => 9999,
    label: "host",
    settings: { startOnLaunch: false, host: "127.0.0.1", ...overrides.settings },
    startOnLaunchPinned: overrides.pinned ?? false,
    saveSettings,
    listInterfaces: () => INTERFACES,
  });
  current = server;
  return { server, saveSettings, port };
}

describe("WebUiServer", () => {
  test("starts on loopback, serves the app, and stops", async () => {
    const { server, port } = await create();
    expect(server.status()).toMatchObject({ available: true, running: false, host: "127.0.0.1" });

    expect(await server.start()).toBeNull();
    expect(await get(port)).toBe(200);
    expect(server.status().running).toBe(true);

    await server.stop();
    await expect(get(port)).rejects.toThrow();
  });

  test("start on launch follows the setting", async () => {
    const { server } = await create({ settings: { startOnLaunch: true } });
    await server.startOnLaunch();
    expect(server.status().running).toBe(true);
  });

  test("reports a busy port instead of throwing", async () => {
    const { server, port } = await create();
    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(port, "127.0.0.1", resolve));
    try {
      expect(await server.start()).toMatch(/already in use/);
      expect(server.status()).toMatchObject({ running: false, lastError: expect.any(String) });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  test("saves settings, refuses unknown interfaces and a pinned start-on-launch", async () => {
    const { server, saveSettings } = await create();
    expect(await server.update({ startOnLaunch: true, host: "0.0.0.0" })).toBeNull();
    expect(saveSettings).toHaveBeenLastCalledWith({ startOnLaunch: true, host: "0.0.0.0" });
    expect(await server.update({ host: "10.9.9.9" })).toMatch(/not an interface/);

    const pinned = await create({ pinned: true });
    expect(await pinned.server.update({ startOnLaunch: true })).toMatch(/environment/);
    expect(pinned.saveSettings).not.toHaveBeenCalled();
  });

  test("trusts only its own origin, on the host name the daemon was reached by", async () => {
    const { server, port } = await create();
    expect(server.isWebClientOrigin(`http://192.168.1.17:${port}`, "192.168.1.17:9999")).toBe(
      false,
    );
    await server.start();

    expect(server.isWebClientOrigin(`http://192.168.1.17:${port}`, "192.168.1.17:9999")).toBe(true);
    expect(server.isWebClientOrigin(`http://localhost:${port}`, "127.0.0.1:9999")).toBe(true);
    expect(server.isWebClientOrigin(`http://evil.test:${port}`, "192.168.1.17:9999")).toBe(false);
    expect(server.isWebClientOrigin("http://192.168.1.17:1234", "192.168.1.17:9999")).toBe(false);
  });
});
