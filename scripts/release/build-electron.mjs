#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { portableCommand } from "../dev/npm-command.mjs";
import { writeElectronChecksums } from "./electron-checksums.mjs";
import { writeElectronInstallerZips } from "./electron-installer-zip.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const desktop = path.join(root, "apps/desktop");
const { values } = parseArgs({
  options: {
    target: {
      type: "string",
      default: `${process.platform === "win32" ? "win" : process.platform}-${process.arch}`,
    },
    dir: { type: "boolean", default: false },
    // Reuse an apps/ui/dist produced elsewhere instead of exporting it here --
    // the same contract as `build:daemon-web-ui -- --skip-export`. The release
    // workflow exports the web UI once in the `ui` job and hands the artifact to
    // every desktop runner, which is otherwise four identical Expo exports.
    "skip-export": { type: "boolean", default: false },
  },
});
const [platform, arch] = values.target.split("-");
if (!/^(linux|darwin|win)-(x64|arm64)$/.test(values.target)) {
  throw new Error("Expected --target <linux|darwin|win>-<x64|arm64> (for example win-x64)");
}
if (platform === "darwin" && process.platform !== "darwin") {
  throw new Error("macOS artifacts must be built on macOS.");
}
function run(script, args = []) {
  const npm = portableCommand("npm", ["run", script, ...args]);
  const result = spawnSync(npm.command, npm.args, {
    cwd: root,
    stdio: "inherit",
    env: process.env,
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (${result.status})`);
}
if (values["skip-export"]) {
  // A missing or empty dist would silently pack a desktop app with no UI:
  // electron-builder copies ../ui/dist as extraResources without complaining.
  if (!existsSync(path.join(root, "apps/ui/dist/index.html"))) {
    throw new Error(
      "--skip-export needs an existing apps/ui/dist (index.html is missing). Run `npm run build:ui`, or download the ui-dist artifact, first.",
    );
  }
  // And an export made for a different brand would ship a mis-branded app just
  // as quietly. build-daemon-web-ui makes the same check on the same artifact.
  const stamp = JSON.parse(readFileSync(path.join(root, "apps/ui/dist/brand-build.json"), "utf8"));
  const provenance = JSON.parse(
    readFileSync(path.join(root, ".generated/branding/provenance.json"), "utf8"),
  );
  if (stamp.configFingerprint !== provenance.configFingerprint) {
    throw new Error(
      "apps/ui/dist was exported for different branding than the selected brand; re-export it.",
    );
  }
  console.log("Reusing apps/ui/dist (--skip-export).");
  // build:ui builds the workspace packages as a side effect (build:app-deps);
  // skipping it must not skip them, or build:main cannot resolve
  // @frogg/protocol's dist.
  run("build:protocol");
} else {
  run("build:ui");
}
run("build:main", ["--workspace=@frogg/desktop"]);
const builder = path.join(root, "node_modules/electron-builder/cli.js");
const platformFlag = platform === "darwin" ? "--mac" : `--${platform}`;
rmSync(path.join(desktop, "release"), { recursive: true, force: true });
const result = spawnSync(
  process.execPath,
  [
    builder,
    "--config",
    "electron-builder.cjs",
    platformFlag,
    `--${arch}`,
    "--publish",
    "never",
    ...(values.dir ? ["--dir"] : []),
  ],
  {
    cwd: desktop,
    stdio: "inherit",
    env: process.env,
  },
);
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);

if (!values.dir) {
  if (platform === "win") await writeElectronInstallerZips(path.join(desktop, "release"));
  await writeElectronChecksums(path.join(desktop, "release"));
}
