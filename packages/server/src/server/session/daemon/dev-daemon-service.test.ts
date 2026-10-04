import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { PersistedWorkspaceRecord } from "../../workspace-registry.js";
import { DevDaemonService } from "./dev-daemon-service.js";

let root: string;

async function makeCheckout(name: string, withModules = true): Promise<string> {
  const cwd = path.join(root, name);
  await mkdir(path.join(cwd, "scripts", "dev"), { recursive: true });
  await writeFile(path.join(cwd, "scripts", "dev", "preview.mts"), "");
  await writeFile(
    path.join(cwd, "package.json"),
    JSON.stringify({ scripts: { "dev:live": "node preview" } }),
  );
  if (withModules) await mkdir(path.join(cwd, "node_modules"));
  return cwd;
}

function workspace(cwd: string, extra: Partial<PersistedWorkspaceRecord> = {}) {
  return {
    cwd,
    title: path.basename(cwd),
    displayName: path.basename(cwd),
    branch: "feature",
    archivedAt: null,
    ...extra,
  } as PersistedWorkspaceRecord;
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "dev-daemon-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

function createService(
  overrides: {
    alive?: Set<number>;
    env?: NodeJS.ProcessEnv;
    siblingWorkspaceFiles?: string[];
  } = {},
) {
  const alive = overrides.alive ?? new Set<number>();
  let nextPid = 4242;
  const spawnLauncher = vi.fn((_cwd: string, _env: NodeJS.ProcessEnv, _log: string) => {
    const pid = nextPid++;
    alive.add(pid);
    return { pid, unref: () => undefined };
  });
  const killGroup = vi.fn((pid: number) => {
    alive.delete(pid);
  });
  const service = new DevDaemonService({
    logger: createTestLogger(),
    siblingWorkspaceFiles: overrides.siblingWorkspaceFiles,
    platform: "linux",
    env: overrides.env ?? {
      FROGG_HOME: "/stable",
      FROGG_LISTEN: "0.0.0.0:9999",
      PATH: "/bin",
    },
    spawnLauncher,
    isAlive: (pid) => alive.has(pid),
    killGroup,
    startupCheckMs: 0,
  });
  return { service, spawnLauncher, killGroup, alive };
}

describe("DevDaemonService", () => {
  test("lists only unarchived source checkouts among the workspaces", async () => {
    const checkout = await makeCheckout("frogg");
    const other = path.join(root, "other");
    await mkdir(other);
    const { service } = createService();

    const status = await service.status([
      workspace(checkout),
      workspace(checkout),
      workspace(other),
      workspace(await makeCheckout("archived"), {
        archivedAt: "2026-01-01T00:00:00Z",
      }),
    ]);

    expect(status.checkouts).toEqual([{ cwd: checkout, name: "frogg", branch: "feature" }]);
    expect(status).toMatchObject({
      supported: true,
      running: false,
      instances: [],
    });
  });

  test("also offers the checkouts in a sibling channel's workspace registry", async () => {
    const checkout = await makeCheckout("frogg");
    const registry = path.join(root, "stable-workspaces.json");
    await writeFile(
      registry,
      JSON.stringify([
        {
          cwd: checkout,
          title: null,
          displayName: "frogg",
          branch: "main",
          archivedAt: null,
        },
        {
          cwd: path.join(root, "missing"),
          displayName: "missing",
          archivedAt: null,
        },
      ]),
    );
    const { service } = createService({
      siblingWorkspaceFiles: [registry, path.join(root, "absent.json")],
    });

    const status = await service.status([]);

    expect(status.checkouts).toEqual([{ cwd: checkout, name: "frogg", branch: "main" }]);
  });

  test("launches dev:live without the stable daemon's own settings or ports", async () => {
    const checkout = await makeCheckout("frogg");
    const { service, spawnLauncher } = createService({
      env: {
        FROGG_HOME: "/stable",
        PREVIEW_PORT: "1",
        LIVE_DAEMON_PORT: "2",
        PATH: "/bin",
      },
    });

    expect(await service.start(checkout)).toBeNull();

    const env = spawnLauncher.mock.calls[0]![1];
    expect(env.FROGG_HOME).toBeUndefined();
    expect(env.PREVIEW_PORT).toBeUndefined();
    expect(env.LIVE_DAEMON_PORT).toBeUndefined();
    expect(env.PATH).toBe("/bin");
    const status = await service.status([workspace(checkout)]);
    expect(status.instances).toMatchObject([
      {
        cwd: checkout,
        branch: "feature",
        ready: false,
        daemonPort: null,
        canRebuild: false,
      },
    ]);
    expect(status).toMatchObject({ running: true, cwd: checkout });
  });

  test("runs one dev build per checkout, side by side, and stops them one at a time", async () => {
    const first = await makeCheckout("first");
    const second = await makeCheckout("second");
    const { service, spawnLauncher, killGroup } = createService();

    await service.start(first);
    await service.start(second);
    expect(await service.start(first)).toBeNull();
    expect(spawnLauncher).toHaveBeenCalledTimes(2);
    expect(killGroup).not.toHaveBeenCalled();
    const record = JSON.parse(
      await readFile(path.join(second, ".dev", "live", "launcher.json"), "utf8"),
    );
    expect(record.pid).toBe(4243);

    const workspaces = [workspace(first), workspace(second)];
    expect((await service.status(workspaces)).instances?.map((i) => i.cwd)).toEqual([
      first,
      second,
    ]);
    expect(await service.stop(first)).toBeNull();
    expect(killGroup).toHaveBeenCalledWith(4242, "SIGTERM");
    expect((await service.status(workspaces)).instances?.map((i) => i.cwd)).toEqual([second]);
  });

  test("a bare stop, as older clients send, stops every dev build", async () => {
    const first = await makeCheckout("first");
    const second = await makeCheckout("second");
    const { service, alive } = createService();
    await service.start(first);
    await service.start(second);
    await service.status([workspace(first), workspace(second)]);

    expect(await service.stop()).toBeNull();
    expect(alive.size).toBe(0);
  });

  test("refuses a folder that is not a checkout, or one without dependencies", async () => {
    const bare = await makeCheckout("bare", false);
    const { service, spawnLauncher } = createService();

    expect(await service.start(root)).toMatch(/not a .* source checkout/);
    expect(await service.start(bare)).toMatch(/npm ci/);
    expect(spawnLauncher).not.toHaveBeenCalled();
  });

  test("a launcher that dies while starting reports its log's error", async () => {
    const checkout = await makeCheckout("frogg");
    const service = new DevDaemonService({
      logger: createTestLogger(),
      platform: "linux",
      env: {},
      spawnLauncher: (_cwd, _env, logPath) => {
        writeFileSync(
          logPath,
          "\u001b[31mError: Another brand is being built\u001b[0m\n    at x\n",
        );
        return { pid: 99, unref: () => undefined };
      },
      isAlive: () => false,
      startupCheckMs: 0,
    });

    expect(await service.start(checkout)).toBe(
      "The dev build exited while starting: Error: Another brand is being built",
    );
    expect((await service.status([])).running).toBe(false);
  });

  test("a dev build reports and rebuilds itself through its launcher", async () => {
    await mkdir(path.join(root, ".dev", "live"), { recursive: true });
    const control = path.join(root, ".dev", "live", "control.json");
    await writeFile(
      control,
      JSON.stringify({
        url: "http://launcher.test",
        token: "t0k",
        pid: 77,
        daemonPort: 41000,
      }),
    );
    const requests: Array<{
      url: string;
      method: string;
      auth: string | null;
    }> = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      requests.push({
        url,
        method: init?.method ?? "GET",
        auth: headers.get("authorization"),
      });
      if (url.endsWith("/status")) {
        return Response.json({
          daemon: {
            running: true,
            stale: ["protocol or client source changed"],
          },
          web: { running: false, stale: [] },
          busy: null,
          lastError: null,
          behindMain: 3,
          branch: "feature",
          daemonPort: 41000,
          webPort: 41001,
        });
      }
      return Response.json({ accepted: true }, { status: 202 });
    }) as typeof fetch;
    const service = new DevDaemonService({
      logger: createTestLogger(),
      platform: "linux",
      env: { FROGG_DEV_CONTROL_FILE: control, FROGG_DEV_ROOT: root },
      isAlive: (pid) => pid === 77,
      fetchImpl,
    });

    const status = await service.status([]);
    expect(status).toMatchObject({
      supported: true,
      isSelf: true,
      running: true,
      ready: true,
      webReady: false,
      daemonStale: ["protocol or client source changed"],
      behindMain: 3,
      branch: "feature",
      canRebuild: true,
      cwd: root,
      selfCwd: root,
      daemonPort: 41000,
      webPort: 41001,
    });
    expect(await service.rebuild("daemon")).toBeNull();
    expect(requests.at(-1)).toEqual({
      url: "http://launcher.test/rebuild?target=daemon",
      method: "POST",
      auth: "Bearer t0k",
    });
    expect(await service.stop(root)).toMatch(/stop it from the stable or beta daemon/);
  });

  test("adopts a dev:live started by hand in one of the checkouts", async () => {
    const checkout = await makeCheckout("frogg");
    await mkdir(path.join(checkout, ".dev", "live"), { recursive: true });
    await writeFile(
      path.join(checkout, ".dev", "live", "control.json"),
      JSON.stringify({ url: "http://launcher.test", token: "t", pid: 55 }),
    );
    const service = new DevDaemonService({
      logger: createTestLogger(),
      platform: "linux",
      env: {},
      isAlive: (pid) => pid === 55,
      fetchImpl: (async () => new Response("", { status: 500 })) as typeof fetch,
    });

    expect((await service.status([workspace(checkout)])).instances).toMatchObject([
      { cwd: checkout, canRebuild: true, ready: false },
    ]);
  });

  test("stop clears a launcher that already exited", async () => {
    const checkout = await makeCheckout("frogg");
    const { service, alive } = createService();
    await service.start(checkout);
    alive.clear();

    expect(await service.stop(checkout)).toBeNull();
    expect((await service.status([workspace(checkout)])).running).toBe(false);
  });
});
