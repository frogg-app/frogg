import { ArrowLeft } from "lucide-react-native";
import { useState } from "react";
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
  return (
    <View style={{ flex: 1, backgroundColor: color.bg2 }}>
      <View style={s.head}>
        <View style={{ flex: 1, minWidth: 200 }}>
          <T v="label">{compare === "uncommitted" ? "changes · uncommitted" : `changes · vs ${base}`}</T>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
            {onBack && <Pressable onPress={onBack} hitSlop={10} accessibilityLabel="Back"><ArrowLeft size={18} color={color.text} /></Pressable>}
            <T v="display" style={{ fontSize: 19 }} numberOfLines={1}>{path.split("/").pop()}</T>
          </View>
          {file && (
            <T v="mono" style={{ marginTop: 4 }}>
              {path.split("/").slice(0, -1).join("/") || "."} · <T v="mono" style={{ color: color.mint }}>+{file.additions}</T>{" "}
              <T v="mono" style={{ color: color.coral }}>-{file.deletions}</T> · {idx + 1} of {files!.length} files
            </T>
          )}
        </View>
        <Seg options={[["uncommitted", "Uncommitted"], ["base", base ? `vs ${base}` : "vs base"]]} value={compare} onChange={(v) => setCompare(v)} />
        {ff === "desktop" && <Seg options={[["unified", "Unified"], ["split", "Split"]]} value={mode} onChange={setMode} />}
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 40 }}>
        {!file && <T v="label" style={{ padding: 24 }}>{files ? "file not in this diff" : "loading diff…"}</T>}
        {file?.status === "binary" && <T v="label" style={{ padding: 24 }}>binary file</T>}
        {file?.status === "too_large" && <T v="label" style={{ padding: 24 }}>diff too large to show</T>}
        {file?.hunks.map((h, i) => (
          <View key={i}>
            <View style={s.hunk}>
              <T v="mono" style={{ color: color.faint }}>@@ -{h.oldStart},{h.oldCount} +{h.newStart},{h.newCount} @@</T>
            </View>
            {effective === "unified" ? <Unified lines={h.lines.filter((l) => l.type !== "header")} o={h.oldStart} n={h.newStart} /> : <Split lines={h.lines.filter((l) => l.type !== "header")} o={h.oldStart} n={h.newStart} />}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function Seg<V extends string>({ options, value, onChange }: { options: Array<[V, string]>; value: V; onChange: (v: V) => void }) {
  return (
    <View style={s.seg}>
      {options.map(([v, label]) => (
        <Pressable key={v} onPress={() => onChange(v)} style={[s.segI, value === v && s.segOn]}>
          <T style={{ fontSize: 12, color: value === v ? color.text : color.faint }}>{label}</T>
        </Pressable>
      ))}
    </View>
  );
}

const bg = { add: "rgba(63,207,142,0.09)", remove: "rgba(255,107,107,0.10)", context: "transparent", header: "transparent" };
const fg = { add: "#a6ecc8", remove: "#ffb3b3", context: color.text, header: color.faint };

function Code({ line, no }: { line: Line | null; no: number | null }) {
  return (
    <View style={[s.line, { backgroundColor: line ? bg[line.type] : "rgba(255,255,255,0.015)" }]}>
      <T style={s.no}>{no ?? ""}</T>
      <T style={[s.code, { color: line ? fg[line.type] : color.faint }]}>
        {line?.tokens ? <Tokens tokens={line.tokens} /> : line?.content ?? ""}
      </T>
    </View>
  );
}

function Unified({ lines, o, n }: { lines: Line[]; o: number; n: number }) {
  let a = o, b = n;
  return (
    <>
      {lines.map((l, i) => {
        const no = l.type === "remove" ? a++ : l.type === "add" ? b++ : (a++, b++);
        return <Code key={i} line={l} no={no} />;
      })}
    </>
  );
}

/** Pairs each run of removals with the additions that follow it, side by side. */
function Split({ lines, o, n }: { lines: Line[]; o: number; n: number }) {
  const rows: Array<[Line | null, number | null, Line | null, number | null]> = [];
  let a = o, b = n, i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (l.type === "context" || l.type === "header") {
      rows.push([l, a++, l, b++]);
      i++;
      continue;
    }
    const rem: Line[] = [], add: Line[] = [];
    while (lines[i]?.type === "remove") rem.push(lines[i++]);
    while (lines[i]?.type === "add") add.push(lines[i++]);
    for (let k = 0; k < Math.max(rem.length, add.length); k++)
      rows.push([rem[k] ?? null, rem[k] ? a++ : null, add[k] ?? null, add[k] ? b++ : null]);
  }
  return (
    <>
      {rows.map(([l, ln, r, rn], k) => (
        <View key={k} style={{ flexDirection: "row" }}>
          <View style={{ flex: 1, borderRightWidth: 1, borderRightColor: color.line }}><Code line={l} no={ln} /></View>
          <View style={{ flex: 1 }}><Code line={r} no={rn} /></View>
        </View>
      ))}
    </>
  );
}

const s = StyleSheet.create({
  head: { flexDirection: "row", flexWrap: "wrap", alignItems: "flex-end", gap: 10, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: color.line },
  seg: { flexDirection: "row", backgroundColor: color.panel, borderWidth: 1, borderColor: color.line },
  segI: { paddingHorizontal: 10, paddingVertical: 5 },
  segOn: { backgroundColor: "rgba(255,255,255,0.07)" },
  hunk: { paddingHorizontal: 16, paddingVertical: 6, backgroundColor: color.bg, borderTopWidth: 1, borderBottomWidth: 1, borderColor: color.line },
  line: { flexDirection: "row", minHeight: 21 },
  no: { width: 44, textAlign: "right", paddingRight: 10, fontFamily: font.mono, fontSize: 11.5, lineHeight: 21, color: color.faint },
  code: { flex: 1, fontFamily: font.mono, fontSize: 12.5, lineHeight: 21, whiteSpace: "pre-wrap", fontVariantLigatures: "none" } as object,
});
