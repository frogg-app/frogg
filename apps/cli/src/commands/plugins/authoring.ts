// Offline author and repository tooling: keygen, new, pack, index build|sign|verify.
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import {
  PluginToolingError,
  buildPluginIndex,
  generatePluginRepoKeyPair,
  packPlugin,
  serializePluginIndex,
  signPluginIndexFile,
  verifyPluginIndexFile,
} from "@frogg/server";
import { PLUGIN_ID_PATTERN } from "@frogg/protocol/plugins/manifest";
import type { CommandOptions, ListResult } from "../../output/index.js";
import { PLUGIN_SCAFFOLD_FILES } from "./scaffold-template.generated.js";
import { fields, type FieldRow } from "./shared.js";

function fail(message: string): never {
  throw { code: "PLUGIN_ERROR", message };
}

async function wrap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof PluginToolingError) fail(err.message);
    throw err;
  }
}

export async function runKeygenCommand(
  options: CommandOptions & { out?: string },
  _command: Command,
): Promise<ListResult<FieldRow>> {
  const keys = generatePluginRepoKeyPair();
  if (options.out) {
    await fs
      .writeFile(options.out, keys.privateKey + "\n", { mode: 0o600, flag: "wx" })
      .catch((err: NodeJS.ErrnoException) => {
        fail(err.code === "EEXIST" ? `${options.out} already exists` : err.message);
      });
    return fields({ publicKey: keys.publicKey, privateKeyFile: path.resolve(options.out) });
  }
  return fields({ publicKey: keys.publicKey, privateKey: keys.privateKey });
}

export function defaultPluginName(id: string): string {
  const last = id.split(".").pop() ?? id;
  return last
    .split("-")
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase() + w.slice(1))
    .join(" ");
}

export async function runNewCommand(
  id: string,
  options: CommandOptions & { name?: string; dir?: string },
  _command: Command,
): Promise<ListResult<FieldRow>> {
  if (!PLUGIN_ID_PATTERN.test(id))
    fail(`Plugin ids are reverse-DNS style, e.g. acme.jira-links (got "${id}")`);
  const name = options.name?.trim() || defaultPluginName(id);
  const dir = path.resolve(options.dir ?? id);
  const existing = await fs.readdir(dir).catch(() => null);
  if (existing && existing.length > 0) fail(`${dir} already exists and is not empty`);
  for (const [rel, template] of Object.entries(PLUGIN_SCAFFOLD_FILES)) {
    const target = path.join(dir, ...rel.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, template.replaceAll("{{id}}", id).replaceAll("{{name}}", name));
  }
  return fields({ id, name, dir });
}

export async function runPackCommand(
  dir: string | undefined,
  options: CommandOptions & { out?: string },
  _command: Command,
): Promise<ListResult<FieldRow>> {
  const src = path.resolve(dir ?? ".");
  const result = await wrap(() => packPlugin(src, path.resolve(options.out ?? src)));
  return fields({
    id: result.manifest.id,
    version: result.manifest.version,
    tarball: result.file,
    sha256: result.sha256,
    bytes: result.bytes,
  });
}

export async function runIndexBuildCommand(
  rawOptions: CommandOptions,
  _command: Command,
): Promise<ListResult<FieldRow>> {
  // commander enforces the required options.
  const options = rawOptions as CommandOptions & {
    plugins: string;
    tarballs: string;
    baseUrl: string;
    name: string;
    commit?: string;
    categories?: string;
    out: string;
  };
  const index = await wrap(() =>
    buildPluginIndex({
      pluginsDir: path.resolve(options.plugins),
      tarballsDir: path.resolve(options.tarballs),
      baseUrl: options.baseUrl,
      name: options.name,
      ...(options.commit ? { commit: options.commit } : {}),
      ...(options.categories ? { categoriesFile: path.resolve(options.categories) } : {}),
    }),
  );
  await fs.mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  await fs.writeFile(options.out, serializePluginIndex(index));
  return fields({ index: path.resolve(options.out), plugins: index.plugins.length });
}

export async function runIndexSignCommand(
  file: string,
  options: CommandOptions & { keyEnv?: string; keyFile?: string },
  _command: Command,
): Promise<ListResult<FieldRow>> {
  let key: string | undefined;
  if (options.keyFile) key = (await fs.readFile(options.keyFile, "utf8")).trim();
  else {
    const env = options.keyEnv ?? "PLUGIN_REPO_SIGNING_KEY";
    key = process.env[env]?.trim();
    if (!key) fail(`Set ${env} to the base64 private key, or pass --key-file`);
  }
  const { publicKey } = await wrap(() => signPluginIndexFile(path.resolve(file), key!));
  return fields({
    signature: `${path.resolve(file)}.sig`,
    publicKey: `${path.resolve(file)}.pub`,
    key: publicKey,
  });
}

export async function runIndexVerifyCommand(
  file: string,
  options: CommandOptions & { publicKey?: string; tarballs?: string },
  _command: Command,
): Promise<ListResult<FieldRow>> {
  const key = options.publicKey?.trim() || process.env.PLUGIN_REPO_PUBLIC_KEY?.trim();
  if (!key) fail("Pass --public-key or set PLUGIN_REPO_PUBLIC_KEY");
  const result = await wrap(() =>
    verifyPluginIndexFile(
      path.resolve(file),
      key!,
      options.tarballs ? path.resolve(options.tarballs) : undefined,
    ),
  );
  return fields({
    index: path.resolve(file),
    plugins: result.index.plugins.length,
    tarballsVerified: result.checkedTarballs,
    signature: "valid",
  });
}
