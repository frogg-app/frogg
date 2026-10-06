import type { ToolCallTimelineItem } from "@frogg/protocol/agent-types";
import {
  Bot, Check, ChevronRight, FilePen, FilePlus, FileText, Globe, ListChecks, Search, SquareTerminal, Wrench, X,
  type LucideIcon,
} from "lucide-react-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { anim, color, font, frames, motion, web } from "../theme/tokens";
import { CodeBlock } from "./Code";
import { Markdown } from "./Markdown";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

type Detail = ToolCallTimelineItem["detail"];

const short = (p: string) => p.split("/").slice(-2).join("/");

/** Icon, verb and the one-line argument shown on the collapsed row. */
function summary(name: string, d: Detail): { icon: LucideIcon; verb: string; arg: string; meta?: string } {
  switch (d.type) {
    case "shell":
      return { icon: SquareTerminal, verb: "Run", arg: d.command, meta: d.exitCode != null && d.exitCode !== 0 ? `exit ${d.exitCode}` : undefined };
    case "read":
      return { icon: FileText, verb: "Read", arg: short(d.filePath), meta: d.limit ? `${d.limit} lines` : undefined };
    case "edit": {
      const diff = d.unifiedDiff ?? "";
      const add = diff.split("\n").filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
      const del = diff.split("\n").filter((l) => l.startsWith("-") && !l.startsWith("---")).length;
      return { icon: FilePen, verb: "Edit", arg: short(d.filePath), meta: diff ? `+${add} -${del}` : undefined };
    }
    case "write":
      return { icon: FilePlus, verb: "Write", arg: short(d.filePath) };
    case "search":
      return {
        icon: Search,
        verb: d.toolName === "web_search" ? "Web search" : d.toolName === "glob" ? "Glob" : "Grep",
        arg: `"${d.query}"`,
        meta: d.numMatches != null ? `${d.numMatches} hits` : d.numFiles != null ? `${d.numFiles} files` : undefined,
      };
    case "fetch":
      return { icon: Globe, verb: "Fetch", arg: d.url, meta: d.code ? String(d.code) : undefined };
    case "sub_agent":
      return { icon: Bot, verb: d.subAgentType ?? "Subagent", arg: d.description ?? "", meta: d.actions ? `${d.actions.length} steps` : undefined };
    case "plan":
      return { icon: ListChecks, verb: "Plan", arg: d.text.split("\n")[0] ?? "" };
    case "plain_text":
      return { icon: Wrench, verb: d.label ?? name, arg: d.text?.split("\n")[0] ?? "" };
    case "worktree_setup":
      return { icon: SquareTerminal, verb: "Set up worktree", arg: d.branchName, meta: `${d.commands.length} commands` };
    default:
      return { icon: Wrench, verb: name, arg: "" };
  }
}

function Body({ d }: { d: Detail }) {
  switch (d.type) {
    case "shell":
      return d.output ? <Pre text={d.output} /> : null;
    case "read":
      return d.content ? <CodeBlock code={d.content} filename={d.filePath} /> : null;
    case "write":
      return d.content ? <CodeBlock code={d.content} filename={d.filePath} /> : null;
    case "edit":
      return d.unifiedDiff ? <DiffText text={d.unifiedDiff} /> : d.newString ? <CodeBlock code={d.newString} filename={d.filePath} /> : null;
    case "search":
      return d.content ? <Pre text={d.content} /> : d.filePaths?.length ? <Pre text={d.filePaths.join("\n")} /> : null;
    case "fetch":
      return d.result ? <View style={{ padding: 12 }}><Markdown text={d.result.slice(0, 4000)} /></View> : null;
    case "plan":
      return <View style={{ padding: 12 }}><Markdown text={d.text} /></View>;
    case "sub_agent":
      return d.log ? <Pre text={d.log} /> : null;
    case "plain_text":
      return d.text ? <Pre text={d.text} /> : null;
    case "worktree_setup":
      return <Pre text={d.log} />;
    case "unknown":
      return <Pre text={JSON.stringify({ input: d.input, output: d.output }, null, 2)} />;
    default:
      return null;
  }
}

function Pre({ text }: { text: string }) {
  return (
    <ScrollView horizontal>
      <T style={s.pre}>{text.length > 12000 ? `${text.slice(0, 12000)}\n…` : text}</T>
    </ScrollView>
  );
}

function DiffText({ text }: { text: string }) {
  return (
    <View style={{ paddingVertical: 6 }}>
      {text.split("\n").filter((l) => !l.startsWith("+++") && !l.startsWith("---")).map((l, i) => {
        const add = l.startsWith("+");
        const del = l.startsWith("-");
        const hunk = l.startsWith("@@");
        return (
          <T key={i} style={[s.diffLine, add && s.add, del && s.del, hunk && { color: color.faint }]}>{l || " "}</T>
        );
      })}
    </View>
  );
}

export function ToolCall({ item }: { item: ToolCallTimelineItem }) {
  const [open, setOpen] = useState(false);
  const { icon: Icon, verb, arg, meta } = summary(item.name, item.detail);
  const failed = item.status === "failed";
  return (
    <View style={[s.box, failed && s.failed]}>
      {item.status === "running" && (
        <View pointerEvents="none" style={s.beamTrack}>
          <View style={s.beam} />
        </View>
      )}
      <Pressable onPress={() => setOpen(!open)}>
        {({ hovered }) => (
          <View style={[s.row, hovered && { backgroundColor: color.wash }]}>
            <Icon size={14} color={failed ? color.coral : color.muted} />
            <T style={{ color: color.cyan2, fontFamily: font.mono, fontSize: 12.5 }}>{verb}</T>
            <T numberOfLines={1} style={{ flex: 1, fontFamily: font.mono, fontSize: 12.5, color: color.text }}>{arg}</T>
            {meta && <T v="mono" style={{ fontSize: 11 }}>{meta}</T>}
            {item.status === "completed" && <Check size={13} color={color.mint} />}
            {failed && <X size={13} color={color.coral} />}
            {item.status === "running" && <StatusGlyph bucket="working" size={7} />}
            <ChevronRight size={13} color={color.faint} style={{ transform: [{ rotate: open ? "90deg" : "0deg" }] }} />
          </View>
        )}
      </Pressable>
      {open && (
        <View style={s.body}>
          {failed && !!item.error && <T v="mono" style={{ color: color.coral, padding: 10 }}>{String(item.error)}</T>}
          <Body d={item.detail} />
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  box: { marginTop: 8, backgroundColor: color.panel, borderWidth: 1, borderColor: color.line, overflow: "hidden", ...motion.enter },
  failed: { borderColor: "rgba(255,107,107,0.35)", borderLeftWidth: 2, borderLeftColor: color.coral },
  beamTrack: { position: "absolute", top: 0, left: 0, right: 0, height: 1, overflow: "hidden" },
  beam: {
    width: "25%", height: 1, backgroundColor: color.cyan2,
    ...web({ backgroundImage: "linear-gradient(90deg, transparent, #7fd9e6, transparent)" }),
    ...anim(frames.beam, "1.4s", "cubic-bezier(0.77,0,0.175,1)", "infinite", "none"),
  },
  row: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  body: { borderTopWidth: 1, borderTopColor: color.line, backgroundColor: color.bg, maxHeight: 420, overflow: "hidden" },
  pre: { fontFamily: font.mono, fontSize: 12, lineHeight: 18, color: color.muted, padding: 12, whiteSpace: "pre" } as object,
  diffLine: { fontFamily: font.mono, fontSize: 12, lineHeight: 19, color: color.muted, paddingHorizontal: 12, whiteSpace: "pre" } as object,
  add: { backgroundColor: "rgba(63,207,142,0.09)", color: "#a6ecc8" },
  del: { backgroundColor: "rgba(255,107,107,0.10)", color: "#ffb3b3" },
});
