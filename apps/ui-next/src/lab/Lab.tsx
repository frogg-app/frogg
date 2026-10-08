// The component lab page: an index of every reusable component and interaction, each rendered
// live on fixtures. `/lab?c=<id>` opens one entry directly.
import { router, useLocalSearchParams } from "expo-router";
import { ArrowLeft, RotateCcw, Search } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Button } from "../components/Button";
import { Logo } from "../components/Logo";
import { Brackets, BracketScope } from "../components/Brackets";
import { Seg } from "../components/settings/controls";
import { T } from "../components/Text";
import { ToastHost } from "../components/toast/ToastHost";
import { bp, color, font, web } from "../theme/tokens";
import { seedLab } from "./client";
import { Specimen, type Entry } from "./kit";
import { announce, BY_ID, ENTRIES, GROUPS } from "./registry";
import { useSlowMotion } from "./slowmo";
import { bumpNonce, setSpeed, useLab, type Speed } from "./store";

const SPEEDS: Array<[Speed, string]> = [
  ["1", "1×"],
  ["0.5", "0.5×"],
  ["0.25", "0.25×"],
];

function prepare(entry: Entry | undefined): void {
  seedLab();
  entry?.setup?.();
}

const pick = (id: string) => router.setParams({ c: id });
const home = () => router.setParams({ c: "" });

export function Lab() {
  const { c } = useLocalSearchParams<{ c?: string }>();
  const entry = c ? BY_ID.get(c) : undefined;
  const wide = useWindowDimensions().width >= bp.tablet;
  const speed = useLab((st) => st.speed);
  const nonce = useLab((st) => st.nonce);
  useSlowMotion(Number(speed));
  // Fixtures reseed before every entry; specimens mount only once that's done. Replay reseeds
  // synchronously and remounts the specimens in place, so the pane keeps its scroll position.
  const key = entry?.id ?? "";
  const [prepared, setPrepared] = useState<string | null>(null);
  useEffect(() => {
    prepare(entry);
    setPrepared(key);
  }, [key, entry]);
  const ready = prepared === key;
  useEffect(() => {
    announce(ready ? key || "(index)" : null);
  }, [ready, key]);
  const replay = useCallback(() => {
    prepare(entry);
    bumpNonce();
  }, [entry]);
  return (
    <SafeAreaView style={s.root}>
      <Header speed={speed} replay={replay} />
      <View style={s.body}>
        {(wide || !entry) && <Index current={entry?.id} wide={wide} />}
        {entry && ready && <EntryView entry={entry} nonce={nonce} back={!wide} />}
        {!entry && wide && <Overview />}
      </View>
      {ready && !entry?.ownToasts && <ToastHost />}
    </SafeAreaView>
  );
}

function Header({ speed, replay }: { speed: Speed; replay: () => void }) {
  return (
    <View style={s.header}>
      <Pressable onPress={home} style={s.brand} accessibilityLabel="Lab overview">
        <Logo size={20} />
        <T v="display" style={s.brandT}>
          Component lab
        </T>
        <T v="mono" style={s.brandSub}>
          ui-next · fixtures
        </T>
      </Pressable>
      <View style={s.spacer} />
      <Seg options={SPEEDS} value={speed} onChange={setSpeed} />
      <Button label="Replay all" icon={RotateCcw} onPress={replay} />
    </View>
  );
}

function Index({ current, wide }: { current?: string; wide: boolean }) {
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        entries: g.entries.filter((e) =>
          `${e.name} ${e.path} ${e.purpose} ${e.id}`.toLowerCase().includes(needle),
        ),
      })).filter((g) => g.entries.length),
    [needle],
  );
  const pending = useMemo(
    () => groups.flatMap((g) => g.entries).filter((e) => e.decision),
    [groups],
  );
  return (
    <View style={wide ? s.index : s.indexFull}>
      <View style={s.search}>
        <Search size={13} color={color.faint} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={`Filter ${ENTRIES.length} entries`}
          placeholderTextColor={color.faint}
          style={s.searchIn}
        />
      </View>
      <BracketScope>
        <ScrollView contentContainerStyle={s.indexBody}>
          {pending.length > 0 && (
            <View style={s.decideGroup}>
              <View style={s.groupHead}>
                <T v="label" style={s.amber}>
                  Needs decision
                </T>
                <T v="mono" style={s.groupNAmber}>
                  {pending.length}
                </T>
              </View>
              {pending.map((e) => (
                <IndexRow key={e.id} entry={e} on={e.id === current} />
              ))}
            </View>
          )}
          {groups.map((g) => (
            <View key={g.category}>
              <View style={s.groupHead}>
                <T v="label">{g.category}</T>
                <View style={s.groupCounts}>
                  <DecideCount entries={g.entries} />
                  <T v="mono" style={s.groupN}>
                    {g.entries.length}
                  </T>
                </View>
              </View>
              {g.entries.map((e) => (
                <IndexRow key={e.id} entry={e} on={e.id === current} />
              ))}
            </View>
          ))}
          {!groups.length && <T style={s.none}>Nothing matches.</T>}
        </ScrollView>
      </BracketScope>
    </View>
  );
}

function IndexRow({ entry, on }: { entry: Entry; on: boolean }) {
  const press = useCallback(() => pick(entry.id), [entry.id]);
  return (
    <Pressable onPress={press} accessibilityRole="link" accessibilityLabel={entry.name}>
      {({ hovered }) => (
        <View style={[s.row, hovered && s.rowHover, on && s.rowOn]}>
          <Brackets len={6} on={on} />
          <View style={s.rowTop}>
            <T style={s.rowNameFlex} numberOfLines={1}>
              {entry.name}
            </T>
            {entry.decision && <DecideChip />}
          </View>
          <T v="mono" style={s.rowPath} numberOfLines={1}>
            {entry.path}
          </T>
        </View>
      )}
    </Pressable>
  );
}

function EntryView({ entry, nonce, back }: { entry: Entry; nonce: number; back: boolean }) {
  const used =
    entry.usedBy === undefined
      ? null
      : `used by ${entry.usedBy} file${entry.usedBy === 1 ? "" : "s"}`;
  return (
    <ScrollView style={s.main} contentContainerStyle={s.mainBody}>
      {back && (
        <Pressable onPress={home} style={s.back} accessibilityLabel="All components">
          <ArrowLeft size={16} color={color.text} />
          <T style={s.backT}>All components</T>
        </Pressable>
      )}
      <T v="label" style={s.eyebrow}>
        {entry.category}
      </T>
      <T v="display" style={s.title}>
        {entry.name}
      </T>
      <T v="mono" style={s.path}>
        src/{entry.path}
      </T>
      <T style={s.purpose}>{entry.purpose}</T>
      <View style={s.metaRow}>
        <T v="mono" style={s.meta}>
          ?c={entry.id}
        </T>
        {used && (
          <T v="mono" style={s.meta}>
            {used}
          </T>
        )}
        <T v="mono" style={s.meta}>
          {entry.variants.length} variant{entry.variants.length === 1 ? "" : "s"}
        </T>
      </View>
      {entry.decision && (
        <View style={s.decide}>
          <View style={s.decideHead}>
            <DecideChip />
            <T v="label" style={s.amber}>
              Decision needed
            </T>
          </View>
          <T style={s.decideQ}>{entry.decision}</T>
          <T v="mono" style={s.decideHint}>
            Reply with ?c={entry.id} and your pick.
          </T>
        </View>
      )}
      <View style={s.polish}>
        <T v="label" style={s.polishL}>
          polish notes
        </T>
        <T v="mono" style={s.polishT}>
          {entry.polish}
        </T>
      </View>
      <View style={s.specs}>
        {entry.variants.map((v) => (
          <Specimen key={`${entry.id}:${v.id}:${nonce}`} v={v} />
        ))}
      </View>
    </ScrollView>
  );
}

function Overview() {
  const interactions = ENTRIES.filter((e) => e.category === "Interactions").length;
  const variants = ENTRIES.reduce((n, e) => n + e.variants.length, 0);
  return (
    <ScrollView style={s.main} contentContainerStyle={s.mainBody}>
      <T v="label" style={s.eyebrow}>
        overview
      </T>
      <T v="display" style={s.title}>
        Every component, live
      </T>
      <T style={s.purpose}>
        {ENTRIES.length - interactions} components and {interactions} interactions, {variants}{" "}
        variants, all running on fixtures with no host. Pick one on the left, or link to it with
        ?c=id. Replay remounts the open entry from fresh fixtures; the speed control slows every
        animation and transition on the page.
      </T>
      {DECISIONS.length > 0 && (
        <View style={s.ovGroup}>
          <T v="label" style={s.amber}>
            Needs decision · {DECISIONS.length}
          </T>
          <View style={s.ovGrid}>
            {DECISIONS.map((e) => (
              <OverviewCard key={e.id} entry={e} />
            ))}
          </View>
        </View>
      )}
      {GROUPS.map((g) => (
        <View key={g.category} style={s.ovGroup}>
          <T v="label">{g.category}</T>
          <View style={s.ovGrid}>
            {g.entries.map((e) => (
              <OverviewCard key={e.id} entry={e} />
            ))}
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

function OverviewCard({ entry }: { entry: Entry }) {
  const press = useCallback(() => pick(entry.id), [entry.id]);
  return (
    <Pressable onPress={press} style={s.ovCardWrap}>
      {({ hovered }) => (
        <View style={[s.ovCard, hovered && s.rowHover, !!entry.decision && s.ovCardDecide]}>
          <View style={s.rowTop}>
            <T style={s.rowNameFlex}>{entry.name}</T>
            {entry.decision && <DecideChip />}
          </View>
          <T style={s.ovPurpose} numberOfLines={2}>
            {entry.decision ?? entry.purpose}
          </T>
        </View>
      )}
    </Pressable>
  );
}

const DECISIONS = ENTRIES.filter((e) => e.decision);

/** Amber marker for an entry awaiting the user's call. */
function DecideChip() {
  return (
    <View style={s.chip}>
      <T v="mono" style={s.chipT}>
        DECIDE
      </T>
    </View>
  );
}

/** Amber dot + count of open decisions in a category header; nothing when there are none. */
function DecideCount({ entries }: { entries: Entry[] }) {
  const n = entries.filter((e) => e.decision).length;
  if (!n) return null;
  return (
    <View style={s.dotRow}>
      <View style={s.dot} />
      <T v="mono" style={s.groupNAmber}>
        {n}
      </T>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    backgroundColor: color.bg,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: 8 },
  brandT: { fontSize: 15 },
  brandSub: { fontSize: 10.5, color: color.faint },
  spacer: { flex: 1 },
  body: { flex: 1, flexDirection: "row" },
  index: {
    width: 280,
    borderRightWidth: 1,
    borderRightColor: color.line,
    backgroundColor: color.bg2,
  },
  indexFull: { flex: 1, backgroundColor: color.bg2 },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    margin: 12,
    marginBottom: 4,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.panel,
  },
  searchIn: {
    flex: 1,
    paddingVertical: 7,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  indexBody: { paddingBottom: 24 },
  groupHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  groupN: { color: color.faint, fontSize: 10.5 },
  groupNAmber: { color: color.amber, fontSize: 10.5 },
  groupCounts: { flexDirection: "row", alignItems: "center", gap: 10 },
  dotRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: color.amber },
  amber: { color: color.amber },
  decideGroup: {
    borderBottomWidth: 1,
    borderBottomColor: color.line,
    paddingBottom: 8,
    backgroundColor: "rgba(245,184,74,0.04)",
  },
  rowTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  rowNameFlex: { flex: 1, fontSize: 13, fontWeight: "500" },
  chip: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: 1,
    borderColor: color.amber,
    backgroundColor: "rgba(245,184,74,0.12)",
  },
  chipT: { fontSize: 9, letterSpacing: 0.8, color: color.amber, fontWeight: "700" },
  decide: {
    marginTop: 10,
    borderLeftWidth: 3,
    borderLeftColor: color.amber,
    borderWidth: 1,
    borderColor: "rgba(245,184,74,0.35)",
    backgroundColor: "rgba(245,184,74,0.08)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    gap: 6,
  },
  decideHead: { flexDirection: "row", alignItems: "center", gap: 8 },
  decideQ: { fontSize: 14, lineHeight: 21, color: color.text, maxWidth: 820 },
  decideHint: { fontSize: 10.5, color: color.faint },
  ovCardDecide: { borderColor: "rgba(245,184,74,0.45)" },
  none: { color: color.faint, textAlign: "center", marginTop: 24 },
  row: { marginHorizontal: 8, paddingHorizontal: 8, paddingVertical: 7, gap: 2 },
  rowHover: { backgroundColor: color.wash },
  rowOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  rowName: { fontSize: 13, fontWeight: "500" },
  rowPath: { fontSize: 10, color: color.faint },
  main: { flex: 1 },
  mainBody: { padding: 20, paddingBottom: 60, gap: 6, maxWidth: 1240, width: "100%" },
  back: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 10 },
  backT: { fontSize: 13 },
  eyebrow: { color: color.cyan2 },
  title: { fontSize: 22 },
  path: { fontSize: 11 },
  purpose: { color: color.muted, lineHeight: 20, maxWidth: 760, marginTop: 4 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, marginTop: 4 },
  meta: { fontSize: 10.5, color: color.faint },
  polish: {
    marginTop: 10,
    borderLeftWidth: 2,
    borderLeftColor: color.violet,
    backgroundColor: color.wash,
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 4,
  },
  polishL: { color: color.violet },
  polishT: { fontSize: 11, lineHeight: 17, color: color.muted },
  specs: { gap: 26, marginTop: 18 },
  ovGroup: { marginTop: 22, gap: 10 },
  ovGrid: { flexDirection: "row", flexWrap: "wrap", gap: 10 },
  ovCardWrap: { width: 260 },
  ovCard: {
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.bg2,
    padding: 12,
    gap: 4,
    minHeight: 78,
  },
  ovPurpose: { fontSize: 12, color: color.faint, lineHeight: 17 },
});
