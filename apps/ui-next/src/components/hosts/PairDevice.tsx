import type { DeviceRole } from "@frogg/protocol/device-access";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { shortFingerprint } from "../../daemon/pairing";
import { getClient, useDaemon } from "../../daemon/store";
import { color, font } from "../../theme/tokens";
import { Button } from "../Button";
import { Seg } from "../settings/controls";
import { copyText } from "../shell/copy";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";
import { useCountdown } from "./PairConfirm";
import { Qr } from "./Qr";
import { closeSheet, useHostView } from "./state";

const ROLES: Array<[DeviceRole, string]> = [
  ["owner", "Owner"],
  ["operator", "Operator"],
  ["viewer", "Viewer"],
];
type Route = "relay" | "direct";
const ROUTES: Array<[Route, string]> = [
  ["relay", "Through the relay"],
  ["direct", "On this network"],
];

interface Minted {
  code: string;
  expiresAt: string | null;
  fingerprint: string;
  direct: string | null;
  relay: string | null;
  relayHost: string | null;
}

/** Owner side of pairing: mint a code for a role and show it as QR, link and code. */
export function PairDevice() {
  const open = useHostView((s) => s.sheet?.kind === "pair-device");
  const host = useDaemon((s) => s.serverName) ?? "host";
  const [role, setRole] = useState<DeviceRole>("operator");
  const [route, setRoute] = useState<Route>("relay");
  const [minted, setMinted] = useState<Minted | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const expires = useCountdown(minted?.expiresAt ?? null);

  useEffect(() => {
    if (!open) return;
    const client = getClient();
    if (!client) return;
    let live = true;
    setError(null);
    void (async () => {
      try {
        const [code, offer] = await Promise.all([
          client.createPairingCode({ role, ttlSeconds: 600 }),
          client.getDaemonPairingOffer().catch(() => null),
        ]);
        if (!live) return;
        if (!code.code) throw new Error(code.error ?? "This host did not mint a code");
        const relay = offer?.relayEnabled ? offer.url : null;
        setMinted({
          code: code.code,
          expiresAt: code.expiresAt,
          fingerprint: code.fingerprint,
          direct: code.endpoints[0]?.deepLink ?? null,
          relay,
          relayHost: relay ? "the relay" : null,
        });
        if (!relay) setRoute("direct");
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      live = false;
    };
  }, [open, role, nonce]);

  const link = (route === "relay" ? minted?.relay : minted?.direct) ?? minted?.direct ?? null;
  const copyLink = useCallback(() => void (link && copyText(link)), [link]);
  const copyCode = useCallback(() => void (minted && copyText(minted.code)), [minted]);
  const renew = useCallback(() => setNonce((n) => n + 1), []);

  return (
    <Dialog
      open={open}
      onClose={closeSheet}
      eyebrow={`${host} · devices`}
      title="Pair a device"
      width={740}
      footer={
        <>
          <T style={s.footNote}>QR, link and code are the same offer.</T>
          <Button kind="primary" label="Done" onPress={closeSheet} />
        </>
      }
    >
      <View style={s.row}>
        <View style={s.qr}>
          {link ? <Qr value={link} size={200} /> : <View style={s.qrEmpty} />}
        </View>
        <View style={s.side}>
          <T v="label">Role for the new device</T>
          <Seg options={ROLES} value={role} onChange={setRole} />
          {minted?.relay && <Seg options={ROUTES} value={route} onChange={setRoute} />}
          <T v="label">Code</T>
          <View style={s.cells}>
            {(minted?.code ?? "        ").split("").map((c, i) => (
              <CodeCell key={POS[i]} ch={c} gap={i === 3} />
            ))}
          </View>
          <T v="label">Link</T>
          <View style={s.link}>
            <T v="mono" numberOfLines={1} style={s.linkT}>
              {link ?? "…"}
            </T>
          </View>
          <View style={s.acts}>
            <Button label="Copy link" onPress={copyLink} disabled={!link} />
            <Button label="Copy code" onPress={copyCode} disabled={!minted} />
            <Button label="New code" onPress={renew} />
          </View>
          {minted && (
            <T style={s.muted}>
              Expires {expires ?? "soon"} · fingerprint{" "}
              <T v="mono" style={s.fp}>
                {shortFingerprint(minted.fingerprint, 2)}
              </T>
              {route === "relay" && minted.relay
                ? " · reached through the relay, so the device needs no shared network."
                : " · reached on this network."}{" "}
              Anyone with this link can request access; the role is fixed by the code.
            </T>
          )}
          {error && <T style={s.error}>{error}</T>}
        </View>
      </View>
    </Dialog>
  );
}

const POS = ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7"];

function CodeCell({ ch, gap }: { ch: string; gap: boolean }) {
  return (
    <View style={[s.cell, gap && s.cellGap]}>
      <T style={s.cellT}>{ch}</T>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: 24 },
  qr: { padding: 10 },
  qrEmpty: { width: 200, height: 200, backgroundColor: color.wash },
  side: { flex: 1, minWidth: 260, gap: 10 },
  cells: { flexDirection: "row", gap: 8 },
  cell: {
    width: 30,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
    borderBottomWidth: 2,
    borderBottomColor: color.cyan,
  },
  cellGap: { marginRight: 10 },
  cellT: { fontFamily: font.mono, fontSize: 20, fontWeight: "600" },
  link: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
  },
  linkT: { color: color.text, fontSize: 12 },
  acts: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  muted: { color: color.muted, fontSize: 12, lineHeight: 18, flexShrink: 1 },
  fp: { color: color.cyan2, fontSize: 11 },
  error: { color: color.coral, fontSize: 12.5 },
  footNote: { flex: 1, alignSelf: "center", color: color.muted, fontSize: 12 },
});
