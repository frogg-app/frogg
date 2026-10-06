import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  clearPendingPair,
  describePairTarget,
  pair,
  shortFingerprint,
  usePendingPair,
  verifyPairTarget,
  type Verify,
} from "../../daemon/pairing";
import { connect } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { Button } from "../Button";
import { Pill } from "../settings/controls";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";
import { closeSheet, useHostView, viewHost } from "./state";

const ROLE: Record<string, string> = { owner: "Owner", operator: "Operator", viewer: "Viewer" };

/** "in 9:41" for a future ISO time, "expired" once past. */
export function useCountdown(iso: string | null): string | null {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!iso) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [iso]);
  if (!iso) return null;
  const left = Math.floor((Date.parse(iso) - now) / 1000);
  if (!Number.isFinite(left)) return null;
  if (left <= 0) return "expired";
  return `in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
}

/** The one confirm step every pairing route ends in: check the key, then pair. */
export function PairConfirm() {
  const open = useHostView((s) => s.sheet?.kind === "confirm");
  const { target, invalid } = usePendingPair();
  const details = useMemo(() => (target ? describePairTarget(target) : null), [target]);
  const [verify, setVerify] = useState<Verify>({ status: "idle" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const expires = useCountdown(details?.expiresAt ?? null);

  useEffect(() => {
    setError(null);
    if (!open || !target) return;
    let live = true;
    setVerify({ status: "verifying" });
    void verifyPairTarget(target).then((v) => live && setVerify(v));
    return () => {
      live = false;
    };
  }, [open, target]);

  const close = useCallback(() => {
    clearPendingPair();
    closeSheet();
  }, []);

  const run = useCallback(
    async (asOwner: boolean) => {
      if (!target) return;
      setBusy(true);
      setError(null);
      try {
        const host = await pair(target, {
          asOwner,
          verified: verify.status === "verified" ? verify.identity : null,
        });
        clearPendingPair();
        closeSheet();
        viewHost(host.id, false);
        void connect(host);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [target, verify],
  );
  const closeFooter = useMemo(() => <Button label="Close" onPress={close} />, [close]);
  const onPair = useCallback(() => void run(false), [run]);
  const onClaim = useCallback(() => void run(true), [run]);

  if (!details) {
    return (
      <Dialog
        open={open}
        onClose={close}
        eyebrow="Add a host · confirm"
        title="Not a pairing link"
        footer={closeFooter}
      >
        <T style={s.note}>
          {invalid
            ? "This link does not carry a Frogg pairing offer. Ask the host for a fresh link or code."
            : "No pairing offer is waiting."}
        </T>
      </Dialog>
    );
  }

  const refused = verify.status === "refused";
  const fp = verify.status === "verified" && verify.identity ? verify.identity.fingerprint : null;
  const fingerprint = fp ?? details.fingerprint;
  const expired = expires === "expired";
  return (
    <Dialog
      open={open}
      onClose={close}
      eyebrow="Add a host · confirm"
      title={`Pair with ${details.name}?`}
      footer={
        <>
          <Button label="Cancel" onPress={close} />
          {details.canClaim && (
            <Button label="Claim as owner" disabled={busy || refused} onPress={onClaim} />
          )}
          <Button
            kind="primary"
            label={busy ? "Pairing…" : "Pair"}
            disabled={busy || refused || expired}
            onPress={onPair}
          />
        </>
      }
    >
      <View>
        <Line k="Address" v={details.address} />
        <View style={s.line}>
          <T style={s.k}>Host key</T>
          <View style={s.fp}>
            <T v="mono" style={s.fpT}>
              {fingerprint ? `SHA256:${shortFingerprint(fingerprint)}` : "shown after connecting"}
            </T>
            <VerifyPill v={verify} />
          </View>
        </View>
        <Line
          k="Your role"
          v={
            details.claim
              ? "Owner (claiming this host)"
              : `${ROLE[details.role ?? ""] ?? "Set by the host"}${details.role ? " (set by the host)" : ""}`
          }
        />
        {expires && <Line k="Offer expires" v={expires} warn={expired} />}
        {details.serverId && <Line k="Server ID" v={details.serverId} mono />}
      </View>
      {verify.status === "refused" && <T style={s.error}>{verify.message}</T>}
      {verify.status === "unverified" && (
        <T style={s.note}>Couldn&apos;t check the host&apos;s key yet: {verify.message}</T>
      )}
      {details.relay && (
        <T style={s.note}>
          Reached through the relay, end-to-end encrypted to this key. No shared network needed.
        </T>
      )}
      {details.canClaim && (
        <T style={s.note}>
          If this host has no owner yet you can claim it instead, which makes this device its owner.
        </T>
      )}
      {error && <T style={s.error}>{error}</T>}
    </Dialog>
  );
}

function VerifyPill({ v }: { v: Verify }) {
  if (v.status === "verified") return <Pill text="verified" tint={color.mint} />;
  if (v.status === "refused") return <Pill text="mismatch" tint={color.coral} />;
  if (v.status === "verifying") return <Pill text="checking" tint={color.amber} />;
  return <Pill text="unverified" tint={color.amber} />;
}

function Line({ k, v, mono, warn }: { k: string; v: string; mono?: boolean; warn?: boolean }) {
  return (
    <View style={s.line}>
      <T style={s.k}>{k}</T>
      <T v={mono ? "mono" : "body"} numberOfLines={1} style={[s.v, warn && s.warn]}>
        {v}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 16,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  k: { color: color.muted, fontSize: 13 },
  v: { flexShrink: 1, textAlign: "right", fontSize: 13 },
  warn: { color: color.coral },
  fp: { flexDirection: "row", alignItems: "center", gap: 6, flexShrink: 1 },
  fpT: { color: color.cyan2, fontSize: 11 },
  note: { color: color.muted, fontSize: 12, lineHeight: 18 },
  error: { color: color.coral, fontSize: 12.5, lineHeight: 18 },
});
