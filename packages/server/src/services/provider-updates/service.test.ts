import { describe, expect, it, vi, beforeEach } from "vitest";
import pino from "pino";

import { ProviderUpdateService } from "./service.js";
import { compareVersions, extractVersion, isNewerVersion } from "./version.js";
import type { ProviderUpdateDescriptor } from "@frogg/protocol/provider-updates";

const { findExecutableMock, execCommandMock } = vi.hoisted(() => ({
  findExecutableMock: vi.fn(),
  execCommandMock: vi.fn(),
}));

vi.mock("../../executable-resolution/executable-resolution.js", () => ({
  findExecutable: findExecutableMock,
  executableExists: vi.fn(),
}));

vi.mock("../../utils/spawn.js", () => ({
  execCommand: execCommandMock,
}));

const logger = pino({ level: "silent" });

const DESCRIPTORS: ProviderUpdateDescriptor[] = [
  {
    provider: "claude",
    binaryNames: ["claude"],
    versionArgs: ["--version"],
    kind: "npm",
    npmPackage: "@anthropic-ai/claude-code",
  },
  {
    provider: "pi",
    binaryNames: ["pi"],
    versionArgs: ["--version"],
    kind: "unmanaged",
  },
];

function registryFetch(versions: Record<string, string>) {
  return vi.fn(async (url: string | URL | Request) => {
    const name = decodeURIComponent(String(url).split("/").pop() ?? "");
    const version = versions[name];
    return {
      ok: version !== undefined,
      status: version === undefined ? 404 : 200,
      json: async () => ({ "dist-tags": { latest: version } }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

function createService(
  options: Partial<ConstructorParameters<typeof ProviderUpdateService>[0]> = {},
) {
  return new ProviderUpdateService({
    logger,
    descriptors: DESCRIPTORS,
    fetch: registryFetch({ "@anthropic-ai/claude-code": "2.0.0" }),
    ...options,
  });
}

beforeEach(() => {
  findExecutableMock.mockReset();
  execCommandMock.mockReset();
});

describe("version helpers", () => {
  it("extracts a version from decorated output", () => {
    expect(extractVersion("1.2.3 (Claude Code)")).toBe("1.2.3");
    expect(extractVersion("codex-cli 0.48.1-alpha.2")).toBe("0.48.1-alpha.2");
    expect(extractVersion("no version here")).toBeNull();
  });

  it("orders releases above prereleases of the same version", () => {
    expect(compareVersions("1.2.3", "1.2.3-beta.1")).toBeGreaterThan(0);
    expect(isNewerVersion("1.3.0", "1.2.9")).toBe(true);
    expect(isNewerVersion("1.2.9", "1.3.0")).toBe(false);
    // An absent installed version means anything published is newer.
    expect(isNewerVersion("1.0.0", null)).toBe(true);
  });
});

describe("ProviderUpdateService.check", () => {
  it("reports an available update when the registry is ahead", async () => {
    findExecutableMock.mockImplementation(async (name: string) =>
      name === "claude" ? "/usr/bin/claude" : null,
    );
    execCommandMock.mockResolvedValue({ stdout: "1.9.0 (Claude Code)", stderr: "" });

    const snapshot = await createService().check();
    const claude = snapshot.entries.find((entry) => entry.provider === "claude");

    expect(claude).toMatchObject({
      status: "update-available",
      installedVersion: "1.9.0",
      latestVersion: "2.0.0",
      updatable: true,
    });
  });

  it("marks a provider we do not distribute as unmanaged rather than stale", async () => {
    findExecutableMock.mockResolvedValue("/usr/bin/pi");
    execCommandMock.mockResolvedValue({ stdout: "0.1.0", stderr: "" });

    const snapshot = await createService().check();
    const pi = snapshot.entries.find((entry) => entry.provider === "pi");

    expect(pi).toMatchObject({ status: "unmanaged", updatable: false, latestVersion: null });
  });

  it("reports a missing binary as not-installed but still names the latest release", async () => {
    findExecutableMock.mockResolvedValue(null);

    const snapshot = await createService().check();
    const claude = snapshot.entries.find((entry) => entry.provider === "claude");

    expect(claude).toMatchObject({
      status: "not-installed",
      installedVersion: null,
      latestVersion: "2.0.0",
    });
  });

  it("serves the cached snapshot until it is forced to refresh", async () => {
    findExecutableMock.mockResolvedValue("/usr/bin/claude");
    execCommandMock.mockResolvedValue({ stdout: "2.0.0", stderr: "" });
    const service = createService();

    await service.check();
    const callsAfterFirst = execCommandMock.mock.calls.length;
    await service.check();
    expect(execCommandMock.mock.calls.length).toBe(callsAfterFirst);

    await service.check({ forceRefresh: true });
    expect(execCommandMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe("ProviderUpdateService.update", () => {
  it("installs and reports the new version", async () => {
    findExecutableMock.mockResolvedValue("/usr/bin/claude");
    execCommandMock
      .mockResolvedValueOnce({ stdout: "1.9.0", stderr: "" })
      .mockResolvedValueOnce({ stdout: "2.0.0", stderr: "" });
    const installer = vi.fn(async () => ({ output: "added 1 package" }));

    const result = await createService({ installer }).update("claude");

    expect(installer).toHaveBeenCalledWith("@anthropic-ai/claude-code", undefined);
    expect(result).toMatchObject({
      updated: true,
      previousVersion: "1.9.0",
      installedVersion: "2.0.0",
      error: null,
    });
  });

  it("refuses a provider it does not distribute", async () => {
    const installer = vi.fn();
    const result = await createService({ installer }).update("pi");

    expect(installer).not.toHaveBeenCalled();
    expect(result.updated).toBe(false);
    expect(result.error).toContain("not installed through a channel");
  });

  it("surfaces an installer failure without claiming an update", async () => {
    findExecutableMock.mockResolvedValue("/usr/bin/claude");
    execCommandMock.mockResolvedValue({ stdout: "1.9.0", stderr: "" });
    const installer = vi.fn(async () => {
      throw new Error("EACCES: permission denied");
    });

    const result = await createService({ installer }).update("claude");

    expect(result.updated).toBe(false);
    expect(result.error).toContain("EACCES");
    expect(result.installedVersion).toBe("1.9.0");
  });

  it("shares one install between concurrent callers", async () => {
    findExecutableMock.mockResolvedValue("/usr/bin/claude");
    execCommandMock.mockResolvedValue({ stdout: "2.0.0", stderr: "" });
    const installer = vi.fn(async () => ({ output: "" }));
    const service = createService({ installer });

    await Promise.all([service.update("claude"), service.update("claude")]);

    expect(installer).toHaveBeenCalledTimes(1);
  });
});
