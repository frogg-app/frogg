import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  fetchServerId,
  isRelayHost,
  rebindHost,
  updateHost,
  type Host,
  type HostLink,
} from "../../daemon/hosts";
import { connect } from "../../daemon/store";
import { color, motion, stateMotion } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";
import { authRefusal, identityMismatch, offlineReason, type IdentityMismatch } from "./access";
import { openSheet } from "./state";

/** "12m ago" style age for an ISO time. */
export function ago(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const s = Math.max(0, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (!Number.isFinite(s)) return null;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/**
 * When a direct host keeps failing, asks /api/identity over the other scheme: a daemon that only
 * answers there means the saved TLS setting is wrong (the usual cause of a bare 1006).
 */
function useTlsMismatch(host: Host, down: boolean): boolean {
  const [wrong, setWrong] = useState(false);
  const { endpoint, tls } = host;
  const relay = isRelayHost(host);
  useEffect(() => {
    setWrong(false);
    if (!down || relay) return;
    let live = true;
    void fetchServerId(endpoint, !tls).then((id) => {
      if (live && id) setWrong(true);
      return undefined;
    });
    return () => {
      live = false;
    };
  }, [endpoint, tls, relay, down]);
  return wrong;
}

/** Re-binds the host to the daemon now at its address and connects; it then pairs afresh. */
function useAdopt(host: Host, actual: string | undefined) {
  return useCallback(() => {
    const next = actual ? rebindHost(host.id, actual) : null;
    if (next) void connect(next);
  }, [host.id, actual]);
}

/** The retry track: a light band runs while a reconnect is in flight. */
function RetryTrack({ connecting, attempt }: { connecting: boolean; attempt: number }) {
  return (
    <View style={s.retryRow}>
      <View style={s.track}>{connecting && <View style={s.scan} />}</View>
      <T v="mono" style={connecting ? s.retryOn : s.retryIdle}>
        {connecting ? `retrying · attempt ${attempt}` : `waiting to retry · ${attempt - 1} tried`}
      </T>
    </View>
  );
}

/**
 * A different daemon answers at the host's address. Its sessions never reach this host; the user
 * either adopts it (the entry re-pairs with it) or points the entry at the host's new address.
 */
export function MismatchBanner({
  host,
  id,
  retry,
}: {
  host: Host;
  id: IdentityMismatch;
  retry?: { connecting: boolean; attempt: number };
}) {
  const adopt = useAdopt(host, id.actual);
  const edit = useCallback(() => openSheet({ kind: "edit", hostId: host.id }), [host.id]);
  const remove = useCallback(() => openSheet({ kind: "remove", hostId: host.id }), [host.id]);
  return (
    <View style={s.banner}>
      <View style={s.bannerHead}>
        <View style={[s.flag, s.flagLive]} />
        <T style={s.strong}>{id.title(host.endpoint)}</T>
      </View>
      <T style={s.bannerBody}>
        {`It isn't the daemon ${host.name} was saved for, so Frogg keeps its sessions off this host${retry ? ` and keeps checking for ${host.name}` : ""}. Use this daemon if it replaced ${host.name} (this app pairs or signs in with it again), or edit the address if ${host.name} moved.`}
      </T>
      <T v="mono" style={s.ids}>
        {`saved ${id.expected} · answering ${id.actual}`}
      </T>
      {retry && <RetryTrack {...retry} />}
      <View style={s.bannerActs}>
        <Button kind="primary" label="Use this daemon" onPress={adopt} />
        <Button label="Edit address…" onPress={edit} />
        <Button kind="danger" label="Remove host…" onPress={remove} />
      </View>
    </View>
  );
}

/** The active host when it is not connected: waiting, retrying, refused, or the wrong daemon. */
export function Offline({ host, link, conn }: { host: Host; link: HostLink; conn: string }) {
  const retry = useCallback(() => void connect(host), [host]);
  const remove = useCallback(() => openSheet({ kind: "remove", hostId: host.id }), [host.id]);
  const pairApp = useCallback(() => openSheet({ kind: "add", method: "pair" }), []);
  const edit = useCallback(() => openSheet({ kind: "edit", hostId: host.id }), [host.id]);
  const refusal = authRefusal(link.error);
  const wrongDaemon = identityMismatch(link.error);
  const last = ago(host.lastOnlineAt);
  const connecting = conn === "connecting";
  // First connect (never dropped this run) reads as a wait; a reconnect reads as a failure.
  const first = connecting && !link.droppedAt;
  const tlsWrong = useTlsMismatch(host, !first && !refusal && !wrongDaemon);
  const fixTls = useCallback(() => {
    const next = updateHost(host.id, { tls: !host.tls });
    if (next) void connect(next);
  }, [host.id, host.tls]);
  const track = useMemo(
    () => ({ connecting, attempt: link.attempt + 1 }),
    [connecting, link.attempt],
  );
  if (wrongDaemon)
    return (
      <MismatchBanner
        host={host}
        id={wrongDaemon}
        // Found behind a refused credential, the client has stopped retrying.
        retry={connecting || link.attempt > 0 ? track : undefined}
      />
    );
  let title = `Can't reach ${host.name}`;
  if (first) title = `Connecting to ${host.name}…`;
  else if (refusal) title = refusal.title;
  let body = `${offlineReason(link)}.${last ? ` Last connected ${last}.` : ""} Sessions on this host are paused here and come back when it does.`;
  if (first) body = host.endpoint;
  else if (refusal) body = refusal.body;
  let primary = <Button kind="primary" label="Retry now" onPress={retry} />;
  if (refusal) primary = <Button kind="primary" label={refusal.action} onPress={pairApp} />;
  else if (tlsWrong)
    primary = (
      <Button kind="primary" label={host.tls ? "Turn off TLS" : "Turn on TLS"} onPress={fixTls} />
    );
  return (
    <View style={[s.banner, first && s.bannerWait]}>
      <View style={s.bannerHead}>
        <View style={[s.flag, first && s.flagWait, !refusal && s.flagLive]} />
        <T style={s.strong}>{title}</T>
      </View>
      <T style={s.bannerBody}>{body}</T>
      {tlsWrong && (
        <T style={s.hintLine}>
          {host.tls
            ? `${host.endpoint} answers without TLS. Turn TLS off for this host to connect.`
            : `${host.endpoint} only answers over TLS. Turn TLS on for this host to connect.`}
        </T>
      )}
      {!refusal && !first && <RetryTrack {...track} />}
      <View style={s.bannerActs}>
        {primary}
        <Button label={refusal ? "Add the password…" : "Edit host…"} onPress={edit} />
        <Button kind="danger" label="Remove host…" onPress={remove} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  strong: { fontWeight: "600", fontSize: 13.5 },
  banner: {
    maxWidth: 720,
    padding: 18,
    gap: 10,
    borderLeftWidth: 2,
    borderLeftColor: color.coral,
    backgroundColor: "rgba(255,107,107,0.06)",
  },
  bannerWait: { borderLeftColor: color.amber, backgroundColor: "rgba(245,184,74,0.05)" },
  bannerHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  flag: { width: 10, height: 10, backgroundColor: color.coral },
  flagWait: { backgroundColor: color.amber },
  flagLive: motion.breathe,
  hintLine: { color: color.text, fontSize: 13, lineHeight: 19 },
  ids: { color: color.faint, fontSize: 11 },
  retryRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: { width: 120, height: 2, backgroundColor: color.line, overflow: "hidden" },
  scan: { width: "25%", height: 2, backgroundColor: color.coral, ...stateMotion.beam },
  retryOn: { color: color.coral, fontSize: 11.5 },
  retryIdle: { color: color.faint, fontSize: 11.5 },
  bannerBody: { color: color.muted, fontSize: 13.5, lineHeight: 21 },
  bannerActs: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});
