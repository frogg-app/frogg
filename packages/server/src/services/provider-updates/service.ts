/**
 * Tracks the installed and latest-published versions of each agent provider CLI,
 * and installs updates on request or automatically.
 *
 * Checks are cheap (one registry request plus one `--version` per provider) and
 * cached, so the settings screen, the CLI and the background poller all share
 * one result. Installing is serialised per provider: two concurrent `npm i -g`
 * runs for the same package corrupt the global prefix.
 */

import type { Logger } from "pino";

import {
  getProviderUpdateDescriptor,
  isProviderUpdatable,
  PROVIDER_UPDATE_DESCRIPTORS,
  type ProviderUpdateDescriptor,
} from "@frogg/protocol/provider-updates";
import { findExecutable } from "../../executable-resolution/executable-resolution.js";
import { createProviderEnvSpec } from "../../server/agent/provider-launch-config.js";
import { execCommand } from "../../utils/spawn.js";
import { fetchLatestNpmVersion, type RegistryFetch } from "./registry.js";
import { isNewerVersion, probeInstalledVersion } from "./version.js";

export type ProviderUpdateStatus =
  | "up-to-date"
  | "update-available"
  | "not-installed"
  | "unmanaged"
  | "unknown";

export interface ProviderUpdateEntry {
  provider: string;
  status: ProviderUpdateStatus;
  installedVersion: string | null;
  latestVersion: string | null;
  packageName: string | null;
  /** True when Frogg can run the update itself. */
  updatable: boolean;
  binaryPath: string | null;
  manualInstallUrl: string | null;
  error: string | null;
}

export interface ProviderUpdateSnapshot {
  checkedAt: string;
  entries: ProviderUpdateEntry[];
}

export interface ProviderUpdateResult {
  provider: string;
  updated: boolean;
  previousVersion: string | null;
  installedVersion: string | null;
  error: string | null;
  output: string;
}

export interface ProviderUpdateServiceOptions {
  logger: Logger;
  fetch?: RegistryFetch;
  descriptors?: ProviderUpdateDescriptor[];
  cacheTtlMs?: number;
  now?: () => number;
  /** Overridable for tests; defaults to a real `npm install -g` run. */
  installer?: ProviderInstaller;
}

export interface ProviderInstaller {
  (packageName: string, signal?: AbortSignal): Promise<{ output: string }>;
}

const DEFAULT_CACHE_TTL_MS = 30 * 60 * 1000;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

async function npmGlobalInstall(
  packageName: string,
  signal?: AbortSignal,
): Promise<{ output: string }> {
  const { stdout, stderr } = await execCommand(
    "npm",
    ["install", "--global", `${packageName}@latest`],
    {
      ...createProviderEnvSpec(),
      timeout: INSTALL_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
      signal,
    },
  );
  return {
    output: [stdout, stderr]
      .filter((part) => part.trim().length > 0)
      .join("\n")
      .trim(),
  };
}

export class ProviderUpdateService {
  private readonly logger: Logger;
  private readonly descriptors: ProviderUpdateDescriptor[];
  private readonly cacheTtlMs: number;
  private readonly now: () => number;
  private readonly fetch: RegistryFetch | undefined;
  private readonly installer: ProviderInstaller;
  private cached: { checkedAtMs: number; snapshot: ProviderUpdateSnapshot } | null = null;
  private inFlight: Promise<ProviderUpdateSnapshot> | null = null;
  private readonly installsInFlight = new Map<string, Promise<ProviderUpdateResult>>();

  constructor(options: ProviderUpdateServiceOptions) {
    this.logger = options.logger.child({ module: "provider-update-service" });
    this.descriptors = options.descriptors ?? PROVIDER_UPDATE_DESCRIPTORS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    this.now = options.now ?? Date.now;
    this.fetch = options.fetch;
    this.installer = options.installer ?? npmGlobalInstall;
  }

  async check(
    options: { forceRefresh?: boolean; signal?: AbortSignal } = {},
  ): Promise<ProviderUpdateSnapshot> {
    const nowMs = this.now();
    if (!options.forceRefresh && this.cached && nowMs - this.cached.checkedAtMs < this.cacheTtlMs) {
      return this.cached.snapshot;
    }
    if (this.inFlight) {
      return this.inFlight;
    }

    const pending = this.runCheck(options.signal)
      .then((snapshot) => {
        this.cached = { checkedAtMs: this.now(), snapshot };
        return snapshot;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = pending;
    return pending;
  }

  private async runCheck(signal?: AbortSignal): Promise<ProviderUpdateSnapshot> {
    const entries = await Promise.all(
      this.descriptors.map((descriptor) => this.checkOne(descriptor, signal)),
    );
    return { checkedAt: new Date(this.now()).toISOString(), entries };
  }

  private async checkOne(
    descriptor: ProviderUpdateDescriptor,
    signal?: AbortSignal,
  ): Promise<ProviderUpdateEntry> {
    const binaryPath = await this.resolveBinary(descriptor);
    const installed = binaryPath
      ? await probeInstalledVersion(binaryPath, descriptor.versionArgs, signal)
      : { version: null as string | null, error: undefined as string | undefined };

    const updatable = isProviderUpdatable(descriptor);
    const base = {
      provider: descriptor.provider,
      installedVersion: installed.version,
      packageName: descriptor.npmPackage ?? null,
      updatable,
      binaryPath,
      manualInstallUrl: descriptor.manualInstallUrl ?? null,
    };

    if (!updatable) {
      return {
        ...base,
        latestVersion: null,
        status: binaryPath ? "unmanaged" : "not-installed",
        error: installed.error ?? null,
      };
    }

    const latest = await fetchLatestNpmVersion(descriptor.npmPackage as string, {
      ...(this.fetch ? { fetch: this.fetch } : {}),
      ...(signal ? { signal } : {}),
    });

    if (!binaryPath) {
      return {
        ...base,
        latestVersion: latest.version,
        status: "not-installed",
        error: latest.error ?? null,
      };
    }

    let status: ProviderUpdateStatus = "up-to-date";
    if (!installed.version) {
      status = "unknown";
    } else if (isNewerVersion(latest.version, installed.version)) {
      status = "update-available";
    }

    return {
      ...base,
      latestVersion: latest.version,
      status,
      error: installed.error ?? latest.error ?? null,
    };
  }

  private async resolveBinary(descriptor: ProviderUpdateDescriptor): Promise<string | null> {
    for (const name of descriptor.binaryNames) {
      const found = await findExecutable(name);
      if (found) return found;
    }
    return null;
  }

  /** Install (or reinstall at latest) one provider. Safe to call concurrently. */
  async update(provider: string, signal?: AbortSignal): Promise<ProviderUpdateResult> {
    const existing = this.installsInFlight.get(provider);
    if (existing) return existing;

    const pending = this.runUpdate(provider, signal).finally(() => {
      this.installsInFlight.delete(provider);
    });
    this.installsInFlight.set(provider, pending);
    return pending;
  }

  private async runUpdate(provider: string, signal?: AbortSignal): Promise<ProviderUpdateResult> {
    const descriptor = getProviderUpdateDescriptor(provider);
    if (!descriptor) {
      return {
        provider,
        updated: false,
        previousVersion: null,
        installedVersion: null,
        error: `Unknown provider: ${provider}`,
        output: "",
      };
    }
    if (!isProviderUpdatable(descriptor)) {
      return {
        provider,
        updated: false,
        previousVersion: null,
        installedVersion: null,
        error: descriptor.manualInstallUrl
          ? `${provider} is not installed through a channel Frogg manages. Update it manually: ${descriptor.manualInstallUrl}`
          : `${provider} is not installed through a channel Frogg manages.`,
        output: "",
      };
    }

    const binaryPath = await this.resolveBinary(descriptor);
    const previousVersion = binaryPath
      ? (await probeInstalledVersion(binaryPath, descriptor.versionArgs, signal)).version
      : null;

    let output = "";
    try {
      const result = await this.installer(descriptor.npmPackage as string, signal);
      output = result.output;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn({ provider, err: message }, "provider update failed");
      return {
        provider,
        updated: false,
        previousVersion,
        installedVersion: previousVersion,
        error: message,
        output,
      };
    }

    // The freshly installed binary may sit at a new path (first install), so
    // resolve again rather than reusing the pre-update one.
    const updatedPath = await this.resolveBinary(descriptor);
    const installedVersion = updatedPath
      ? (await probeInstalledVersion(updatedPath, descriptor.versionArgs, signal)).version
      : null;

    // A check cached before the install now describes the old world.
    this.cached = null;

    return {
      provider,
      updated: installedVersion !== null && installedVersion !== previousVersion,
      previousVersion,
      installedVersion,
      error: null,
      output,
    };
  }

  /** Drop the cached snapshot so the next check hits the network. */
  invalidate(): void {
    this.cached = null;
  }
}
