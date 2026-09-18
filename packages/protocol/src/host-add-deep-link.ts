/**
 * `<scheme>://host/add?type=directTcp&host=…&port=…` — the supported way for
 * external tooling (studio rollout scripts, provisioning jobs) to register a
 * daemon that needs no pairing: the app adds the host if it is absent, selects
 * it, and connects. Adding one that already exists is a no-op.
 */
export interface HostAddDeepLinkTarget {
  type: "directTcp";
  host: string;
  port: number;
  useTls: boolean;
  label?: string;
}

const MAX_PORT = 65_535;

function trimNonEmpty(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parsePort(value: string | null): number | null {
  const normalized = trimNonEmpty(value);
  if (!normalized || !/^\d+$/.test(normalized)) {
    return null;
  }
  const port = Number(normalized);
  return port >= 1 && port <= MAX_PORT ? port : null;
}

function parseBoolean(value: string | null): boolean {
  const normalized = trimNonEmpty(value)?.toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

export function buildHostAddDeepLink(
  target: {
    host: string;
    port: number;
    useTls?: boolean;
    label?: string;
  },
  scheme = "frogg",
): string {
  const host = trimNonEmpty(target.host);
  const port = parsePort(String(target.port));
  if (!host || port === null) {
    throw new Error("Host add deep links require a host and a valid port.");
  }
  const params = new URLSearchParams({
    type: "directTcp",
    host,
    port: String(port),
  });
  if (target.useTls) {
    params.set("tls", "1");
  }
  const label = trimNonEmpty(target.label);
  if (label) {
    params.set("label", label);
  }
  return `${scheme}://host/add?${params.toString()}`;
}

export function parseHostAddDeepLink(
  input: string,
  scheme = "frogg",
): HostAddDeepLinkTarget | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }

  if (
    url.protocol !== `${scheme}:` ||
    url.hostname !== "host" ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    return null;
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 1 || segments[0] !== "add") {
    return null;
  }

  const params = url.searchParams;
  // Only directTcp today; an unknown type is rejected rather than guessed at.
  if (trimNonEmpty(params.get("type")) !== "directTcp") {
    return null;
  }

  const host = trimNonEmpty(params.get("host"));
  const port = parsePort(params.get("port"));
  if (!host || port === null) {
    return null;
  }

  const label = trimNonEmpty(params.get("label"));
  return {
    type: "directTcp",
    host,
    port,
    useTls: parseBoolean(params.get("tls")),
    ...(label ? { label } : {}),
  };
}

export function hostAddDeepLinkEndpoint(target: HostAddDeepLinkTarget): string {
  return `${target.host}:${target.port}`;
}
