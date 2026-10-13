import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import net from "node:net";
import { createTestFroggDaemon, type TestFroggDaemon } from "./test-utils/frogg-daemon.js";

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

interface InitialDaemonConnectionHint {
  listen: string;
  useTls: boolean;
  label: string;
}

function fetchDaemonWebUi(options: {
  port: number;
  headers?: Record<string, string>;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port: options.port,
        path: "/",
        headers: {
          host: `daemon.example.test:${options.port}`,
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            reject(new Error(`Expected 200 from web UI, got ${res.statusCode ?? 0}`));
            return;
          }
          resolve(Buffer.concat(chunks).toString("utf-8"));
        });
      },
    );
    req.on("error", reject);
  });
}

function readInjectedConnectionHint(html: string): InitialDaemonConnectionHint {
  const match = html.match(
    /window\.__FROGG_INITIAL_DAEMON_CONNECTION__=(?<json>\{[^<]+})<\/script>/,
  );
  if (!match?.groups?.json) {
    throw new Error("Missing initial daemon connection hint");
  }
  return JSON.parse(match.groups.json) as InitialDaemonConnectionHint;
}

describe("daemon web UI bootstrap", () => {
  test("the daemon's own port serves no web client", async () => {
    const distDir = await createWebUiDist();
    daemonHandle = await createTestFroggDaemon({
      mcpEnabled: false,
      webUi: { enabled: true, distDir, port: await freePort() },
    });
    await expect(fetchDaemonWebUi({ port: daemonHandle.port })).rejects.toThrow(/got 40[14]/);
  });

  // Unclaimed, every visitor gets the claim page; these tests are about the app.
  function claimDaemon(handle: TestFroggDaemon): void {
    handle.daemon.claimStore.mintPrincipal({
      label: "Laptop",
      role: "owner",
      pairedVia: "code",
    });
  }

  let tempRoot: string | null = null;
  let daemonHandle: TestFroggDaemon | null = null;

  async function createWebUiDist(): Promise<string> {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "frogg-bootstrap-web-ui-"));
    const distDir = path.join(tempRoot, "dist");
    await mkdir(distDir, { recursive: true });
    await writeFile(
      path.join(distDir, "index.html"),
      "<!DOCTYPE html><html><head></head><body>app</body></html>",
    );
    return distDir;
  }

  afterEach(async () => {
    await daemonHandle?.close();
    daemonHandle = null;
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = null;
    }
  });

  test("the web client's page connects to the daemon's port; TLS only via a trusted proxy only ", async () => {
    const distDir = await createWebUiDist();

    const webPort = await freePort();
    daemonHandle = await createTestFroggDaemon({
      mcpEnabled: false,
      webUi: {
        enabled: true,
        distDir,
        port: webPort,
      },
    });
    claimDaemon(daemonHandle);

    const httpHint = readInjectedConnectionHint(await fetchDaemonWebUi({ port: webPort }));
    const httpsHint = readInjectedConnectionHint(
      await fetchDaemonWebUi({
        port: webPort,
        headers: { "x-forwarded-proto": "https" },
      }),
    );

    expect(httpHint).toEqual({
      listen: `daemon.example.test:${daemonHandle.port}`,
      useTls: false,
      label: os.hostname(),
    });
    expect(httpsHint).toEqual({
      listen: `daemon.example.test:${daemonHandle.port}`,
      useTls: true,
      label: os.hostname(),
    });
  });

  test("ignores forwarded HTTPS when proxy trust is disabled", async () => {
    const distDir = await createWebUiDist();
    const webPort = await freePort();

    daemonHandle = await createTestFroggDaemon({
      mcpEnabled: false,
      trustedProxies: [],
      webUi: {
        enabled: true,
        distDir,
        port: webPort,
      },
    });
    claimDaemon(daemonHandle);

    const httpsHint = readInjectedConnectionHint(
      await fetchDaemonWebUi({
        port: webPort,
        headers: { "x-forwarded-proto": "https" },
      }),
    );

    expect(httpsHint).toEqual({
      listen: `daemon.example.test:${daemonHandle.port}`,
      useTls: false,
      label: os.hostname(),
    });
  });
});
