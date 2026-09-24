import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { claimLocalDaemon } from "./auth-claim.js";

interface SeenRequest {
  url: string | undefined;
  authorization: string | undefined;
  body: unknown;
}

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).toReversed()) await cleanup();
});

function createHome(token: string | null): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "frogg-cli-auth-claim-"));
  cleanups.push(() => rmSync(home, { recursive: true, force: true }));
  if (token)
    writeFileSync(path.join(home, "local-token"), `${token}\n`, {
      mode: 0o600,
    });
  return home;
}

/** A fake daemon answering POST /api/setup/claim with a fixed status and body. */
async function fakeDaemon(
  status: number,
  body: unknown,
): Promise<{ listen: string; seen: SeenRequest[] }> {
  const seen: SeenRequest[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      seen.push({
        url: req.url,
        authorization: req.headers.authorization,
        body: raw ? JSON.parse(raw) : null,
      });
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  cleanups.push(() => new Promise<void>((resolve) => server.close(() => resolve())));
  return {
    listen: `127.0.0.1:${(server.address() as AddressInfo).port}`,
    seen,
  };
}

const minted = {
  serverId: "srv_1",
  principalId: "prn_1",
  credentialId: "cred_1",
  credential: "secret-credential",
  role: "owner",
  deviceName: "Laptop",
  fingerprint: "ab:cd",
  permissions: [],
};

describe("frogg auth claim", () => {
  test("201: posts an open claim with the local-token bearer and returns the owner credential", async () => {
    const home = createHome("local-tok");
    const daemon = await fakeDaemon(201, minted);

    const result = await claimLocalDaemon({
      home,
      listen: daemon.listen,
      deviceName: "Laptop",
    });

    expect(result).toMatchObject({ ...minted, home });
    expect(daemon.seen).toEqual([
      {
        url: "/api/setup/claim",
        authorization: "Bearer local-tok",
        body: { claim: true, deviceName: "Laptop" },
      },
    ]);
  });

  test("409 already claimed", async () => {
    const home = createHome("t");
    const daemon = await fakeDaemon(409, {
      error: "This daemon has already been claimed",
    });
    await expect(claimLocalDaemon({ home, listen: daemon.listen })).rejects.toMatchObject({
      code: "ALREADY_CLAIMED",
    });
  });

  test("409 not in claim mode", async () => {
    const home = createHome("t");
    const daemon = await fakeDaemon(409, {
      error: "This daemon is not in claim mode",
    });
    await expect(claimLocalDaemon({ home, listen: daemon.listen })).rejects.toMatchObject({
      code: "NOT_IN_CLAIM_MODE",
    });
  });

  test("403 refused; without a local token it says so and sends no bearer", async () => {
    const home = createHome(null);
    const daemon = await fakeDaemon(403, {
      error: "This daemon can only be claimed from the host itself",
    });
    const failure = await claimLocalDaemon({
      home,
      listen: daemon.listen,
    }).catch((e) => e);
    expect(failure).toMatchObject({ code: "CLAIM_REFUSED" });
    expect(failure.message).toContain("local-token");
    expect(daemon.seen[0]?.authorization).toBeUndefined();
  });

  test("daemon not running", async () => {
    const home = createHome("t");
    await expect(claimLocalDaemon({ home })).rejects.toMatchObject({
      code: "DAEMON_NOT_RUNNING",
    });
  });

  test("nothing listening is reported as unreachable", async () => {
    const home = createHome("t");
    const daemon = await fakeDaemon(201, minted);
    await cleanups.pop()?.();
    await expect(claimLocalDaemon({ home, listen: daemon.listen })).rejects.toMatchObject({
      code: "DAEMON_UNREACHABLE",
    });
  });
});
