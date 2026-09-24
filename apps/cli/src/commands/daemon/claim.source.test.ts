import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";

// claim-status asks the running daemon first; point "running" at a fake one.
const daemonState = vi.hoisted(() => ({ value: { running: false } as Record<string, unknown> }));
vi.mock("./local-daemon.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./local-daemon.js")>();
  return { ...actual, resolveLocalDaemonState: () => daemonState.value };
});

const { describeClaimStatus } = await import("./claim.js");

const homes: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  for (const server of servers.splice(0)) await new Promise((r) => server.close(r));
  daemonState.value = { running: false };
});

function createHome(): string {
  const home = mkdtempSync(path.join(os.tmpdir(), "frogg-cli-claim-src-"));
  homes.push(home);
  return home;
}

const POSTURE = {
  findings: [{ id: "exposed_without_password", severity: "critical", fixAction: "set_password" }],
};

/** A fake daemon that returns the owner shape only for the right bearer. */
async function startFakeDaemon(token: string): Promise<{ listen: string; bearers: string[] }> {
  const bearers: string[] = [];
  const server = createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    bearers.push(auth);
    res.setHeader("content-type", "application/json");
    const body =
      auth === `Bearer ${token}`
        ? {
            claimed: true,
            pairingRequired: false,
            passwordEnabled: true,
            trustLan: true,
            posture: POSTURE,
          }
        : { claimed: false, pairingRequired: true };
    res.end(JSON.stringify(body));
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { listen: `127.0.0.1:${(server.address() as AddressInfo).port}`, bearers };
}

test("reads claimed / password / LAN trust from the running daemon with the local token", async () => {
  const home = createHome();
  writeFileSync(path.join(home, "local-token"), "tok-123\n");
  const fake = await startFakeDaemon("tok-123");
  daemonState.value = { running: true, listen: fake.listen };

  const status = await describeClaimStatus(home);
  expect(fake.bearers).toContain("Bearer tok-123");
  expect(status).toMatchObject({
    source: "daemon",
    claimed: true,
    passwordConfigured: true,
    lanTrusted: true,
    findings: POSTURE.findings,
  });
});

test("falls back to config.json when the daemon does not return the owner view", async () => {
  const home = createHome();
  writeFileSync(path.join(home, "local-token"), "stale");
  const fake = await startFakeDaemon("tok-123");
  daemonState.value = { running: true, listen: fake.listen };

  const status = await describeClaimStatus(home);
  expect(status.source).toBe("config");
  expect(status.passwordConfigured).toBe(false);
  expect(status).not.toHaveProperty("findings");
});

test("falls back to config.json when no daemon is running", async () => {
  const status = await describeClaimStatus(createHome());
  expect(status.source).toBe("config");
});
