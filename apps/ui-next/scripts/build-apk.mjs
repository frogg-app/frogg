#!/usr/bin/env node
// Builds the ui-next prototype as a debug-signed arm64 release APK (package app.frogg.next).
// Expects the workspace deps built (`npm run build:app-deps` at the repo root) and an Android SDK.
// Usage: node apps/ui-next/scripts/build-apk.mjs [out-dir]
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.resolve(process.argv[2] ?? path.join(app, "dist-apk"));
const win = process.platform === "win32";

const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: win });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("npx", ["expo", "prebuild", "--platform", "android", "--clean", "--no-install"], app);
// Capped heaps and one worker: an uncapped Gradle daemon gets OOM-killed on small runners.
run(
  win ? "gradlew.bat" : "./gradlew",
  [
    ":app:assembleRelease",
    "--no-daemon",
    "--max-workers=1",
    "-PreactNativeArchitectures=arm64-v8a",
    "-Dorg.gradle.jvmargs=-Xmx3072m -XX:MaxMetaspaceSize=768m",
    "-Dkotlin.daemon.jvm.options=-Xmx1024m",
  ],
  path.join(app, "android"),
);

const { version } = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8"));
mkdirSync(outDir, { recursive: true });
const dest = path.join(outDir, `Frogg-Next-${version}-android-arm64-v8a.apk`);
copyFileSync(path.join(app, "android/app/build/outputs/apk/release/app-release.apk"), dest);
console.log(`APK: ${dest}`);
