import { describe, expect, it } from "vitest";
import { splitTextRuns, splitUserMessage } from "./user-message-segments";

describe("splitUserMessage", () => {
  it("lifts a markdown image out of the text", () => {
    const src =
      "file:///C:/Users/a/AppData/Local/Temp/frogg-attachments-m7qgB8/7248dc02fd9967aaac9e77acf35f3478e74281f2a1d20c7153fc941f931d88ed.png";
    expect(splitUserMessage(`Claude Code\n![Image](${src})`)).toEqual([
      { kind: "text", runs: [{ text: "Claude Code" }] },
      { kind: "image", alt: "Image", src },
    ]);
  });

  it("unescapes backslashes and parens in an image source", () => {
    expect(splitUserMessage("![x](/tmp/a\\)b.png)")).toEqual([
      { kind: "image", alt: "x", src: "/tmp/a)b.png" },
    ]);
  });

  it("leaves plain text as one run", () => {
    expect(splitUserMessage("just text")).toEqual([
      { kind: "text", runs: [{ text: "just text" }] },
    ]);
  });
});

describe("splitTextRuns", () => {
  it("links a bare URL without its trailing full stop", () => {
    const url = "https://claude.ai/code/artifact/77864620-7765-44d2-8cea-a34a5d1457eb";
    expect(splitTextRuns(`Outline is up: ${url}. Filling in the summary now.`)).toEqual([
      { text: "Outline is up: " },
      { text: url, url },
      { text: ". Filling in the summary now." },
    ]);
  });

  it("links a markdown link by its label", () => {
    expect(splitTextRuns("[Frogg-OW: setup](https://claude.ai/x) ok")).toEqual([
      { text: "Frogg-OW: setup", url: "https://claude.ai/x" },
      { text: " ok" },
    ]);
  });
});
