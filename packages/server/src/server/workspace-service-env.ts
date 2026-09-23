import { brand } from "@frogg/branding";
import { projectServiceProxyUrls } from "./service-proxy.js";

export interface WorkspaceServicePeer {
  scriptName: string;
  port: number;
}

export interface BuildWorkspaceServiceEnvOptions {
  scriptName: string;
  projectSlug: string;
  branchName: string | null;
  daemonPort: number | null | undefined;
  workspaceServiceBindHost: string | null | undefined;
  serviceProxyPublicBaseUrl?: string | null;
  peers: readonly WorkspaceServicePeer[];
}

export function normalizeServiceEnvName(scriptName: string): string {
  return scriptName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function buildWorkspaceServiceEnv(
  options: BuildWorkspaceServiceEnvOptions,
): Record<string, string> {
  const scriptNames = options.peers.map((peer) => peer.scriptName);
  assertNoServiceEnvNameCollisions(scriptNames);

  const selfPeer = options.peers.find((peer) => peer.scriptName === options.scriptName);
  if (!selfPeer) {
    throw new Error(`Service '${options.scriptName}' is missing from workspace service peers`);
  }

  const env: Record<string, string> = {
    HOST: resolveServiceBindHost(options.workspaceServiceBindHost),
    FROGG_PORT: String(selfPeer.port),
  };

  const selfProxyUrl = buildServiceProxyUrl({
    projectSlug: options.projectSlug,
    branchName: options.branchName,
    scriptName: options.scriptName,
    daemonPort: options.daemonPort,
    serviceProxyPublicBaseUrl: options.serviceProxyPublicBaseUrl,
  });
  if (selfProxyUrl) {
    env.FROGG_URL = selfProxyUrl;
  }

  for (const peer of options.peers) {
    const envName = normalizeServiceEnvName(peer.scriptName);
    env[`FROGG_SERVICE_${envName}_PORT`] = String(peer.port);

    const peerProxyUrl = buildServiceProxyUrl({
      projectSlug: options.projectSlug,
      branchName: options.branchName,
      scriptName: peer.scriptName,
      daemonPort: options.daemonPort,
      serviceProxyPublicBaseUrl: options.serviceProxyPublicBaseUrl,
    });
    if (peerProxyUrl) {
      env[`FROGG_SERVICE_${envName}_URL`] = peerProxyUrl;
    }
  }

  return env;
}

/**
 * The `HOST` a workspace dev server binds to.
 *
 * This used to follow the daemon's own listen host, so a daemon on `0.0.0.0`
 * published every workspace dev server onto the network with no authentication
 * in front of it. It now follows `daemon.workspaceServices.bindHost`, which
 * defaults to loopback (brand `daemon.workspaceServicesBind`): another device
 * reaches the service through the daemon's authenticated service proxy. An
 * operator who wants the old wide bind sets the key to `0.0.0.0`.
 */
export function resolveServiceBindHost(
  workspaceServiceBindHost: string | null | undefined,
): string {
  const configured = workspaceServiceBindHost?.trim();
  return configured && configured.length > 0 ? configured : brand.daemon.workspaceServicesBindHost;
}

interface BuildServiceProxyUrlOptions {
  projectSlug: string;
  branchName: string | null;
  scriptName: string;
  daemonPort: number | null | undefined;
  serviceProxyPublicBaseUrl?: string | null;
}

function buildServiceProxyUrl(options: BuildServiceProxyUrlOptions): string | null {
  return projectServiceProxyUrls({
    projectSlug: options.projectSlug,
    branchName: options.branchName,
    scriptName: options.scriptName,
    daemonPort: options.daemonPort,
    publicBaseUrl: options.serviceProxyPublicBaseUrl,
  }).proxyUrl;
}

export function assertNoServiceEnvNameCollisions(scriptNames: readonly string[]): void {
  const scriptNamesByEnvName = new Map<string, string[]>();

  for (const scriptName of scriptNames) {
    const envName = normalizeServiceEnvName(scriptName);
    const namesForEnvName = scriptNamesByEnvName.get(envName) ?? [];
    namesForEnvName.push(scriptName);
    scriptNamesByEnvName.set(envName, namesForEnvName);
  }

  const collisions: string[] = [];
  for (const [envName, names] of scriptNamesByEnvName) {
    if (names.length > 1) {
      collisions.push(`Service env name collision for ${envName}: ${names.join(", ")}`);
    }
  }

  if (collisions.length > 0) {
    throw new Error(collisions.join("; "));
  }
}
