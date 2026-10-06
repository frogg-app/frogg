import { highlightCode } from "@frogg/highlight";
import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { color, font, syntax } from "../theme/tokens";
import { T } from "./Text";

export function Tokens({ tokens, fallback }: { tokens: Array<{ text: string; style: string | null }> | undefined; fallback?: string }) {
  if (!tokens) return <>{fallback}</>;
  return (
    <>
      {tokens.map((t, i) => (
        <T key={i} style={t.style ? { color: syntax[t.style], fontFamily: font.mono } : { fontFamily: font.mono }}>{t.text}</T>
      ))}
    </>
  );
}

/** A whole file, highlighted by its extension, with a line gutter. */
export function CodeBlock({ code, filename }: { code: string; filename: string }) {
  const lines = useMemo(() => {
    try {
      return highlightCode(code, filename);
    } catch {
      return code.split("\n").map((text) => [{ text, style: null }]);
    }
  }, [code, filename]);
  return (
    <ScrollView horizontal contentContainerStyle={{ minWidth: "100%" }}>
      <View style={{ paddingVertical: 10, minWidth: "100%" }}>
        {lines.map((tokens, i) => (
          <View key={i} style={s.line}>
            <T style={s.no}>{i + 1}</T>
            <T style={s.code}><Tokens tokens={tokens} /></T>
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  line: { flexDirection: "row", minHeight: 20 },
  no: { width: 52, textAlign: "right", paddingRight: 14, fontFamily: font.mono, fontSize: 11.5, lineHeight: 20, color: color.faint },
  code: { fontFamily: font.mono, fontSize: 12.5, lineHeight: 20, color: color.text, whiteSpace: "pre", fontVariantLigatures: "none", paddingRight: 24 } as object,
});
