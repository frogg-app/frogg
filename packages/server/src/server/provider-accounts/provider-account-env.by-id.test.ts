import { describe, expect, it } from "vitest";
import {
  findProviderAccountCapability,
  providerAccountDefaultId,
} from "@frogg/protocol/provider-accounts";
import { resolveProviderAccountEnvById } from "./provider-account-env.js";

function storeWith(
  enabled: boolean,
  accounts: Record<string, { provider: string; configDir: string }> = {},
) {
  return {
    getCapability: (provider: string) => {
      const capability = findProviderAccountCapability(provider);
      return capability ? { ...capability, enabled } : undefined;
    },
    findAccount: (id: string) => accounts[id] as never,
  };
}

describe("resolveProviderAccountEnvById", () => {
  it("signs in a provider's default account even when extra accounts are opt-in", () => {
    const launch = resolveProviderAccountEnvById(
      storeWith(false),
      providerAccountDefaultId("gemini"),
    );
    expect(launch).not.toBeNull();
    expect(launch?.env).toEqual({});
    expect(launch?.loginCommand.command).toBe(
      findProviderAccountCapability("gemini")!.loginCommand.command,
    );
  });

  it("still refuses an extra account while its provider's accounts are disabled", () => {
    const store = storeWith(false, {
      extra: { provider: "gemini", configDir: "/h/.gemini-x" },
    });
    expect(resolveProviderAccountEnvById(store, "extra")).toBeNull();
  });

  it("returns null for a default id of an unknown provider", () => {
    expect(
      resolveProviderAccountEnvById(storeWith(true), providerAccountDefaultId("nope")),
    ).toBeNull();
  });
});
