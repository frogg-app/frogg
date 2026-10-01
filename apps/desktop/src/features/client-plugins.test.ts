import { mkdtemp, mkdir, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createClientPluginStore, readClientPluginFolder } from "./client-plugins.js";

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "client-plugins-"));
}

describe("client plugin store", () => {
  it("round-trips records and removes them", async () => {
    const dir = await tempDir();
    const store = createClientPluginStore(path.join(dir, "client-plugins"));
    expect(await store.list()).toEqual([]);
    await store.put({ record: { id: "acme.clock", version: "1.0.0" } });
    expect(await store.list()).toEqual([{ id: "acme.clock", version: "1.0.0" }]);
    await store.remove({ id: "acme.clock" });
    expect(await store.list()).toEqual([]);
  });

  it("rejects ids that could escape the directory", async () => {
    const store = createClientPluginStore(await tempDir());
    await expect(store.put({ record: { id: "../evil" } })).rejects.toThrow(/Invalid plugin id/);
    await expect(store.remove({ id: "a/../../b" })).rejects.toThrow(/Invalid plugin id/);
  });

  it("skips corrupt and foreign files", async () => {
    const dir = await tempDir();
    await writeFile(path.join(dir, "acme.bad.json"), "{nope");
    await writeFile(path.join(dir, "notes.txt"), "x");
    const store = createClientPluginStore(dir);
    expect(await store.list()).toEqual([]);
    expect((await readdir(dir)).length).toBe(2);
  });
});

describe("readClientPluginFolder", () => {
  it("reads the manifest and client entry", async () => {
    const dir = await tempDir();
    await mkdir(path.join(dir, "dist"));
    await writeFile(
      path.join(dir, "frogg-plugin.json"),
      JSON.stringify({ entry: { client: "dist/client.js" } }),
    );
    await writeFile(path.join(dir, "dist", "client.js"), "export default () => {}");
    const result = await readClientPluginFolder({ path: dir });
    expect(result.entrySource).toBe("export default () => {}");
  });

  it("refuses an entry outside the folder", async () => {
    const dir = await tempDir();
    await writeFile(
      path.join(dir, "frogg-plugin.json"),
      JSON.stringify({ entry: { client: "../outside.js" } }),
    );
    await expect(readClientPluginFolder({ path: dir })).rejects.toThrow(/inside the plugin/);
  });

  it("requires an absolute path", async () => {
    await expect(readClientPluginFolder({ path: "relative" })).rejects.toThrow(/absolute/);
  });
});
