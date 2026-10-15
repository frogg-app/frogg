import { execFileSync } from "child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { zipDirectory } from "./zip.js";

describe("zipDirectory", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), "frogg-zip-"));
    mkdirSync(path.join(root, "app/src/empty"), { recursive: true });
    mkdirSync(path.join(root, "app/node_modules/dep"), { recursive: true });
    writeFileSync(path.join(root, "app/src/index.ts"), "export const x = 1;\n".repeat(200));
    writeFileSync(path.join(root, "app/README.md"), "# app\n");
    writeFileSync(path.join(root, "app/node_modules/dep/index.js"), "module.exports = 1;\n");
    symlinkSync(path.join(root, "app/README.md"), path.join(root, "app/link.md"));
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  const unpack = async (includeIgnored?: boolean) => {
    const zip = await zipDirectory({ root, relativePath: "app", includeIgnored });
    const file = path.join(root, "out.zip");
    writeFileSync(file, Buffer.concat(zip.chunks));
    const listing = execFileSync("unzip", ["-Z1", file], { encoding: "utf8" }).trim().split("\n");
    execFileSync("unzip", ["-tq", file]);
    return { zip, listing };
  };

  it("packs the folder under its own name, skipping dependencies and symlinks", async () => {
    const { zip, listing } = await unpack();

    expect(zip.fileName).toBe("app.zip");
    expect(zip.fileCount).toBe(2);
    expect(zip.size).toBe(Buffer.concat(zip.chunks).length);
    expect(listing.sort()).toEqual(["app/README.md", "app/src/empty/", "app/src/index.ts"]);
    expect(zip.skipped.sort()).toEqual(["link.md", "node_modules/"]);
  });

  it("includes ignored folders when asked", async () => {
    const { listing } = await unpack(true);

    expect(listing).toContain("app/node_modules/dep/index.js");
  });

  it("refuses folders past the limits and paths outside the checkout", async () => {
    await expect(
      zipDirectory({ root, relativePath: "app", limits: { maxFiles: 1, maxBytes: 1e9 } }),
    ).rejects.toThrow("more than 1 files");
    await expect(
      zipDirectory({ root, relativePath: "app", limits: { maxFiles: 100, maxBytes: 10 } }),
    ).rejects.toThrow("larger than");
    await expect(zipDirectory({ root, relativePath: "../" })).rejects.toThrow();
  });
});
