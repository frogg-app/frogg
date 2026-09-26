import { describe, expect, it } from "vitest";
import { presenceAvatarColor, presenceInitials } from "./avatar";

describe("presence avatar", () => {
  it("derives initials from the first two words, ignoring punctuation", () => {
    expect(presenceInitials("Paz")).toBe("PA");
    expect(presenceInitials("Ada's laptop")).toBe("AL");
    expect(presenceInitials("Frogg Desktop on build-box")).toBe("FD");
    expect(presenceInitials("  ")).toBe("?");
  });

  it("gives one identity the same colour every time", () => {
    expect(presenceAvatarColor("key-a")).toBe(presenceAvatarColor("key-a"));
    expect(presenceAvatarColor("key-a")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
