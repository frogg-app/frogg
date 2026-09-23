import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:net";
import { buildSshTunnelArgs } from "@frogg/protocol/ssh-transport";
import type { SshTarget } from "./args.js";

/**
 * A short-lived loopback forward to a deployed daemon, used to pair with a
 * daemon that binds loopback only.
 *
 * The tunnel posture used to skip pairing altogether and report the host
 * unverified, on the grounds that SSH had already authenticated it. SSH does
 * authenticate the host, but it authenticates the *shell*: the app was then
 * talking to the daemon over an unauthenticated loopback socket with no
 * device identity at all, so the daemon had no principal to attach a role to,
 * to show as present, or to revoke. Opening a forward lets the deploy redeem
 * the daemon's own pairing code over it and store a real device credential,
 * so revocation, roles and presence work over a tunnel exactly as they do on
 * the network.
 *
 * Each accepted connection gets its own `ssh -W` child, so the forward serves
 * the claim request and any retry, and is closed as soon as pairing is done.
 */
export interface SshForward {
  forwardId: string;
  /** `127.0.0.1:<port>` on this machine, forwarded to the daemon's own port. */
  endpoint: string;
}

interface OpenForward {
  server: Server;
  children: Set<{ kill(): void; killed: boolean }>;
  cleanupAuth(): void;
}

export type SpawnSsh = (args: string[], env: NodeJS.ProcessEnv) => SshChild;

export interface SshChild {
  stdin: NodeJS.WritableStream;
  stdout: NodeJS.ReadableStream;
  stderr: NodeJS.ReadableStream;
  killed: boolean;
  kill(): void;
  on(event: "error" | "exit", handler: (...args: unknown[]) => void): void;
}

export class SshForwardManager {
  private forwards = new Map<string, OpenForward>();

  constructor(
    private readonly deps: {
      passwordEnvironment(password?: string): Promise<{ env: NodeJS.ProcessEnv; cleanup(): void }>;
      spawnSsh?: SpawnSsh;
    },
  ) {}

  async open(target: SshTarget, daemonPort: number): Promise<SshForward> {
    const args = buildSshTunnelArgs({
      host: target.host,
      ...(target.sshPort === undefined ? {} : { sshPort: target.sshPort }),
      ...(target.identityFile === undefined ? {} : { identityFile: target.identityFile }),
      daemonPort,
    });
    if (target.sshPassword) {
      args.splice(
        args.indexOf("BatchMode=yes"),
        1,
        "NumberOfPasswordPrompts=1",
        "-o",
        "PreferredAuthentications=publickey,keyboard-interactive,password",
      );
    }
    const auth = await this.deps.passwordEnvironment(target.sshPassword);
    const spawnSsh =
      this.deps.spawnSsh ??
      ((sshArgs, env) =>
        spawn("ssh", sshArgs, {
          env,
          stdio: ["pipe", "pipe", "pipe"],
          windowsHide: true,
        }) as unknown as SshChild);

    const children = new Set<{ kill(): void; killed: boolean }>();
    const server = createServer((socket) => {
      const child = spawnSsh(args, auth.env);
      children.add(child);
      socket.on("error", () => undefined);
      child.stderr.on("data", () => undefined);
      child.on("error", () => socket.destroy());
      child.on("exit", () => {
        children.delete(child);
        socket.destroy();
      });
      socket.on("close", () => {
        if (!child.killed) child.kill();
      });
      socket.pipe(child.stdin);
      child.stdout.pipe(socket);
    });

    return new Promise<SshForward>((resolve, reject) => {
      server.once("error", (error) => {
        auth.cleanup();
        reject(error);
      });
      // Loopback only: nothing off this machine may borrow the forward.
      server.listen(0, "127.0.0.1", () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          auth.cleanup();
          server.close();
          reject(new Error("Failed to allocate the pairing forward port."));
          return;
        }
        const forwardId = randomUUID();
        this.forwards.set(forwardId, { server, children, cleanupAuth: auth.cleanup });
        resolve({ forwardId, endpoint: `127.0.0.1:${address.port}` });
      });
    });
  }

  close(forwardId: string): { closed: boolean } {
    const forward = this.forwards.get(forwardId);
    if (!forward) return { closed: false };
    this.forwards.delete(forwardId);
    forward.server.close();
    forward.cleanupAuth();
    for (const child of forward.children) if (!child.killed) child.kill();
    forward.children.clear();
    return { closed: true };
  }

  closeAll(): void {
    // Copied first: close() removes the entry it is given.
    for (const forwardId of Array.from(this.forwards.keys())) this.close(forwardId);
  }
}
