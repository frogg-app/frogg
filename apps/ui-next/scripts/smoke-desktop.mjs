#!/usr/bin/env node
// Launches a packaged Frogg Next build and checks it really starts: the window loads the UI on
// the brand's scheme, the preload bridge is there, a fresh install asks to pair instead of
// dialing the daemon bare, and a second launch hands its pairing link to the running window and
// exits instead of opening a second, disconnected copy. Linux needs a display: run under xvfb-run.
// Usage: xvfb-run -a node apps/ui-next/scripts/smoke-desktop.mjs <executable> [--no-sandbox]
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { _electron as electron } from "playwright";

const [executable, ...flags] = process.argv.slice(2);
if (!executable) throw new Error("Usage: smoke-desktop.mjs <packaged executable> [--no-sandbox]");
const resources =
  process.platform === "darwin"
    ? path.resolve(path.dirname(executable), "../Resources")
    : path.join(path.dirname(executable), "resources");
const asar = (await import("@electron/asar")).default;
const identity = JSON.parse(
  asar.extractFile(path.join(resources, "app.asar"), "identity.json").toString("utf8"),
);
const state = mkdtempSync(path.join(os.tmpdir(), "frogg-next-smoke-"));
// Electron's appData follows these, so the smoke never touches a real install's data.
const env = {
  ...process.env,
  HOME: state,
  XDG_CONFIG_HOME: path.join(state, "config"),
  APPDATA: path.join(state, "appdata"),
};
delete env.ELECTRON_RUN_AS_NODE;
const args = flags.includes("--no-sandbox") ? ["--no-sandbox"] : [];
const pairLink = `${identity.scheme}://pair/direct?v=1&host=127.0.0.1&port=9999&fp=sha256%3Aabcdef&pairingCode=ABCD-2345&name=smoke-host`;

let application;
try {
  application = await electron.launch({ executablePath: executable, args, env, timeout: 45_000 });
  const page = await application.firstWindow();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => document.body.innerText.trim().length > 20, null, {
    timeout: 30_000,
  });
  const url = new URL(page.url());
  assert.equal(url.protocol, `${identity.scheme}:`, "the UI loads on the brand's scheme");
  assert.equal(url.searchParams.get("daemon"), identity.defaultDaemon);
  assert.equal(await page.title(), identity.name);

  const update = await page.evaluate(() => window.froggNextDesktop?.updates.get());
  assert.ok(update, "the preload bridge exposes the updater");
  assert.equal(
    update.currentVersion,
    JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../package.json"), "utf8"))
      .version,
  );

  // Nothing is saved, so the app opens on pairing rather than an endless "disconnected".
  await page.getByText("Paste a link or enter the code").waitFor({ timeout: 15_000 });

  // A second launch exits and passes its link to this window, which opens the confirm sheet.
  const second = spawn(executable, [...args, pairLink], { env, stdio: "ignore" });
  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("the second launch kept running")), 20_000);
    second.on("exit", (exitCode) => {
      clearTimeout(timer);
      resolve(exitCode);
    });
  });
  assert.equal(code, 0, "the second launch exits cleanly");
  await page.getByText("smoke-host").first().waitFor({ timeout: 15_000 });
  assert.equal((await application.windows()).length, 1, "still one window");
  assert.deepEqual(errors, []);
  console.log(
    `Smoke passed: ${identity.name} ${update.currentVersion} (${update.mode} updates) loads ${url.protocol}//${url.host}, asks to pair, stays single-instance`,
  );
} finally {
  await application?.close().catch(() => undefined);
  rmSync(state, { recursive: true, force: true });
}
