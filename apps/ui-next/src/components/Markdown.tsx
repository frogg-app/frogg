import { Fragment } from "react";
import { View } from "react-native";
import { color, font } from "../theme/tokens";
import { T } from "./Text";

const body = { fontSize: 14.5, lineHeight: 22 };

/** Headings, bullets, fenced code, inline code and bold: enough for agent replies. */
export function Markdown({ text }: { text: string }) {
  const blocks: Array<{ kind: "code" | "h" | "li" | "p"; text: string; level?: number }> = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push({ kind: "h", text: line.replace(/^#+\s/, ""), level: line.indexOf(" ") });
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      blocks.push({ kind: "li", text: line.replace(/^\s*([-*]|\d+\.)\s/, "") });
    } else if (line.trim()) {
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === "p" && lines[i - 1]?.trim()) prev.text += " " + line;
      else blocks.push({ kind: "p", text: line });
    }
  }
  return (
    <View style={{ gap: 8 }}>
      {blocks.map((b, i) => {
        if (b.kind === "code")
          return (
            <View key={i} style={{ backgroundColor: color.bg, borderLeftWidth: 2, borderLeftColor: color.deep, padding: 10 }}>
              <T v="mono" style={{ color: color.text, fontSize: 12.5, lineHeight: 19 }}>{b.text}</T>
            </View>
          );
        if (b.kind === "h")
          return <T key={i} v="display" style={{ fontSize: b.level === 1 ? 18 : 15.5, marginTop: 6 }}>{b.text}</T>;
        if (b.kind === "li")
          return (
            <View key={i} style={{ flexDirection: "row", gap: 10, paddingLeft: 4 }}>
              <View style={{ width: 5, height: 5, marginTop: 9, backgroundColor: color.cyan, transform: [{ rotate: "45deg" }] }} />
              <T style={[body, { flex: 1 }]}><Inline text={b.text} /></T>
            </View>
          );
        return <T key={i} style={body}><Inline text={b.text} /></T>;
      })}
    </View>
  );
}

function Inline({ text }: { text: string }) {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
      return (
        <T key={i} style={{ fontFamily: font.mono, fontSize: 12.5, color: color.cyan2, backgroundColor: "rgba(127,217,230,0.08)" }}>
          {part.slice(1, -1)}
        </T>
      );
    if (part.startsWith("**")) return <T key={i} style={{ fontWeight: "600" }}>{part.slice(2, -2)}</T>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
