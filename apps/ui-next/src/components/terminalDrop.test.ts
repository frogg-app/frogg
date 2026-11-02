import { describe, expect, it } from "vitest";
import { droppedPaths, shellPath } from "./terminalDrop";

describe("shellPath", () => {
  it("leaves plain paths bare", () => {
    expect(shellPath("/home/me/.frogg/uploads/a1/shot.png")).toBe(
      "/home/me/.frogg/uploads/a1/shot.png",
    );
  });
  it("single-quotes POSIX paths with spaces or quotes", () => {
    expect(shellPath("/tmp/My Shot.png")).toBe("'/tmp/My Shot.png'");
    expect(shellPath("/tmp/it's.txt")).toBe(`'/tmp/it'\\''s.txt'`);
  });
  it("double-quotes Windows paths", () => {
    expect(shellPath("C:\\Users\\me\\My Shot.png")).toBe('"C:\\Users\\me\\My Shot.png"');
  });
});

describe("droppedPaths", () => {
  it("joins with spaces and ends with one", () => {
    expect(droppedPaths(["/a", "/b c"])).toBe("/a '/b c' ");
    expect(droppedPaths([])).toBe("");
  });
});
