// Download, verify and install the beta desktop app beside this (stable) one.
//
// Electron-free core: every side effect comes through `BetaAppDeps` so tests run it
// against test-owned directories and a fake network. The Electron wiring lives in
// ./ipc.ts. The stable install is never a target: paths come from the beta identity,
// assets must carry the beta artifact prefix, and on macOS the bundle id is checked.

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import {
  DESKTOP_CHECKSUM_ASSET,
  RELEASE_DESCRIPTOR_ASSET,
  assertBetaArtifact,
  parseSha256Sums,
  parseWindowsUninstallEntries,
  selectBetaInstallerAsset,
  selectLatestBetaRelease,
  sha256FromReleaseDescriptor,
  type BetaInstallerAsset,
  type BetaInstallerKind,
  type BetaRelease,
} from "./release.js";

export type BetaAppUnsupportedReason =
  | "running-beta"
  | "unsupported-platform"
  | "no-release-repository";

export interface BetaAppStatus {
  supported: boolean;
  unsupportedReason: BetaAppUnsupportedReason | null;
  /** Display name of the beta app, e.g. "frogg beta". */
  betaName: string;
  installed: boolean;
  installedVersion: string | null;
  installPath: string | null;
  /** True while an install started by this app is in flight. */
  installing: boolean;
}

export interface BetaAppLatestRelease {
  version: string;
  tag: string;
  assetName: string;
  assetSize: number | null;
  kind: BetaInstallerKind;
}

export type BetaAppInstallPhase =
  | "resolving"
  | "downloading"
  | "verifying"
  | "installing"
  | "launched"
  | "failed"
  | "cancelled";

export interface BetaAppInstallProgress {
  phase: BetaAppInstallPhase;
  version: string | null;
  assetName: string | null;
  receivedBytes: number;
  totalBytes: number | null;
  error: string | null;
}

export interface BetaAppInstallResult {
  version: string;
  assetName: string;
  sha256: string;
  /** Where the beta app ends up; null on Windows, where the NSIS installer decides. */
  installPath: string | null;
}

export interface BetaAppIdentity {
  channel: "stable" | "beta";
  releasesApi: string | null;
  beta: {
    id: string;
    name: string;
    applicationId: string;
    artifactPrefix: string;
  };
  stable: { name: string; applicationId: string; artifactPrefix: string };
}

export interface BetaAppDeps {
  identity: BetaAppIdentity;
  platform: string;
  arch: string;
  homeDir: string;
  tempDir: string;
  /** macOS install root; defaults to /Applications. */
  macApplicationsDir?: string;

  fetch: typeof fetch;
  /** Run a command to completion; resolves stdout, rejects on non-zero exit. */
  run: (command: string, args: string[]) => Promise<string>;
  /** Start a detached process that outlives this app. */
  spawnDetached: (command: string, args: string[]) => void;
  emit: (progress: BetaAppInstallProgress) => void;
}

const REQUEST_TIMEOUT_MS = 15_000;
const PROGRESS_INTERVAL_MS = 150;

async function fetchJson(deps: BetaAppDeps, url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await deps.fetch(url, {
    headers: { Accept: "application/vnd.github+json" },
    signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Release discovery failed (${response.status}).`);
  return response.json();
}

export class BetaAppService {
  private active: AbortController | null = null;

  constructor(private readonly deps: BetaAppDeps) {}

  private unsupportedReason(): BetaAppUnsupportedReason | null {
    const { identity, platform } = this.deps;
    if (identity.channel === "beta") return "running-beta";
    if (!identity.releasesApi) return "no-release-repository";
    if (!["win32", "darwin", "linux"].includes(platform)) return "unsupported-platform";
    if (platform === "linux" && !["x64", "arm64"].includes(this.deps.arch)) {
      return "unsupported-platform";
    }
    return null;
  }

  private assertSupported(): void {
    const reason = this.unsupportedReason();
    if (reason === "running-beta") {
      throw new Error("This is already the beta app; it updates itself from Settings.");
    }
    if (reason) throw new Error(`Installing the beta app is not supported here (${reason}).`);
  }

  /** macOS bundle / Linux AppImage location the beta app is installed to. */
  private managedInstallPath(): string | null {
    const { platform, homeDir, identity } = this.deps;
    if (platform === "darwin") {
      return path.join(
        this.deps.macApplicationsDir ?? "/Applications",
        `${identity.beta.name}.app`,
      );
    }
    if (platform === "linux") {
      return path.join(homeDir, "Applications", `${identity.beta.id}.AppImage`);
    }
    return null;
  }

  async getStatus(): Promise<BetaAppStatus> {
    const reason = this.unsupportedReason();
    const installed = reason === null || reason === "running-beta" ? await this.detect() : null;
    return {
      supported: reason === null,
      unsupportedReason: reason,
      betaName: this.deps.identity.beta.name,
      installed: installed !== null,
      installedVersion: installed?.version ?? null,
      installPath: installed?.path ?? null,
      installing: this.active !== null,
    };
  }

  private async detect(): Promise<{
    path: string;
    version: string | null;
  } | null> {
    const { platform, identity } = this.deps;
    try {
      if (platform === "darwin") {
        const roots = [
          this.deps.macApplicationsDir ?? "/Applications",
          path.join(this.deps.homeDir, "Applications"),
        ];
        for (const root of roots) {
          const bundle = path.join(root, `${identity.beta.name}.app`);
          const plist = path.join(bundle, "Contents", "Info.plist");
          if (!(await exists(plist))) continue;
          const bundleId = await this.plistValue(plist, "CFBundleIdentifier");
          if (bundleId !== identity.beta.applicationId) continue;
          return {
            path: bundle,
            version: await this.plistValue(plist, "CFBundleShortVersionString"),
          };
        }
        return null;
      }
      if (platform === "linux") {
        const file = this.managedInstallPath()!;
        if (!(await exists(file))) return null;
        const meta = await fs.readFile(`${file}.json`, "utf8").catch(() => null);
        const version = meta ? (JSON.parse(meta) as { version?: unknown }).version : null;
        return {
          path: file,
          version: typeof version === "string" ? version : null,
        };
      }
      if (platform === "win32") {
        const output = await this.deps.run("reg", [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall",
          "/s",
          "/f",
          identity.beta.name,
          "/d",
        ]);
        const entry = parseWindowsUninstallEntries(output).find(
          (candidate) => candidate.displayName.replace(/ \d[\w.+-]*$/, "") === identity.beta.name,
        );
        if (!entry) return null;
        const exe = entry.installLocation
          ? path.win32.join(entry.installLocation, `${identity.beta.id}.exe`)
          : null;
        if (!exe || !(await exists(exe))) return null;
        return { path: exe, version: entry.displayVersion };
      }
    } catch {
      return null;
    }
    return null;
  }

  private async plistValue(plist: string, key: string): Promise<string | null> {
    const value = await this.deps
      .run("plutil", ["-extract", key, "raw", "-o", "-", plist])
      .catch(() => null);
    return value?.trim() || null;
  }

  private async resolve(signal?: AbortSignal): Promise<{
    release: BetaRelease;
    asset: BetaInstallerAsset;
  }> {
    this.assertSupported();
    const raw = await fetchJson(
      this.deps,
      `${this.deps.identity.releasesApi}?per_page=100`,
      signal,
    );
    const release = selectLatestBetaRelease(raw);
    if (!release) throw new Error("No published beta release is available.");
    const asset = selectBetaInstallerAsset({
      release,
      artifactPrefix: this.deps.identity.beta.artifactPrefix,
      platform: this.deps.platform,
      arch: this.deps.arch,
    });
    if (!asset) {
      throw new Error(
        `Beta ${release.version} has no desktop installer for ${this.deps.platform}-${this.deps.arch} yet.`,
      );
    }
    assertBetaArtifact({
      assetName: asset.name,
      betaArtifactPrefix: this.deps.identity.beta.artifactPrefix,
      stableArtifactPrefix: this.deps.identity.stable.artifactPrefix,
    });
    return { release, asset };
  }

  async resolveLatest(): Promise<BetaAppLatestRelease> {
    const { release, asset } = await this.resolve();
    return {
      version: release.version,
      tag: release.tag,
      assetName: asset.name,
      assetSize: asset.size,
      kind: asset.kind,
    };
  }

  cancelInstall(): boolean {
    if (!this.active) return false;
    this.active.abort();
    return true;
  }

  async install(): Promise<BetaAppInstallResult> {
    if (this.active) throw new Error("A beta install is already running.");
    const controller = new AbortController();
    this.active = controller;
    const progress: BetaAppInstallProgress = {
      phase: "resolving",
      version: null,
      assetName: null,
      receivedBytes: 0,
      totalBytes: null,
      error: null,
    };
    const emit = (patch: Partial<BetaAppInstallProgress>) => {
      Object.assign(progress, patch);
      this.deps.emit({ ...progress });
    };
    let workDir: string | null = null;
    try {
      emit({});
      const { release, asset } = await this.resolve(controller.signal);
      emit({
        version: release.version,
        assetName: asset.name,
        totalBytes: asset.size,
      });
      const expected = await this.expectedSha256(release, asset.name, controller.signal);
      workDir = await fs.mkdtemp(
        path.join(this.deps.tempDir, `${this.deps.identity.beta.id}-installer-`),
      );
      const file = path.join(workDir, asset.name);
      emit({ phase: "downloading" });
      const actual = await this.download(asset, file, controller.signal, (received, total) =>
        emit({ receivedBytes: received, totalBytes: total }),
      );
      emit({ phase: "verifying" });
      if (actual !== expected) {
        throw new Error(`Checksum mismatch for ${asset.name}; the download was discarded.`);
      }
      if (controller.signal.aborted) throw abortError();
      emit({ phase: "installing" });
      const installPath = await this.installAsset(asset.kind, file, release.version);
      emit({ phase: "launched" });
      // The Windows installer runs from the downloaded file; keep it until it exits.
      if (asset.kind !== "nsis-exe") await fs.rm(workDir, { recursive: true, force: true });
      return {
        version: release.version,
        assetName: asset.name,
        sha256: actual,
        installPath,
      };
    } catch (error) {
      if (workDir) await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
      const cancelled = controller.signal.aborted;
      let message = error instanceof Error ? error.message : String(error);
      if (cancelled) message = "Beta install cancelled.";
      emit({ phase: cancelled ? "cancelled" : "failed", error: message });
      throw new Error(message, { cause: error });
    } finally {
      this.active = null;
    }
  }

  private async expectedSha256(
    release: BetaRelease,
    assetName: string,
    signal: AbortSignal,
  ): Promise<string> {
    const sums = release.assets.find((asset) => asset.name === DESKTOP_CHECKSUM_ASSET);
    if (sums) {
      const response = await this.deps.fetch(sums.url, { signal });
      if (!response.ok)
        throw new Error(`Could not fetch ${DESKTOP_CHECKSUM_ASSET} (${response.status}).`);
      const hash = parseSha256Sums(await response.text()).get(assetName);
      if (hash) return hash;
    }
    const descriptor = release.assets.find((asset) => asset.name === RELEASE_DESCRIPTOR_ASSET);
    if (descriptor) {
      const hash = sha256FromReleaseDescriptor(
        await fetchJson(this.deps, descriptor.url, signal),
        assetName,
      );
      if (hash) return hash;
    }
    throw new Error(
      `Beta ${release.version} publishes no checksum for ${assetName}; not installing.`,
    );
  }

  private async download(
    asset: BetaInstallerAsset,
    file: string,
    signal: AbortSignal,
    onProgress: (received: number, total: number | null) => void,
  ): Promise<string> {
    const response = await this.deps.fetch(asset.url, { signal });
    if (!response.ok || !response.body) {
      throw new Error(`Download of ${asset.name} failed (${response.status}).`);
    }
    const header = Number(response.headers.get("content-length"));
    const total = Number.isFinite(header) && header > 0 ? header : asset.size;
    const hash = createHash("sha256");
    const out = createWriteStream(file, { mode: 0o600 });
    let received = 0;
    let lastEmit = 0;
    try {
      const reader = response.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        hash.update(value);
        received += value.byteLength;
        if (!out.write(value))
          await new Promise<void>((resolve) => out.once("drain", () => resolve()));
        const now = Date.now();
        if (now - lastEmit >= PROGRESS_INTERVAL_MS) {
          lastEmit = now;
          onProgress(received, total);
        }
      }
    } finally {
      await new Promise<void>((resolve, reject) =>
        out.end((error?: Error | null) => {
          if (error) reject(error);
          else resolve();
        }),
      );
    }
    onProgress(received, total);
    if (asset.size !== null && received !== asset.size) {
      throw new Error(`Download of ${asset.name} is incomplete (${received}/${asset.size} bytes).`);
    }
    return hash.digest("hex");
  }

  private async installAsset(
    kind: BetaInstallerKind,
    file: string,
    version: string,
  ): Promise<string | null> {
    switch (kind) {
      case "nsis-exe":
        // One-click per-user NSIS installer for the beta app id; it installs beside the
        // stable app and launches the beta when done (runAfterFinish).
        this.deps.spawnDetached(file, []);
        return null;
      case "dmg":
        return this.installDmg(file);
      case "appimage":
        return this.installAppImage(file, version);
    }
  }

  private async installDmg(file: string): Promise<string> {
    const { identity } = this.deps;
    const target = this.managedInstallPath()!;
    if (path.basename(target) === `${identity.stable.name}.app`) {
      throw new Error("Refusing to install over the stable app.");
    }
    const mountPoint = await fs.mkdtemp(path.join(this.deps.tempDir, `${identity.beta.id}-dmg-`));
    await this.deps.run("hdiutil", [
      "attach",
      "-nobrowse",
      "-readonly",
      "-noautoopen",
      "-mountpoint",
      mountPoint,
      file,
    ]);
    try {
      const source = path.join(mountPoint, `${identity.beta.name}.app`);
      const bundleId = await this.plistValue(
        path.join(source, "Contents", "Info.plist"),
        "CFBundleIdentifier",
      );
      if (bundleId !== identity.beta.applicationId) {
        throw new Error(
          `The disk image does not contain ${identity.beta.name} (found ${bundleId ?? "nothing"}).`,
        );
      }
      await fs.rm(target, { recursive: true, force: true });
      await this.deps.run("ditto", [source, target]);
    } finally {
      await this.deps.run("hdiutil", ["detach", mountPoint, "-force"]).catch(() => "");
      await fs.rm(mountPoint, { recursive: true, force: true }).catch(() => {});
    }
    this.deps.spawnDetached("open", ["-n", target]);
    return target;
  }

  private async installAppImage(file: string, version: string): Promise<string> {
    const target = this.managedInstallPath()!;
    await fs.mkdir(path.dirname(target), { recursive: true });
    const staged = `${target}.download`;
    await fs.copyFile(file, staged);
    await fs.chmod(staged, 0o755);
    await fs.rename(staged, target);
    await fs.writeFile(`${target}.json`, JSON.stringify({ version }), {
      mode: 0o644,
    });
    this.deps.spawnDetached(target, []);
    return target;
  }

  async open(): Promise<void> {
    const installed = await this.detect();
    if (!installed) throw new Error(`${this.deps.identity.beta.name} is not installed.`);
    if (this.deps.platform === "darwin") {
      this.deps.spawnDetached("open", ["-n", installed.path]);
    } else {
      this.deps.spawnDetached(installed.path, []);
    }
  }
}

function abortError(): Error {
  const error = new Error("Aborted");
  error.name = "AbortError";
  return error;
}

async function exists(file: string): Promise<boolean> {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}
