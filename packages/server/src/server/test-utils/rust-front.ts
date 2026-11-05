import { spawn, type ChildProcess } from "node:child_process";
import net from "node:net";

/**
 * Conformance hook for the Rust front (`apps/daemon-rs`, docs/plans/rust-rebuild.md): with
 * `FROGG_TEST_RS_FRONT=<path to frogg-daemond>`, every test daemon is reached through the
 * Rust front, which terminates the client connection and forwards to the in-process Node
 * daemon exactly as it does in production. Running a suite with and without it shows any
 * protocol behaviour the front changes.
 */
export const RUST_FRONT_ENV = "FROGG_TEST_RS_FRONT";

export interface RustFront {
  port: number;
  close(): Promise<void>;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => {
        if (port === null) reject(new Error("no port"));
        else resolve(port);
      });
    });
  });
}

function waitForPort(port: number, child: ChildProcess, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      if (child.exitCode !== null) {
        reject(new Error(`Rust front exited ${child.exitCode}`));
        return;
      }
      const socket = net.connect(port, "127.0.0.1");
      socket.once("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.once("error", () => {
        socket.destroy();
        if (Date.now() > deadline) reject(new Error("Timed out waiting for the Rust front"));
        else setTimeout(attempt, 10);
      });
    };
    attempt();
  });
}

export async function startRustFront(input: {
  binary: string;
  upstreamPort: number;
  froggHome: string;
}): Promise<RustFront> {
  const port = await freePort();
  const child = spawn(input.binary, [], {
    env: {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      FROGG_HOME: input.froggHome,
      FROGG_LISTEN: `127.0.0.1:${port}`,
      FROGG_RS_UPSTREAM: `ws://127.0.0.1:${input.upstreamPort}/ws`,
      RUST_LOG: process.env.RUST_LOG ?? "error",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  await waitForPort(port, child, 10_000);
  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        if (child.exitCode !== null) {
          resolve();
          return;
        }
        child.once("exit", () => resolve());
        child.kill("SIGTERM");
      }),
  };
}
