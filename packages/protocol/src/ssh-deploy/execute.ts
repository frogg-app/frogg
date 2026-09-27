import type { SshTarget } from "./args.js";

/**
 * The deploy engine's only SSH dependency: run `command` on the target with
 * `script` on its stdin. The desktop spawns the `ssh` binary; the mobile app
 * uses its native SSH client.
 */
export interface ExecutionInput {
  target: SshTarget;
  command: string;
  script: string;
  signal: AbortSignal;
  timeoutMs: number;
  onLine?(stream: "stdout" | "stderr", text: string): void;
}
export interface ExecutionResult {
  stdout: string;
  stderr: string;
  code: number | null;
}
export type ExecuteScript = (input: ExecutionInput) => Promise<ExecutionResult>;

/** A short-lived loopback forward to a deployed daemon; see the desktop's `forward.ts`. */
export interface SshForward {
  forwardId: string;
  /** `127.0.0.1:<port>` on this machine, forwarded to the daemon's own port. */
  endpoint: string;
}
export interface SshForwards {
  open(target: SshTarget, daemonPort: number): Promise<SshForward>;
  close(forwardId: string): { closed: boolean };
  closeAll(): void;
}
