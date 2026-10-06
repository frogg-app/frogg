import { Plus, SquareTerminal, X } from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { useDaemon } from "../daemon/store";
import {
  killTerminal,
  type TerminalInfo,
  newTerminal,
  useTerminals,
  watchTerminals,
} from "../daemon/terminals";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { Button } from "./Button";
import { GroupHead, PanelHead } from "./PanelHead";
import { useActiveCwd } from "./ScmPanel";
import { Brackets } from "./SessionList";
import { T } from "./Text";
import { useConfirm } from "./tools/Confirm";

export function TerminalsPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((s) => s.conn);
  const { list, error } = useTerminals();
  const [busy, setBusy] = useState(false);
  const { terminalId, openTerminal } = useUi();
  useEffect(() => {
    if (cwd && conn === "online")
      void watchTerminals(cwd).catch((e: unknown) => useTerminals.setState({ error: String(e) }));
  }, [cwd, conn]);
  const create = useCallback(async () => {
    if (busy || !cwd || conn !== "online") return;
    setBusy(true);
    try {
      const id = await newTerminal();
      if (id) openTerminal(id);
    } catch (e) {
      useTerminals.setState({ error: String(e) });
    } finally {
      setBusy(false);
    }
  }, [openTerminal, busy, cwd, conn]);
  const onCreate = useCallback(() => void create(), [create]);
  return (
    <View style={st.fill}>
      <PanelHead title="Terminals">
        <Pressable
          disabled={busy || !cwd || conn !== "online"}
          onPress={onCreate}
          accessibilityLabel="New terminal"
        >
          <Plus size={17} color={color.faint} />
        </Pressable>
      </PanelHead>
      <T v="mono" numberOfLines={1} style={st.cwd}>
        {cwd ? "…/" + cwd.split("/").slice(-2).join("/") : "no checkout"}
      </T>
      <ScrollView style={st.flex}>
        <GroupHead label="Running" count={list?.length} />
        {list?.length === 0 && (
          <View style={st.empty}>
            <T style={st.muted}>No terminals in this checkout yet.</T>
            <Button
              kind="primary"
              label="New terminal"
              kbd="⌃`"
              onPress={onCreate}
              disabled={busy || !cwd || conn !== "online"}
            />
          </View>
        )}
        {list?.map((t) => (
          <TerminalRow key={t.id} t={t} on={t.id === terminalId} onOpen={openTerminal} />
        ))}
        {error && (
          <T v="mono" style={st.error}>
            {error}
          </T>
        )}
      </ScrollView>
    </View>
  );
}

function TerminalRow({
  t,
  on,
  onOpen,
}: {
  t: TerminalInfo;
  on: boolean;
  onOpen: (id: string) => void;
}) {
  const press = useCallback(() => onOpen(t.id), [onOpen, t.id]);
  const confirm = useConfirm();
  const kill = useCallback(
    () =>
      confirm.ask({
        title: `Close ${t.title || t.name}?`,
        body: "This stops the terminal and its running process.",
        action: "Close terminal",
        danger: true,
        run: () => {
          void killTerminal(t.id).catch((e: unknown) =>
            useTerminals.setState({ error: String(e) }),
          );
        },
      }),
    [confirm, t],
  );
  return (
    <View>
      {confirm.dialog}
      <Pressable onPress={press}>
        {({ hovered }) => (
          <View style={[st.row, hovered && st.rowHover, on && st.rowOn]}>
            {on && <Brackets />}
            <SquareTerminal size={15} color={on ? color.cyan2 : color.muted} />
            <View style={st.flex}>
              <T numberOfLines={1}>{t.title || t.name}</T>
              <T v="mono" style={st.name}>
                {t.name}
              </T>
            </View>
            {(hovered || on) && (
              <Pressable onPress={kill} accessibilityLabel="Kill terminal">
                <X size={14} color={color.faint} />
              </Pressable>
            )}
          </View>
        )}
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  cwd: { paddingHorizontal: 14, fontSize: 11 },
  empty: { padding: 16, gap: 12, alignItems: "flex-start" },
  muted: { color: color.muted },
  error: { color: color.coral, padding: 16 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginHorizontal: 8,
    padding: 10,
  },
  rowHover: { backgroundColor: color.wash },
  rowOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  name: { fontSize: 10.5, color: color.faint },
});
