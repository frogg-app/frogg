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
import { Brackets } from "../components/SessionList";
import { Seg } from "../components/settings/controls";
import { T } from "../components/Text";
import { ToastHost } from "../components/toast/ToastHost";
import { bp, color, font, web } from "../theme/tokens";
import { seedLab } from "./client";
import { Specimen, type Entry } from "./kit";
import { BY_ID, ENTRIES, GROUPS } from "./registry";
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
  // Fixtures reseed before every entry and every replay; specimens mount only once that's done.
  const key = `${entry?.id ?? ""}:${nonce}`;
  const [prepared, setPrepared] = useState<string | null>(null);
  useEffect(() => {
    prepare(entry);
    setPrepared(key);
  }, [key, entry]);
  const ready = prepared === key;
  return (
    <SafeAreaView style={s.root}>
      <Header speed={speed} />
      <View style={s.body}>
        {(wide || !entry) && <Index current={entry?.id} wide={wide} />}
        {entry && ready && <EntryView entry={entry} nonce={nonce} back={!wide} />}
        {!entry && wide && <Overview />}
      </View>
      {ready && !entry?.ownToasts && <ToastHost />}
    </SafeAreaView>
  );
}

function Header({ speed }: { speed: Speed }) {
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
      <Button label="Replay" icon={RotateCcw} onPress={bumpNonce} />
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
      <ScrollView contentContainerStyle={s.indexBody}>
        {groups.map((g) => (
          <View key={g.category}>
            <View style={s.groupHead}>
              <T v="label">{g.category}</T>
              <T v="mono" style={s.groupN}>
                {g.entries.length}
              </T>
            </View>
            {g.entries.map((e) => (
              <IndexRow key={e.id} entry={e} on={e.id === current} />
            ))}
          </View>
        ))}
        {!groups.length && <T style={s.none}>Nothing matches.</T>}
      </ScrollView>
    </View>
  );
}

function IndexRow({ entry, on }: { entry: Entry; on: boolean }) {
  const press = useCallback(() => pick(entry.id), [entry.id]);
  return (
    <Pressable onPress={press} accessibilityRole="link" accessibilityLabel={entry.name}>
      {({ hovered }) => (
        <View style={[s.row, hovered && s.rowHover, on && s.rowOn]}>
          {on && <Brackets len={6} />}
          <T style={s.rowName} numberOfLines={1}>
            {entry.name}
          </T>
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
        <View style={[s.ovCard, hovered && s.rowHover]}>
          <T style={s.rowName}>{entry.name}</T>
          <T style={s.ovPurpose} numberOfLines={2}>
            {entry.purpose}
          </T>
        </View>
      )}
    </Pressable>
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
