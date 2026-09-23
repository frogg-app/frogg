import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  encodeOfferFragmentPayload,
  type ConnectionOfferV3,
} from "@frogg/protocol/connection-offer";
import {
  daemonKeyFingerprint,
  deployAction,
  deployListenAddress,
  resolveDeployTarget,
  runDeployToHost,
  type DeployStepId,
  type DeployStepStatus,
  type DeployToHostDeps,
} from "./deploy-to-host";
import type { SshDeployProbe } from "./ssh-deploy";

const KEY = Buffer.from("daemon-public-key-bytes").toString("base64");
const FINGERPRINT = `SHA256:${createHash("sha256")
  .update("daemon-public-key-bytes")
  .digest("base64")
  .replace(/=+$/u, "")}`;
const OFFER: ConnectionOfferV3 = {
  v: 3,
  serverId: "srv-1",
  hostname: "box",
  daemonPublicKeyB64: KEY,
  direct: { endpoints: ["10.0.0.2:9999"] },
  claim: { token: "t", expiresAt: "2999-01-01T00:00:00Z" },
};
const LINK = `frogg://pair#offer=${encodeOfferFragmentPayload(OFFER)}`;
const PROBE: SshDeployProbe = {
  os: "Linux",
  arch: "x86_64",
  hasDocker: false,
  hasSystemdUser: true,
  hasCurl: true,
  hasFrogg: { installed: false, version: null },
  hasDockerContainer: false,
  homeDir: "/home/u",
};

function deps(overrides: Partial<DeployToHostDeps> = {}): DeployToHostDeps {
  return {
    probe: vi.fn(async () => PROBE),
    install: vi.fn(async () => undefined),
    pairCode: vi.fn(async () => ({
      source: "pair-code" as const,
      deepLink: LINK,
      host: "10.0.0.2",
      port: 9999,
      fingerprint: FINGERPRINT,
      expiresAt: null,
    })),
    connectTunnel: vi.fn(async () => ({ serverId: "srv-1", hostname: "box" })),
    claim: vi.fn(async () => ({ serverId: "srv-1", hostname: "box" })),
    fingerprint: (key) => daemonKeyFingerprint(key),
    ...overrides,
  };
}

function run(
  network: "tunnel" | "lan",
  d: DeployToHostDeps,
  signal = new AbortController().signal,
) {
  const steps: string[] = [];
  const promise = runDeployToHost({ target: { host: "u@box" }, network, daemonPort: 9999 }, d, {
    signal,
    onStep: (step: DeployStepId, status: DeployStepStatus) => steps.push(`${step}:${status}`),
  });
  return { promise, steps };
}

describe("deploy to host", () => {
  it("binds loopback for a tunnel, verifies the SSH-issued identity and connects", async () => {
    const d = deps();
    const { promise, steps } = run("tunnel", d);
    await expect(promise).resolves.toMatchObject({
      serverId: "srv-1",
      verified: true,
    });
    expect(d.install).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "native",
        listen: "127.0.0.1:9999",
        host: "u@box",
      }),
      expect.anything(),
    );
    expect(d.connectTunnel).toHaveBeenCalledWith({
      host: "u@box",
      daemonPort: 9999,
    });
    expect(d.claim).not.toHaveBeenCalled();
    expect(steps).toEqual([
      "connect:running",
      "connect:done",
      "install:running",
      "install:done",
      "pairCode:running",
      "pairCode:done",
      "pair:running",
      "pair:done",
    ]);
  });

  it("claims over the LAN at the endpoint the pair command reported", async () => {
    const d = deps();
    await expect(run("lan", d).promise).resolves.toMatchObject({
      serverId: "srv-1",
    });
    expect(d.install).toHaveBeenCalledWith(
      expect.objectContaining({ listen: "0.0.0.0:9999" }),
      expect.anything(),
    );
    expect(d.claim).toHaveBeenCalledWith(expect.objectContaining({ serverId: "srv-1" }), {
      endpointOverride: "10.0.0.2:9999",
    });
  });

  it("refuses a pairing code whose fingerprint does not match the offered key", async () => {
    const d = deps({
      pairCode: async () => ({
        source: "pair-code",
        deepLink: LINK,
        host: null,
        port: null,
        fingerprint: "SHA256:forged",
        expiresAt: null,
      }),
    });
    const { promise, steps } = run("lan", d);
    await expect(promise).rejects.toMatchObject({
      step: "pairCode",
      code: "fingerprint_mismatch",
    });
    expect(steps.at(-1)).toBe("pairCode:failed");
    expect(d.claim).not.toHaveBeenCalled();
  });

  it("rejects a tunnel that reaches a different daemon than the SSH session named", async () => {
    const d = deps({
      connectTunnel: async () => ({ serverId: "other", hostname: null }),
    });
    await expect(run("tunnel", d).promise).rejects.toMatchObject({
      step: "pair",
      code: "server_mismatch",
    });
  });

  it("still connects a tunnel when no pairing code is available, unverified", async () => {
    const d = deps({
      pairCode: async () => Promise.reject(new Error("already claimed")),
    });
    const { promise, steps } = run("tunnel", d);
    await expect(promise).resolves.toMatchObject({ verified: false });
    expect(steps).toContain("pairCode:skipped");
  });

  it("needs a pairing code for LAN and maps claim failures to actionable codes", async () => {
    await expect(
      run("lan", deps({ pairCode: async () => Promise.reject(new Error("claimed")) })).promise,
    ).rejects.toMatchObject({
      step: "pairCode",
      code: "pair_code_unavailable",
    });
    const unreachable = Object.assign(new Error("no answer"), {
      code: "unreachable",
    });
    await expect(
      run("lan", deps({ claim: async () => Promise.reject(unreachable) })).promise,
    ).rejects.toMatchObject({ step: "pair", code: "unreachable" });
  });

  it("stops on unsupported platforms and SSH failures before installing", async () => {
    const windows = deps({
      probe: async () => ({ ...PROBE, os: "MINGW64_NT" }),
    });
    await expect(run("tunnel", windows).promise).rejects.toMatchObject({
      step: "connect",
      code: "unsupported_platform",
    });
    expect(windows.install).not.toHaveBeenCalled();
    await expect(
      run(
        "tunnel",
        deps({
          probe: async () => Promise.reject(new Error("Permission denied")),
        }),
      ).promise,
    ).rejects.toMatchObject({
      code: "ssh_failed",
      detail: "Permission denied",
    });
  });

  it("reports cancellation during install as cancelled", async () => {
    const controller = new AbortController();
    const d = deps({
      install: async () => {
        controller.abort();
        throw Object.assign(new Error("Cancelled"), { cancelled: true });
      },
    });
    await expect(run("tunnel", d, controller.signal).promise).rejects.toMatchObject({
      step: "install",
      code: "cancelled",
    });
    expect(d.pairCode).not.toHaveBeenCalled();
  });

  it("builds the SSH target from a config alias or manual fields", () => {
    const base = {
      mode: "manual" as const,
      alias: null,
      host: "box.lan",
      user: "alice",
      sshPortText: "2222",
      identityFile: "",
      daemonPortText: "",
      network: "lan" as const,
      defaultDaemonPort: 9999,
    };
    expect(resolveDeployTarget({ ...base, mode: "config", alias: "prod" })).toEqual({
      ok: true,
      target: { host: "prod" },
      daemonPort: 9999,
    });
    expect(resolveDeployTarget({ ...base, identityFile: "~/.ssh/id_deploy" })).toEqual({
      ok: true,
      target: {
        host: "alice@box.lan",
        sshPort: 2222,
        identityFile: "~/.ssh/id_deploy",
      },
      daemonPort: 9999,
    });
    const errors = [
      [{ mode: "config" as const }, "hostRequired"],
      [{ host: "" }, "hostRequired"],
      [{ host: "-oProxyCommand=x" }, "invalidHost"],
      [{ user: "a b" }, "invalidHost"],
      [{ sshPortText: "70000" }, "invalidSshPort"],
      [{ daemonPortText: "x" }, "invalidDaemonPort"],
      [{ identityFile: "id_rsa" }, "invalidKeyFile"],
      [{ identityFile: "~/.ssh/k", network: "tunnel" as const }, "tunnelKeyUnsupported"],
    ] as const;
    for (const [override, error] of errors)
      expect(resolveDeployTarget({ ...base, ...override })).toEqual({
        ok: false,
        error,
      });
  });

  it("chooses the listen address and the re-deploy action", () => {
    expect(deployListenAddress("tunnel", 7000)).toBe("127.0.0.1:7000");
    expect(deployListenAddress("lan", 7000)).toBe("0.0.0.0:7000");
    expect(deployAction(PROBE, "1.0.0")).toBe("deploy");
    expect(deployAction({ hasFrogg: { installed: true, version: "1.0.0" } }, "v1.0.0")).toBe(
      "reinstall",
    );
    expect(deployAction({ hasFrogg: { installed: true, version: "0.9.0" } }, "1.0.0")).toBe(
      "upgrade",
    );
  });
});
