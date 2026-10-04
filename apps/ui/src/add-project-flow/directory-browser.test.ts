import { describe, expect, it } from "vitest";
import {
  breadcrumbSegments,
  directoryNavigationTarget,
  isDoubleActivation,
  moveDirectorySelection,
  newDirectoryNameError,
  visibleDirectoryEntries,
} from "./directory-browser";

function entry(name: string, kind: "file" | "directory" = "directory") {
  return { name, kind, path: name, size: 0, modifiedAt: "" };
}

const entries = [
  entry("beta"),
  entry("Alpha"),
  entry("item10"),
  entry("item2"),
  entry(".config"),
  entry("alpha.txt", "file"),
  entry("README.md", "file"),
];

describe("directory explorer model", () => {
  it("lists folders before files in natural, case-insensitive order", () => {
    expect(
      visibleDirectoryEntries(entries, { showHidden: false, filter: "" }).map((e) => e.name),
    ).toEqual(["Alpha", "beta", "item2", "item10", "alpha.txt", "README.md"]);
  });

  it("shows dot-prefixed entries only when hidden items are enabled", () => {
    const names = visibleDirectoryEntries(entries, { showHidden: true, filter: "" }).map(
      (e) => e.name,
    );
    expect(names[0]).toBe(".config");
  });

  it("filters the current folder by name and ignores path-like input", () => {
    expect(
      visibleDirectoryEntries(entries, { showHidden: false, filter: "ALP" }).map((e) => e.name),
    ).toEqual(["Alpha", "alpha.txt"]);
    expect(visibleDirectoryEntries(entries, { showHidden: false, filter: "~/" })).toHaveLength(6);
  });

  it("builds clickable breadcrumbs for POSIX, Windows, UNC and home paths", () => {
    expect(breadcrumbSegments("/home/dev")).toEqual([
      { label: "/", path: "/" },
      { label: "home", path: "/home" },
      { label: "dev", path: "/home/dev" },
    ]);
    expect(breadcrumbSegments("/")).toEqual([{ label: "/", path: "/" }]);
    expect(breadcrumbSegments("C:\\Users\\dev")).toEqual([
      { label: "C:", path: "C:\\" },
      { label: "Users", path: "C:\\Users" },
      { label: "dev", path: "C:\\Users\\dev" },
    ]);
    expect(breadcrumbSegments("\\\\server\\share\\repo").map((s) => s.path)).toEqual([
      "\\\\server\\share",
      "\\\\server\\share\\repo",
    ]);
    expect(breadcrumbSegments("~")).toEqual([{ label: "~", path: "~" }]);
  });

  it("recognises typed paths as navigation targets", () => {
    expect(directoryNavigationTarget("/home/dev", "~/src")).toBe("~/src");
    expect(directoryNavigationTarget("/home/dev", "C:\\work")).toBe("C:\\work");
    expect(directoryNavigationTarget("/home/dev", "..")).toBe("/home/dev/..");
    expect(directoryNavigationTarget("/home/dev", "src/app")).toBe("/home/dev/src/app");
    expect(directoryNavigationTarget("/home/dev", "src")).toBeNull();
  });

  it("validates new folder names as a single path segment", () => {
    expect(newDirectoryNameError("  ")).toBe("empty");
    expect(newDirectoryNameError("../x")).toBe("invalid");
    expect(newDirectoryNameError("..")).toBe("invalid");
    expect(newDirectoryNameError("app")).toBeNull();
  });

  it("moves the highlight without wrapping and enters from either end", () => {
    expect(moveDirectorySelection(-1, 3, "next")).toBe(0);
    expect(moveDirectorySelection(-1, 3, "previous")).toBe(2);
    expect(moveDirectorySelection(2, 3, "next")).toBe(2);
    expect(moveDirectorySelection(0, 3, "previous")).toBe(0);
    expect(moveDirectorySelection(1, 3, "last")).toBe(2);
    expect(moveDirectorySelection(0, 0, "next")).toBe(-1);
  });

  it("treats a quick second press on the same row as a double-click", () => {
    expect(isDoubleActivation({ id: "a", at: 1000 }, "a", 1300)).toBe(true);
    expect(isDoubleActivation({ id: "a", at: 1000 }, "a", 1500)).toBe(false);
    expect(isDoubleActivation({ id: "a", at: 1000 }, "b", 1100)).toBe(false);
    expect(isDoubleActivation(null, "a", 1000)).toBe(false);
  });
});
