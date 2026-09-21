import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import pino from "pino";
import { afterEach, expect, test, vi } from "vitest";

// A brand whose env prefix is not FROGG. Under the stock brand
// `${brand.envPrefix}_INSTALL_DIR` and `FROGG_INSTALL_DIR` are the same
// string, so this call site reads as correct either way.
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

import { DaemonUpdateService, type SpawnUpdateCli } from "./daemon-update-service.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "daemon-update-brand-env-"));
  dirs.push(dir);
  return dir;
}

/**
 * The CLI resolves its install directory through `brandEnv`, which on a
 * branded build reads only `<PREFIX>_INSTALL_DIR`. Handed `FROGG_INSTALL_DIR`
 * it finds nothing and self-update installs to the default location instead of
 * the one the daemon is running from.
 */
test("self-update hands the CLI an install dir it can actually read", async () => {
  const installDir = makeDir();
  let captured: NodeJS.ProcessEnv | undefined;

  const spawnCli: SpawnUpdateCli = (_launcher, _args, options) => {
    captured = options?.env;
    const stdout = new PassThrough();
    const emitter = new EventEmitter() as unknown as ChildProcess;
    Object.assign(emitter, { stdout, stderr: new PassThrough(), kill: () => {} });
    stdout.end();
    setImmediate(() => emitter.emit("exit", 0, null));
    return emitter;
  };

  const service = new DaemonUpdateService({
    install: {
      installDir,
      updatable: true,
      reason: null,
      runningRoot: path.join(installDir, "versions", "0.1.13"),
      cliLauncher: path.join(installDir, "versions", "0.1.13", "bin", "acme"),
    },
    daemonVersion: "0.1.13",
    froggHome: path.join(installDir, "home"),
    listen: "0.0.0.0:9993",
    logger: pino({ level: "silent" }),
    env: { PATH: "/usr/bin" },
    spawnCli,
    checkTimeoutMs: 2000,
  });
  service.setBroadcaster(() => {});

  await service.check().catch(() => undefined);

  expect(captured?.ACME_INSTALL_DIR).toBe(installDir);
  expect(captured?.ACME_HOME).toBe(path.join(installDir, "home"));
  // The CLI reads this one straight off `env` without normalising, so it
  // deliberately stays under the internal name.
  expect(captured?.FROGG_LISTEN).toBe("0.0.0.0:9993");
});
