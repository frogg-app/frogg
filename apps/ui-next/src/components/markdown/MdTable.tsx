import { useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { color, font } from "../../theme/tokens";
import { T } from "../Text";
import type { Align, Cell, Table } from "./syntax";

const MIN_COL = 56;
const MAX_COL = 300;
const CHAR = 7.4;
const PAD = 24;

/** Column widths from the longest cell, so wrapped rows still line up across columns. */
function widths(t: Table): number[] {
  return t.head.map((h, c) => {
    const longest = Math.max(h.text.length, ...t.rows.map((r) => r[c]?.text.length ?? 0));
    return Math.round(Math.min(MAX_COL, Math.max(MIN_COL, longest * CHAR + PAD)));
  });
}

const alignStyle: Record<Align, object> = {
  left: { textAlign: "left" },
  center: { textAlign: "center" },
  right: { textAlign: "right" },
};

/**
 * A GFM pipe table. Columns size to their content and grow to fill the reply; a table wider
 * than the reply scrolls sideways instead of squeezing. `cell` renders a cell's inline content.
 */
export function MdTable({
  table,
  cell,
}: {
  table: Table;
  cell: (c: Cell, row: number) => ReactNode;
}) {
  const cols = useMemo(
    () => widths(table).map((w) => ({ flexGrow: w, flexBasis: w, flexShrink: 0 })),
    [table],
  );
  const rows = useMemo(
    () => table.rows.map((r, i) => ({ cells: r, key: `r${i}:${r[0]?.off ?? 0}` })),
    [table],
  );
  return (
    <ScrollView horizontal style={s.scroll} contentContainerStyle={s.content}>
      <View style={s.table}>
        <View style={[s.row, s.headRow]}>
          {table.head.map((h, c) => (
            <View key={`h${h.off}`} style={[s.cell, cols[c], c > 0 && s.divider]}>
              <T style={[s.headText, alignStyle[table.align[c]]]}>{cell(h, -1)}</T>
            </View>
          ))}
        </View>
        {rows.map(({ cells, key }, r) => (
          <View key={key} style={[s.row, r % 2 === 1 && s.zebra]}>
            {cells.map((x, c) => (
              <View key={`c${table.head[c].off}`} style={[s.cell, cols[c], c > 0 && s.divider]}>
                <T style={[s.text, alignStyle[table.align[c]]]}>{cell(x, r)}</T>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { flexGrow: 0 },
  content: { minWidth: "100%" },
  table: {
    flexGrow: 1,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg,
  },
  row: {
    flexDirection: "row",
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  headRow: { borderTopWidth: 0, backgroundColor: color.raise },
  zebra: { backgroundColor: color.wash },
  cell: { paddingHorizontal: 12, paddingVertical: 7, justifyContent: "center" },
  divider: { borderLeftWidth: 1, borderLeftColor: color.line },
  headText: {
    fontFamily: font.body,
    fontSize: 12.5,
    lineHeight: 18,
    fontWeight: "600",
    color: color.text,
  },
  text: { fontSize: 13.5, lineHeight: 20, color: color.text },
});
