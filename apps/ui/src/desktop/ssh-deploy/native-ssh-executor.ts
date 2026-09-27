import type { ExecuteScript } from "@frogg/protocol/ssh-deploy/execute";

/** The `FroggSsh` native module (apps/ui/modules/frogg-ssh). */
export interface FroggSshModule {
  exec(options: {
    runId: string;
    host: string;
    port: number;
    user: string;
    password?: string;
    privateKey?: string;
    passphrase?: string;
    command: string;
    stdin: string;
    timeoutMs: number;
  }): Promise<{ stdout: string; stderr: string; code: number | null }>;
  cancel(runId: string): void;
  addListener(
    event: "onOutput",
    listener: (event: { runId: string; stream: "stdout" | "stderr"; text: string }) => void,
  ): { remove(): void };
}

/**
 * `user@host`, `user@[::1]` or a bare host. A phone has no local user name
 * for ssh to fall back to, so the user is left empty for the caller to reject.
 */
export function splitSshDestination(destination: string): { user: string; host: string } {
  const at = destination.lastIndexOf("@");
  const user = at > 0 ? destination.slice(0, at) : "";
  const host = destination.slice(at + 1).replace(/^\[(.*)\]$/u, "$1");
  return { user, host };
}

let runCounter = 0;

/** The deploy engine's `ExecuteScript`, run by the app's own SSH client. */
export function createNativeExecuteScript(module: FroggSshModule): ExecuteScript {
  return async (input) => {
    if (input.signal.aborted) throw new Error("Cancelled");
    const { user, host } = splitSshDestination(input.target.host);
    runCounter += 1;
    const runId = `ssh-${Date.now().toString(36)}-${runCounter}`;
    const subscription = module.addListener("onOutput", (event) => {
      if (event.runId === runId) input.onLine?.(event.stream, event.text);
    });
    const cancel = () => module.cancel(runId);
    input.signal.addEventListener("abort", cancel);
    try {
      const result = await module.exec({
        runId,
        host,
        port: input.target.sshPort ?? 22,
        user,
        ...(input.target.sshPassword ? { password: input.target.sshPassword } : {}),
        ...(input.target.privateKey ? { privateKey: input.target.privateKey } : {}),
        ...(input.target.privateKeyPassphrase
          ? { passphrase: input.target.privateKeyPassphrase }
          : {}),
        command: input.command,
        stdin: input.script,
        timeoutMs: input.timeoutMs,
      });
      return { stdout: result.stdout, stderr: result.stderr, code: result.code ?? null };
    } finally {
      input.signal.removeEventListener("abort", cancel);
      subscription.remove();
    }
  };
}
