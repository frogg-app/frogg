import { describe, expect, it } from "vitest";
import { baseName, isWindowsPath, joinPath, parentDir, tildePath } from "./paths";

describe("host paths", () => {
  it("joins with the host's separator", () => {
    expect(joinPath("/home/dev", "app")).toBe("/home/dev/app");
    expect(joinPath("/", "home")).toBe("/home");
    expect(joinPath("C:\\Users\\dev", "app")).toBe("C:\\Users\\dev\\app");
    expect(joinPath("C:\\", "Users")).toBe("C:\\Users");
    expect(joinPath("D:", "src")).toBe("D:\\src");
  });
  it("walks up to the root and stops there", () => {
    expect(parentDir("/home/dev/")).toBe("/home");
    expect(parentDir("/home")).toBe("/");
    expect(parentDir("/")).toBe("/");
    expect(parentDir("C:\\Users\\dev")).toBe("C:\\Users");
    expect(parentDir("C:\\Users")).toBe("C:\\");
    expect(parentDir("C:\\")).toBe("C:\\");
    expect(parentDir("C:/Users/dev")).toBe("C:/Users");
  });
  it("names the last segment", () => {
    expect(baseName("/home/dev/app")).toBe("app");
    expect(baseName("C:\\Users\\dev\\app\\")).toBe("app");
    expect(baseName("C:\\")).toBe("");
  });
  it("detects Windows paths", () => {
    expect(isWindowsPath("C:\\")).toBe(true);
    expect(isWindowsPath("\\\\server\\share")).toBe(true);
    expect(isWindowsPath("/home/dev")).toBe(false);
  });
  it("shortens home folders", () => {
    expect(tildePath("/home/dev/app")).toBe("~/app");
    expect(tildePath("C:\\Users\\dev\\app")).toBe("~\\app");
  });
});
