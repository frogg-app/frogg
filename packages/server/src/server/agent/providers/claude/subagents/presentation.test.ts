import { beforeEach, describe, expect, it } from "vitest";

import { seedClaudeModelCatalog } from "../test-utils.js";
import { buildClaudeSubagentSubtitle } from "./presentation.js";

describe("buildClaudeSubagentSubtitle", () => {
  beforeEach(() => {
    seedClaudeModelCatalog();
  });

  it("formats Claude facts into one compact provider-owned label", () => {
    expect(
      buildClaudeSubagentSubtitle({
        title: "general-purpose",
        model: "claude-opus-5",
        effort: "high",
        usage: { totalTokens: 16_484 },
      }),
    ).toBe("general-purpose · Opus 5 · High · 16.5k tokens");
  });

  it("uses the reported label for context-window model variants", () => {
    expect(buildClaudeSubagentSubtitle({ model: "claude-opus-4-8[1m]" })).toBe("Opus 4.8 1M");
  });

  it("keeps unknown compatible-provider model names visible", () => {
    expect(buildClaudeSubagentSubtitle({ model: "glm-5.1" })).toBe("glm-5.1");
  });

  it("omits facts that were not observed", () => {
    expect(buildClaudeSubagentSubtitle({ title: "Explore", usage: { totalTokens: 0 } })).toBe(
      "Explore",
    );
    expect(buildClaudeSubagentSubtitle({})).toBeUndefined();
  });
});
