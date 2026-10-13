import { StyleSheet, View } from "react-native";
import { color, motion } from "../../theme/tokens";
import type { Tool } from "../../ui-store";
import { TOOLS } from "../Rail";
import { T } from "../Text";

const HINT: Partial<Record<Tool, string>> = {
  files: "Pick a file to open it here.",
  scm: "Pick a changed file to see its diff.",
  terminals: "Open a terminal, or start a new one.",
  prs: "Pick a CI run to see its jobs.",
  inbox: "Pick a notification to read it here.",
};

/** The main pane for a tool with nothing open: the chat stays in Sessions. */
export function ToolEmpty({ tool }: { tool: Tool }) {
  const meta = TOOLS.find((t) => t.id === tool);
  const Icon = meta?.icon;
  return (
    <View style={[s.root, motion.enter]}>
      {Icon && <Icon size={22} color={color.faint} strokeWidth={1.4} />}
      <T v="label">{meta?.label ?? tool}</T>
      <T style={s.hint}>{HINT[tool] ?? "Nothing open."}</T>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: color.bg,
  },
  hint: { color: color.faint, fontSize: 12.5 },
});
