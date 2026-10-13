import { highlightCode } from "@frogg/highlight";
import { useMemo } from "react";
import { ScrollView, StyleSheet, View, type TextStyle } from "react-native";
import { color, font, syntax } from "../theme/tokens";
import { T } from "./Text";

interface Token {
  text: string;
  style: string | null;
}

const tokenStyles: Record<string, TextStyle> = StyleSheet.create(
  Object.fromEntries(
    Object.entries(syntax).map(([k, c]) => [k, { color: c, fontFamily: font.mono }]),
  ),
);

/** Keys a line's tokens by position once, so renders reuse them. */
function keyed(tokens: Token[]): Array<Token & { id: string }> {
  return tokens.map((t, n) => ({ ...t, id: `t${n}` }));
}

export function Tokens({
  tokens,
  fallback = null,
}: {
  tokens: Token[] | undefined;
  fallback?: string | null;
}) {
  const list = useMemo(() => (tokens ? keyed(tokens) : null), [tokens]);
  if (!list) return fallback;
  return (
    <>
      {list.map((t) => (
        <T key={t.id} style={t.style ? tokenStyles[t.style] : s.plain}>
          {t.text}
        </T>
      ))}
    </>
  );
}

/** A whole file, highlighted by its extension, with a line gutter. */
export function CodeBlock({ code, filename }: { code: string; filename: string }) {
  const lines = useMemo(() => {
    let tokens: Token[][];
    try {
      tokens = highlightCode(code, filename);
    } catch {
      tokens = code.split("\n").map((text) => [{ text, style: null }]);
    }
    return tokens.map((t, n) => ({ id: `L${n + 1}`, no: n + 1, tokens: t }));
  }, [code, filename]);
  return (
    <ScrollView horizontal contentContainerStyle={s.scroll}>
      <View style={s.lines}>
        {lines.map((line) => (
          <View key={line.id} style={s.line}>
            <T style={s.no}>{line.no}</T>
            <T style={s.code}>
              <Tokens tokens={line.tokens} />
            </T>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  scroll: { minWidth: "100%" },
  lines: { paddingVertical: 10, minWidth: "100%" },
  plain: { fontFamily: font.mono },
  line: { flexDirection: "row", minHeight: 20 },
  no: {
    width: 52,
    textAlign: "right",
    paddingRight: 14,
    fontFamily: font.mono,
    fontSize: 11.5,
    lineHeight: 20,
    color: color.faint,
  },
  code: {
    fontFamily: font.mono,
    fontSize: 12.5,
    lineHeight: 20,
    color: color.text,
    whiteSpace: "pre",
    fontVariantLigatures: "none",
    paddingRight: 24,
  } as TextStyle,
});
