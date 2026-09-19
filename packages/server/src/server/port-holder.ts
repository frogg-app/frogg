import { execFile } from "node:child_process";

/**
 * Best-effort description of whatever holds a TCP port this daemon failed to
 * bind (`EADDRINUSE`). A daemon that cannot bind otherwise restarts silently in
 * a loop; naming the holder (another Frogg daemon, the pre-rename FDE service,
 * or an unrelated process) makes the conflict actionable from the log.
 */
export interface PortHolder {
  port: number;
  /** `/api/identity` of the listener, when it is a Frogg-family daemon. */
  identity?: { product: string; version: string; serverId: string | null };
  /** Owning process, when the OS tells us (`ss` on Linux, `lsof` on macOS). */
  process?: { pid: number; name: string | null };
}

export function isAddressInUse(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}

function probeHost(host: string): string {
  if (!host || host === "0.0.0.0" || host === "::" || host === "[::]") return "127.0.0.1";
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

async function probeIdentity(host: string, port: number): Promise<PortHolder["identity"]> {
  try {
    const response = await fetch(`http://${probeHost(host)}:${port}/api/identity`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as Record<string, unknown>;
    const product = typeof body.product === "string" ? body.product : "";
    const version = typeof body.version === "string" ? body.version : "";
    if (!product && !version) return undefined;
    return {
      product: product || "unknown",
      version: version || "unknown",
      serverId: typeof body.serverId === "string" ? body.serverId : null,
    };
  } catch {
    return undefined;
  }
}

function run(command: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      execFile(command, args, { timeout: 1500 }, (error, stdout) =>
        resolve(error ? null : String(stdout)),
      );
    } catch {
      resolve(null);
    }
  });
}

/** Parses `ss -Hltnp 'sport = :PORT'` output: `users:(("name",pid=123,fd=4))`. */
export function parseSsOwner(output: string): PortHolder["process"] {
  const match = /users:\(\("([^"]*)",pid=(\d+)/.exec(output);
  return match ? { pid: Number(match[2]), name: match[1] || null } : undefined;
}

/** Parses `lsof -nP -iTCP:PORT -sTCP:LISTEN -Fpc` output (`p123\ncnode`). */
export function parseLsofOwner(output: string): PortHolder["process"] {
  const pid = /^p(\d+)$/m.exec(output)?.[1];
  if (!pid) return undefined;
  return { pid: Number(pid), name: /^c(.+)$/m.exec(output)?.[1] ?? null };
}

async function probeProcess(port: number): Promise<PortHolder["process"]> {
  if (process.platform === "linux") {
    const out = await run("ss", ["-Hltnp", `sport = :${port}`]);
    return out ? parseSsOwner(out) : undefined;
  }
  if (process.platform === "darwin") {
    const out = await run("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fpc"]);
    return out ? parseLsofOwner(out) : undefined;
  }
  return undefined;
}

export async function findPortHolder(host: string, port: number): Promise<PortHolder> {
  const [identity, owner] = await Promise.all([probeIdentity(host, port), probeProcess(port)]);
  return { port, ...(identity ? { identity } : {}), ...(owner ? { process: owner } : {}) };
}

export function describePortHolder(holder: PortHolder): string {
  const parts: string[] = [];
  if (holder.identity) {
    parts.push(
      `a ${holder.identity.product} daemon ${holder.identity.version}${
        holder.identity.serverId ? ` (server ${holder.identity.serverId})` : ""
      }`,
    );
  }
  if (holder.process) {
    parts.push(
      `pid ${holder.process.pid}${holder.process.name ? ` (${holder.process.name})` : ""}`,
    );
  }
  const who = parts.length > 0 ? parts.join(", ") : "another process (owner not discoverable)";
  return `port ${holder.port} is already in use by ${who}`;
}
