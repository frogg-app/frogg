import { describe, expect, it } from "vitest";
import { parseTable, resolveImage, splitImages, splitRow, type Cell } from "./syntax";

const texts = (row: Cell[]) => row.map((c) => c.text);

describe("parseTable", () => {
  const lines = [
    "| Prize pool | 1st | 2nd |",
    "|---|---:|:---:|",
    "| $5k (Cup #1) | 2,000 | 1,250 |",
    "| $10k | 4,000 |",
    "",
    "after",
  ];

  it("reads header, alignment and rows, padding short rows", () => {
    const t = parseTable(lines, 0);
    expect(texts(t?.head ?? [])).toEqual(["Prize pool", "1st", "2nd"]);
    expect(t?.align).toEqual(["left", "right", "center"]);
    expect(t?.rows.map(texts)).toEqual([
      ["$5k (Cup #1)", "2,000", "1,250"],
      ["$10k", "4,000", ""],
    ]);
    expect(t?.end).toBe(4);
  });

  it("keeps cell offsets on their line", () => {
    const t = parseTable(lines, 0);
    const c = t!.rows[0][1];
    expect(lines[2].slice(c.off, c.off + c.text.length)).toBe("2,000");
  });

  it("needs a separator line", () => {
    expect(parseTable(["| a | b |", "| c | d |"], 0)).toBeNull();
    expect(parseTable(["just text", "---"], 0)).toBeNull();
  });

  it("splits rows without outer pipes and keeps escaped pipes", () => {
    expect(texts(splitRow("a | b \\| c"))).toEqual(["a", "b | c"]);
  });
});

describe("splitImages", () => {
  it("splits back-to-back images and drops empty runs between them", () => {
    const s = "![Image](file:///tmp/a.png)![Image](file:///tmp/b.png)";
    expect(splitImages(s)).toEqual([
      { kind: "img", alt: "Image", src: "file:///tmp/a.png", off: 0 },
      { kind: "img", alt: "Image", src: "file:///tmp/b.png", off: 27 },
    ]);
  });

  it("keeps surrounding text with offsets", () => {
    const parts = splitImages("see ![x](./a.png) here");
    expect(parts.map((p) => p.kind)).toEqual(["text", "img", "text"]);
    expect(parts[2]).toMatchObject({ text: " here", off: 17 });
  });

  it("leaves plain text alone", () => {
    expect(splitImages("no images")).toEqual([{ kind: "text", text: "no images", off: 0 }]);
  });
});

describe("resolveImage", () => {
  it("loads URLs directly", () => {
    expect(resolveImage("https://x.dev/a.png", "/w")).toEqual({
      kind: "uri",
      uri: "https://x.dev/a.png",
    });
  });

  it("reads file URLs and absolute paths from the host", () => {
    expect(resolveImage("file:///var/folders/T/a%20b.png", undefined)).toEqual({
      kind: "host",
      cwd: "/",
      path: "/var/folders/T/a b.png",
    });
    expect(resolveImage("file:///C:/Users/x/a.png", undefined)).toEqual({
      kind: "host",
      cwd: "C:/",
      path: "C:/Users/x/a.png",
    });
  });

  it("resolves relative paths from the session folder", () => {
    expect(resolveImage("./shots/a.png", "/repo")).toEqual({
      kind: "host",
      cwd: "/repo",
      path: "shots/a.png",
    });
    expect(resolveImage("shots/a.png", undefined)).toBeNull();
    expect(resolveImage("ftp://x/a.png", "/repo")).toBeNull();
  });
});
