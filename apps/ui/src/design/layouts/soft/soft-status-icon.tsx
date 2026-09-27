import { Check, CircleAlert, LoaderCircle, MessageCircleQuestion, Sparkles } from "lucide-react-native";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { mixColor } from "@/styles/color-mix";
import { themeOf } from "@/styles/design-theme";
import type { Theme } from "@/styles/theme";
import type { SoftStatus } from "./soft-data";

const ThemedLoader = withUnistyles(LoaderCircle);
const ThemedQuestion = withUnistyles(MessageCircleQuestion);
const ThemedAlert = withUnistyles(CircleAlert);
const ThemedSparkles = withUnistyles(Sparkles);
const ThemedCheck = withUnistyles(Check);

const accentMapping = (theme: Theme) => ({ color: theme.colors.accent });
const warningMapping = (theme: Theme) => ({ color: theme.colors.statusDotWarning });
const dangerMapping = (theme: Theme) => ({ color: theme.colors.statusDotDanger });
const onAccentMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * A round, tinted status badge in the Perplexity/ChatGPT iOS idiom: the colour says how urgent,
 * the glyph says what kind. A finished-but-unseen chat is the one solid (accent) badge.
 */
export function SoftStatusIcon({ status, size = 32 }: { status: SoftStatus; size?: number }) {
  const glyph = Math.round(size * 0.5);
  return (
    <View style={badgeStyle(status, size)}>
      {status === "running" ? <ThemedLoader size={glyph} uniProps={accentMapping} /> : null}
      {status === "needs_input" ? <ThemedQuestion size={glyph} uniProps={warningMapping} /> : null}
      {status === "failed" ? <ThemedAlert size={glyph} uniProps={dangerMapping} /> : null}
      {status === "attention" ? <ThemedSparkles size={glyph} uniProps={onAccentMapping} /> : null}
      {status === "done" ? <ThemedCheck size={glyph} uniProps={mutedMapping} /> : null}
    </View>
  );
}

function badgeStyle(status: SoftStatus, size: number) {
  return [styles.badge, styles[status], size === 32 ? null : sizeStyles(size)];
}

const sizeCache = new Map<number, { width: number; height: number }>();
function sizeStyles(size: number) {
  let cached = sizeCache.get(size);
  if (!cached) {
    cached = { width: size, height: size };
    sizeCache.set(size, cached);
  }
  return cached;
}

type RealTheme = ReturnType<typeof themeOf>;

/** A solid wash of a status colour over the page, computed on the real theme (web CSS vars). */
function tint(themeName: string | undefined, pick: (real: RealTheme) => string, amount: number) {
  const real = themeOf(themeName);
  return mixColor(real.colors.surface0, pick(real), amount);
}

const styles = StyleSheet.create((theme, rt) => ({
  badge: {
    width: 32,
    height: 32,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  running: { backgroundColor: tint(rt.themeName, (t) => t.colors.accent, 0.14) },
  needs_input: { backgroundColor: tint(rt.themeName, (t) => t.colors.statusDotWarning, 0.16) },
  failed: { backgroundColor: tint(rt.themeName, (t) => t.colors.statusDotDanger, 0.14) },
  attention: { backgroundColor: theme.colors.accent },
  done: { backgroundColor: theme.colors.surface2 },
}));
