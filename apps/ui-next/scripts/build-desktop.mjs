#!/usr/bin/env node
// Builds the Frogg Next desktop app for one target into release-assets/<dir>/: the installers,
// their blockmaps, a `<feed>.<target>.feed.json` fragment of the electron-updater feed (the
// release job merges the fragments into <feedPrefix>-latest*.yml) and a SHA256SUMS. Name, app id,
// scheme and artifact prefix come from the brand's `next` identity (desktop/identity.cjs).
// Windows builds are signed with Azure Trusted Signing when TRUSTED_SIGNING_* is set, like the
// classic app; Mac builds are ad-hoc signed.
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseArgs } from "node:util";
import { portableCommand } from "../../../scripts/dev/npm-command.mjs";
import { writeElectronChecksums } from "../../../scripts/release/electron-checksums.mjs";
import { froggNextArtifactName } from "../../../packages/branding/src/artifact-contract.mjs";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "../../..");
const app = path.join(root, "apps/ui-next");
const { resolveIdentity, feedFileNames } = require("../desktop/identity.cjs");
const { PACKAGED_FILES, missingFromPackage } = require("../desktop/packaged-files.cjs");
const { values } = parseArgs({
  options: {
    target: { type: "string", default: "darwin-arm64" },
    "export-only": { type: "boolean", default: false },
    // Print the release asset names this target produces, then exit.
    "dry-run": { type: "boolean", default: false },
    // Reuse dist-desktop/web from an earlier run instead of exporting the UI again.
    "skip-export": { type: "boolean", default: false },
  },
});
const { loadBrand } = require("../../../scripts/dev/branding/load.cjs");
const brand = loadBrand();
const identity = resolveIdentity(brand);
// The web bundle reads these (pairing schemes, release links); app.config.js sets the same.
Object.assign(process.env, {
  EXPO_PUBLIC_FROGG_APP_SCHEME: identity.scheme,
  EXPO_PUBLIC_FROGG_ARTIFACT_PREFIX: identity.artifactPrefix,
  EXPO_PUBLIC_FROGG_RELEASE_REPO: identity.repository,
});
const icons = path.join(root, ".generated/branding/icons");
const feeds = feedFileNames(identity);
const name = (version, suffix) => froggNextArtifactName(version, suffix, identity.artifactPrefix);
const mac = (arch) => ({
  os: "darwin",
  label: `Mac ${arch === "arm64" ? "ARM" : "Intel"}`,
  dir: `ui-next-mac-${arch}`,
  cli: ["--mac", `--${arch}`],
  feed: feeds.darwin,
  assets: [`mac-${arch}.dmg`, `mac-${arch}.zip`],
  config: {
    artifactName: name("${version}", "mac-${arch}.${ext}"),
    mac: {
      target: ["dmg", "zip"],
      category: "public.app-category.developer-tools",
      icon: path.join(icons, "icon.icns"),
      identity: "-",
      notarize: false,
    },
  },
});
// Per target: the OS that must build it, the artifact folder and electron-builder settings.
const targets = {
  "darwin-arm64": mac("arm64"),
  "darwin-x64": mac("x64"),
  "win32-x64": {
    os: "win32",
    label: "Windows x64",
    dir: "ui-next-win-x64",
    cli: ["--win", "--x64"],
    feed: feeds.win32,
    assets: ["win-x64.exe", "win-x64.zip"],
    config: {
      artifactName: name("${version}", "win-${arch}.${ext}"),
      win: { target: ["nsis", "zip"], icon: path.join(icons, "icon.ico"), ...azureSigning() },
      nsis: {
        oneClick: true,
        perMachine: false,
        runAfterFinish: true,
        deleteAppDataOnUninstall: false,
        shortcutName: identity.name,
        uninstallDisplayName: identity.name,
      },
    },
  },
  "linux-x64": {
    os: "linux",
    label: "Linux x64",
    dir: "ui-next-linux-x64",
    cli: ["--linux", "--x64"],
    feed: feeds.linux,
    assets: ["linux-x86_64.AppImage", "linux-x86_64.deb"],
    config: {
      linux: {
        target: ["AppImage", "deb"],
        category: "Development",
        icon: path.join(icons, "icon.png"),
        maintainer: `${brand.publisher} <hello@frogg.app>`,
      },
      appImage: { artifactName: name("${version}", "linux-x86_64.${ext}") },
      deb: { artifactName: name("${version}", "linux-x86_64.${ext}") },
    },
  },
};
const target = targets[values.target];
if (!target) throw new Error(`--target must be one of: ${Object.keys(targets).join(", ")}`);
const { version } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
if (values["dry-run"]) {
  for (const suffix of target.assets) {
    console.log(path.join("release-assets", target.dir, name(version, suffix)));
  }
  console.log(path.join("release-assets", target.dir, `${target.feed}.${values.target}.feed.json`));
  process.exit(0);
}
if (!values["export-only"] && process.platform !== target.os) {
  throw new Error(
    `${target.label} artifacts must be built on ${target.os}. Use --export-only to validate the UI elsewhere.`,
  );
}

/** Azure Trusted Signing, configured exactly as the classic app's electron-builder.cjs does. */
function azureSigning() {
  const account = process.env.TRUSTED_SIGNING_ACCOUNT;
  if (!account) return {};
  const endpoint = process.env.TRUSTED_SIGNING_ENDPOINT;
  const profile = process.env.TRUSTED_SIGNING_PROFILE;
  if (!endpoint || !profile)
    throw new Error("Trusted Signing requires endpoint and certificate profile.");
  return {
    azureSignOptions: {
      endpoint,
      codeSigningAccountName: account,
      certificateProfileName: profile,
      publisherName: brand.publisher,
    },
  };
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

const stage = path.join(app, "dist-desktop");
if (values["skip-export"]) {
  for (const entry of readdirSync(stage))
    if (entry !== "web") rmSync(path.join(stage, entry), { recursive: true, force: true });
} else {
  for (const script of ["build:highlight", "build:client"]) {
    const npm = portableCommand("npm", ["run", script]);
    run(npm.command, npm.args);
  }
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
}
// One file per entry point: every local module and electron-updater are inlined, so no
// `require` can name a file the package left out.
const esbuild = require("esbuild");
await esbuild.build({
  entryPoints: ["main.cjs", "preload.cjs"].map((file) => path.join(app, "desktop", file)),
  outdir: stage,
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node22",
  external: ["electron"],
  logLevel: "warning",
});
writeFileSync(path.join(stage, "identity.json"), `${JSON.stringify(identity, null, 2)}\n`);
const desktopPackage = JSON.parse(
  readFileSync(path.join(root, "apps/desktop/package.json"), "utf8"),
);
writeFileSync(
  path.join(stage, "package.json"),
  JSON.stringify({
    name: identity.desktopBinaryName,
    productName: identity.name,
    version,
    description: `${identity.name} desktop client`,
    author: desktopPackage.author,
    homepage: brand.links?.website ?? "https://frogg.app",
    license: "Apache-2.0",
    main: "main.cjs",
  }),
);
cpSync(path.join(root, "LICENSE"), path.join(stage, "LICENSE"));
cpSync(path.join(root, "NOTICE"), path.join(stage, "NOTICE"));
if (values["export-only"]) {
  console.log(`Desktop UI staged at ${stage}`);
} else {
  const outDir = path.join(root, "release-assets", target.dir);
  rmSync(outDir, { recursive: true, force: true });
  const configPath = path.join(stage, "builder.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      appId: identity.applicationId,
      productName: identity.name,
      executableName: identity.desktopBinaryName,
      electronVersion: desktopPackage.devDependencies.electron,
      npmRebuild: false,
      asar: true,
      files: PACKAGED_FILES,
      directories: { output: outDir },
      protocols: [{ name: identity.name, schemes: [identity.scheme] }],
      ...target.config,
      // Only for the feed files (`<feedPrefix>-latest*.yml`) and the embedded app-update.yml;
      // the running app points the updater at the newest matching release itself.
      publish: [
        {
          provider: "generic",
          url: `https://github.com/${identity.repository}/releases/latest/download`,
          channel: `${identity.feedPrefix}-latest`,
        },
      ],
    }),
  );
  run(process.execPath, [
    path.join(root, "node_modules/electron-builder/cli.js"),
    "--projectDir",
    stage,
    "--config",
    configPath,
    ...target.cli,
    "--publish",
    "never",
  ]);
  checkPackagedFiles(outDir);
  writeFeedFragment(outDir);
  await writeElectronChecksums(outDir);
  console.log(`${target.label} artifacts: ${outDir}`);
}

/** Fails the build when app.asar lacks a file main.cjs or preload.cjs loads at run time. */
function checkPackagedFiles(outDir) {
  const asar = require("@electron/asar");
  const archives = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.name === "app.asar") archives.push(full);
      else if (entry.isDirectory() && !entry.isSymbolicLink()) walk(full);
    }
  };
  walk(outDir);
  if (!archives.length) throw new Error(`No app.asar under ${outDir}`);
  for (const archive of archives) {
    const entries = asar
      .listPackage(archive, { isPack: false })
      .map((e) => e.replace(/^[\\/]/, ""));
    const missing = missingFromPackage(entries, (file) =>
      asar.extractFile(archive, file).toString("utf8"),
    );
    if (missing.length)
      throw new Error(`${archive} is missing files the app loads: ${missing.join(", ")}`);
    console.log(`Checked ${path.relative(root, archive)}: ${entries.length} entries`);
  }
}

/**
 * electron-builder writes this platform's feed as `<channel>[-mac|-linux].yml`. Mac arm64 and x64
 * build on separate runners and would each write `-mac.yml` for one arch, so every build keeps
 * its feed as a JSON fragment and the release job merges them (scripts/merge-update-feeds.mjs).
 */
function writeFeedFragment(outDir) {
  const yaml = require("js-yaml");
  const feed = yaml.load(readFileSync(path.join(outDir, target.feed), "utf8"));
  rmSync(path.join(outDir, target.feed));
  writeFileSync(
    path.join(outDir, `${target.feed}.${values.target}.feed.json`),
    `${JSON.stringify(feed, null, 2)}\n`,
  );
}
