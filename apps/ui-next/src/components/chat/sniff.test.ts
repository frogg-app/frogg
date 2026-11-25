import { describe, expect, it } from "vitest";
import { imageName, sniffImage, untyped } from "./sniff";

const bytes = (...xs: (number | string)[]) =>
  Uint8Array.from(
    xs.flatMap((x) => (typeof x === "string" ? [...x].map((c) => c.charCodeAt(0)) : [x])),
  );

describe("sniffImage", () => {
  it("recognises common photo formats", () => {
    expect(sniffImage(bytes(0x89, "PNG", 0x0d, 0x0a))?.mime).toBe("image/png");
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0))?.mime).toBe("image/jpeg");
    expect(sniffImage(bytes("GIF89a"))?.mime).toBe("image/gif");
    expect(sniffImage(bytes("RIFF", 0, 0, 0, 0, "WEBP"))?.mime).toBe("image/webp");
    expect(sniffImage(bytes(0, 0, 0, 0x18, "ftypheic"))?.mime).toBe("image/heic");
  });

  it("leaves anything else alone", () => {
    expect(sniffImage(bytes("PK", 3, 4))).toBeNull();
    expect(sniffImage(bytes("RIFF", 0, 0, 0, 0, "WAVE"))).toBeNull();
    expect(sniffImage(new Uint8Array())).toBeNull();
  });
});

describe("untyped", () => {
  it("treats a missing or generic type as unknown", () => {
    expect(untyped(null)).toBe(true);
    expect(untyped("application/octet-stream")).toBe(true);
    expect(untyped("image/png")).toBe(false);
  });
});

describe("imageName", () => {
  it("gives Android's content names a safe name and an extension", () => {
    expect(imageName("image:1000014295", "png")).toBe("image-1000014295.png");
    expect(imageName("shot.jpg", "png")).toBe("shot.jpg");
  });
});
