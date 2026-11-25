import { MutableDaemonConfigPatchSchema } from "@frogg/protocol/messages";
import { describe, expect, it } from "vitest";
import { addableProviders, catalogProviderPatch, PROVIDER_CATALOG } from "./provider-catalog";

describe("provider catalog", () => {
  it("offers Gemini until the host lists it", () => {
    expect(addableProviders(["claude", "codex"]).map((p) => p.id)).toContain("gemini");
    expect(addableProviders(["claude", "gemini"]).map((p) => p.id)).not.toContain("gemini");
  });

  it("installs Gemini as an enabled ACP provider the daemon accepts", () => {
    const gemini = PROVIDER_CATALOG.find((p) => p.id === "gemini")!;
    const patch = catalogProviderPatch(gemini);
    expect(MutableDaemonConfigPatchSchema.parse(patch)).toEqual(patch);
    expect(patch.providers?.gemini).toEqual({
      extends: "acp",
      label: "Gemini CLI",
      description: "Google's official CLI for Gemini",
      command: ["npx", "-y", "@google/gemini-cli@0.52.0", "--acp"],
      env: {},
      enabled: true,
    });
  });
});
