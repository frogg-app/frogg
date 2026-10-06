import { ArrowLeft } from "lucide-react-native";
import { useCallback, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { setCompare, useScm, type DiffFile } from "../daemon/scm";
import { useFormFactor } from "../theme/layout";
import { color, font } from "../theme/tokens";
import { Tokens } from "./Code";
import { T } from "./Text";

type Line = DiffFile["hunks"][number]["lines"][number];
type Mode = "unified" | "split";

export function DiffView({ path, onBack }: { path: string; onBack?: () => void }) {
  const { files, compare, status } = useScm();
  const ff = useFormFactor();
  const [mode, setMode] = useState<Mode>("split");
  const file = files?.find((f) => f.path === path);
  const idx = files?.findIndex((f) => f.path === path) ?? -1;
  const effective: Mode = ff === "desktop" ? mode : "unified";
  const base = status?.isGit ? status.baseRef : null;
  const compareOptions = useMemo<Array<["uncommitted" | "base", string]>>(
    () => [
      ["uncommitted", "Uncommitted"],
      ["base", base ? `vs ${base}` : "vs base"],
    ],
    [base],
  );
  return (
    <View style={s.root}>
      <View style={s.head}>
        <View style={s.title}>
          <T v="label">
            {compare === "uncommitted" ? "changes · uncommitted" : `changes · vs ${base}`}
          </T>
          <View style={s.titleRow}>
            {onBack && (
              <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back">
                <ArrowLeft size={18} color={color.text} />
              </Pressable>
            )}
            <T v="display" style={s.name} numberOfLines={1}>
              {path.split("/").pop()}
            </T>
          </View>
          {file && (
            <T v="mono" style={s.meta}>
              {path.split("/").slice(0, -1).join("/") || "."} ·{" "}
              <T v="mono" style={s.plus}>
                +{file.additions}
              </T>{" "}
              <T v="mono" style={s.minus}>
                -{file.deletions}
              </T>{" "}
              · {idx + 1} of {files!.length} files
            </T>
          )}
        </View>
        <Seg options={compareOptions} value={compare} onChange={setCompare} />
        {ff === "desktop" && <Seg options={MODE_OPTIONS} value={mode} onChange={setMode} />}
      </View>
      <ScrollView style={s.fill} contentContainerStyle={s.scroll}>
        {!file && (
          <T v="label" style={s.note}>
            {files ? "file not in this diff" : "loading diff…"}
          </T>
        )}
        {file?.status === "binary" && (
          <T v="label" style={s.note}>
            binary file
          </T>
        )}
        {file?.status === "too_large" && (
          <T v="label" style={s.note}>
            diff too large to show
          </T>
        )}
        {file?.hunks.map((h) => (
          <Hunk
            key={`${h.oldStart},${h.oldCount},${h.newStart},${h.newCount}`}
            hunk={h}
            mode={effective}
          />
        ))}
      </ScrollView>
    </View>
  );
}

const MODE_OPTIONS: Array<[Mode, string]> = [
  ["unified", "Unified"],
  ["split", "Split"],
];

type Hunk = DiffFile["hunks"][number];

function Hunk({ hunk: h, mode }: { hunk: Hunk; mode: Mode }) {
  const lines = useMemo(() => h.lines.filter((l) => l.type !== "header"), [h.lines]);
  return (
    <View>
      <View style={s.hunk}>
        <T v="mono" style={s.faint}>
          @@ -{h.oldStart},{h.oldCount} +{h.newStart},{h.newCount} @@
        </T>
      </View>
      {mode === "unified" ? (
        <Unified lines={lines} o={h.oldStart} n={h.newStart} />
      ) : (
        <Split lines={lines} o={h.oldStart} n={h.newStart} />
      )}
    </View>
  );
}

function Seg<V extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<[V, string]>;
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <View style={s.seg}>
      {options.map(([v, label]) => (
        <SegItem key={v} v={v} label={label} on={value === v} onChange={onChange} />
      ))}
    </View>
  );
}

function SegItem<V extends string>({
  v,
  label,
  on,
  onChange,
}: {
  v: V;
  label: string;
  on: boolean;
  onChange: (v: V) => void;
}) {
  const press = useCallback(() => onChange(v), [onChange, v]);
  return (
    <Pressable onPress={press} style={[s.segI, on && s.segOn]}>
      <T style={[s.segT, on && s.segTOn]}>{label}</T>
    </Pressable>
  );
}

const bg = {
  add: "rgba(63,207,142,0.09)",
  remove: "rgba(255,107,107,0.10)",
  context: "transparent",
  header: "transparent",
};
const fg = {
  add: "#a6ecc8",
  remove: "#ffb3b3",
  context: color.text,
  header: color.faint,
};

const lineBg = StyleSheet.create({
  add: { backgroundColor: bg.add },
  remove: { backgroundColor: bg.remove },
  context: { backgroundColor: bg.context },
  header: { backgroundColor: bg.header },
  empty: { backgroundColor: "rgba(255,255,255,0.015)" },
});
const lineFg = StyleSheet.create({
  add: { color: fg.add },
  remove: { color: fg.remove },
  context: { color: fg.context },
  header: { color: fg.header },
  empty: { color: color.faint },
});

function Code({ line, no }: { line: Line | null; no: number | null }) {
  const kind = line ? line.type : "empty";
  return (
    <View style={[s.line, lineBg[kind]]}>
      <T style={s.no}>{no ?? ""}</T>
      <T style={[s.code, lineFg[kind]]}>
        {line?.tokens ? <Tokens tokens={line.tokens} /> : (line?.content ?? "")}
      </T>
    </View>
  );
}

function Unified({ lines, o, n }: { lines: Line[]; o: number; n: number }) {
  let a = o,
    b = n;
  return (
    <>
      {lines.map((l) => {
        // Removals key on the old line number, everything else on the new one; both counters are unique per side.
        let no: number;
        let key: string;
        if (l.type === "remove") {
          no = a++;
          key = `o${no}`;
        } else if (l.type === "add") {
          no = b++;
          key = `n${no}`;
        } else {
          a++;
          no = b++;
          key = `n${no}`;
        }
        return <Code key={key} line={l} no={no} />;
      })}
    </>
  );
}

/** Pairs each run of removals with the additions that follow it, side by side. */
function Split({ lines, o, n }: { lines: Line[]; o: number; n: number }) {
  const rows: Array<[Line | null, number | null, Line | null, number | null]> = [];
  let a = o,
    b = n,
    i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.type === "context" || l.type === "header") {
      rows.push([l, a++, l, b++]);
      i++;
      continue;
    }
    const rem: Line[] = [],
      add: Line[] = [];
    while (lines[i]?.type === "remove") rem.push(lines[i++]);
    while (lines[i]?.type === "add") add.push(lines[i++]);
    for (let k = 0; k < Math.max(rem.length, add.length); k++)
      rows.push([rem[k] ?? null, rem[k] ? a++ : null, add[k] ?? null, add[k] ? b++ : null]);
  }
  return (
    <>
      {rows.map(([l, ln, r, rn]) => (
        <View key={`${ln ?? "-"}:${rn ?? "-"}`} style={s.splitRow}>
          <View style={s.splitLeft}>
            <Code line={l} no={ln} />
          </View>
          <View style={s.fill}>
            <Code line={r} no={rn} />
          </View>
        </View>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  fill: { flex: 1 },
  title: { flex: 1, minWidth: 200 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  name: { fontSize: 19 },
  meta: { marginTop: 4 },
  plus: { color: color.mint },
  minus: { color: color.coral },
  faint: { color: color.faint },
  scroll: { paddingBottom: 40 },
  note: { padding: 24 },
  segT: { fontSize: 12, color: color.faint },
  segTOn: { color: color.text },
  splitRow: { flexDirection: "row" },
  splitLeft: { flex: 1, borderRightWidth: 1, borderRightColor: color.line },
  head: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 10,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  seg: {
    flexDirection: "row",
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
  },
  segI: { paddingHorizontal: 10, paddingVertical: 5 },
  segOn: { backgroundColor: "rgba(255,255,255,0.07)" },
  hunk: {
    paddingHorizontal: 16,
    paddingVertical: 6,
    backgroundColor: color.bg,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: color.line,
  },
  line: { flexDirection: "row", minHeight: 21 },
  no: {
    width: 44,
    textAlign: "right",
    paddingRight: 10,
    fontFamily: font.mono,
    fontSize: 11.5,
    lineHeight: 21,
    color: color.faint,
  },
  code: {
    flex: 1,
    fontFamily: font.mono,
    fontSize: 12.5,
    lineHeight: 21,
    whiteSpace: "pre-wrap",
    fontVariantLigatures: "none",
  } as object,
});
