import { Check, Copy } from "lucide-react-native";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Platform, Pressable, StyleSheet, View } from "react-native";
import { alpha, color, font } from "../theme/tokens";
import { HostImage } from "./markdown/HostImage";
import { MdTable } from "./markdown/MdTable";
import {
  classifyLine,
  INLINE,
  inlineToken,
  parseTable,
  safeHref,
  splitImages,
  type Cell,
  type Table,
} from "./markdown/syntax";
import { T } from "./Text";
import { copyText } from "./tools/clipboard";

interface Block {
  kind: "code" | "h" | "li" | "p" | "table" | "img" | "quote" | "hr";
  text: string;
  level?: number;
  /** List items: nesting depth and the marker drawn before it (`•`, `2.`, `☐`, `☑`). */
  depth?: number;
  marker?: string;
  table?: Table;
  src?: string;
  key: string;
}

/** Splits markdown into blocks: the subset agent replies use, shared with the streaming reveal. */
export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = `${i}`;
    const table = parseTable(lines, i);
    const kind = table ? null : classifyLine(line);
    if (table) {
      blocks.push({ kind: "table", text: "", table, key });
      i = table.end - 1;
    } else if (kind?.kind === "fence") {
      const code: string[] = [];
      while (++i < lines.length && classifyLine(lines[i])?.kind !== "fence") code.push(lines[i]);
      blocks.push({ kind: "code", text: code.join("\n"), key });
    } else if (kind?.kind === "hr") {
      blocks.push({ kind: "hr", text: "", key });
    } else if (kind?.kind === "h") {
      blocks.push({ kind: "h", text: line.slice(kind.cut), level: kind.level, key });
    } else if (kind?.kind === "li") {
      blocks.push({
        kind: "li",
        text: line.slice(kind.cut),
        depth: kind.depth,
        marker: kind.marker,
        key,
      });
    } else if (kind?.kind === "quote") {
      const prev = blocks[blocks.length - 1];
      const body = line.slice(kind.cut);
      if (prev?.kind === "quote") prev.text += body.trim() ? ` ${body}` : "\n";
      else blocks.push({ kind: "quote", text: body, key });
    } else if (line.trim()) {
      splitImages(line).forEach((piece, n) => {
        const k = `${key}.${piece.off}`;
        if (piece.kind === "img") {
          blocks.push({ kind: "img", text: piece.alt, src: piece.src, key: k });
          return;
        }
        const prev = blocks[blocks.length - 1];
        if (n === 0 && prev?.kind === "p" && lines[i - 1]?.trim()) prev.text += " " + piece.text;
        else blocks.push({ kind: "p", text: piece.text, key: k });
      });
    }
  }
  return blocks;
}

/**
 * Headings, lists (bulleted, numbered, tasks, nested), quotes, rules, tables, images, fenced code,
 * links and inline code, bold, italic and strikethrough: what agent replies use.
 */
export function Markdown({ text }: { text: string }) {
  const blocks = useMemo(() => parseBlocks(text), [text]);
  return (
    <View style={st.wrap}>
      {blocks.map((b) => (
        <MdBlock key={b.key} b={b} />
      ))}
    </View>
  );
}

function MdBlock({ b }: { b: Block }) {
  if (b.kind === "code") return <CodeFence text={b.text} />;
  if (b.table) return <MdTable table={b.table} cell={tableCell} />;
  if (b.src) return <HostImage src={b.src} alt={b.text} />;
  if (b.kind === "hr") return <View style={st.hr} />;
  if (b.kind === "h")
    return (
      <T v="display" style={[st.h, b.level === 1 && st.h1, (b.level ?? 0) >= 4 && st.h4]}>
        <Inline text={b.text} />
      </T>
    );
  if (b.kind === "quote")
    return (
      <View style={st.quote}>
        <T style={st.quoteText}>
          <Inline text={b.text} />
        </T>
      </View>
    );
  if (b.kind === "li") return <ListItem b={b} />;
  return (
    <T style={st.body}>
      <Inline text={b.text} />
    </T>
  );
}

const indents = [0, 1, 2, 3, 4].map((d) => ({ paddingLeft: 4 + d * 18 }));

/** A list row: bullet diamond, number or task box, indented by its nesting depth. */
export function ListMarker({ marker }: { marker?: string }) {
  if (!marker || marker === "•") return <View style={st.bullet} />;
  const task = marker === "☐" || marker === "☑";
  return (
    <T v="mono" style={[st.ordinal, task && st.task, marker === "☑" && st.taskDone]}>
      {marker}
    </T>
  );
}

function ListItem({ b }: { b: Block }) {
  return (
    <View style={[st.li, indents[b.depth ?? 0]]}>
      <ListMarker marker={b.marker} />
      <T style={st.liText}>
        <Inline text={b.text} />
      </T>
    </View>
  );
}

export const listIndent = (depth: number | undefined) => indents[depth ?? 0];

const tableCell = (c: Cell) => <Inline text={c.text} />;

const openLink = (href: string) => () => {
  void Linking.openURL(href).catch(() => undefined);
};

function Inline({ text }: { text: string }) {
  let offset = 0;
  return text.split(INLINE).map((part) => {
    const key = `${offset}`;
    offset += part.length + 1;
    const tok = inlineToken(part);
    if (tok.kind === "code")
      return (
        <T key={key} style={st.inlineCode}>
          {tok.text}
        </T>
      );
    if (tok.kind === "bold")
      return (
        <T key={key} style={st.bold}>
          {tok.text}
        </T>
      );
    if (tok.kind === "strike")
      return (
        <T key={key} style={st.strike}>
          {tok.text}
        </T>
      );
    if (tok.kind === "italic")
      return (
        <T key={key} style={st.italic}>
          {tok.text}
        </T>
      );
    if (tok.kind === "link") {
      const href = safeHref(tok.href);
      if (!href) return <Fragment key={key}>{tok.text}</Fragment>;
      return (
        <T
          key={key}
          style={st.link}
          onPress={openLink(href)}
          accessibilityRole="link"
          {...linkProps(href)}
        >
          {tok.text}
        </T>
      );
    }
    return <Fragment key={key}>{part}</Fragment>;
  });
}

/** On web a link is a real anchor (new tab, copyable address); native opens it with Linking. */
const linkProps = (href: string) =>
  Platform.OS === "web"
    ? ({ href, hrefAttrs: { target: "_blank", rel: "noreferrer" } } as object)
    : {};

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
    backgroundColor: alpha(color.cyan2, 0.08),
  },
  bold: { fontWeight: "600" },
  italic: { fontStyle: "italic", color: color.muted },
  strike: { textDecorationLine: "line-through", color: color.muted },
  link: { color: color.cyan2, textDecorationLine: "underline" },
  h4: { fontSize: 14 },
  hr: { height: 1, backgroundColor: color.line2, marginVertical: 6 },
  quote: { borderLeftWidth: 2, borderLeftColor: color.line2, paddingLeft: 12 },
  quoteText: { fontSize: 14.5, lineHeight: 22, color: color.muted },
  ordinal: { fontSize: 12.5, lineHeight: 22, color: color.cyan2, minWidth: 18 },
  task: { fontSize: 14, color: color.muted },
  taskDone: { color: color.mint },
});
