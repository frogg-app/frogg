import { execFile, spawn } from "node:child_process";
import os from "node:os";
import { app, BrowserWindow } from "electron";
import { brand } from "@frogg/branding";
import { handleDesktopIpc } from "../../ipc-security.js";
import { BetaAppService, type BetaAppInstallProgress } from "./service.js";

/** Renderer channel; preload exposes it as `froggDesktop.betaApp.onProgress`. */
export const BETA_APP_PROGRESS_EVENT = "frogg:event:beta-app-install-progress";

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout) => {
      if (error) reject(error);
      else resolve(stdout);
    });
  });
}

function spawnDetached(command: string, args: string[]): void {
  const child = spawn(command, args, { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

function broadcast(progress: BetaAppInstallProgress): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(BETA_APP_PROGRESS_EVENT, progress);
  }
}

export function registerBetaAppHandlers(): void {
  const service = new BetaAppService({
    identity: {
      channel: brand.channel,
      releasesApi: brand.distribution.releasesApi,
      beta: brand.channels.beta,
      stable: brand.channels.stable,
    },
    platform: process.platform,
    arch: process.arch,
    homeDir: os.homedir(),
    tempDir: app.getPath("temp"),
    fetch: (input, init) => fetch(input, init),
    run,
    spawnDetached,
    emit: broadcast,
  });
  handleDesktopIpc("frogg:beta-app:status", () => service.getStatus());
  handleDesktopIpc("frogg:beta-app:resolveLatest", () => service.resolveLatest());
  handleDesktopIpc("frogg:beta-app:install", () => service.install());
  handleDesktopIpc("frogg:beta-app:cancelInstall", () => service.cancelInstall());
  handleDesktopIpc("frogg:beta-app:open", () => service.open());
}
