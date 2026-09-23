export const DEFAULT_SSH_DAEMON_PORT = 9999;

export interface SshTransportTarget {
  host: string;
  sshPort?: number;
  daemonPort: number;
  /**
   * An explicit ssh private key for this connection. When set, ssh is told to
   * use only this key (`IdentitiesOnly=yes`) instead of ssh-agent's keys;
   * `~/.ssh/config` still supplies everything else for the host.
   */
  identityFile?: string;
}

export function validatePort(value: string | number, label: string): number {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${label} must be between 1 and 65535`);
  }
  return port;
}

export function validateSshHost(host: string): string {
  const normalized = host.trim();
  if (!normalized) throw new Error("SSH host is required");
  if (/\s/u.test(normalized) || normalized.startsWith("-")) {
    throw new Error("SSH host is invalid");
  }
  return normalized;
}

/**
 * An ssh key path: absolute, `~/`-relative or a Windows drive path. Rejects
 * leading `-` (which ssh would read as a flag), whitespace and control
 * characters so the path can never become another argument.
 */
export function validateSshIdentityFile(value: string): string {
  const path = value.trim();
  if (!path) throw new Error("SSH key file is required");
  if (
    path.length > 1024 ||
    path.startsWith("-") ||
    /\s/u.test(path) ||
    [...path].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127;
    }) ||
    !(path.startsWith("~/") || path.startsWith("/") || /^[A-Za-z]:[\\/]/u.test(path))
  ) {
    throw new Error("SSH key file must be an absolute or ~/ path");
  }
  return path;
}

export function parseSshTransportUri(value: string): SshTransportTarget {
  let url: URL;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error("Invalid SSH host URI", { cause: error });
  }

  if (url.protocol !== "ssh:" || url.password || (url.pathname !== "" && url.pathname !== "/")) {
    throw new Error("Invalid SSH host URI");
  }
  if (url.hash) throw new Error("SSH host URI does not support fragments");

  for (const key of url.searchParams.keys()) {
    if (key !== "daemonPort") throw new Error(`Unsupported SSH host option: ${key}`);
  }
  const daemonPorts = url.searchParams.getAll("daemonPort");
  if (daemonPorts.length > 1) throw new Error("daemonPort may only be specified once");

  const urlHostname = url.hostname;
  const hostname = validateSshHost(
    urlHostname.startsWith("[") && urlHostname.endsWith("]")
      ? urlHostname.slice(1, -1)
      : urlHostname,
  );
  const username = decodeURIComponent(url.username);
  const host = validateSshHost(username ? `${username}@${hostname}` : hostname);
  return {
    host,
    ...(url.port ? { sshPort: validatePort(url.port, "SSH port") } : {}),
    daemonPort:
      daemonPorts[0] === undefined
        ? DEFAULT_SSH_DAEMON_PORT
        : validatePort(daemonPorts[0], "Daemon port"),
  };
}

export function buildSshTunnelArgs(target: SshTransportTarget): string[] {
  const host = validateSshHost(target.host);
  const daemonPort = validatePort(target.daemonPort, "Daemon port");
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=10",
    "-o",
    "ClearAllForwardings=yes",
    "-o",
    "ExitOnForwardFailure=yes",
  ];
  if (target.sshPort !== undefined) {
    args.push("-p", String(validatePort(target.sshPort, "SSH port")));
  }
  if (target.identityFile !== undefined) {
    args.push("-i", validateSshIdentityFile(target.identityFile), "-o", "IdentitiesOnly=yes");
  }
  args.push("-W", `127.0.0.1:${daemonPort}`, host);
  return args;
}
