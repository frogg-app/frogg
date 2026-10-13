import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { color } from "../../theme/tokens";
import { Cut } from "../Cut";
import { T } from "../Text";

/** One chamfered card of the host detail grid. */
export function Card({
  title,
  count,
  children,
}: {
  title: string;
  count?: string;
  children: ReactNode;
}) {
  return (
    <Cut size={10} flip style={s.card}>
      <View style={s.cardHead}>
        <T style={s.strong}>{title}</T>
        {count && <T style={s.faintSmall}>{count}</T>}
      </View>
      {children}
    </Cut>
  );
}

const s = StyleSheet.create({
  card: {
    flexGrow: 1,
    flexBasis: 340,
    padding: 16,
    gap: 12,
    backgroundColor: color.panel,
  },
  cardHead: { flexDirection: "row", alignItems: "baseline", gap: 8 },
  strong: { fontWeight: "600", fontSize: 13.5 },
  faintSmall: { color: color.faint, fontSize: 12 },
});
