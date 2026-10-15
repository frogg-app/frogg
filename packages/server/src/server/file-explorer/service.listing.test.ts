import { promises as fs } from "fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listDirectoryEntries } from "./service.js";

function errno(code: string, target: string): NodeJS.ErrnoException {
  const error: NodeJS.ErrnoException = new Error(`${code}: operation not permitted, '${target}'`);
  error.code = code;
  return error;
}

describe("listDirectoryEntries", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(["EPERM", "EACCES", "EBUSY"])(
    "skips an entry the daemon cannot resolve (%s) instead of failing the listing",
    async (code) => {
      const root = await mkdtemp(path.join(os.tmpdir(), "frogg-list-unreadable-"));
      try {
        await mkdir(path.join(root, "Frogg-OW"));
        await mkdir(path.join(root, "System Volume Information"));
        await writeFile(path.join(root, "notes.txt"), "hi", "utf8");
        const blocked = path.join(root, "System Volume Information");
        const realpath = fs.realpath.bind(fs);
        vi.spyOn(fs, "realpath").mockImplementation(async (target, options) => {
          if (String(target) === blocked) throw errno(code, blocked);
          return realpath(target, options);
        });

        const listing = await listDirectoryEntries({ root });

        expect(listing.entries.map((entry) => entry.name).sort()).toEqual([
          "Frogg-OW",
          "notes.txt",
        ]);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );

  it("still fails when the listed folder itself cannot be read", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "frogg-list-unreadable-root-"));
    try {
      vi.spyOn(fs, "readdir").mockRejectedValue(errno("EPERM", root));
      await expect(listDirectoryEntries({ root })).rejects.toThrow("EPERM");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
