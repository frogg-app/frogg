import { describe, expect, it } from "vitest";
import {
  classifyLine,
  INLINE,
  inlineToken,
  parseTable,
  resolveImage,
  safeHref,
  splitImages,
  splitRow,
  type Cell,
} from "./syntax";

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

describe("classifyLine", () => {
  it("tells fences, rules, headings, quotes and prose apart", () => {
    expect(classifyLine("```ts")).toEqual({ kind: "fence" });
    expect(classifyLine("~~~")).toEqual({ kind: "fence" });
    expect(classifyLine("---")).toEqual({ kind: "hr" });
    expect(classifyLine("* * *")).toEqual({ kind: "hr" });
    expect(classifyLine("###### Six")).toEqual({ kind: "h", level: 6, cut: 7 });
    expect(classifyLine("> quoted")).toEqual({ kind: "quote", cut: 2 });
    expect(classifyLine("**bold** start")).toBeNull();
    expect(classifyLine("plain")).toBeNull();
  });

  it("reads list markers, numbers, tasks and nesting", () => {
    expect(classifyLine("- item")).toMatchObject({ kind: "li", marker: "•", depth: 0, cut: 2 });
    expect(classifyLine("  * nested")).toMatchObject({ marker: "•", depth: 1 });
    expect(classifyLine("12. twelfth")).toMatchObject({ marker: "12.", ordered: true, cut: 4 });
    expect(classifyLine("3) third")).toMatchObject({ marker: "3." });
    expect(classifyLine("- [ ] todo")).toMatchObject({ marker: "☐", cut: 6 });
    expect(classifyLine("- [x] done")).toMatchObject({ marker: "☑" });
  });
});

describe("inline tokens", () => {
  const parts = (t: string) => t.split(INLINE).filter(Boolean).map(inlineToken);

  it("finds links, bare URLs and strikethrough", () => {
    expect(parts("see [the docs](https://frogg.app/docs) now")).toEqual([
      { kind: "text", text: "see ", off: 0 },
      { kind: "link", text: "the docs", off: 1, href: "https://frogg.app/docs" },
      { kind: "text", text: " now", off: 0 },
    ]);
    expect(parts("at https://x.dev/a.")[1]).toEqual({
      kind: "link",
      text: "https://x.dev/a",
      off: 0,
      href: "https://x.dev/a",
    });
    expect(parts("~~old~~")[0]).toEqual({ kind: "strike", text: "old", off: 2 });
  });

  it("only opens web and mail links", () => {
    expect(safeHref("https://a.b")).toBe("https://a.b");
    expect(safeHref("mailto:a@b.c")).toBe("mailto:a@b.c");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref("src/app.ts")).toBeNull();
  });
});
