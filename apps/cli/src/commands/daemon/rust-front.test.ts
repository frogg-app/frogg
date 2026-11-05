import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRustFrontLaunch } from "./rust-front.js";

const bundleRoot = "/opt/frogg/current";
const runnerEntry = `${bundleRoot}/daemon/packages/server/dist/scripts/supervisor-entrypoint.js`;
const worker = `${bundleRoot}/daemon/packages/server/dist/server/server/daemon-worker.js`;
const binary = `${bundleRoot}/bin/frogg-daemond`;

function resolve(env: NodeJS.ProcessEnv, files: string[], platform: NodeJS.Platform = "linux") {
  const warnings: string[] = [];
  const launch = resolveRustFrontLaunch({
    env,
    envPrefix: "FROGG",
    runnerEntry,
    workerArgs: ["--no-relay"],
    nodePath: "/opt/frogg/current/node/bin/node",
    platform,
    exists: (file) => files.includes(path.resolve(file)),
    warn: (message) => warnings.push(message),
  });
  return { launch, warnings };
}

describe("resolveRustFrontLaunch", () => {
  it("is off unless the flag is set", () => {
    expect(resolve({}, [binary, worker]).launch).toBeNull();
    expect(resolve({ FROGG_RS_FRONT: "0" }, [binary, worker]).launch).toBeNull();
  });

  it("starts the bundled Rust front in supervise mode when the flag is on", () => {
    expect(resolve({ FROGG_RS_FRONT: "1" }, [binary, worker]).launch).toEqual({
      command: binary,
      args: [
        "--supervise",
        "--node",
        "/opt/frogg/current/node/bin/node",
        "--worker",
        worker,
        "--",
        "--no-relay",
      ],
    });
  });

  it("prefers an explicit binary", () => {
    const launch = resolve({ FROGG_RS_FRONT: "true", FROGG_RS_FRONT_BIN: "/tmp/rs" }, [
      "/tmp/rs",
      binary,
      worker,
    ]).launch;
    expect(launch?.command).toBe("/tmp/rs");
  });

  it("falls back to Node with a warning when the binary is missing or on Windows", () => {
    const missing = resolve({ FROGG_RS_FRONT: "1" }, [worker]);
    expect(missing.launch).toBeNull();
    expect(missing.warnings[0]).toMatch(/not found/);
    const windows = resolve({ FROGG_RS_FRONT: "1" }, [binary, worker], "win32");
    expect(windows.launch).toBeNull();
    expect(windows.warnings[0]).toMatch(/Windows/);
  });
});
