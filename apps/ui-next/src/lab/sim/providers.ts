// Provider installs for the lab: two providers the host hasn't got, which install in a few
// seconds and then turn ready. Enabled flags follow the simulated daemon config.
import { useConfig } from "../../daemon/config";
import { providers as fixture } from "../fixtures";
import { labWait, latency } from "./time";

interface Missing {
  provider: string;
  label: string;
  version: string;
  installed: boolean;
  /** The next install fails (shows the error state); cleared after one attempt. */
  fails?: boolean;
}

const start = (): Missing[] => [
  { provider: "copilot", label: "Copilot", version: "1.0.8", installed: false },
  { provider: "opencode", label: "OpenCode", version: "0.15.2", installed: false },
];
let missing: Missing[] = start();
/** No provider ready (lab control): the fixture providers report a sign-in error. */
let noneReady = false;

export function resetProviderInstalls(): void {
  missing = start();
  noneReady = false;
}

/** Make the next install of `provider` fail (lab control). */
export function failNextInstall(provider: string): void {
  missing = missing.map((m) => (m.provider === provider ? { ...m, fails: true } : m));
}

/** Start with no provider ready (lab control). */
export function setNoProviderReady(on: boolean): void {
  noneReady = on;
}

function enabled(provider: string): boolean {
  const cfg = useConfig.getState().config as { providers?: Record<string, { enabled?: boolean }> };
  return cfg?.providers?.[provider]?.enabled ?? true;
}

function snapshot() {
  const base = fixture.entries.map((e) => ({
    ...e,
    enabled: enabled(e.provider),
    ...(noneReady ? { status: "error", error: "Not signed in. Run `claude` on the host." } : {}),
  }));
  const extra = missing.map((m) => ({
    provider: m.provider,
    label: m.label,
    status: m.installed ? "ready" : "unavailable",
    enabled: enabled(m.provider),
    models: [],
  }));
  return { ...fixture, entries: [...base, ...extra] };
}

function updates() {
  const have = fixture.entries.map((e) => ({
    provider: e.provider,
    status: "up-to-date",
    installedVersion: "2.1.0",
    latestVersion: "2.1.0",
    packageName: null,
    updatable: true,
    binaryPath: `/usr/local/bin/${e.provider}`,
    manualInstallUrl: null,
    error: null,
  }));
  const rest = missing.map((m) => ({
    provider: m.provider,
    status: m.installed ? "up-to-date" : "not-installed",
    installedVersion: m.installed ? m.version : null,
    latestVersion: m.version,
    packageName: m.provider,
    updatable: true,
    binaryPath: m.installed ? `/usr/local/bin/${m.provider}` : null,
    manualInstallUrl: null,
    error: null,
  }));
  return {
    requestId: "lab",
    checkedAt: new Date().toISOString(),
    entries: [...have, ...rest],
    preferences: {
      checkEnabled: true,
      autoUpdate: false,
      checkIntervalMinutes: 360,
      ignoredProviders: [],
    },
    error: null,
  };
}

export const providerRpcs = {
  getProvidersSnapshot: async () => snapshot(),
  refreshProvidersSnapshot: async () => {
    await latency(200);
    return { requestId: "lab", ...snapshot() };
  },
  checkProviderUpdates: async () => {
    await latency(250);
    return updates();
  },
  installProviderUpdate: async (o: { provider: string }) => {
    // npm install on a real host takes a while; a few seconds reads as work without boring.
    await labWait(2600);
    const m = missing.find((x) => x.provider === o.provider);
    if (!m)
      return {
        requestId: "lab",
        provider: o.provider,
        updated: false,
        previousVersion: null,
        installedVersion: null,
        error: "Already installed",
      };
    if (m.fails) {
      m.fails = false;
      return {
        requestId: "lab",
        provider: o.provider,
        updated: false,
        previousVersion: null,
        installedVersion: null,
        output: "npm ERR! code EACCES",
        error: "npm exited with code 243 (permission denied writing the global prefix)",
      };
    }
    m.installed = true;
    return {
      requestId: "lab",
      provider: o.provider,
      updated: true,
      previousVersion: null,
      installedVersion: m.version,
      error: null,
    };
  },
};
