import { Filter } from "lucide-react-native";
import { Pressable, StyleSheet, View } from "react-native";
import { clearTodoFilters, filterSummary, useTodos } from "../../daemon/todos";
import { color, motion } from "../../theme/tokens";
import { T } from "../Text";

/**
 * Says what the filters are hiding, wherever to-dos are listed: the project and the text match,
 * how many of the host's to-dos are left, and a Clear. Nothing when no filter is set.
 */
export function FilterNote({ inset = 12 }: { inset?: number }) {
  const scope = useTodos((s) => s.scope);
  const query = useTodos((s) => s.query.trim());
  const projectName = useTodos(
    (s) => s.projects?.find((p) => p.projectId === s.scope)?.projectDisplayName ?? "one project",
  );
  const shown = useTodos((s) => filterSummary(s).shown);
  const total = useTodos((s) => filterSummary(s).total);
  if (!scope && !query) return null;
  const why = [scope ? projectName : null, query ? `“${query}”` : null].filter(Boolean).join(" · ");
  return (
    <View style={[s.note, motion.enter, inset === 12 ? s.in12 : s.in24]}>
      <Filter size={12} color={color.cyan2} />
      <T style={s.t} numberOfLines={1}>
        Showing {shown} of {total} · {why}
      </T>
      <Pressable onPress={clearTodoFilters} hitSlop={6} accessibilityRole="button">
        {({ hovered }) => <T style={[s.clear, hovered && s.clearOn]}>Clear filters</T>}
      </Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  note: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: `${color.cyan}0f`,
  },
  in12: { marginHorizontal: 12, marginBottom: 8 },
  in24: { marginTop: 8 },
  t: { flex: 1, fontSize: 12, color: color.muted },
  clear: { fontSize: 12, color: color.muted },
  clearOn: { color: color.text },
});
