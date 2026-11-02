import {
  isTailnetAddress,
  keyExpiryState,
  type KeyExpiryState,
  type TailscaleNodeStatus,
} from "@frogg/protocol/tailscale";
import { StyleSheet } from "react-native";
import type { Host } from "../../daemon/hosts";
import { color } from "../../theme/tokens";
import { T } from "../Text";
import { Card } from "./Card";

/** server_info.tailscale from a daemon that reports it (v1.6.14+), else null. */
export function tailscaleOf(info: unknown): TailscaleNodeStatus | null {
  return (info as { tailscale?: TailscaleNodeStatus } | null)?.tailscale ?? null;
}

/** The host is reached at a tailnet address (a direct route; a relay host never is). */
export const overTailscale = (host: Pick<Host, "endpoint" | "relay">): boolean =>
  !host.relay && isTailnetAddress(host.endpoint);

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** One line on the node key, or null when there is nothing to say. */
export function expiryLine(state: KeyExpiryState): string | null {
  if (!state.expiresAt) return null;
  const date = fmtDate(state.expiresAt);
  if (state.level === "expired") return `The node key expired on ${date}.`;
  if (state.daysLeft === 0) return `The node key expires today (${date}).`;
  return `The node key expires in ${state.daysLeft} day${state.daysLeft === 1 ? "" : "s"} (${date}).`;
}

export function reloginHint(level: KeyExpiryState["level"]): string {
  if (level === "expired")
    return "Log this machine in to Tailscale again (tailscale up, or the Tailscale app) to reach it over Tailscale. Disable key expiry for it in the Tailscale admin console to stop this recurring.";
  return "Log this machine in to Tailscale again before then (tailscale up, or the Tailscale app), or disable key expiry for it in the Tailscale admin console. Until it is renewed, Frogg cannot reach this host over Tailscale.";
}

/**
 * Host detail card: whether this connection runs over Tailscale, the daemon machine's node, and
 * its key expiry, with the re-login steps once expiry is near. Shown when either side knows of
 * Tailscale; nothing otherwise.
 */
export function TailscaleCard({ host, info }: { host: Host; info: unknown }) {
  const node = tailscaleOf(info);
  const viaTailnet = overTailscale(host);
  if (!node && !viaTailnet) return null;
  const state = keyExpiryState(node);
  const warn = state.level === "soon" || state.level === "urgent" || state.level === "expired";
  const tint = state.level === "soon" ? color.amber : color.coral;
  let keyLine = expiryLine(state);
  if (node && !state.expiresAt) keyLine = "Key expiry is disabled for this machine.";
  if (!node)
    keyLine = "This daemon does not report its Tailscale node; update it to see key expiry.";
  return (
    <Card title="Tailscale">
      <T style={s.strong}>
        {viaTailnet ? "Connected over Tailscale" : "Tailscale on this host"}
        {node && !node.online ? " · logged out" : ""}
      </T>
      {node?.dnsName && (
        <T v="mono" style={s.faint}>
          {node.dnsName}
        </T>
      )}
      {keyLine && <T style={[s.muted, warn && { color: tint }]}>{keyLine}</T>}
      {warn && <T style={s.muted}>{reloginHint(state.level)}</T>}
    </Card>
  );
}

const s = StyleSheet.create({
  strong: { fontWeight: "600", fontSize: 13.5 },
  muted: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  faint: { color: color.faint, fontSize: 10.5 },
});
