import { promises as fs } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  generatePluginRepoKeyPair,
  publicKeyFromPrivateKey,
  sha256Hex,
  signPluginIndex,
  verifyPluginIndexSignature,
} from "./signing.js";
import { createTarGz, readTarGz } from "./tar.js";
import {
  buildPluginIndex,
  packPlugin,
  readManifestFromTarball,
  serializePluginIndex,
  signPluginIndexFile,
  verifyPluginIndexFile,
} from "./tooling.js";
import { tempDir, writeFixturePlugin } from "./test-fixtures.js";

const cleanup: string[] = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe("ed25519 signing", () => {
  const keys = generatePluginRepoKeyPair();
  const data = Buffer.from('{"schemaVersion":1}');

  it("round-trips and derives the public key", () => {
    const sig = signPluginIndex(data, keys.privateKey);
    expect(verifyPluginIndexSignature(data, sig, keys.publicKey)).toBe(true);
    expect(publicKeyFromPrivateKey(keys.privateKey)).toBe(keys.publicKey);
    expect(Buffer.from(keys.publicKey, "base64")).toHaveLength(32);
  });

  it("rejects tampered data, wrong keys and malformed signatures", () => {
    const sig = signPluginIndex(data, keys.privateKey);
    const tampered = Buffer.from(data);
    tampered[2] ^= 1;
    expect(verifyPluginIndexSignature(tampered, sig, keys.publicKey)).toBe(false);
    expect(verifyPluginIndexSignature(data, sig, generatePluginRepoKeyPair().publicKey)).toBe(
      false,
    );
    expect(verifyPluginIndexSignature(data, "not-base64!", keys.publicKey)).toBe(false);
    expect(verifyPluginIndexSignature(data, sig, "short")).toBe(false);
    const flipped = Buffer.from(sig, "base64");
    flipped[0] ^= 1;
    expect(verifyPluginIndexSignature(data, flipped.toString("base64"), keys.publicKey)).toBe(
      false,
    );
  });
});

function rawTar(name: string, type: string, body = Buffer.alloc(0)): Buffer {
  const h = Buffer.alloc(512);
  h.write(name, 0);
  h.write("0000644\0", 100);
  h.write(body.length.toString(8).padStart(11, "0") + "\0", 124);
  h.write(type, 156);
  h.write("ustar\0", 257);
  h.fill(0x20, 148, 156);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, "0") + "\0 ", 148);
  const pad = Buffer.alloc((512 - (body.length % 512)) % 512);
  return gzipSync(Buffer.concat([h, body, pad, Buffer.alloc(1024)]));
}

describe("tarballs", () => {
  it("round-trips deterministically", () => {
    const entries = [
      { path: "b.txt", data: Buffer.from("b") },
      { path: "dist/a.js", data: Buffer.from("a".repeat(700)) },
    ];
    const a = createTarGz(entries);
    expect(sha256Hex(createTarGz(entries.toReversed()))).toBe(sha256Hex(a));
    const out = readTarGz(a);
    expect(out.map((e) => e.path)).toEqual(["b.txt", "dist/a.js"]);
    expect(Buffer.from(out[1]!.data).toString()).toBe("a".repeat(700));
  });

  it("rejects path traversal, absolute paths and links", () => {
    expect(() => readTarGz(rawTar("../evil.js", "0", Buffer.from("x")))).toThrow(/escapes/);
    expect(() => readTarGz(rawTar("/etc/evil", "0", Buffer.from("x")))).toThrow(/absolute/);
    expect(() => readTarGz(rawTar("link", "2"))).toThrow(/unsupported/);
    expect(() => readTarGz(Buffer.from("not gzip"))).toThrow(/gzip/);
  });
});

describe("pack, index build, sign, verify", () => {
  async function setup() {
    const root = await tempDir("frogg-plugin-tooling-");
    cleanup.push(root);
    const src = path.join(root, "plugins");
    const out = path.join(root, "out");
    const dir = await writeFixturePlugin(src, { id: "fx.hello", version: "1.0.0" });
    await fs.mkdir(path.join(dir, "src"), { recursive: true });
    await fs.writeFile(path.join(dir, "src", "daemon.ts"), "// source stays out");
    const packed = await packPlugin(dir, out);
    return { root, src, out, dir, packed };
  }

  it("packs only the manifest, package.json and entry directories", async () => {
    const { packed } = await setup();
    expect(path.basename(packed.file)).toBe("fx.hello-1.0.0.tgz");
    const { manifest, entries } = readManifestFromTarball(await fs.readFile(packed.file), "t");
    expect(manifest.id).toBe("fx.hello");
    expect(entries.map((e) => e.path).sort()).toEqual([
      "dist/client.js",
      "dist/daemon.js",
      "frogg-plugin.json",
      "package.json",
    ]);
    expect(await fs.readFile(`${packed.file}.sha256`, "utf8")).toContain(packed.sha256);
  });

  it("builds, signs and verifies an index; detects tampering", async () => {
    const { src, out } = await setup();
    const keys = generatePluginRepoKeyPair();
    const index = await buildPluginIndex({
      pluginsDir: src,
      tarballsDir: out,
      baseUrl: "https://x.test/repo",
      name: "T",
      commit: "abc",
    });
    expect(index.plugins[0]).toMatchObject({ id: "fx.hello", category: "examples" });
    expect(index.plugins[0]!.versions[0]!.tarball).toBe("https://x.test/repo/fx.hello-1.0.0.tgz");
    const file = path.join(out, "index.json");
    await fs.writeFile(file, serializePluginIndex(index));
    const { publicKey } = await signPluginIndexFile(file, keys.privateKey);
    expect(publicKey).toBe(keys.publicKey);
    expect((await fs.readFile(`${file}.pub`, "utf8")).trim()).toBe(keys.publicKey);
    await expect(verifyPluginIndexFile(file, keys.publicKey, out)).resolves.toMatchObject({
      checkedTarballs: 1,
    });

    await expect(
      verifyPluginIndexFile(file, generatePluginRepoKeyPair().publicKey),
    ).rejects.toThrow(/signature/);

    const tgz = path.join(out, "fx.hello-1.0.0.tgz");
    const good = await fs.readFile(tgz);
    await fs.writeFile(tgz, Buffer.concat([good, Buffer.from("x")]));
    await expect(verifyPluginIndexFile(file, keys.publicKey, out)).rejects.toThrow(/sha256/);
    await fs.writeFile(tgz, good);

    await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace('"T"', '"U"'));
    await expect(verifyPluginIndexFile(file, keys.publicKey)).rejects.toThrow(/signature/);
  });

  it("rejects undeclared categories and missing tarballs", async () => {
    const { root, src, out } = await setup();
    const categories = path.join(root, "categories.json");
    await fs.writeFile(categories, JSON.stringify({ categories: [{ id: "other" }] }));
    await expect(
      buildPluginIndex({
        pluginsDir: src,
        tarballsDir: out,
        baseUrl: "https://x.test/",
        name: "T",
        categoriesFile: categories,
      }),
    ).rejects.toThrow(/category/);
    await expect(
      buildPluginIndex({
        pluginsDir: src,
        tarballsDir: path.join(root, "empty"),
        baseUrl: "https://x.test/",
        name: "T",
      }),
    ).rejects.toThrow(/not found/);
  });
});
