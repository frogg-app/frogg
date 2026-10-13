import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { usePrefs } from "../../prefs";
import { color } from "../../theme/tokens";
import { StatusGlyph } from "../StatusGlyph";
import { T } from "../Text";
import type { SubWork } from "./model";
import { SubWorkBody, SubWorkChip } from "./views";

/** Two session rows with fixed sub-work, in the indicator style picked in Design options. */
export function SubWorkPreview() {
  const variant = usePrefs((st) => st.subworkStyle);
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((o) => !o), []);
  const items = useMemo<SubWork[]>(() => {
    const t = Date.now();
    return [
      {
        id: "a",
        kind: "subagent",
        label: "Explore",
        status: "running",
        startedAt: t - 84_000,
        activity: "Grep · evictOldest",
        parentId: "p",
      },
      {
        id: "b",
        kind: "script",
        label: "dev",
        status: "running",
        startedAt: null,
        port: 3000,
        parentId: "p",
      },
      {
        id: "c",
        kind: "subagent",
        label: "ui-next-dev",
        status: "done",
        startedAt: t - 300_000,
        endedAt: t - 120_000,
        parentId: "p",
      },
    ];
  }, []);
  const failed = useMemo<SubWork[]>(
    () => [
      {
        id: "d",
        kind: "terminal",
        label: "npm run e2e",
        status: "failed",
        startedAt: null,
        parentId: "q",
      },
    ],
    [],
  );
  return (
    <View style={s.box}>
      <View style={s.row}>
        <View style={s.top}>
          <StatusGlyph bucket="working" />
          <T numberOfLines={1} style={s.title}>
            Interface redesign (ui-next)
          </T>
          <SubWorkChip items={items} variant={variant} open={open} onToggle={toggle} />
          <T v="mono" style={s.time}>
            3m
          </T>
        </View>
        <SubWorkBody items={items} variant={variant} open={open} />
      </View>
      <View style={s.row}>
        <View style={s.top}>
          <StatusGlyph bucket="idle" />
          <T numberOfLines={1} style={s.title}>
            Docs: pairing guide
          </T>
          <SubWorkChip items={failed} variant={variant} open onToggle={toggle} />
          <T v="mono" style={s.time}>
            1d
          </T>
        </View>
        <SubWorkBody items={failed} variant={variant} open />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  box: { backgroundColor: color.bg2, borderWidth: 1, borderColor: color.line, maxWidth: 360 },
  row: { padding: 10, borderBottomWidth: 1, borderBottomColor: color.line },
  top: { flexDirection: "row", alignItems: "center", gap: 6 },
  title: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  time: { fontSize: 10.5, color: color.faint },
});
