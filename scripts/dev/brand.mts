import { stageBrand } from "./branding/stage.mjs";
import { parseArgs } from "node:util";
import { mkdir, copyFile, writeFile, mkdtemp, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { BrandManifestSchema } from "../../packages/branding/src/schema.js";
import { validateAssets } from "./branding/assets.mjs";
import { prepareBrand } from "./branding/prepare.mjs";
import { root, resolveBrand } from "./branding/resolve.mjs";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    brand: { type: "string" },
    channel: { type: "string" },
    dir: { type: "string" },
    id: { type: "string" },
    name: { type: "string" },
    "app-id": { type: "string" },
    port: { type: "string" },
    icon: { type: "string" },
    json: { type: "boolean" },
  },
});
const command = positionals[0];

/** A 1024 px tile with the brand's initials, so a brand can be scaffolded before its artwork exists. */
function placeholderIcon(name: string): string {
  const initials = name
    .split(/\s+/u)
    .map((word) => word.charAt(0).toUpperCase())
    .filter((letter) => /[A-Z0-9]/u.test(letter))
    .slice(0, 2)
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <rect x="64" y="64" width="896" height="896" rx="200" fill="#3f4a47"/>
  <text x="512" y="512" dy="0.35em" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="400" font-weight="700" fill="#f4f7f6">${initials || "B"}</text>
</svg>
`;
}

if (command === "init") {
  if (!values.dir || !values.id || !values.name || !values["app-id"] || !values.port)
    throw new Error(
      "brand:init requires --dir, --id, --name, --app-id and --port (--icon optional)",
    );
  const filename = values.icon ? `icon${path.extname(values.icon)}` : "icon.svg";
  const manifest = BrandManifestSchema.parse({
    schemaVersion: 1,
    id: values.id,
    name: values.name,
    applicationId: values["app-id"],
    daemonPort: Number(values.port),
    assets: { icon: `./${filename}` },
  });
  const destination = path.resolve(values.dir);
  if (await lstat(destination).catch(() => null)) {
    throw new Error(`Brand destination already exists: ${destination}. Choose a new directory.`);
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const staging = await mkdtemp(path.join(path.dirname(destination), ".brand-init-"));
  try {
    if (values.icon) await copyFile(path.resolve(values.icon), path.join(staging, filename));
    else await writeFile(path.join(staging, filename), placeholderIcon(manifest.name));
    await writeFile(path.join(staging, "brand.json"), JSON.stringify(manifest, null, 2) + "\n");
    await validateAssets(resolveBrand(staging));
    await rename(staging, destination);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
  process.stdout.write(
    `Brand created at ${destination}. Build with FROGG_BRAND_DIR=${destination}\n` +
      (values.icon ? "" : `Placeholder ${filename} written; replace it before you ship.\n`),
  );
} else if (command === "check") {
  const build = resolveBrand(values.brand, values.channel);
  await validateAssets(build);
  process.stdout.write(
    values.json
      ? JSON.stringify(build.brand, null, 2) + "\n"
      : `${build.brand.name}: valid (${build.brand.applicationId}, ${build.channel} channel); updates ${build.brand.distribution.updateMode}\n`,
  );
} else if (command === "prepare") {
  if (values.channel) process.env.FROGG_BRAND_CHANNEL = values.channel;
  const build = await prepareBrand(values.brand);
  process.stdout.write(`Brand prepared: ${build.brand.name} (${build.fingerprint.slice(0, 12)})\n`);
} else if (command === "stage") {
  process.stdout.write((await stageBrand(values.brand)) + "\n");
} else if (command === "schema") {
  await writeFile(
    path.join(root, "packages/branding/brand.schema.json"),
    JSON.stringify(z.toJSONSchema(BrandManifestSchema), null, 2) + "\n",
  );
} else {
  throw new Error(
    "Usage: brand.ts init|check|prepare|schema [--brand <directory>] [--channel stable|beta]",
  );
}
