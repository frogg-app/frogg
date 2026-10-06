import { Plus, SquareTerminal, X } from "lucide-react-native";
import { useEffect } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useDaemon } from "../daemon/store";
import { killTerminal, newTerminal, useTerminals, watchTerminals } from "../daemon/terminals";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { Button } from "./Button";
import { GroupHead, PanelHead } from "./PanelHead";
import { useActiveCwd } from "./ScmPanel";
import { Brackets } from "./SessionList";
import { T } from "./Text";

export function TerminalsPanel() {
  const cwd = useActiveCwd();
  const conn = useDaemon((s) => s.conn);
  const { list, error } = useTerminals();
  const { terminalId, openTerminal } = useUi();
  useEffect(() => {
    if (cwd && conn === "online") void watchTerminals(cwd);
  }, [cwd, conn]);
  const create = async () => {
    const id = await newTerminal();
    if (id) openTerminal(id);
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <PanelHead title="Terminals">
        <Pressable onPress={() => void create()} accessibilityLabel="New terminal"><Plus size={17} color={color.faint} /></Pressable>
      </PanelHead>
      <T v="mono" numberOfLines={1} style={{ paddingHorizontal: 14, fontSize: 11 }}>{cwd ? "…/" + cwd.split("/").slice(-2).join("/") : "no checkout"}</T>
      <ScrollView style={{ flex: 1 }}>
        <GroupHead label="Running" count={list?.length} />
        {list?.length === 0 && (
          <View style={{ padding: 16, gap: 12, alignItems: "flex-start" }}>
            <T style={{ color: color.muted }}>No terminals in this checkout yet.</T>
            <Button kind="primary" label="New terminal" kbd="⌃`" onPress={() => void create()} />
          </View>
        )}
        {list?.map((t) => {
          const on = t.id === terminalId;
          return (
            <Pressable key={t.id} onPress={() => openTerminal(t.id)}>
              {({ hovered }) => (
                <View style={[{ flexDirection: "row", alignItems: "center", gap: 10, marginHorizontal: 8, padding: 10 }, hovered && { backgroundColor: color.wash }, on && { backgroundColor: "rgba(127,217,230,0.05)" }]}>
                  {on && <Brackets />}
                  <SquareTerminal size={15} color={on ? color.cyan2 : color.muted} />
                  <View style={{ flex: 1 }}>
                    <T numberOfLines={1}>{t.title || t.name}</T>
                    <T v="mono" style={{ fontSize: 10.5, color: color.faint }}>{t.name}</T>
                  </View>
                  {hovered && (
                    <Pressable onPress={() => void killTerminal(t.id)} accessibilityLabel="Kill terminal"><X size={14} color={color.faint} /></Pressable>
                  )}
                </View>
              )}
            </Pressable>
          );
        })}
        {error && <T v="mono" style={{ color: color.coral, padding: 16 }}>{error}</T>}
      </ScrollView>
    </View>
  );
}
