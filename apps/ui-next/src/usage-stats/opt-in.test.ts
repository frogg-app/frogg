import { beforeEach, describe, expect, test, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner" as string | undefined,
  config: { usageStats: false } as { usageStats?: boolean } | null,
  refuse: false,
  connected: true,
  patches: [] as unknown[],
  consent: [] as boolean[],
}));

vi.mock("../daemon/store", () => ({
  getClient: () =>
    state.connected ? { getLastServerInfoMessage: () => ({ callerRole: state.role }) } : null,
}));
vi.mock("../daemon/config", () => ({
  useConfig: { getState: () => ({ config: state.config }) },
  loadConfig: async () => undefined,
  patchConfig: async (patch: { usageStats?: boolean }) => {
    state.patches.push(patch);
    if (!state.refuse && state.config) state.config = { ...state.config, ...patch };
  },
}));
vi.mock("./store", () => ({
  setUsageStatsConsent: (on: boolean) => state.consent.push(on),
}));

const { hostOptInAction, optInToUsageStats } = await import("./opt-in");

beforeEach(() => {
  Object.assign(state, {
    role: "owner",
    config: { usageStats: false },
    refuse: false,
    connected: true,
    patches: [],
    consent: [],
  });
});

describe("opting in to usage statistics", () => {
  test("an owner's opt-in turns the host's statistics on too", async () => {
    expect(await optInToUsageStats()).toBe("enabled");
    expect(state.consent).toEqual([true]);
    expect(state.patches).toEqual([{ usageStats: true }]);
  });

  test.each(["operator", "viewer", undefined])(
    "a %s's opt-in leaves the host alone",
    async (role) => {
      state.role = role;
      expect(await optInToUsageStats()).toBe("not_owner");
      expect(state.consent).toEqual([true]);
      expect(state.patches).toEqual([]);
    },
  );

  test("a host already on is not patched again", async () => {
    state.config = { usageStats: true };
    expect(await optInToUsageStats()).toBe("already");
    expect(state.patches).toEqual([]);
  });

  test("an older daemon without the setting is left alone", async () => {
    state.config = {};
    expect(await optInToUsageStats()).toBe("unsupported");
    expect(state.patches).toEqual([]);
  });

  test("no host connected still opts the app in", async () => {
    state.connected = false;
    expect(await optInToUsageStats()).toBe("unsupported");
    expect(state.consent).toEqual([true]);
  });

  test("a refused patch reports failure", async () => {
    state.refuse = true;
    expect(await optInToUsageStats()).toBe("failed");
  });

  test("the decision on its own", () => {
    expect(hostOptInAction("owner", false)).toBe("enable");
    expect(hostOptInAction("owner", undefined)).toBe("unsupported");
    expect(hostOptInAction("operator", false)).toBe("not_owner");
    expect(hostOptInAction("owner", true)).toBe("already");
  });
});
