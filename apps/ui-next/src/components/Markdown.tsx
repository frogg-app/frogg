import { Check, Copy } from "lucide-react-native";
import { Fragment, useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { color, font } from "../theme/tokens";
import { T } from "./Text";
import { copyText } from "./tools/clipboard";

interface Block {
  kind: "code" | "h" | "li" | "p";
  text: string;
  level?: number;
  key: string;
}

/** Headings, bullets, fenced code, inline code and bold: enough for agent replies. */
export function Markdown({ text }: { text: string }) {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = `${i}`;
    if (line.startsWith("```")) {
      const code: string[] = [];
      while (++i < lines.length && !lines[i].startsWith("```")) code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n"), key });
    } else if (/^#{1,4}\s/.test(line)) {
      blocks.push({
        kind: "h",
        text: line.replace(/^#+\s/, ""),
        level: line.indexOf(" "),
        key,
      });
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      blocks.push({
        kind: "li",
        text: line.replace(/^\s*([-*]|\d+\.)\s/, ""),
        key,
      });
    } else if (line.trim()) {
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === "p" && lines[i - 1]?.trim()) prev.text += " " + line;
      else blocks.push({ kind: "p", text: line, key });
    }
  }
  return (
    <View style={st.wrap}>
      {blocks.map((b) => {
        if (b.kind === "code") return <CodeFence key={b.key} text={b.text} />;
        if (b.kind === "h")
          return (
            <T key={b.key} v="display" style={[st.h, b.level === 1 && st.h1]}>
              {b.text}
            </T>
          );
        if (b.kind === "li")
          return (
            <View key={b.key} style={st.li}>
              <View style={st.bullet} />
              <T style={st.liText}>
                <Inline text={b.text} />
              </T>
            </View>
          );
        return (
          <T key={b.key} style={st.body}>
            <Inline text={b.text} />
          </T>
        );
      })}
    </View>
  );
}

function Inline({ text }: { text: string }) {
  let offset = 0;
  return text
    .split(/(`[^`]+`|\*\*[^*]+\*\*|(?<![\w*])[_*][^_*\s][^_*]*[_*](?![\w*]))/g)
    .map((part) => {
      const key = `${offset}`;
      offset += part.length + 1;
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
        return (
          <T key={key} style={st.inlineCode}>
            {part.slice(1, -1)}
          </T>
        );
      if (part.startsWith("**"))
        return (
          <T key={key} style={st.bold}>
            {part.slice(2, -2)}
          </T>
        );
      if (/^[_*].+[_*]$/.test(part))
        return (
          <T key={key} style={st.italic}>
            {part.slice(1, -1)}
          </T>
        );
      return <Fragment key={key}>{part}</Fragment>;
    });
}

const COPIED_MS = 1400;

/** A fenced block with a copy button; the icon turns into a tick while the copy is fresh. */
function CodeFence({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);
  const copy = useCallback(() => {
    void copyText(text).then((ok) => ok && setCopied(true));
  }, [text]);
  return (
    <View style={st.code}>
      <T v="mono" style={st.codeText}>
        {text}
      </T>
      <Pressable
        onPress={copy}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={copied ? "Copied" : "Copy code"}
        style={st.copy}
      >
        {({ hovered }) =>
          copied ? (
            <Check size={13} color={color.mint} />
          ) : (
            <Copy size={13} color={hovered ? color.text : color.faint} />
          )
        }
      </Pressable>
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { gap: 8 },
  code: {
    backgroundColor: color.bg,
    borderLeftWidth: 2,
    borderLeftColor: color.deep,
    padding: 10,
    paddingRight: 34,
  },
  copy: { position: "absolute", top: 8, right: 8, padding: 2 },
  codeText: { color: color.text, fontSize: 12.5, lineHeight: 19 },
  h: { fontSize: 15.5, marginTop: 6 },
  h1: { fontSize: 18 },
  li: { flexDirection: "row", gap: 10, paddingLeft: 4 },
  bullet: {
    width: 5,
    height: 5,
    marginTop: 9,
    backgroundColor: color.cyan,
    transform: [{ rotate: "45deg" }],
  },
  body: { fontSize: 14.5, lineHeight: 22 },
  liText: { fontSize: 14.5, lineHeight: 22, flex: 1 },
  inlineCode: {
    fontFamily: font.mono,
    fontSize: 12.5,
    color: color.cyan2,
    backgroundColor: "rgba(127,217,230,0.08)",
  },
  bold: { fontWeight: "600" },
  italic: { fontStyle: "italic", color: color.muted },
});
