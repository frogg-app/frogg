import { PluginRequestError } from "@frogg/client/internal/daemon-client";
import { Puzzle, Radio } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import {
  describeCapability,
  isRemoteControlCapability,
  wantsRemoteControl,
} from "../../daemon/plugins";
import { getClient } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { Button } from "../Button";
import { Cut } from "../Cut";
import { Pill, Toggle } from "../settings/controls";
import { T } from "../Text";
import { useConfirm } from "./Confirm";
import { PluginPanels } from "./PluginPanels";

type Client = NonNullable<ReturnType<typeof getClient>>;
export type Installed = Awaited<ReturnType<Client["pluginsList"]>>["plugins"][number];
export type Act = (id: string, fn: () => Promise<unknown>) => Promise<void>;

const need = () => {
  const c = getClient();
  if (!c) throw new Error("Host is not connected.");
  return c;
};

/** One installed plugin: enable, granted capabilities, remote control, update, uninstall. */
export function InstalledRow({
  p,
  busy,
  act,
  remoteControlForbidden,
}: {
  p: Installed;
  busy: boolean;
  act: Act;
  remoteControlForbidden: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const confirm = useConfirm();
  const isDev = p.source === "dev" || !!p.devPath;
  const togglePanels = useCallback(() => setExpanded((v) => !v), []);
  const onToggle = useCallback(
    (v: boolean) => void act(p.id, () => need().pluginsSetEnabled(p.id, v)),
    [act, p.id],
  );
  const onRemoteControl = useCallback(
    (v: boolean) => void act(p.id, () => need().pluginsSetRemoteControl(p.id, v)),
    [act, p.id],
  );
  const onUpdate = useCallback(
    () =>
      void act(p.id, async () => {
        try {
          await need().pluginsUpdate({ id: p.id });
        } catch (e) {
          // An update that asks for more than was granted goes back through consent.
          if (!(e instanceof PluginRequestError) || e.code !== "consent_required") throw e;
          const added = e.capabilities ?? [];
          confirm.ask({
            eyebrow: "Plugin permissions",
            title: `Update ${p.name}?`,
            body: `Version ${p.updateAvailable ?? "latest"} asks for more:\n${added.map(capabilityLine(remoteControlForbidden)).join("\n")}`,
            action: "Grant and update",
            run: () =>
              act(p.id, () =>
                need().pluginsUpdate({
                  id: p.id,
                  grantedCapabilities: [...new Set([...p.grantedCapabilities, ...added])],
                }),
              ),
          });
        }
      }),
    [act, confirm, p, remoteControlForbidden],
  );
  const onUninstall = useCallback(
    () =>
      confirm.ask({
        title: `Uninstall ${p.name}?`,
        body: `${p.name} and its stored settings will be removed from this host.`,
        action: "Uninstall",
        danger: true,
        run: () => act(p.id, () => need().pluginsUninstall(p.id)),
      }),
    [act, confirm, p.id, p.name],
  );
  const onUnlink = useCallback(
    () => void act(p.id, () => need().pluginsDevUnlink(p.id)),
    [act, p.id],
  );
  return (
    <Cut size={10} flip style={s.card}>
      {confirm.dialog}
      <View style={s.headRow}>
        <Puzzle size={15} color={p.enabled ? color.violet : color.faint} />
        <T style={s.name}>{p.name}</T>
        <Toggle value={p.enabled} disabled={busy} onChange={onToggle} />
      </View>
      {p.description && <T style={s.desc}>{p.description}</T>}
      <View style={s.pills}>
        <T v="mono" style={s.mono}>
          v{p.version}
        </T>
        {p.apiVersion > 1 && <Pill text={`api v${p.apiVersion}`} tint={color.cyan2} />}
        {isDev && <Pill text="dev link" tint={color.amber} />}
        {p.preinstalled && <Pill text="built in" />}
        {p.updateAvailable && <Pill text={`update ${p.updateAvailable}`} tint={color.cyan2} />}
        {p.status !== "active" && p.status !== "ok" && (
          <Pill text={p.status} tint={p.error ? color.coral : color.muted} />
        )}
      </View>
      {p.grantedCapabilities.length > 0 && (
        <View style={s.caps}>
          {p.grantedCapabilities.map((c) => (
            <Capability key={c} id={c} live={!isRemoteControlCapability(c) || !!p.remoteControl} />
          ))}
        </View>
      )}
      {wantsRemoteControl(p) && (
        <View style={s.remote}>
          <View style={s.headRow}>
            <Radio size={14} color={p.remoteControl ? color.amber : color.faint} />
            <T style={s.name}>Remote control</T>
            <Toggle
              value={p.remoteControl === true}
              disabled={busy || remoteControlForbidden}
              onChange={onRemoteControl}
            />
          </View>
          <T style={s.hint}>
            {remoteControlForbidden
              ? "Remote control is turned off for this build."
              : "Lets this plugin start agents, answer permission requests, change to-dos and send messages for people outside Frogg. Only turn it on if you trust everyone the plugin lets in."}
          </T>
        </View>
      )}
      <View style={s.actions}>
        <Button
          label={expanded ? "Close panels" : "Open panels"}
          onPress={togglePanels}
          disabled={!p.enabled}
        />
        {p.updateAvailable && !isDev && (
          <Button label="Update" kind="primary" onPress={onUpdate} disabled={busy} />
        )}
        {isDev && <Button label="Unlink" onPress={onUnlink} disabled={busy} />}
        {!isDev && !p.preinstalled && (
          <Button label="Uninstall…" onPress={onUninstall} disabled={busy} />
        )}
      </View>
      {expanded && <PluginPanels pluginId={p.id} />}
      {p.error && (
        <T v="mono" style={s.error}>
          {p.error}
        </T>
      )}
    </Cut>
  );
}

/** A consent line: the capability, flagged when it only works with remote control on. */
export const capabilityLine =
  (forbidden: boolean) =>
  (c: string): string => {
    if (!isRemoteControlCapability(c)) return `· ${describeCapability(c)}`;
    const note = forbidden
      ? "remote control is off for this build"
      : "off until you turn on remote control";
    return `· ${describeCapability(c)} (${note})`;
  };

/** A granted capability; remote-control ones dim while remote control is off. */
function Capability({ id, live }: { id: string; live: boolean }) {
  const remote = isRemoteControlCapability(id);
  return (
    <View style={s.cap}>
      <View style={[s.dot, remote && s.dotRemote, !live && s.dotOff]} />
      <T style={[s.capText, !live && s.capOff]}>{describeCapability(id)}</T>
    </View>
  );
}

const s = StyleSheet.create({
  card: { backgroundColor: color.panel, padding: 14, gap: 8 },
  headRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  name: { flex: 1, fontWeight: "600" },
  desc: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  mono: { fontSize: 10.5 },
  caps: { gap: 3 },
  cap: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 5, height: 5, backgroundColor: color.violet },
  dotRemote: { backgroundColor: color.amber },
  dotOff: { opacity: 0.35 },
  capText: { color: color.muted, fontSize: 12 },
  capOff: { color: color.faint },
  remote: {
    gap: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: color.line2,
  },
  hint: { color: color.faint, fontSize: 11.5, lineHeight: 16 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  error: { color: color.coral, fontSize: 11 },
});
