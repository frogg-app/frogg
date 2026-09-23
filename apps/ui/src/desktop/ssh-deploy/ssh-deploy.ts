import { DEFAULT_SSH_DAEMON_PORT } from "@frogg/protocol/ssh-transport";
import { listenToDesktopEvent, type DesktopEventUnlisten } from "@/desktop/electron/events";
import { invokeDesktopCommand } from "@/desktop/electron/invoke";
import { getSessionSshPassword } from "@/desktop/daemon/ssh-session-passwords";

/** Desktop bridge event name (`frogg:event:` is added by the shell). */
export const SSH_DEPLOY_EVENT = "ssh-deploy-event";
export const DEFAULT_SSH_DEPLOY_LISTEN_HOST = "0.0.0.0";
/** The service manager returns before the daemon binds its port; wait this long before reconnecting. */
export const SSH_DEPLOY_RECONNECT_GRACE_MS = 2000;

export type SshDeployMethod = "native" | "docker";

export interface SshDeployTarget {
  host: string;
  sshPort?: number;
  /** Key file for deploy sessions only; otherwise ssh-agent and ~/.ssh/config apply. */
  identityFile?: string;
}

/** What `ssh_deploy_pair_code` reports; see apps/desktop/src/deploy/pair-code.ts. */
export interface SshDeployPairCode {
  source: "pair-code" | "pair";
  deepLink: string;
  host: string | null;
  port: number | null;
  fingerprint: string | null;
  expiresAt: string | null;
}

/** What `ssh_deploy_probe` reports about the remote host. */
export interface SshDeployProbe {
  os: string;
  arch: string;
  hasDocker: boolean;
  hasSystemdUser: boolean;
  hasCurl: boolean;
  hasFrogg: { installed: boolean; version: string | null };
  hasDockerContainer: boolean;
  homeDir: string;
}

export type SshDeployEvent =
  | { jobId: string; kind: "log"; text: string; stream: "stdout" | "stderr" }
  | { jobId: string; kind: "done"; text: string | null }
  | { jobId: string; kind: "error"; detail: string; cancelled: boolean };

export interface SshDeployStartInput extends SshDeployTarget {
  method: SshDeployMethod;
  version?: string;
  listen?: string;
  bundleUrl?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function flag(value: unknown): boolean {
  return value === true;
}

export function parseSshDeployProbe(raw: unknown): SshDeployProbe {
  if (!isRecord(raw)) {
    throw new Error("The probe returned no result.");
  }
  const frogg = isRecord(raw.hasFrogg) ? raw.hasFrogg : {};
  const version = text(frogg.version);
  return {
    os: text(raw.os),
    arch: text(raw.arch),
    hasDocker: flag(raw.hasDocker),
    hasSystemdUser: flag(raw.hasSystemdUser),
    hasCurl: flag(raw.hasCurl),
    hasFrogg: { installed: flag(frogg.installed), version: version || null },
    hasDockerContainer: flag(raw.hasDockerContainer),
    homeDir: text(raw.homeDir),
  };
}

export function parseSshDeployEvent(raw: unknown): SshDeployEvent | null {
  if (!isRecord(raw)) return null;
  const jobId = text(raw.jobId);
  if (!jobId) return null;
  switch (raw.kind) {
    case "log":
      return {
        jobId,
        kind: "log",
        text: typeof raw.text === "string" ? raw.text : "",
        stream: raw.stream === "stderr" ? "stderr" : "stdout",
      };
    case "done":
      return { jobId, kind: "done", text: text(raw.text) || null };
    case "error":
      return {
        jobId,
        kind: "error",
        detail: text(raw.detail) || "Unknown error",
        cancelled: flag(raw.cancelled),
      };
    default:
      return null;
  }
}

/** Bind all interfaces on the daemon port saved with the host. */
export function defaultSshDeployListen(daemonPort?: number): string {
  return `${DEFAULT_SSH_DEPLOY_LISTEN_HOST}:${daemonPort ?? DEFAULT_SSH_DAEMON_PORT}`;
}

/** `Linux x86_64`, `Darwin arm64`; empty when the probe had nothing. */
export function describeSshDeployPlatform(probe: Pick<SshDeployProbe, "os" | "arch">): string {
  return [probe.os, probe.arch].filter(Boolean).join(" ");
}

/** Which service manager the native installer will use on this host. */
export function sshDeployServiceKind(
  probe: Pick<SshDeployProbe, "os" | "hasSystemdUser">,
): "systemd" | "launchd" | "none" {
  if (probe.os === "Darwin") return "launchd";
  return probe.hasSystemdUser ? "systemd" : "none";
}

/** The card's primary action for the current state of the host. */
export function sshDeployPrimaryAction(
  probe: Pick<SshDeployProbe, "hasFrogg" | "hasDockerContainer">,
  method: SshDeployMethod,
  targetVersion: string | null,
): "deploy" | "upgrade" | "reinstall" {
  const installed = method === "docker" ? probe.hasDockerContainer : probe.hasFrogg.installed;
  if (!installed) return "deploy";
  const current = method === "native" ? probe.hasFrogg.version : null;
  if (current && targetVersion && current === targetVersion.replace(/^v/u, "")) {
    return "reinstall";
  }
  return "upgrade";
}

/**
 * The ssh password the user typed for this host during this app session, if
 * any, so probes and deploy jobs reach password-only hosts the way the
 * tunnel does. In memory only; see `ssh-session-passwords.ts`.
 */
function withSessionSshPassword<T extends SshDeployTarget>(target: T): T {
  const sshPassword = getSessionSshPassword({
    host: target.host,
    ...(target.sshPort !== undefined ? { sshPort: target.sshPort } : {}),
  });
  return sshPassword ? { ...target, sshPassword } : target;
}

function targetArgs(target: SshDeployTarget): Record<string, unknown> {
  return withSessionSshPassword({
    host: target.host,
    ...(target.sshPort !== undefined ? { sshPort: target.sshPort } : {}),
    ...(target.identityFile ? { identityFile: target.identityFile } : {}),
  });
}

export async function probeSshDeploy(target: SshDeployTarget): Promise<SshDeployProbe> {
  return parseSshDeployProbe(
    await invokeDesktopCommand<unknown>("ssh_deploy_probe", targetArgs(target)),
  );
}

export function parseSshDeployPairCode(raw: unknown): SshDeployPairCode {
  if (!isRecord(raw) || !text(raw.deepLink)) {
    throw new Error("The daemon printed no pairing link.");
  }
  const port = raw.port;
  return {
    source: raw.source === "pair-code" ? "pair-code" : "pair",
    deepLink: text(raw.deepLink),
    host: text(raw.host) || null,
    port:
      typeof port === "number" && Number.isInteger(port) && port > 0 && port <= 65535 ? port : null,
    fingerprint: text(raw.fingerprint) || null,
    expiresAt: text(raw.expiresAt) || null,
  };
}

/** Runs the daemon's pairing command over SSH and returns what it printed. */
export async function fetchSshDeployPairCode(target: SshDeployTarget): Promise<SshDeployPairCode> {
  return parseSshDeployPairCode(
    await invokeDesktopCommand<unknown>("ssh_deploy_pair_code", targetArgs(target)),
  );
}

/**
 * Starts a deploy job and settles when it finishes: resolves on `done`,
 * rejects with the job's detail on `error`. Aborting cancels the remote job.
 */
export async function runSshDeployJob(
  input: SshDeployStartInput,
  options: { onLog?: (text: string) => void; signal?: AbortSignal } = {},
): Promise<void> {
  let jobId: string | null = null;
  const pending: SshDeployEvent[] = [];
  let settle: { resolve: () => void; reject: (error: Error) => void } | null = null;
  const finished = new Promise<void>((resolve, reject) => {
    settle = { resolve, reject };
  });
  const handle = (event: SshDeployEvent) => {
    if (event.kind === "log") options.onLog?.(event.text);
    else if (event.kind === "done") settle?.resolve();
    else settle?.reject(new SshDeployJobError(event.detail, event.cancelled));
  };
  const unlisten = await listenToSshDeployEvents((event) => {
    if (jobId === null) pending.push(event);
    else if (event.jobId === jobId) handle(event);
  });
  const abort = () => {
    if (jobId) void cancelSshDeploy(jobId).catch(() => undefined);
  };
  try {
    options.signal?.throwIfAborted();
    jobId = await startSshDeploy(input);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    for (const event of pending.splice(0)) if (event.jobId === jobId) handle(event);
    await finished;
  } finally {
    options.signal?.removeEventListener("abort", abort);
    unlisten();
  }
}

export class SshDeployJobError extends Error {
  constructor(
    message: string,
    readonly cancelled: boolean,
  ) {
    super(message);
    this.name = "SshDeployJobError";
  }
}

function jobIdOf(raw: unknown): string {
  const jobId = isRecord(raw) ? text(raw.jobId) : "";
  if (!jobId) {
    throw new Error("The deploy job did not start.");
  }
  return jobId;
}

export async function startSshDeploy(input: SshDeployStartInput): Promise<string> {
  return jobIdOf(
    await invokeDesktopCommand<unknown>("ssh_deploy_start", withSessionSshPassword({ ...input })),
  );
}

export async function uninstallSshDeploy(
  input: SshDeployTarget & { method: SshDeployMethod },
): Promise<string> {
  return jobIdOf(
    await invokeDesktopCommand<unknown>(
      "ssh_deploy_uninstall",
      withSessionSshPassword({ ...input }),
    ),
  );
}

export async function cancelSshDeploy(jobId: string): Promise<void> {
  await invokeDesktopCommand<unknown>("ssh_deploy_cancel", { jobId });
}

export function listenToSshDeployEvents(
  handler: (event: SshDeployEvent) => void,
): Promise<DesktopEventUnlisten> {
  return listenToDesktopEvent<unknown>(SSH_DEPLOY_EVENT, (raw) => {
    const event = parseSshDeployEvent(raw);
    if (event) handler(event);
  });
}
