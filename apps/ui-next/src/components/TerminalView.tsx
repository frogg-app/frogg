import { StyleSheet, View } from "react-native";
import { color } from "../theme/tokens";
import { T } from "./Text";

/** Native terminal rendering lands with the native pass; web uses TerminalView.web.tsx. */
export function TerminalSurface(_: { terminalId: string }) {
  return (
    <View style={st.fill}>
      <T v="label">terminal view is web-only for now</T>
    </View>
  );
}

const st = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.bg,
  },
});
