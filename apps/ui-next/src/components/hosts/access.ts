import type { DaemonClientErrorInfo } from "@frogg/client/internal/daemon-client";
import type { DeviceCredential } from "@frogg/protocol/device-access";

/**
 * Only an owner device may mint pairing codes or offers. A current daemon registers every
 * connection as a device (a password session included), so a refusal means this device's role
 * is below owner. An older daemon also refused a tokenless loopback or trusted-LAN connection
 * once it was claimed; that connection showed up as no device at all.
 */
export function pairingErrorText(e: unknown, role?: string | null): string {
  const raw = e instanceof Error ? e.message : String(e);
  if (/not authorized for (auth\.pairing_code\.create|daemon\.get_pairing_offer)/.test(raw)) {
    if (role && role !== "owner")
      return `Only an owner device can pair new devices, and this app is registered as ${role === "operator" ? "an" : "a"} ${role}. Ask an owner to change its role, or pair from an owner device.`;
    return "This host only hands out pairing codes to an owner device, and this app reaches it without a device credential. Edit this host and add the daemon password, or pair from a device that is already an owner.";
  }
  if (/Only an owner device/.test(raw)) return "Only an owner device can create owner codes.";
  return raw;
}

/** How this device is registered on the daemon, when it is not a regular pairing. */
export function registeredVia(d: Pick<DeviceCredential, "pairedVia">): string | null {
  if (d.pairedVia === "password") return "signed in with the daemon password";
  if (d.pairedVia === "local") return "local to the host";
  return null;
}

/**
 * True when a device list has no entry for this connection: only an older daemon that still
 * admits tokenless loopback/LAN callers. A current one lists every connection as a device.
 */
export const isUnregistered = (devices: readonly Pick<DeviceCredential, "current">[] | null) =>
  devices !== null && !devices.some((d) => d.current);

export interface AuthRefusal {
  kind: "unclaimed" | "missing" | "rejected";
  title: string;
  body: string;
}

/**
 * Why the daemon refused this app (WS close 4401), from its close reason. Every connection must
 * be a registered device: a paired credential, the daemon password, or the host's local token.
 */
export function authRefusal(error: DaemonClientErrorInfo | null): AuthRefusal | null {
  if (error?.code !== "pairing_required") return null;
  if (error.credentialRejected)
    return {
      kind: "rejected",
      title: "The host turned this app away",
      body: `It refused the saved credential (${error.reason || "rejected"}): the device was revoked, or the password changed. Pair again, or enter the current password.`,
    };
  if (/pairing required/i.test(error.reason))
    return {
      kind: "unclaimed",
      title: "This host isn't claimed yet",
      body: "No device owns this daemon, and it only admits registered devices. Run `frogg daemon pair` on the host and paste the link or code here to claim it as owner.",
    };
  return {
    kind: "missing",
    title: "This host needs pairing or its password",
    body: "The daemon only admits registered devices, from any network. Pair this app with a code from an owner device, or add the daemon password to this host.",
  };
}
