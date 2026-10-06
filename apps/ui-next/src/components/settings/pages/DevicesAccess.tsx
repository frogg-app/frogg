import { need } from "./hostkit";
import { HostPage } from "./host-state";
import { useHostRpc as useRpc } from "./host-state";
import { useHostAction as useAction } from "./host-state";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import { Globe, Laptop, QrCode, ShieldAlert, Smartphone } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { getClient } from "../../../daemon/store";
import { color, font } from "../../../theme/tokens";
import { agoText } from "../../../util";
import { Select } from "../../Select";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Row, Section, Seg } from "../controls";
import { Acts, Banner, Block, Confirm, ErrorLine, Field, Item, Status, useFeature } from "./kit";

type Device = Awaited<ReturnType<DaemonClient["listDevices"]>>["devices"][number];
type Pending = Awaited<ReturnType<DaemonClient["listPairingRequests"]>>["requests"][number];
type Code = Awaited<ReturnType<DaemonClient["createPairingCode"]>>;
type Role = Device["role"];

const ROLES: Array<[Role, string]> = [
  ["owner", "Owner"],
  ["operator", "Operator"],
  ["viewer", "Viewer"],
];
const ROLE_OPTIONS = ROLES.map(([value, label]) => ({ value, label }));
const INVITE_ROLES: Array<[Role, string]> = [
  ["operator", "Operator"],
  ["viewer", "Viewer"],
];

const loadDevices = (c: DaemonClient) => c.listDevices();
const loadRequests = (c: DaemonClient) => c.listPairingRequests();

function deviceIcon(d: Device) {
  const n = d.name.toLowerCase();
  if (/(phone|pixel|android|iphone|galaxy)/.test(n)) return Smartphone;
  if (/(firefox|chrome|safari|edge|browser|web)/.test(n)) return Globe;
  return Laptop;
}

function seenText(d: Device): string {
  if (d.current) return d.connected ? "This device · connected" : "This device";
  if (d.connected) return "Connected";
  return d.lastSeenAt ? `Last seen ${agoText(d.lastSeenAt)}` : "Never connected";
}

export function DevicesAccess() {
  return <HostPage body={PageBody} />;
}
function PageBody() {
  const supported = useFeature("deviceAccess");
  const devices = useRpc(loadDevices, { enabled: supported !== false, pollMs: 15000 });
  const requests = useRpc(loadRequests, { enabled: supported !== false, pollMs: 5000 });
  if (supported === false)
    return <T style={s.muted}>This daemon is too old for per-device access. Update it first.</T>;
  const list = devices.data?.devices ?? [];
  const waiting = requests.data?.requests ?? [];
  return (
    <>
      <PairBar />
      {waiting.length > 0 && (
        <Section title="Waiting for approval">
          {waiting.map((r) => (
            <PendingRow
              key={r.id}
              req={r}
              last={r.id === waiting.at(-1)?.id}
              onDone={requests.reload}
              onApproved={devices.reload}
            />
          ))}
        </Section>
      )}
      <ErrorLine text={requests.error} />
      <Section title="Paired devices">
        <Status rpc={devices} what="devices">
          {list.length === 0 ? (
            <Block last>
              <T style={s.muted}>No devices paired yet.</T>
            </Block>
          ) : (
            list.map((d) => (
              <DeviceRow
                key={d.id}
                device={d}
                last={d.id === list.at(-1)?.id}
                onChange={devices.reload}
              />
            ))
          )}
        </Status>
      </Section>
      <Section title="Roles">
        <Row label="Owner" hint="Everything, including pairing and security" />
        <Row label="Operator" hint="Drive sessions, approve, run terminals" />
        <Row label="Viewer" hint="Read-only" last />
      </Section>
    </>
  );
}

function PairBar() {
  const [role, setRole] = useState<Role>("operator");
  const [code, setCode] = useState<Code | null>(null);
  const act = useAction();
  const create = useCallback(() => {
    void act.run("pair", async () => {
      const res = await createCode(role);
      setCode(res);
      return res;
    });
  }, [act, role]);
  const close = useCallback(() => setCode(null), []);
  return (
    <>
      <Banner
        icon={QrCode}
        title="Pair a device"
        body="One flow for phones, browsers and other computers: a link and 8-character code that carry the same offer."
      >
        <Seg options={INVITE_ROLES} value={role} onChange={setRole} />
        <Button
          kind="primary"
          label={act.pending ? "Creating…" : "Pair a device…"}
          disabled={!!act.pending}
          onPress={create}
        />
      </Banner>
      <ErrorLine text={act.error} />
      {code?.code && (
        <Section title="Pairing code">
          <Block>
            <T style={s.code} selectable>
              {code.code.replace(/(.{4})/, "$1-")}
            </T>
            <T style={s.muted}>
              Enter it on the new device, or open the link there. Grants {code.role ?? "operator"}
              {code.expiresAt ? ` · expires ${new Date(code.expiresAt).toLocaleString()}` : ""}.
            </T>
          </Block>
          {code.endpoints.map((e, i) => (
            <Item
              key={e.deepLink}
              title={`${e.host}:${e.port}`}
              sub={e.deepLink}
              subMono
              last={i === code.endpoints.length - 1}
            />
          ))}
          <Block last>
            <Acts>
              <Button label="Done" onPress={close} />
            </Acts>
          </Block>
        </Section>
      )}
    </>
  );
}

async function createCode(role: Role): Promise<Code> {
  const c = getClient();
  if (!c) throw new Error("Not connected");
  return c.createPairingCode({ role });
}

function PendingRow({
  req,
  last,
  onDone,
  onApproved,
}: {
  req: Pending;
  last: boolean;
  onDone: () => void;
  onApproved: () => void;
}) {
  const [role, setRole] = useState<Role>("operator");
  const act = useAction();
  const decide = useCallback(
    (decision: "approve" | "deny") => {
      void act
        .run(decision, async () => {
          return need().decidePairingRequest({
            pairingRequestId: req.id,
            decision,
            ...(decision === "approve" ? { role } : {}),
          });
        })
        .then((ok) => {
          if (!ok) return false;
          onDone();
          if (decision === "approve") onApproved();
          return true;
        });
    },
    [act, req.id, role, onDone, onApproved],
  );
  const approve = useCallback(() => decide("approve"), [decide]);
  const deny = useCallback(() => decide("deny"), [decide]);
  return (
    <View style={[s.req, !last && s.line]}>
      <ShieldAlert size={15} color={color.amber} strokeWidth={1.8} />
      <View style={s.reqText}>
        <T style={s.bold}>{req.deviceName}</T>
        <T style={s.sub}>
          Match code <T style={s.match}>{req.matchCode}</T>
          {req.remoteAddress ? ` · ${req.remoteAddress}` : ""} · {agoText(req.createdAt)}
        </T>
        <ErrorLine text={act.error} />
      </View>
      <Acts>
        <Seg options={INVITE_ROLES} value={role} onChange={setRole} />
        <Button label="Deny" onPress={deny} disabled={!!act.pending} />
        <Button
          kind="primary"
          label={act.pending === "approve" ? "Approving…" : "Approve"}
          onPress={approve}
          disabled={!!act.pending}
        />
      </Acts>
    </View>
  );
}

function DeviceRow({
  device,
  last,
  onChange,
}: {
  device: Device;
  last: boolean;
  onChange: () => void;
}) {
  const act = useAction();
  const canRoles = useFeature("deviceRoleManagement");
  const [name, setName] = useState<string | null>(null);
  const withClient = useCallback(
    (key: string, fn: (c: DaemonClient) => Promise<unknown>) =>
      act
        .run(key, async () => {
          const c = getClient();
          if (!c) throw new Error("Not connected");
          return fn(c);
        })
        .then((ok) => {
          if (ok) onChange();
          return ok;
        }),
    [act, onChange],
  );
  const setRole = useCallback(
    (role: Role) =>
      void withClient("role", (c) => c.setDeviceRole({ credentialId: device.id, role })),
    [withClient, device.id],
  );
  const revoke = useCallback(
    () => void withClient("revoke", (c) => c.revokeDevice(device.id)),
    [withClient, device.id],
  );
  const startRename = useCallback(() => setName(device.name), [device.name]);
  const cancelRename = useCallback(() => setName(null), []);
  const saveRename = useCallback(() => {
    const next = name?.trim();
    if (!next) return;
    void withClient("rename", (c) => c.renameDevice({ deviceId: device.id, name: next })).then(
      (ok) => ok && setName(null),
    );
  }, [withClient, device.id, name]);
  const Icon = deviceIcon(device);
  return (
    <Item icon={Icon} title={device.name} sub={act.error ?? seenText(device)} last={last}>
      {name !== null ? (
        <>
          <Field value={name} onChangeText={setName} onSubmitEditing={saveRename} autoFocus />
          <Button label="Cancel" onPress={cancelRename} />
          <Button kind="primary" label="Save" onPress={saveRename} disabled={!!act.pending} />
        </>
      ) : (
        <>
          {canRoles ? (
            <Select
              options={ROLE_OPTIONS}
              value={device.role}
              onChange={setRole}
              width={110}
              label="Device role"
            />
          ) : (
            <T v="mono">{device.role}</T>
          )}
          <Button label="Rename" onPress={startRename} />
          {!device.current && (
            <Confirm
              label="Revoke…"
              confirm="Revoke access"
              onConfirm={revoke}
              pending={act.pending === "revoke"}
            />
          )}
        </>
      )}
    </Item>
  );
}

const s = StyleSheet.create({
  muted: { color: color.muted },
  sub: { color: color.faint, fontSize: 12.5, marginTop: 3 },
  bold: { fontWeight: "600" },
  match: { color: color.cyan2, fontFamily: font.mono, fontSize: 12 },
  code: {
    fontFamily: font.mono,
    fontSize: 26,
    letterSpacing: 4,
    color: color.cyan2,
  },
  req: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: "rgba(245,184,74,0.06)",
  },
  reqText: { flex: 1, minWidth: 180 },
  line: { borderBottomWidth: 1, borderBottomColor: color.line },
});
