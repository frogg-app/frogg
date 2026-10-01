import { describe, expect, it } from "vitest";
import type { SkillEntry } from "@frogg/protocol/messages";
import { skillProviders, stripFrontMatter } from "./skills-view";

describe("skillProviders", () => {
  it("merges providers across copies", () => {
    const entry: SkillEntry = {
      id: "delegate",
      name: "delegate",
      description: "",
      enabled: true,
      scope: "built_in",
      locations: [
        { scope: "built_in", path: "/a", providers: ["codex"] },
        { scope: "built_in", path: "/b", providers: ["claude", "codex"] },
      ],
    };
    expect(skillProviders(entry)).toEqual(["claude", "codex"]);
  });
});

describe("stripFrontMatter", () => {
  it("drops the YAML header", () => {
    expect(stripFrontMatter("---\nname: a\n---\n\n# Title\n")).toBe("# Title\n");
    expect(stripFrontMatter("# No header")).toBe("# No header");
  });
});
