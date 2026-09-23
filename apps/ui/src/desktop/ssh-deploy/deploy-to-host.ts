import {
  parseAnyConnectionOfferFromUrl,
  type AnyConnectionOffer,
  type ConnectionOfferV3,
} from "@frogg/protocol/connection-offer";
import { parseDirectPairingDeepLink, type DirectPairingLink } from "@frogg/protocol/device-access";
import { brand } from "@frogg/branding";
import type {
  SshDeployHardenResult,
  SshDeployPairCode,
  SshDeployProbe,
  SshDeployStartInput,
  SshDeployTarget,
} from "./ssh-deploy";

/**
 * "Deploy to host": connect over SSH, detect the platform, install the daemon
 * with the branded installer, fetch a pairing code by running the daemon's CLI
 * over the same SSH session, then add the host. The SSH session is the trust
 * anchor: the offer it returns names the daemon (server id and public key),
 * and the network connection must prove it is that daemon.
 *
 * `tunnel` (the default) binds the daemon to loopback and connects through an
 * SSH tunnel, so nothing on the remote host's network can reach it at all;
 * `lan` binds all interfaces and claims it over the network with the offer's
 * single-use token, recording this device's name on the credential.
 *
 * Either way a fresh deploy runs a `secure` step first, which turns trusted
 * LAN off. Without it the installed daemon treats every peer on the remote
 * host's network as an owner with no pairing at all, and the pairing step
 * does not take that back — it adds a credential, it does not require one.
 */
export type DeployNetwork = "tunnel" | "lan";
export type DeployStepId = "connect" | "install" | "secure" | "pairCode" | "pair";
export type DeployStepStatus = "pending" | "running" | "done" | "skipped" | "failed";
export const DEPLOY_STEPS: readonly DeployStepId[] = [
  "connect",
  "install",
  "secure",
  "pairCode",
  "pair",
];

export type DeployErrorCode =
  | "ssh_failed"
  | "unsupported_platform"
  | "install_failed"
  | "harden_failed"
  | "pair_code_unavailable"
  | "invalid_pair_code"
  | "fingerprint_mismatch"
  | "server_mismatch"
  | "unreachable"
  | "claim_rejected"
  | "connect_failed"
  | "cancelled";

export class DeployToHostError extends Error {
  constructor(
    readonly step: DeployStepId,
    readonly code: DeployErrorCode,
    readonly detail: string,
  ) {
    super(detail);
    this.name = "DeployToHostError";
  }
}

export interface DeployToHostInput {
  target: SshDeployTarget;
  network: DeployNetwork;
  daemonPort: number;
  /** Release to install; the app's own version when omitted. */
  version?: string;
}

export interface DeployedHost {
  serverId: string;
  hostname: string | null;
  /** True when the daemon identity was checked against the SSH-issued offer. */
  verified: boolean;
  /**
   * True when this deploy left the daemon requiring a credential from LAN
   * clients. False when the host was already installed (its existing LAN
   * clients are left alone) or its CLI is too old to have the setting.
   */
  lanLockedDown: boolean;
  probe: SshDeployProbe;
}

export interface DeployToHostDeps {
  probe(target: SshDeployTarget): Promise<SshDeployProbe>;
  install(input: SshDeployStartInput, signal: AbortSignal): Promise<void>;
  pairCode(target: SshDeployTarget): Promise<SshDeployPairCode>;
  /** Turns trusted LAN off on the deployed daemon; see `harden.ts`. */
  harden(target: SshDeployTarget): Promise<SshDeployHardenResult>;
  /** Adds (or refreshes) the Remote SSH connection and returns the daemon's identity. */
  connectTunnel(input: {
    host: string;
    sshPort?: number;
    daemonPort: number;
    identityFile?: string;
  }): Promise<{ serverId: string; hostname: string | null }>;
  /** Redeems a v3 claim offer; the device label is recorded by the daemon. */
  claim(
    offer: ConnectionOfferV3,
    input: { endpointOverride?: string },
  ): Promise<{ serverId: string; hostname: string | null }>;
  /** Redeems a `<scheme>://pair/direct?…` link, which is what `<cli> pair` prints. */
  claimPairingLink(link: DirectPairingLink): Promise<{ serverId: string; hostname: string | null }>;
  fingerprint(daemonPublicKeyB64: string): Promise<string>;
}

const SUPPORTED_OS = new Set(["Linux", "Darwin"]);
const SUPPORTED_ARCH = new Set(["x86_64", "amd64", "aarch64", "arm64"]);

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isCancelled(error: unknown, signal: AbortSignal): boolean {
  return (
    signal.aborted ||
    (typeof error === "object" &&
      error !== null &&
      "cancelled" in error &&
      error.cancelled === true)
  );
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : null;
}

/** `SHA256:<base64, unpadded>` of the raw key bytes, as OpenSSH prints fingerprints. */
export async function daemonKeyFingerprint(
  daemonPublicKeyB64: string,
  digest: (bytes: Uint8Array) => Promise<ArrayBuffer> = (bytes) =>
    globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer),
): Promise<string> {
  const binary = globalThis.atob(daemonPublicKeyB64.replace(/-/g, "+").replace(/_/g, "/"));
  const hash = new Uint8Array(await digest(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
  let out = "";
  for (const byte of hash) out += String.fromCharCode(byte);
  return `SHA256:${globalThis.btoa(out).replace(/=+$/u, "")}`;
}

/**
 * Fingerprints are compared across two spellings: OpenSSH's `SHA256:<base64>`
 * and the daemon's `sha256:<base64url>`. Case, padding and the url-safe
 * alphabet are all normalised away so the same key compares equal.
 */
function normalizeFingerprint(value: string): string {
  return value
    .trim()
    .replace(/^sha256:/iu, "SHA256:")
    .replace(/-/gu, "+")
    .replace(/_/gu, "/")
    .replace(/=+$/u, "");
}

export type DeployFormError =
  | "hostRequired"
  | "invalidHost"
  | "invalidSshPort"
  | "invalidDaemonPort"
  | "invalidKeyFile";

function parsePortText(text: string, fallback: number | undefined): number | undefined | null {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  if (!/^\d{1,5}$/u.test(trimmed)) return null;
  const port = Number(trimmed);
  return port >= 1 && port <= 65535 ? port : null;
}

const HOST_PATTERN = /^[^\s@-][^\s@]*$/u;

/**
 * The form's SSH target. A config entry submits its alias alone so `ssh`
 * resolves HostName, User, Port, IdentityFile and ProxyJump from the config;
 * the manual tab builds `user@host` plus port and an optional key file. The
 * key file rides the tunnel connection too, so the saved host reconnects with
 * the same key the deploy used.
 */
export function resolveDeployTarget(input: {
  mode: "config" | "manual";
  alias: string | null;
  host: string;
  user: string;
  sshPortText: string;
  identityFile: string;
  daemonPortText: string;
  network: DeployNetwork;
  defaultDaemonPort: number;
}):
  | { ok: true; target: SshDeployTarget; daemonPort: number }
  | { ok: false; error: DeployFormError } {
  const daemonPort = parsePortText(input.daemonPortText, input.defaultDaemonPort);
  if (input.mode === "config") {
    const alias = input.alias?.trim() ?? "";
    if (!alias) return { ok: false, error: "hostRequired" };
    if (daemonPort == null) return { ok: false, error: "invalidDaemonPort" };
    return { ok: true, target: { host: alias }, daemonPort };
  }
  const host = input.host.trim();
  const user = input.user.trim();
  if (!host) return { ok: false, error: "hostRequired" };
  if (!HOST_PATTERN.test(host) || (user && !HOST_PATTERN.test(user)))
    return { ok: false, error: "invalidHost" };
  const sshPort = parsePortText(input.sshPortText, undefined);
  if (sshPort === null) return { ok: false, error: "invalidSshPort" };
  if (daemonPort == null) return { ok: false, error: "invalidDaemonPort" };
  const identityFile = input.identityFile.trim();
  if (identityFile && !/^(~\/|\/|[A-Za-z]:[\\/])/u.test(identityFile))
    return { ok: false, error: "invalidKeyFile" };
  return {
    ok: true,
    target: {
      host: user ? `${user}@${host}` : host,
      ...(sshPort !== undefined ? { sshPort } : {}),
      ...(identityFile ? { identityFile } : {}),
    },
    daemonPort,
  };
}

/** The listen address the installer's service uses for each network choice. */
export function deployListenAddress(network: DeployNetwork, daemonPort: number): string {
  return `${network === "tunnel" ? "127.0.0.1" : "0.0.0.0"}:${daemonPort}`;
}

/** The action a re-run takes on this host: first deploy, upgrade, or reinstall. */
export function deployAction(
  probe: Pick<SshDeployProbe, "hasFrogg">,
  targetVersion: string | null,
): "deploy" | "upgrade" | "reinstall" {
  if (!probe.hasFrogg.installed) return "deploy";
  const current = probe.hasFrogg.version;
  return current && targetVersion && current === targetVersion.replace(/^v/u, "")
    ? "reinstall"
    : "upgrade";
}

interface StepContext {
  fail(code: DeployErrorCode, detail: string): never;
  signal: AbortSignal;
}

/**
 * Obtains the pairing code over SSH and checks it names the daemon we just
 * installed. A tunnel needs no code — SSH already authenticates the host — so
 * an unavailable code only fails the LAN path.
 */
async function resolvePairing(
  input: DeployToHostInput,
  deps: DeployToHostDeps,
  context: StepContext,
): Promise<{
  code: SshDeployPairCode | null;
  offer: AnyConnectionOffer | null;
  link: DirectPairingLink | null;
}> {
  let code: SshDeployPairCode | null = null;
  try {
    code = await deps.pairCode(input.target);
  } catch (error) {
    if (input.network === "lan") context.fail("pair_code_unavailable", message(error));
  }
  if (!code) return { code: null, offer: null, link: null };

  // `<cli> pair` prints a direct pairing link; older daemons print the
  // `<scheme>://pair#offer=…` fragment, which stays supported as the fallback.
  const link = parseDirectPairingDeepLink(code.deepLink, brand.scheme);
  if (link) {
    if (
      code.fingerprint &&
      normalizeFingerprint(link.fingerprint) !== normalizeFingerprint(code.fingerprint)
    ) {
      context.fail("fingerprint_mismatch", `${code.fingerprint} ≠ ${link.fingerprint}`);
    }
    if (input.network === "lan" && !link.pairingCode && !link.claim) {
      context.fail("invalid_pair_code", "The pairing link carries no pairing code.");
    }
    return { code, offer: null, link };
  }

  let offer: AnyConnectionOffer | null = null;
  try {
    offer = parseAnyConnectionOfferFromUrl(code.deepLink);
  } catch (error) {
    context.fail("invalid_pair_code", message(error));
  }
  if (!offer) return context.fail("invalid_pair_code", code.deepLink);
  if (code.fingerprint) {
    const actual = await deps.fingerprint(offer.daemonPublicKeyB64);
    if (normalizeFingerprint(actual) !== normalizeFingerprint(code.fingerprint)) {
      context.fail("fingerprint_mismatch", `${code.fingerprint} ≠ ${actual}`);
    }
  }
  if (input.network === "lan" && offer.v !== 3) {
    context.fail("pair_code_unavailable", "The daemon offered relay pairing only.");
  }
  return { code, offer, link: null };
}

/**
 * Turns trusted LAN off on a host this deploy just installed, and reports
 * whether the daemon now requires a credential from network clients. A host
 * that already had the daemon is left as it is: its operator may be relying
 * on LAN clients that this would disconnect.
 */
async function lockDownHost(
  input: DeployToHostInput,
  probe: SshDeployProbe,
  deps: DeployToHostDeps,
  context: StepContext,
  onStep: (step: DeployStepId, status: DeployStepStatus) => void,
): Promise<boolean> {
  if (deployAction(probe, null) !== "deploy") {
    onStep("secure", "skipped");
    return false;
  }
  let hardened: SshDeployHardenResult;
  try {
    hardened = await deps.harden(input.target);
  } catch (error) {
    if (isCancelled(error, context.signal)) throw error;
    return context.fail("harden_failed", message(error));
  }
  onStep("secure", hardened.unsupported ? "skipped" : "done");
  return !hardened.trustLan;
}

/** Adds the host: a tunnel connection, or a claim redeemed over the network. */
async function performPairing(
  input: DeployToHostInput,
  deps: DeployToHostDeps,
  context: StepContext,
  pairing: {
    code: SshDeployPairCode | null;
    offer: AnyConnectionOffer | null;
    link: DirectPairingLink | null;
  },
): Promise<{ serverId: string; hostname: string | null }> {
  try {
    if (input.network === "tunnel") {
      return await deps.connectTunnel({
        host: input.target.host,
        ...(input.target.sshPort === undefined ? {} : { sshPort: input.target.sshPort }),
        ...(input.target.identityFile === undefined
          ? {}
          : { identityFile: input.target.identityFile }),
        daemonPort: input.daemonPort,
      });
    }
    const { code, offer, link } = pairing;
    if (link) return await deps.claimPairingLink(link);
    const endpointOverride = code?.host && code.port ? `${code.host}:${code.port}` : undefined;
    return await deps.claim(
      offer as ConnectionOfferV3,
      endpointOverride ? { endpointOverride } : {},
    );
  } catch (error) {
    if (isCancelled(error, context.signal)) throw error;
    return context.fail(claimErrorCode(error), message(error));
  }
}

function claimErrorCode(error: unknown): DeployErrorCode {
  switch (errorCode(error)) {
    case "identity_mismatch":
      return "server_mismatch";
    case "unreachable":
      return "unreachable";
    case "token_rejected":
    case "expired":
      return "claim_rejected";
    default:
      return "connect_failed";
  }
}

export async function runDeployToHost(
  input: DeployToHostInput,
  deps: DeployToHostDeps,
  options: {
    signal: AbortSignal;
    onStep: (step: DeployStepId, status: DeployStepStatus) => void;
    /** The platform report, as soon as SSH answers (labels the install as deploy or upgrade). */
    onProbe?: (probe: SshDeployProbe) => void;
  },
): Promise<DeployedHost> {
  const { signal, onStep } = options;
  let step: DeployStepId = "connect";
  const begin = (next: DeployStepId) => {
    signal.throwIfAborted();
    step = next;
    onStep(next, "running");
  };
  const fail = (code: DeployErrorCode, detail: string): never => {
    throw new DeployToHostError(step, code, detail);
  };
  const context: StepContext = { fail, signal };

  try {
    begin("connect");
    let probe: SshDeployProbe;
    try {
      probe = await deps.probe(input.target);
    } catch (error) {
      return fail("ssh_failed", message(error));
    }
    options.onProbe?.(probe);
    if (!SUPPORTED_OS.has(probe.os) || !SUPPORTED_ARCH.has(probe.arch)) {
      fail("unsupported_platform", [probe.os, probe.arch].filter(Boolean).join(" "));
    }
    onStep("connect", "done");

    begin("install");
    try {
      await deps.install(
        {
          ...input.target,
          method: "native",
          listen: deployListenAddress(input.network, input.daemonPort),
          ...(input.version ? { version: input.version } : {}),
        },
        signal,
      );
    } catch (error) {
      if (isCancelled(error, signal)) throw error;
      fail("install_failed", message(error));
    }
    onStep("install", "done");

    // Lock the box down before a pairing code exists, so the window in which
    // the daemon is both reachable and unauthenticated is never opened. Only
    // on a first deploy: flipping the setting on a host that was already
    // running would cut off LAN clients the operator is relying on.
    begin("secure");
    const lanLockedDown = await lockDownHost(input, probe, deps, context, onStep);

    begin("pairCode");
    const pairing = await resolvePairing(input, deps, context);
    onStep("pairCode", pairing.code ? "done" : "skipped");

    begin("pair");
    const paired = await performPairing(input, deps, context, pairing);
    const expectedServerId = pairing.offer?.serverId ?? pairing.link?.serverId ?? null;
    if (expectedServerId && paired.serverId !== expectedServerId) {
      fail("server_mismatch", `${paired.serverId} ≠ ${expectedServerId}`);
    }
    onStep("pair", "done");
    return {
      ...paired,
      verified: pairing.offer !== null || pairing.link !== null,
      lanLockedDown,
      probe,
    };
  } catch (error) {
    if (error instanceof DeployToHostError) {
      onStep(error.step, "failed");
      throw error;
    }
    onStep(step, "failed");
    if (isCancelled(error, signal)) throw new DeployToHostError(step, "cancelled", "Cancelled");
    throw new DeployToHostError(step, "connect_failed", message(error));
  }
}
