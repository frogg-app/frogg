import { GitBranch, GitPullRequest } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import {
  loadBranches,
  stashAndSwitch,
  switchBranch,
  useScmExtra,
  type BranchInfo,
} from "../../daemon/scm";
import { color, font, web } from "../../theme/tokens";
import { T } from "../Text";
import { Popover, type Rect } from "./Menu";

/** The branch switcher under the branch name: filter, recent branches, this branch's PR. */
export function BranchMenu({
  rect,
  onClose,
  current,
  dirty,
}: {
  rect: Rect | null;
  onClose: () => void;
  current: string | null;
  dirty: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const branches = useScmExtra((st) => st.branches);
  const pr = useScmExtra((st) => st.pr);
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => {
    if (!rect) return;
    setPending(null);
    setError(null);
    const t = setTimeout(
      () => void loadBranches(query || undefined).catch((e: unknown) => setError(String(e))),
      120,
    );
    return () => clearTimeout(t);
  }, [rect, query]);
  const list = useMemo(() => {
    const all = [...(branches ?? [])].sort((a, b) => b.committerDate - a.committerDate);
    const mine = all.find((b) => b.name === current);
    const rest = all.filter((b) => b.name !== current);
    return mine ? [mine, ...rest] : rest;
  }, [branches, current]);
  const pick = useCallback(
    (name: string) => {
      if (name === current) return onClose();
      if (dirty) return setPending(name);
      onClose();
      void switchBranch(name);
    },
    [current, dirty, onClose],
  );
  const stashSwitch = useCallback(() => {
    if (!pending) return;
    onClose();
    void stashAndSwitch(pending);
  }, [pending, onClose]);
  return (
    <Popover rect={rect} onClose={onClose} width={320}>
      <View style={s.filterWrap}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Filter branches and PRs"
          placeholderTextColor={color.faint}
          style={s.filter}
          autoFocus
        />
      </View>
      <ScrollView style={s.scroll}>
        <T v="label" style={s.head}>
          Recent
        </T>
        {error && <T style={s.loading}>{error}</T>}
        {branches && list.length === 0 && <T style={s.loading}>No matching branches.</T>}
        {!branches && !error && (
          <T v="mono" style={s.loading}>
            loading branches…
          </T>
        )}
        {list.map((b) => (
          <BranchRow
            key={b.name}
            b={b}
            on={b.name === current}
            picked={b.name === pending}
            onPick={pick}
          />
        ))}
        {pr && (
          <>
            <T v="label" style={s.head}>
              Pull requests
            </T>
            <View style={s.row}>
              <GitPullRequest size={13} color={color.faint} />
              <View style={s.flex}>
                <T numberOfLines={1} style={s.name}>
                  {pr.number ? `#${pr.number} ` : ""}
                  {pr.title}
                </T>
                <T v="mono" style={s.sub}>
                  {pr.state}
                </T>
              </View>
            </View>
          </>
        )}
      </ScrollView>
      {dirty > 0 && (
        <View style={s.warn}>
          <View style={s.diamond} />
          <T style={s.warnText}>
            {pending
              ? `${dirty} uncommitted file${dirty === 1 ? "" : "s"}. Stash them and switch to ${pending}?`
              : `${dirty} uncommitted file${dirty === 1 ? "" : "s"}. Switching will offer`}
          </T>
          <Pressable onPress={stashSwitch} disabled={!pending} accessibilityRole="button">
            <T style={[s.warnAct, !pending && s.warnActIdle]}>Stash & switch</T>
          </Pressable>
        </View>
      )}
    </Popover>
  );
}

function BranchRow({
  b,
  on,
  picked,
  onPick,
}: {
  b: BranchInfo;
  on: boolean;
  picked: boolean;
  onPick: (name: string) => void;
}) {
  const press = useCallback(() => onPick(b.name), [onPick, b.name]);
  return (
    <Pressable onPress={press} accessibilityRole="menuitem">
      {({ hovered }) => (
        <View style={[s.row, (hovered || picked) && s.rowHover, on && s.rowOn]}>
          <GitBranch size={13} color={on ? color.cyan2 : color.faint} />
          <View style={s.flex}>
            <T numberOfLines={1} style={s.name}>
              {b.name}
            </T>
            {on && (
              <T v="mono" style={s.sub}>
                current{b.ahead != null ? ` · ↑${b.ahead}` : ""}
                {b.behind != null ? ` ↓${b.behind}` : ""}
              </T>
            )}
          </View>
        </View>
      )}
    </Pressable>
  );
}

const s = StyleSheet.create({
  filterWrap: { padding: 8, paddingBottom: 4 },
  filter: {
    height: 32,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.panel,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  scroll: { maxHeight: 320 },
  head: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 4, fontSize: 9.5 },
  loading: { paddingHorizontal: 12, paddingVertical: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginHorizontal: 4,
  },
  rowHover: { backgroundColor: "rgba(37,181,200,0.1)" },
  rowOn: { backgroundColor: "rgba(127,217,230,0.08)" },
  flex: { flex: 1 },
  name: { fontSize: 13, color: color.text },
  sub: { fontSize: 10.5, color: color.faint, marginTop: 1 },
  warn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    margin: 6,
    marginTop: 4,
    padding: 10,
    backgroundColor: "rgba(232,179,57,0.07)",
  },
  diamond: { width: 7, height: 7, backgroundColor: color.amber, transform: [{ rotate: "45deg" }] },
  warnText: { flex: 1, fontSize: 12, color: color.muted },
  warnAct: { fontSize: 12, color: color.text, fontWeight: "500" },
  warnActIdle: { color: color.faint },
});
