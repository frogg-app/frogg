#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { portableCommand } from "../../../scripts/dev/npm-command.mjs";
import { writeElectronChecksums } from "../../../scripts/release/electron-checksums.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const app = path.join(root, "apps/ui-next");
const { values } = parseArgs({
  options: {
    target: { type: "string", default: "darwin-arm64" },
    "export-only": { type: "boolean", default: false },
  },
});
if (values.target !== "darwin-arm64") throw new Error("Only --target darwin-arm64 is supported.");
if (!values["export-only"] && process.platform !== "darwin") {
  throw new Error("Mac artifacts require macOS. Use --export-only to validate the UI elsewhere.");
}
function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
for (const script of ["build:highlight", "build:client"]) {
  const npm = portableCommand("npm", ["run", script]);
  run(npm.command, npm.args);
}
const stage = path.join(app, "dist-desktop");
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
run(
  process.execPath,
  [
    path.join(root, "node_modules/expo/bin/cli"),
    "export",
    "--platform",
    "web",
    "--output-dir",
    path.join(stage, "web"),
  ],
  app,
);
cpSync(path.join(app, "assets/fonts"), path.join(stage, "web/fonts"), { recursive: true });
cpSync(path.join(app, "desktop/fonts.css"), path.join(stage, "web/desktop-fonts.css"));
const indexPath = path.join(stage, "web/index.html");
const policy =
  "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; font-src 'self' data:; connect-src 'self' ws: wss: https: http:; worker-src 'self' blob:";
writeFileSync(
  indexPath,
  readFileSync(indexPath, "utf8").replace(
    "<head>",
    `<head><meta http-equiv="Content-Security-Policy" content="${policy}"><link id="frogg-fonts" rel="stylesheet" href="/desktop-fonts.css">`,
  ),
);
for (const file of ["main.cjs", "resolve-asset.cjs"]) {
  cpSync(path.join(app, "desktop", file), path.join(stage, file));
}
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const desktopPackage = JSON.parse(
  readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"),
);
writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify({
    name: "frogg-next-desktop",
    version,
    description: "Frogg Next interface prototype",
    author: desktopPackage.author,
    license: "Apache-2.0",
    main: "main.cjs",
  }),
);
cpSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
cpSync(path.join(root, "NOTICE"), path.join(stage, "NOTICE"));
if (values["export-only"]) {
  console.log(`Desktop UI staged at ${stage}`);
} else {
  const outDir = path.join(root, "release-assets/ui-next-mac-arm64");
  const configPath = path.join(stage, "builder.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      appId: "app.frogg.next",
      productName: "Frogg Next",
      artifactName: "Frogg-Next-${version}-mac-${arch}.${ext}",
      electronVersion: desktopPackage.devDependencies.electron,
      npmRebuild: false,
      asar: true,
      files: ["main.cjs", "resolve-asset.cjs", "web/**/*", "package.json", "LICENSE", "NOTICE"],
      directories: { output: outDir },
      mac: {
        target: ["dmg", "zip"],
        category: "public.app-category.developer-tools",
        icon: path.join(root, ".generated/branding/icons/icon.icns"),
        identity: "-",
        notarize: false,
      },
      publish: null,
    }),
  );
  run(process.execPath, [
    path.join(root, "node_modules/electron-builder/cli.js"),
    "--projectDir",
    stage,
    "--config",
    configPath,
    "--mac",
    "--arm64",
    "--publish",
    "never",
  ]);
  await writeElectronChecksums(outDir);
  console.log(`Mac ARM artifacts: ${outDir}`);
}
