#!/usr/bin/env node
// Builds Frogg Next as an arm64 release APK (package id from the brand's `next` identity):
//
//   <prefix>-<version>-android-arm64-v8a.apk            signed with FROGG_ANDROID_KEYSTORE*
//   <prefix>-<version>-android-arm64-v8a-unsigned.apk   debug-signed (no keystore set)
//
// The keystore variables are the ones apps/ui/plugins/with-android-release-signing.js reads; the
// release workflow fills them from the classic app's FROGG_ANDROID_* secrets (or the
// FROGG_NEXT_ANDROID_* override), so a promoted build can update the classic app in place.
// Expects the workspace deps built (`npm run build:app-deps` at the repo root) and an Android SDK.
// Usage: node apps/ui-next/scripts/build-apk.mjs [out-dir] [--dry-run]
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { froggNextArtifactName } from "../../../packages/branding/src/artifact-contract.mjs";

const app = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const { loadBrand } = require("../../../scripts/dev/branding/load.cjs");
const { resolveIdentity } = require("../desktop/identity.cjs");
const identity = resolveIdentity(loadBrand());
// Read by the bundle Gradle builds (pairing schemes, the in-app updater); app.config.js sets the same.
Object.assign(process.env, {
  EXPO_PUBLIC_FROGG_APP_SCHEME: identity.scheme,
  EXPO_PUBLIC_FROGG_ARTIFACT_PREFIX: identity.artifactPrefix,
  EXPO_PUBLIC_FROGG_RELEASE_REPO: identity.repository,
});
const { values, positionals } = parseArgs({
  options: { "dry-run": { type: "boolean", default: false } },
  allowPositionals: true,
});
const outDir = path.resolve(positionals[0] ?? path.join(app, "dist-apk"));
const win = process.platform === "win32";
const keystore = process.env.FROGG_ANDROID_KEYSTORE;
const { version } = JSON.parse(readFileSync(path.join(app, "package.json"), "utf8"));
const dest = path.join(
  outDir,
  froggNextArtifactName(
    version,
    `android-arm64-v8a${keystore ? "" : "-unsigned"}.apk`,
    identity.artifactPrefix,
  ),
);
if (values["dry-run"]) {
  console.log(dest);
  process.exit(0);
}
if (keystore) {
  if (!existsSync(keystore)) throw new Error(`FROGG_ANDROID_KEYSTORE does not exist: ${keystore}`);
  for (const key of ["FROGG_ANDROID_KEYSTORE_PASSWORD", "FROGG_ANDROID_KEY_ALIAS"]) {
    if (!process.env[key]) throw new Error(`${key} is required when FROGG_ANDROID_KEYSTORE is set`);
  }
}

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

mkdirSync(outDir, { recursive: true });
copyFileSync(path.join(app, "android/app/build/outputs/apk/release/app-release.apk"), dest);
console.log(`APK: ${dest} (${keystore ? "release-signed" : "debug-signed"})`);
