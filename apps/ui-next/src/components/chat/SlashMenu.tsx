import { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { color, motion, web } from "../../theme/tokens";
import { Cut } from "../Cut";
import { T } from "../Text";
import type { SlashCommand } from "./actions";

/** Prefix matches first, then substring matches, commands before skills. */
export function matchCommands(all: SlashCommand[], q: string): SlashCommand[] {
  const query = q.toLowerCase();
  const scored = all.flatMap((c) => {
    const n = c.name.toLowerCase();
    if (n.startsWith(query)) return [{ c, rank: 0 }];
    if (n.includes(query) || c.description.toLowerCase().includes(query)) return [{ c, rank: 1 }];
    return [];
  });
  const kindRank = (c: SlashCommand) => (c.kind === "skill" ? 1 : 0);
  return scored
    .sort((a, b) => kindRank(a.c) - kindRank(b.c) || a.rank - b.rank)
    .map((x) => x.c)
    .slice(0, 40);
}

/** The `/` autocomplete above the composer: Commands, then Skills. */
export function SlashMenu({
  commands,
  error = false,
  matches,
  highlight,
  onPick,
}: {
  commands: SlashCommand[] | null;
  error?: boolean;
  matches: SlashCommand[];
  highlight: number;
  onPick: (c: SlashCommand) => void;
}) {
  const groups = useMemo(() => {
    const cmd = matches.filter((c) => c.kind !== "skill");
    const skill = matches.filter((c) => c.kind === "skill");
    return { cmd, skill };
  }, [matches]);
  const hiName = matches[highlight]?.name;
  return (
    <Cut size={8} flip style={s.pop}>
      <ScrollView style={s.scroll} keyboardShouldPersistTaps="always">
        {!commands && (
          <T v="label" style={s.empty}>
            loading commands…
          </T>
        )}
        {commands && matches.length === 0 && (
          <T v="label" style={s.empty}>
            {error ? "Commands unavailable; you can still type a command" : "No matching commands"}
          </T>
        )}
        {groups.cmd.length > 0 && (
          <T v="label" style={s.head}>
            Commands
          </T>
        )}
        {groups.cmd.map((c) => (
          <Row key={`c:${c.name}`} c={c} on={c.name === hiName} onPick={onPick} />
        ))}
        {groups.skill.length > 0 && (
          <T v="label" style={s.head}>
            Skills
          </T>
        )}
        {groups.skill.map((c) => (
          <Row key={`s:${c.name}`} c={c} on={c.name === hiName} onPick={onPick} />
        ))}
      </ScrollView>
    </Cut>
  );
}

function Row({
  c,
  on,
  onPick,
}: {
  c: SlashCommand;
  on: boolean;
  onPick: (c: SlashCommand) => void;
}) {
  const press = useCallback(() => onPick(c), [c, onPick]);
  return (
    <Pressable onPress={press} accessibilityRole="menuitem">
      {({ hovered }) => (
        <View style={[s.row, (on || hovered) && s.rowOn]}>
          <T v="mono" style={s.name}>
            /{c.name}
            {c.argumentHint ? <T style={s.arg}> {c.argumentHint}</T> : null}
          </T>
          {!!c.description && (
            <T style={s.desc} numberOfLines={1}>
              {c.description}
            </T>
          )}
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  pop: {
    position: "absolute",
    left: 0,
    bottom: "100%",
    marginBottom: 6,
    width: 340,
    maxWidth: "100%",
    zIndex: 20,
    backgroundColor: color.raise,
    borderWidth: 1,
    borderColor: color.line2,
    paddingVertical: 4,
    ...motion.enter,
    ...web({ boxShadow: `0 16px 40px ${color.scrim}` }),
  },
  scroll: { maxHeight: 380, flexGrow: 0 },
  head: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 4, fontSize: 9.5 },
  empty: { padding: 14 },
  row: { paddingHorizontal: 10, paddingVertical: 7, marginHorizontal: 4 },
  rowOn: { backgroundColor: `${color.cyan}1a` },
  name: { fontSize: 12.5, color: color.cyan2 },
  arg: { color: color.faint },
  desc: { fontSize: 11.5, color: color.faint, marginTop: 2 },
});
