import { EventEmitter } from "node:events";
import { afterEach, expect, test, vi } from "vitest";

// A brand whose env prefix is *not* FROGG, which is the whole point: under the
// stock brand `${brand.envPrefix}_LISTEN` and `FROGG_LISTEN` are the same
// string, so a hardcoded FROGG_ name passes every stock-brand test and still
// breaks every branded build.
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

import {
  type DaemonLaunchRuntime,
  type DetachedDaemonProcess,
  startLocalDaemonForeground,
} from "./local-daemon.js";

class FakeDaemonProcess extends EventEmitter implements DetachedDaemonProcess {
  pid = 4242;
  unref() {}
}

class RecordingRuntime implements DaemonLaunchRuntime {
  env: NodeJS.ProcessEnv | undefined;
  readonly daemonProcess = new FakeDaemonProcess();

  resolveRunnerEntry(): string {
    return "/repo/packages/server/scripts/supervisor-entrypoint.ts";
  }

  resolveHome(env: NodeJS.ProcessEnv): string {
    return env.ACME_HOME ?? "/tmp/acme";
  }

  spawnDetached(
    _command: string,
    _args: string[],
    options: Parameters<DaemonLaunchRuntime["spawnDetached"]>[2],
  ): DetachedDaemonProcess {
    this.env = options?.env;
    return this.daemonProcess;
  }

  spawnForeground(
    _command: string,
    _args: string[],
    options: Parameters<DaemonLaunchRuntime["spawnForeground"]>[2],
  ) {
    this.env = options?.env;
    return { status: 0, error: undefined };
  }
}

afterEach(() => vi.unstubAllEnvs());

/**
 * The daemon runs `normalizeBrandEnvironment` before reading config: it maps
 * `ACME_*` onto the internal `FROGG_*` names and then deletes every `FROGG_*`
 * key, because a branded build deliberately stops accepting the upstream
 * namespace. An override spawned as `FROGG_LISTEN` is therefore thrown away
 * before it is ever read, and `--listen` / `--port` are silently ignored.
 */
test("daemon start overrides travel under the brand's env prefix, not FROGG_", async () => {
  const runtime = new RecordingRuntime();

  await startLocalDaemonForeground(
    {
      home: "/tmp/acme-home",
      listen: "0.0.0.0:6798",
      hostnames: "acme.internal",
      relayUseTls: true,
      webUi: true,
    },
    runtime,
  );

  expect(runtime.env?.ACME_HOME).toBe("/tmp/acme-home");
  expect(runtime.env?.ACME_LISTEN).toBe("0.0.0.0:6798");
  expect(runtime.env?.ACME_HOSTNAMES).toBe("acme.internal");
  expect(runtime.env?.ACME_RELAY_USE_TLS).toBe("true");
  expect(runtime.env?.ACME_WEB_UI_ENABLED).toBe("true");

  // Nothing may go out under the upstream namespace: the daemon deletes it.
  const upstreamKeys = Object.keys(runtime.env ?? {}).filter(
    (key) =>
      key.startsWith("FROGG_") &&
      ["LISTEN", "HOSTNAMES", "RELAY_USE_TLS", "WEB_UI_ENABLED", "HOME"].some((suffix) =>
        key.endsWith(suffix),
      ),
  );
  expect(upstreamKeys).toEqual([]);
});

test("--port becomes a brand-prefixed listen address", async () => {
  const runtime = new RecordingRuntime();

  await startLocalDaemonForeground({ home: "/tmp/acme-home", port: "6798" }, runtime);

  expect(runtime.env?.ACME_LISTEN).toBe("0.0.0.0:6798");
  expect(runtime.env?.FROGG_LISTEN).toBeUndefined();
});

test("--no-web-ui is passed on as an explicit false, not dropped", async () => {
  const runtime = new RecordingRuntime();

  await startLocalDaemonForeground({ home: "/tmp/acme-home", webUi: false }, runtime);

  expect(runtime.env?.ACME_WEB_UI_ENABLED).toBe("false");
});
