import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";
import type { Command } from "commander";
import { afterEach, describe, expect, it } from "vitest";
import { createCli } from "../../cli.js";
import {
  defaultPluginName,
  runIndexBuildCommand,
  runIndexSignCommand,
  runIndexVerifyCommand,
  runKeygenCommand,
  runNewCommand,
  runPackCommand,
} from "./authoring.js";

const cmd = {} as Command;
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

function value(result: { data: { field: string; value: string }[] }, field: string): string {
  return result.data.find((r) => r.field === field)?.value ?? "";
}

describe("frogg plugins authoring", () => {
  it("registers the command tree", () => {
    const plugins = createCli().commands.find((c) => c.name() === "plugins");
    const names = plugins?.commands.map((c) => c.name()) ?? [];
    for (const name of [
      "list",
      "install",
      "uninstall",
      "enable",
      "disable",
      "update",
      "repos",
      "link",
      "unlink",
      "new",
      "pack",
      "keygen",
      "index",
    ]) {
      expect(names).toContain(name);
    }
  });

  it("embeds an up-to-date copy of templates/plugin", () => {
    const script = fileURLToPath(
      new URL("../../../scripts/generate-plugin-scaffold.mjs", import.meta.url),
    );
    expect(() =>
      execFileSync(process.execPath, [script, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });

  it("derives a display name from the id", () => {
    expect(defaultPluginName("acme.jira-links")).toBe("Jira Links");
  });

  it("scaffolds, packs, indexes, signs and verifies", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "frogg-cli-plugins-"));
    dirs.push(root);
    const pluginDir = path.join(root, "plugins", "examples", "acme.hello");
    await runNewCommand("acme.hello", { dir: pluginDir }, cmd);
    const manifest = JSON.parse(
      await fs.readFile(path.join(pluginDir, "frogg-plugin.json"), "utf8"),
    );
    expect(manifest).toMatchObject({ id: "acme.hello", name: "Hello" });
    expect(await fs.readFile(path.join(pluginDir, "src", "daemon.ts"), "utf8")).toContain(
      '"acme.hello.hello"',
    );
    await expect(runNewCommand("acme.hello", { dir: pluginDir }, cmd)).rejects.toMatchObject({
      message: expect.stringMatching(/not empty/),
    });
    await expect(runNewCommand("Bad", {}, cmd)).rejects.toMatchObject({ code: "PLUGIN_ERROR" });

    // No build yet: pack refuses.
    const out = path.join(root, "out");
    await expect(runPackCommand(pluginDir, { out }, cmd)).rejects.toMatchObject({
      message: expect.stringMatching(/build the plugin/),
    });
    await fs.mkdir(path.join(pluginDir, "dist"));
    await fs.writeFile(
      path.join(pluginDir, "dist", "daemon.js"),
      "export default function activate() {}\n",
    );
    const packed = await runPackCommand(pluginDir, { out }, cmd);
    expect(value(packed, "tarball")).toBe(path.join(out, "acme.hello-0.1.0.tgz"));

    const keyFile = path.join(root, "key");
    const keys = await runKeygenCommand({ out: keyFile }, cmd);
    const publicKey = value(keys, "publicKey");
    expect((await fs.stat(keyFile)).mode & 0o777).toBe(0o600);

    const indexFile = path.join(out, "index.json");
    await runIndexBuildCommand(
      {
        plugins: path.join(root, "plugins"),
        tarballs: out,
        baseUrl: "https://example.test/repo/",
        name: "Test",
        out: indexFile,
      },
      cmd,
    );
    await runIndexSignCommand(indexFile, { keyFile }, cmd);
    const verified = await runIndexVerifyCommand(indexFile, { publicKey, tarballs: out }, cmd);
    expect(value(verified, "tarballsVerified")).toBe("1");
    await expect(
      runIndexVerifyCommand(
        indexFile,
        { publicKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" },
        cmd,
      ),
    ).rejects.toMatchObject({ code: "PLUGIN_ERROR" });
  });
});
