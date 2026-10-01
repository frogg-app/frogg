import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import type { ChildProcess } from "node:child_process";
import { brand } from "@frogg/branding";
import pino from "pino";
import { afterEach, describe, expect, test } from "vitest";
import type { SessionOutboundMessage } from "../../messages.js";
import {
  BetaChannelService,
  parseScriptHeader,
  repairStaleBetaServiceListen,
  sha256Hex,
  type BetaChannelServiceOptions,
  type SpawnInstallerScript,
} from "./beta-channel-service.js";
import { selectBetaRelease } from "./beta-release.js";

const beta = brand.channels.beta;
const dirs: string[] = [];
function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "beta-channel-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scriptFor(overrides: Record<string, string> = {}): string {
  const header = {
    ID: beta.id,
    APPLICATION_ID: beta.applicationId,
    ENV_PREFIX: "FROGG_BETA",
    SERVICE: beta.serviceName,
    CHANNEL: "beta",
    LEGACY: "false",
    ...overrides,
  };
  return [
    "#!/usr/bin/env bash",
    "# BEGIN BRAND DEFAULTS",
    ...Object.entries(header).map(([key, value]) => `BRAND_${key}='${value}'`),
    "# END BRAND DEFAULTS",
    "echo installing",
  ].join("\n");
}

function release(
  tag: string,
  opts: { draft?: boolean; prerelease?: boolean; scripts?: Record<string, string> } = {},
) {
  return {
    tag_name: tag,
    draft: opts.draft ?? false,
    prerelease: opts.prerelease ?? true,
    html_url: `https://github.com/frogg-app/frogg/releases/tag/${tag}`,
    published_at: "2026-09-01T00:00:00Z",
    assets: Object.entries(opts.scripts ?? {}).map(([name, content]) => ({
      name,
      browser_download_url: `https://github.com/frogg-app/frogg/releases/download/${tag}/${name}`,
      digest: `sha256:${sha256Hex(Buffer.from(content))}`,
    })),
  };
}

function fakeFetch(releases: unknown[], files: Record<string, string> = {}): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("api.github.com") || url.includes("/releases?")) {
      return new Response(JSON.stringify(releases), { status: 200 });
    }
    const content = files[url];
    if (content === undefined) return new Response("missing", { status: 404 });
    return new Response(content, { status: 200 });
  }) as typeof fetch;
}

interface SpawnCall {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

function fakeSpawn(opts: { lines?: string[]; code?: number } = {}) {
  const calls: SpawnCall[] = [];
  const spawnScript: SpawnInstallerScript = (command, args, options) => {
    calls.push({ command, args, env: options.env });
    const child = new EventEmitter() as ChildProcess;
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    Object.assign(child, { stdout, stderr, kill: () => true });
    setImmediate(() => {
      for (const line of opts.lines ?? []) stdout.write(`${line}\n`);
      stdout.end();
      stderr.end();
      setImmediate(() => child.emit("close", opts.code ?? 0, null));
    });
    return child;
  };
  return { calls, spawnScript };
}

function makeService(overrides: Partial<BetaChannelServiceOptions> = {}) {
  const messages: SessionOutboundMessage[] = [];
  const service = new BetaChannelService({
    logger: pino({ level: "silent" }),
    env: { PATH: "/usr/bin", FROGG_HOME: "/stable/home", FROGG_LISTEN: "0.0.0.0:9999" },
    platform: "linux",
    homedir: makeDir(),
    tmpdir: makeDir(),
    selfChannel: "stable",
    isDocker: () => false,
    probeDaemon: async () => null,
    probeWeb: async () => false,
    fetchImpl: fakeFetch([]),
    ...overrides,
  });
  service.setBroadcaster((msg) => messages.push(msg));
  return { service, messages };
}

function installBeta(homedir: string, version: string) {
  const current = path.join(homedir, ".local", "share", beta.id, "current");
  mkdirSync(current, { recursive: true });
  writeFileSync(path.join(current, "manifest.json"), JSON.stringify({ version }));
}

describe("selectBetaRelease", () => {
  test("picks the newest published beta by version, skipping drafts and stable releases", () => {
    const picked = selectBetaRelease([
      release("v1.7.0-beta.1", { draft: true }),
      release("v1.6.5-beta.2"),
      release("v1.6.5-beta.10"),
      release("v1.6.4", { prerelease: false }),
      release("v1.6.9-beta.1", { prerelease: false }),
    ]);
    expect(picked?.version).toBe("1.6.5-beta.10");
  });

  test("an exact version must still be a published beta", () => {
    const releases = [release("v1.6.5-beta.2"), release("v1.6.4", { prerelease: false })];
    expect(selectBetaRelease(releases, "1.6.5-beta.2")?.tagName).toBe("v1.6.5-beta.2");
    expect(selectBetaRelease(releases, "1.6.4")).toBeNull();
  });
});

describe("parseScriptHeader", () => {
  test("reads the brand defaults block", () => {
    expect(parseScriptHeader(scriptFor())).toMatchObject({ ID: beta.id, CHANNEL: "beta" });
  });
});

describe("BetaChannelService.status", () => {
  test("reports installed, running and latest beta", async () => {
    const { service } = makeService({
      probeDaemon: async (port) => (port === beta.daemonPort ? { version: "1.6.5-beta.1" } : null),
      fetchImpl: fakeFetch([release("v1.6.5-beta.2"), release("v1.6.5-beta.1")]),
    });
    installBeta((service as unknown as { homedir: string }).homedir, "1.6.5-beta.1");
    const status = await service.status();
    expect(status).toMatchObject({
      supported: true,
      reason: null,
      selfIsBeta: false,
      installed: true,
      installedVersion: "1.6.5-beta.1",
      running: true,
      runningVersion: "1.6.5-beta.1",
      port: beta.daemonPort,
      serviceName: beta.serviceName,
      latestVersion: "1.6.5-beta.2",
      latestError: null,
      run: null,
    });
  });

  test("reports a failed release lookup without failing the status", async () => {
    const { service } = makeService({
      fetchImpl: (async () => new Response("", { status: 503 })) as typeof fetch,
    });
    const status = await service.status();
    expect(status.installed).toBe(false);
    expect(status.latestVersion).toBeNull();
    expect(status.latestError).toContain("503");
  });

  test.each([
    [{ selfChannel: "beta" as const }, "itself"],
    [{ platform: "win32" as const }, "Windows"],
    [{ isDocker: () => true }, "Docker"],
    [{ modulePath: "/nix/store/abc-frogg/dist/bootstrap.js" }, "Nix"],
  ])("refuses where it cannot manage the beta (%#)", async (overrides, reason) => {
    const { service } = makeService(overrides);
    const status = await service.status();
    expect(status.supported).toBe(false);
    expect(status.reason).toContain(reason);
    const started = service.install();
    expect(started.accepted).toBe(false);
    expect(started.error).toContain(reason);
  });
});

describe("BetaChannelService.install", () => {
  function setup(opts: { script?: string; digestOf?: string; code?: number } = {}) {
    const script = opts.script ?? scriptFor();
    const rel = release("v1.6.5-beta.3", { scripts: { "install.sh": opts.digestOf ?? script } });
    const url = rel.assets[0]!.browser_download_url;
    const spawn = fakeSpawn({ lines: ["[frogg-beta] installed", "done"], code: opts.code });
    const made = makeService({
      fetchImpl: fakeFetch([rel, release("v1.6.5-beta.1")], { [url]: script }),
      spawnScript: spawn.spawnScript,
    });
    return { ...made, spawn };
  }

  test("runs the verified beta install.sh with the stable daemon's env scrubbed", async () => {
    const { service, messages, spawn } = setup();
    const started = service.install();
    expect(started).toMatchObject({ accepted: true, error: null });
    await service.idle();

    expect(spawn.calls).toHaveLength(1);
    const env = spawn.calls[0]!.env;
    expect(spawn.calls[0]!.command).toBe("bash");
    expect(env.FROGG_HOME).toBeUndefined();
    expect(env.FROGG_LISTEN).toBeUndefined();
    expect(env.FROGG_BETA_VERSION).toBe("1.6.5-beta.3");
    expect(env.PATH).toBe("/usr/bin");

    const progress = messages.filter((m) => m.type === "daemon.beta_channel.run.progress");
    expect(progress.map((m) => m.payload.run.phase)).toEqual(
      expect.arrayContaining(["resolve", "download", "verify", "install", "done"]),
    );
    expect(progress.some((m) => m.payload.logLine === "[frogg-beta] installed")).toBe(true);
    const completed = messages.find((m) => m.type === "daemon.beta_channel.run.completed");
    expect(completed?.payload).toMatchObject({
      runId: started.runId,
      action: "install",
      status: "succeeded",
      version: "1.6.5-beta.3",
      error: null,
    });
    expect((await service.status()).run).toBeNull();
  });

  test("refuses a script whose checksum does not match the release digest", async () => {
    const { service, messages, spawn } = setup({ digestOf: "something else" });
    service.install();
    await service.idle();
    expect(spawn.calls).toHaveLength(0);
    const completed = messages.find((m) => m.type === "daemon.beta_channel.run.completed");
    expect(completed?.payload).toMatchObject({ status: "failed" });
    expect(
      completed?.type === "daemon.beta_channel.run.completed" && completed.payload.error,
    ).toContain("checksum mismatch");
  });

  test("refuses a script that would install another channel", async () => {
    const { service, messages, spawn } = setup({ script: scriptFor({ CHANNEL: "stable" }) });
    service.install();
    await service.idle();
    expect(spawn.calls).toHaveLength(0);
    const completed = messages.find((m) => m.type === "daemon.beta_channel.run.completed");
    expect(completed?.payload).toMatchObject({ status: "failed" });
  });

  test("reports an installer failure with its last output line", async () => {
    const { service, messages } = setup({ code: 1 });
    service.install();
    await service.idle();
    const completed = messages.find((m) => m.type === "daemon.beta_channel.run.completed");
    expect(completed?.payload).toMatchObject({ status: "failed" });
    expect(
      completed?.type === "daemon.beta_channel.run.completed" && completed.payload.error,
    ).toContain("exited with 1");
  });

  test("allows one run at a time", async () => {
    const { service } = setup();
    const first = service.install();
    const second = service.install({ version: "1.6.5-beta.1" });
    expect(second).toMatchObject({ accepted: false, runId: first.runId });
    await service.idle();
  });

  test("an unknown version fails the run", async () => {
    const { service, messages, spawn } = setup();
    service.install({ version: "9.9.9-beta.1" });
    await service.idle();
    expect(spawn.calls).toHaveLength(0);
    const completed = messages.find((m) => m.type === "daemon.beta_channel.run.completed");
    expect(completed?.payload).toMatchObject({ status: "failed" });
  });
});

describe("BetaChannelService.uninstall", () => {
  test("refuses when the beta is not installed", () => {
    const { service } = makeService();
    expect(service.uninstall()).toMatchObject({ accepted: false });
  });

  test("runs the installed release's uninstall.sh and passes purge", async () => {
    const script = scriptFor({ CHANNEL: "" });
    const rel = release("v1.6.5-beta.1", { scripts: { "uninstall.sh": script } });
    const spawn = fakeSpawn();
    const { service, messages } = makeService({
      fetchImpl: fakeFetch([release("v1.6.5-beta.3"), rel], {
        [rel.assets[0]!.browser_download_url]: script,
      }),
      spawnScript: spawn.spawnScript,
    });
    installBeta((service as unknown as { homedir: string }).homedir, "1.6.5-beta.1");
    expect(service.uninstall({ purge: true })).toMatchObject({ accepted: true });
    await service.idle();
    expect(spawn.calls[0]?.env.FROGG_BETA_PURGE).toBe("1");
    const completed = messages.find((m) => m.type === "daemon.beta_channel.run.completed");
    expect(completed?.payload).toMatchObject({ action: "uninstall", status: "succeeded" });
  });
});

describe("repairStaleBetaServiceListen", () => {
  const unit = (listen: string) =>
    `[Service]\nExecStart=/x daemon start\nEnvironment=FROGG_BETA_LISTEN=${listen}\nEnvironment=FROGG_BETA_WEB_UI_ENABLED=true\n`;
  const input = { envKey: "FROGG_BETA_LISTEN", stalePort: 9998, port: 9989 };

  test("moves a unit on the retired port to the beta's port, keeping the bind host", () => {
    expect(repairStaleBetaServiceListen(unit("0.0.0.0:9998"), input)).toBe(unit("0.0.0.0:9989"));
  });

  test("leaves a port chosen on purpose, or one already right, alone", () => {
    expect(repairStaleBetaServiceListen(unit("0.0.0.0:7000"), input)).toBeNull();
    expect(repairStaleBetaServiceListen(unit("0.0.0.0:9989"), input)).toBeNull();
    expect(repairStaleBetaServiceListen(unit("0.0.0.0:99980"), input)).toBeNull();
  });
});

describe("BetaChannelService beta-side control and repair", () => {
  test("a beta daemon stops itself through its own CLI after replying", async () => {
    const homedir = makeDir();
    installBeta(homedir, "1.6.7-beta.3");
    const cli = path.join(homedir, ".local", "share", beta.id, "current", "bin", beta.cliName);
    mkdirSync(path.dirname(cli), { recursive: true });
    writeFileSync(cli, "");
    const spawn = fakeSpawn();
    const { service } = makeService({
      selfChannel: "beta",
      homedir,
      spawnScript: spawn.spawnScript,
    });

    expect(await service.setRunning(true)).toBeNull();
    expect(await service.setRunning(false)).toBeNull();
    expect(spawn.calls).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, 700));
    expect(spawn.calls).toEqual([
      expect.objectContaining({ command: cli, args: ["daemon", "stop"] }),
    ]);
    expect(spawn.calls[0]!.env.FROGG_LISTEN).toBeUndefined();
  });

  test("the stable daemon moves a beta unit off the stable web client's port", async () => {
    const homedir = makeDir();
    const unitDir = path.join(homedir, ".config", "systemd", "user");
    mkdirSync(unitDir, { recursive: true });
    const unit = path.join(unitDir, `${beta.serviceName}.service`);
    const envKey = `${brand.channels.stable.id.toUpperCase()}_BETA_LISTEN`;
    writeFileSync(
      unit,
      `[Service]\nEnvironment=${envKey}=0.0.0.0:${brand.channels.stable.webPort}\n`,
    );
    const systemctl: string[][] = [];
    const { service } = makeService({
      homedir,
      runSystemctl: (args) => {
        systemctl.push(args);
        return 0;
      },
    });

    await service.status();
    await service.status();

    expect(readFileSync(unit, "utf8")).toContain(`${envKey}=0.0.0.0:${beta.daemonPort}`);
    expect(systemctl).toEqual([
      ["daemon-reload"],
      ["is-active", "--quiet", beta.serviceName],
      ["restart", beta.serviceName],
    ]);
  });
});
