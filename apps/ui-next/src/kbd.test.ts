import { describe, expect, it } from "vitest";
import { kbd } from "./kbd";

describe("kbd", () => {
  it("keeps Apple symbols on Apple keyboards", () => {
    expect(kbd("⌘K", true)).toBe("⌘K");
    expect(kbd("⌘↵", true)).toBe("⌘↵");
  });
  it("spells shortcuts with Ctrl elsewhere", () => {
    expect(kbd("⌘K", false)).toBe("Ctrl+K");
    expect(kbd("⌘↵", false)).toBe("Ctrl+↵");
    expect(kbd("⌃`", false)).toBe("Ctrl+`");
    expect(kbd("⌥⇧F", false)).toBe("Alt+Shift+F");
    expect(kbd("A", false)).toBe("A");
  });
  it("rewrites hints inside prose", () => {
    expect(kbd("or ⌘K → Getting started", false)).toBe("or Ctrl+K → Getting started");
  });
});
