import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Opt-in Rust front (`apps/daemon-rs`, binary `frogg-daemond`): with `<PREFIX>_RS_FRONT=1`
 * the CLI starts the Rust binary instead of the Node supervisor. It owns the public
 * listener, answers transport pings itself, supervises the Node worker on a private
 * loopback port and forwards everything else to it. Off by default; shipped only in
 * Frogg Next (`-next.N`) daemon bundles for Linux and macOS. See docs/plans/rust-rebuild.md.
 */
export const RUST_FRONT_BINARY = "frogg-daemond";

export interface DaemonLaunchCommand {
  command: string;
  args: string[];
}

export interface RustFrontInput {
  env: NodeJS.ProcessEnv;
  envPrefix: string;
  /** `packages/server/dist/scripts/supervisor-entrypoint.js` (or the .ts in dev). */
  runnerEntry: string;
  workerArgs: string[];
  nodePath: string;
  platform?: NodeJS.Platform;
  exists?: (file: string) => boolean;
  warn?: (message: string) => void;
}

function isEnabled(value: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes(value?.trim().toLowerCase() ?? "");
}

/** The Rust front launch, or null to start the Node supervisor as usual. */
export function resolveRustFrontLaunch(input: RustFrontInput): DaemonLaunchCommand | null {
  const key = (suffix: string) => `${input.envPrefix}_${suffix}`;
  if (!isEnabled(input.env[key("RS_FRONT")])) return null;
  const warn = input.warn ?? ((message: string) => process.stderr.write(`${message}\n`));
  const exists = input.exists ?? existsSync;
  if ((input.platform ?? process.platform) === "win32") {
    warn(`${key("RS_FRONT")} is not supported on Windows yet; starting the Node daemon.`);
    return null;
  }

  // <server>/dist/scripts/supervisor-entrypoint.js, or <server>/scripts/... in dev.
  const scriptsDir = path.dirname(input.runnerEntry);
  const serverRoot =
    path.basename(path.dirname(scriptsDir)) === "dist"
      ? path.dirname(path.dirname(scriptsDir))
      : path.dirname(scriptsDir);
  const worker = path.join(serverRoot, "dist", "server", "server", "daemon-worker.js");
  const candidates = [
    input.env[key("RS_FRONT_BIN")]?.trim(),
    // Daemon bundle: <root>/daemon/packages/server -> <root>/bin.
    path.resolve(serverRoot, "../../../bin", RUST_FRONT_BINARY),
    // Repository checkout: a local `cargo build --release`.
    path.resolve(serverRoot, "../../apps/daemon-rs/target/release", RUST_FRONT_BINARY),
  ].filter((candidate): candidate is string => Boolean(candidate));
  const binary = candidates.find((candidate) => exists(candidate));
  if (!binary) {
    warn(
      `${key("RS_FRONT")} is set but ${RUST_FRONT_BINARY} was not found; starting the Node daemon.`,
    );
    return null;
  }
  if (!exists(worker)) {
    warn(`${key("RS_FRONT")} needs the built daemon worker (${worker}); starting the Node daemon.`);
    return null;
  }
  return {
    command: binary,
    args: ["--supervise", "--node", input.nodePath, "--worker", worker, "--", ...input.workerArgs],
  };
}
