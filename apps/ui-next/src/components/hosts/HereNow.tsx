import type {
  DeviceCredential,
  DeviceRole,
  PendingPairingRequest,
} from "@frogg/protocol/device-access";
import { Globe, Laptop, Smartphone } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getClient, useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { agoText } from "../../util";
import { Button } from "../Button";
import { Select } from "../Select";
import { Pill } from "../settings/controls";
import { useFeature } from "../settings/pages/kit";
import { T } from "../Text";
import { usePrompt } from "../tools/Prompt";
import { Card } from "./Card";

const ROLE_OPTIONS: Array<{ value: DeviceRole; label: string }> = [
  { value: "owner", label: "Owner" },
  { value: "operator", label: "Operator" },
  { value: "viewer", label: "Viewer" },
];

const openDevices = () => {
  useUi.getState().setTool("settings");
  useUi.getState().openSettings("devices");
};

function iconOf(name: string) {
  if (/pixel|phone|android|ios|iphone|galaxy/i.test(name)) return Smartphone;
  if (/firefox|chrome|safari|edge|browser|web/i.test(name)) return Globe;
  return Laptop;
}

/**
 * Who is on the active host: paired devices (connected first) and pairing requests.
 * Everything is read from the client of the host on screen, and dropped when the host changes,
 * so another host's devices never linger here.
 */
export function HereNow({ owner, role }: { owner: boolean; role: string | null }) {
  const url = useDaemon((s) => s.url);
  const [devices, setDevices] = useState<DeviceCredential[] | null>(null);
  const [requests, setRequests] = useState<PendingPairingRequest[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const prompt = usePrompt();
  useEffect(() => {
    setDevices(null);
    setRequests([]);
    setError(null);
  }, [url]);
  useEffect(() => {
    const client = getClient();
    if (!client) return;
    let live = true;
    const load = () => {
      // The host on screen may have changed since this timer started.
      if (getClient() !== client) return;
      void client
        .listDevices()
        .then((r) => {
          if (!live) return;
          setDevices(r.devices);
          setError(null);
          return undefined;
        })
        .catch((e: unknown) => live && setError(e instanceof Error ? e.message : String(e)));
      if (owner)
        void client
          .listPairingRequests()
          .then((r) => live && setRequests(r.requests))
          .catch(() => {});
    };
    load();
    const id = setInterval(load, 5000);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [url, owner, tick]);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  const list = devices ?? [];
  const sorted = [...list].sort(
    (a, b) => Number(b.current) - Number(a.current) || Number(b.connected) - Number(a.connected),
  );
  // A tokenless loopback/LAN connection has no credential, so the list has no "current" entry.
  const anonymous = devices !== null && !list.some((d) => d.current);
  const connected = list.filter((d) => d.connected).length + (anonymous ? 1 : 0);
  return (
    <Card title="Here now" count={devices ? `${connected} connected` : undefined}>
      {anonymous && <ThisSession role={role} />}
      {sorted.slice(0, 6).map((d) => (
        <DeviceRow key={d.id} d={d} owner={owner} ask={prompt.ask} done={refresh} />
      ))}
      {devices === null && !error && <T style={s.muted}>Reading devices…</T>}
      {devices?.length === 0 && !anonymous && <T style={s.muted}>No paired devices.</T>}
      {error && <T style={s.err}>{error}</T>}
      {requests.map((r) => (
        <RequestRow key={r.id} r={r} done={refresh} />
      ))}
      <View style={s.foot}>
        <Button
          label={list.length > 6 ? `All ${list.length} devices…` : "Manage devices…"}
          onPress={openDevices}
        />
      </View>
      {prompt.dialog}
    </Card>
  );
}

function ThisSession({ role }: { role: string | null }) {
  return (
    <View style={s.device}>
      <Globe size={14} color={color.cyan2} />
      <View style={s.flex}>
        <T numberOfLines={1} style={s.deviceName}>
          This app
        </T>
        <T style={s.faintSmall}>connected · trusted network, no device credential</T>
      </View>
      <Pill text={role ?? "owner"} tint={color.cyan2} />
    </View>
  );
}

type Ask = ReturnType<typeof usePrompt>["ask"];

function DeviceRow({
  d,
  owner,
  ask,
  done,
}: {
  d: DeviceCredential;
  owner: boolean;
  ask: Ask;
  done: () => void;
}) {
  const canRoles = useFeature("deviceRoleManagement") === true && owner && !d.current;
  const [err, setErr] = useState<string | null>(null);
  const Icon = iconOf(d.name);
  let seen = d.lastSeenAt ? `last seen ${agoText(d.lastSeenAt)}` : "never connected";
  if (d.connected) seen = "connected";
  if (d.current) seen = d.connected ? "this device · connected" : "this device";
  const rename = useCallback(
    () =>
      ask({
        eyebrow: "Devices",
        title: `Rename ${d.name}`,
        initial: d.name,
        action: "Rename",
        run: async (name) => {
          const c = getClient();
          if (!c) return "Host offline";
          await c.renameDevice({ deviceId: d.id, name });
          done();
          return null;
        },
      }),
    [ask, d.id, d.name, done],
  );
  const setRole = useCallback(
    (role: DeviceRole) => {
      setErr(null);
      const apply = async () => {
        const c = getClient();
        if (!c) throw new Error("Host offline");
        const r = await c.setDeviceRole({ credentialId: d.id, role });
        if (r.error) setErr(r.error);
        done();
      };
      apply().catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
    },
    [d.id, done],
  );
  return (
    <View style={s.deviceWrap}>
      <View style={s.device}>
        <Icon size={14} color={d.current ? color.cyan2 : color.muted} />
        <View style={s.flex}>
          <T numberOfLines={1} style={s.deviceName}>
            {d.name}
          </T>
          <T style={d.connected ? s.on : s.faintSmall}>{seen}</T>
        </View>
        {canRoles ? (
          <Select
            options={ROLE_OPTIONS}
            value={d.role}
            onChange={setRole}
            width={110}
            label="Device role"
          />
        ) : (
          <Pill text={d.role} />
        )}
        {(owner || d.current) && <Button label="Rename" onPress={rename} />}
      </View>
      {err && <T style={s.err}>{err}</T>}
    </View>
  );
}

function RequestRow({ r, done }: { r: PendingPairingRequest; done: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const decide = useCallback(
    (decision: "approve" | "deny") =>
      void getClient()
        ?.decidePairingRequest({ pairingRequestId: r.id, decision, role: "operator" })
        .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)))
        .finally(done),
    [r.id, done],
  );
  const approve = useCallback(() => decide("approve"), [decide]);
  const deny = useCallback(() => decide("deny"), [decide]);
  return (
    <View style={s.request}>
      <View style={s.diamond} />
      <View style={s.flex}>
        <T style={s.strong}>{r.deviceName} wants Operator access</T>
        <T style={s.muted}>
          Match code{" "}
          <T v="mono" style={s.code}>
            {r.matchCode}
          </T>{" "}
          on that device
          {r.remoteAddress ? ` · ${r.remoteAddress}` : ""}
        </T>
        {err && <T style={s.err}>{err}</T>}
      </View>
      <Button label="Deny" onPress={deny} />
      <Button kind="primary" label="Approve" onPress={approve} />
    </View>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1 },
  strong: { fontWeight: "600", fontSize: 13.5 },
  muted: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  faintSmall: { color: color.faint, fontSize: 12 },
  on: { color: color.mint, fontSize: 12 },
  err: { color: color.coral, fontSize: 12 },
  deviceWrap: { gap: 4 },
  device: { flexDirection: "row", alignItems: "center", gap: 10, minHeight: 32 },
  deviceName: { fontSize: 13 },
  foot: { flexDirection: "row", justifyContent: "flex-end" },
  request: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 12,
    backgroundColor: "rgba(245,184,74,0.06)",
  },
  diamond: {
    width: 8,
    height: 8,
    backgroundColor: color.amber,
    transform: [{ rotate: "45deg" }],
  },
  code: { color: color.cyan2 },
});
