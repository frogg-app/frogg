import { describe, expect, it } from "vitest";
import { isUntrustedTextTruncated, sanitizeUntrustedText } from "./untrusted-text";

describe("sanitizeUntrustedText", () => {
  it("keeps an ordinary device name unchanged", () => {
    expect(sanitizeUntrustedText("Ada's Pixel 9")).toBe("Ada's Pixel 9");
  });

  it("never returns markup as markup, and leaves the characters visible", () => {
    // RN Text renders this literally; the point is that we do not strip it
    // into something that reads as trustworthy either.
    expect(sanitizeUntrustedText("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });

  it("strips bidi overrides that would reorder the row", () => {
    expect(sanitizeUntrustedText("laptop‮gnitset")).toBe("laptopgnitset");
  });

  it("strips zero-width and control characters", () => {
    expect(sanitizeUntrustedText("pi​xel\u0000\u0007")).toBe("pixel");
  });

  it("collapses newlines so a name cannot take over the list", () => {
    expect(sanitizeUntrustedText("phone\n\n\nOwner: yes")).toBe("phone Owner: yes");
  });

  it("truncates a long name with an ellipsis", () => {
    const long = "x".repeat(200);
    const shown = sanitizeUntrustedText(long, { max: 10 });
    expect(shown).toBe("xxxxxxxxx…");
    expect(isUntrustedTextTruncated(long, { max: 10 })).toBe(true);
  });

  it("does not split a surrogate pair", () => {
    const shown = sanitizeUntrustedText("👩‍💻👩‍💻👩‍💻👩‍💻", { max: 3 });
    expect([...shown].length).toBeLessThanOrEqual(3);
    expect(shown).not.toContain("�");
  });

  it("falls back when nothing printable is left", () => {
    expect(sanitizeUntrustedText("​ ‭", { fallback: "Unnamed device" })).toBe(
      "Unnamed device",
    );
    expect(sanitizeUntrustedText(null, { fallback: "Unnamed device" })).toBe("Unnamed device");
  });
});
