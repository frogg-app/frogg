import { useCallback, useEffect, useState } from "react";
import { StyleSheet, TextInput } from "react-native";
import { removeHost, useHosts } from "../../daemon/hosts";
import { connect, disconnect, useDaemon } from "../../daemon/store";
import { color, font, web } from "../../theme/tokens";
import { Button } from "../Button";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";
import { closeSheet, useHostView, viewHost } from "./state";

/** Forget a saved host. Typing its name confirms; nothing on the host changes. */
export function RemoveHost() {
  const sheet = useHostView((s) => s.sheet);
  const id = sheet?.kind === "remove" ? sheet.hostId : null;
  const host = useHosts((s) => s.hosts.find((h) => h.id === id));
  const active = useHosts((s) => s.activeId === id);
  const sessions = useDaemon((s) => Object.keys(s.sessions).length);
  const [typed, setTyped] = useState("");
  useEffect(() => setTyped(""), [id]);
  const ok = !!host && typed.trim() === host.name;
  const remove = useCallback(() => {
    if (!host || !ok) return;
    removeHost(host.id);
    closeSheet();
    viewHost(null, false);
    if (active) {
      const next = useHosts.getState().hosts[0];
      if (next) void connect(next);
      else void disconnect();
    }
  }, [host, active, ok]);
  const count = active ? `its ${sessions} session${sessions === 1 ? "" : "s"}` : "its sessions";
  return (
    <Dialog
      open={!!host}
      onClose={closeSheet}
      eyebrow="Danger"
      title={`Remove ${host?.name ?? "host"}?`}
      footer={
        <>
          <Button label="Cancel" onPress={closeSheet} />
          <Button kind="danger" label="Remove host" disabled={!ok} onPress={remove} />
        </>
      }
    >
      <T style={s.body}>
        This device forgets the host and {count} disappear from your lists. The daemon on{" "}
        {host?.name} keeps running; nothing on disk changes.
      </T>
      <T v="label">
        Type{" "}
        <T v="label" style={s.name}>
          {host?.name}
        </T>{" "}
        to confirm
      </T>
      <TextInput
        value={typed}
        onChangeText={setTyped}
        style={s.input}
        autoCapitalize="none"
        autoCorrect={false}
        accessibilityLabel="Host name"
      />
    </Dialog>
  );
}

const s = StyleSheet.create({
  body: { color: color.muted, fontSize: 13.5, lineHeight: 20 },
  name: { color: color.cyan2 },
  input: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    color: color.text,
    fontFamily: font.mono,
    fontSize: 12.5,
    ...web({ outlineStyle: "none" }),
  },
});
