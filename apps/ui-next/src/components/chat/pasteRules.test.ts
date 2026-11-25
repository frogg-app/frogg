import { describe, expect, it } from "vitest";
import { isUnnamed, pastedName, picturesToAttach } from "./pasteRules";

const png = { name: "image.png", type: "image/png" };

describe("picturesToAttach", () => {
  it("attaches a screenshot pasted on its own", () => {
    expect(picturesToAttach([png], "")).toEqual([png]);
  });

  it("attaches a copied image whose text is only its address or name", () => {
    expect(picturesToAttach([png], "https://example.com/a.png")).toEqual([png]);
    expect(picturesToAttach([png], "shot_2026-11-01.png")).toEqual([png]);
    expect(picturesToAttach([png], "file:///home/me/shot.png")).toEqual([png]);
  });

  it("attaches a file copied from the desktop even with its name as text", () => {
    const file = { name: "Screenshot 2026-11-01 at 10.02.png", type: "image/png" };
    expect(picturesToAttach([file], "Screenshot 2026-11-01 at 10.02.png")).toEqual([file]);
  });

  it("attaches an unnamed picture whose text is a file name with spaces", () => {
    expect(picturesToAttach([png], "Screenshot 2026-11-01 at 10.02.png")).toEqual([png]);
    expect(picturesToAttach([png], "  Photo 1.JPEG\n")).toEqual([png]);
  });

  it("attaches several copied files listed one per line", () => {
    expect(picturesToAttach([png, png], "a b.png\r\nc.jpg")).toEqual([png, png]);
    expect(picturesToAttach([png], "/home/me/a.png\nhttps://x.test/b.webp")).toEqual([png]);
  });

  it("pastes the text when a document copy carries a rendered picture of it", () => {
    expect(picturesToAttach([png], "Quarterly numbers are up 4%")).toEqual([]);
    expect(picturesToAttach([png], "Revenue chart\nshot.png")).toEqual([]);
    expect(picturesToAttach([png], "see https://example.com/a.png")).toEqual([]);
  });

  it("ignores pastes with no pictures", () => {
    expect(picturesToAttach([{ name: "a.txt", type: "text/plain" }], "")).toEqual([]);
  });

  it("attaches only the pictures from a mixed paste", () => {
    const txt = { name: "notes.txt", type: "text/plain" };
    expect(picturesToAttach([txt, png], "")).toEqual([png]);
  });
});

describe("isUnnamed", () => {
  it("treats the browser's stand-in names as unnamed", () => {
    expect(isUnnamed("")).toBe(true);
    expect(isUnnamed("image.png")).toBe(true);
    expect(isUnnamed("image.jpeg")).toBe(true);
    expect(isUnnamed("image 2.png")).toBe(false);
    expect(isUnnamed("diagram.png")).toBe(false);
  });
});

describe("pastedName", () => {
  it("numbers pasted pictures and names them by type", () => {
    const a = pastedName("image/png");
    const b = pastedName("image/jpeg");
    expect(a).toMatch(/^Pasted image \d+\.png$/);
    expect(b).toMatch(/^Pasted image \d+\.jpg$/);
    expect(a).not.toBe(b.replace(".jpg", ".png"));
    expect(pastedName("image/svg+xml")).toMatch(/\.svg$/);
  });
});
