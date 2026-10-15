import type {
  DesktopAppUpdateCheckResult,
  DesktopAppUpdateCheckIntent,
  DesktopAppUpdateInstallResult,
} from "@/desktop/updates/desktop-updates";
import type { DesktopAppUpdaterPort } from "@/desktop/updates/desktop-app-updater";

export interface FakeDesktopAppUpdaterPort extends DesktopAppUpdaterPort {
  readonly recordedChecks: Array<{ intent: DesktopAppUpdateCheckIntent }>;
  /** Number of install calls the port received. */
  readonly installCount: number;
  nextCheckResult(result: DesktopAppUpdateCheckResult): void;
  deferNextCheck(): {
    resolve(result: DesktopAppUpdateCheckResult): void;
    reject(error: unknown): void;
  };
  failNextCheck(error: unknown): void;
  nextInstallResult(result: DesktopAppUpdateInstallResult): void;
  failNextInstall(error: unknown): void;
  deferNextInstall(): {
    resolve(result: DesktopAppUpdateInstallResult): void;
    reject(error: unknown): void;
  };
}

type CheckOutcome =
  | { kind: "result"; result: DesktopAppUpdateCheckResult }
  | { kind: "error"; error: unknown }
  | { kind: "deferred"; promise: Promise<DesktopAppUpdateCheckResult> };

type InstallOutcome =
  | { kind: "result"; result: DesktopAppUpdateInstallResult }
  | { kind: "error"; error: unknown }
  | { kind: "deferred"; promise: Promise<DesktopAppUpdateInstallResult> };

function buildCheckResult(
  overrides: Partial<DesktopAppUpdateCheckResult> = {},
): DesktopAppUpdateCheckResult {
  return {
    hasUpdate: false,
    readyToInstall: false,
    downloading: false,
    currentVersion: null,
    latestVersion: null,
    body: null,
    date: null,
    errorMessage: null,
    notes: null,
    assetName: null,
    assetSize: null,
    installKind: null,
    releaseUrl: null,
    strategy: null,
    checkedAt: null,
    ...overrides,
  };
}

function buildInstallResult(
  overrides: Partial<DesktopAppUpdateInstallResult> = {},
): DesktopAppUpdateInstallResult {
  return {
    installed: false,
    version: null,
    message: "Update completed.",
    restartRequired: false,
    ...overrides,
  };
}

export function createFakeDesktopAppUpdaterPort(): FakeDesktopAppUpdaterPort {
  const recordedChecks: Array<{ intent: DesktopAppUpdateCheckIntent }> = [];
  let installCount = 0;
  const checkOutcomes: CheckOutcome[] = [];
  const installOutcomes: InstallOutcome[] = [];

  return {
    recordedChecks,
    get installCount() {
      return installCount;
    },
    nextCheckResult(result) {
      checkOutcomes.push({ kind: "result", result });
    },
    deferNextCheck() {
      let resolve!: (value: DesktopAppUpdateCheckResult) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<DesktopAppUpdateCheckResult>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      checkOutcomes.push({ kind: "deferred", promise });
      return { resolve, reject };
    },
    failNextCheck(error) {
      checkOutcomes.push({ kind: "error", error });
    },
    nextInstallResult(result) {
      installOutcomes.push({ kind: "result", result });
    },
    deferNextInstall() {
      let resolve!: (result: DesktopAppUpdateInstallResult) => void;
      let reject!: (error: unknown) => void;
      const promise = new Promise<DesktopAppUpdateInstallResult>((res, rej) => {
        resolve = res;
        reject = rej;
      });
      installOutcomes.push({ kind: "deferred", promise });
      return { resolve, reject };
    },
    failNextInstall(error) {
      installOutcomes.push({ kind: "error", error });
    },
    async checkDesktopAppUpdate(input) {
      recordedChecks.push(input);
      const outcome = checkOutcomes.shift();
      if (!outcome) {
        return buildCheckResult();
      }
      if (outcome.kind === "result") {
        return outcome.result;
      }
      if (outcome.kind === "error") {
        throw outcome.error;
      }
      return outcome.promise;
    },
    async installDesktopAppUpdate() {
      installCount += 1;
      const outcome = installOutcomes.shift();
      if (!outcome) {
        return buildInstallResult();
      }
      if (outcome.kind === "result") {
        return outcome.result;
      }
      if (outcome.kind === "deferred") return outcome.promise;
      throw outcome.error;
    },
  };
}

export function buildFakeCheckResult(
  overrides: Partial<DesktopAppUpdateCheckResult> = {},
): DesktopAppUpdateCheckResult {
  return buildCheckResult(overrides);
}

export function buildFakeInstallResult(
  overrides: Partial<DesktopAppUpdateInstallResult> = {},
): DesktopAppUpdateInstallResult {
  return buildInstallResult(overrides);
}
