import { describe, expect, it } from "vitest";
import { resolveWindowGlyph } from "./meter-glyph";

describe("resolveWindowGlyph", () => {
  it("reads Claude's five-hour window as S and its weekly one as W", () => {
    expect(resolveWindowGlyph({ id: "five_hour", label: "Session" })).toBe("S");
    expect(resolveWindowGlyph({ id: "weekly", label: "Weekly" })).toBe("W");
  });

  it("reads Codex's session window the same way", () => {
    expect(resolveWindowGlyph({ id: "session", label: "5h limit" })).toBe("S");
  });

  it("matches on the label when the id says nothing", () => {
    expect(resolveWindowGlyph({ id: "primary", label: "Monthly quota" })).toBe("M");
  });

  it("falls back to the label's initial", () => {
    expect(resolveWindowGlyph({ id: "burst", label: "burst" })).toBe("B");
  });

  it("never returns an empty glyph", () => {
    expect(resolveWindowGlyph({ id: "", label: "   " })).toBe("?");
  });
});
