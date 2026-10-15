// Building blocks shared by the onboarding steps: choice cards, the progress bar, step glyphs.
import { Check, type LucideIcon } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from "react";
import { Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { color, font, glide, web } from "../../theme/tokens";
import { Brackets } from "../Brackets";
import { Num } from "../CountUp";
import { Cut } from "../Cut";
import { useReducedMotion } from "../Meter";
import { T } from "../Text";

/** Progress fill and its count move together on this duration and the glide curve. */
export const FILL_MS = 420;
const curve = Easing.bezier(...glide.curve);

/** Title and lede at the top of a step. */
export function StepHead({ title, lede }: { title: string; lede?: string }) {
  return (
    <View style={s.head}>
      <T v="display" style={s.title}>
        {title}
      </T>
      {lede && <T style={s.lede}>{lede}</T>}
    </View>
  );
}

/** A paragraph of explanation; `faint` for asides. */
export function Para({ children, faint }: { children: ReactNode; faint?: boolean }) {
  return <T style={[s.para, faint && s.faint]}>{children}</T>;
}

/** A command to run on the host, selectable for copying. */
export function Cmd({ children }: { children: string }) {
  return (
    <Cut size={6} style={s.cmd}>
      <T v="mono" style={s.cmdT} selectable>
        {children}
      </T>
    </Cut>
  );
}

/**
 * A selectable card. In a `BracketScope`, the brackets slide from the old pick to the new one,
 * as everywhere else selection shows in the app.
 */
export function Choice<K extends string>({
  id,
  title,
  sub,
  icon: Icon,
  on,
  onPick,
  multi,
  compact,
}: {
  id: K;
  title: string;
  sub?: string;
  icon?: LucideIcon;
  on: boolean;
  onPick: (id: K) => void;
  /** Several can be on: shows a check box instead of relying on the brackets alone. */
  multi?: boolean;
  compact?: boolean;
}) {
  const press = useCallback(() => onPick(id), [id, onPick]);
  const state = useMemo(() => (multi ? { checked: on } : { selected: on }), [multi, on]);
  return (
    <Pressable
      onPress={press}
      accessibilityRole={multi ? "checkbox" : "radio"}
      accessibilityState={state}
      accessibilityLabel={title}
      style={[s.choiceWrap, compact && s.choiceWrapCompact]}
    >
      {({ hovered }) => (
        <Cut
          size={on ? 12 : 8}
          style={[s.choice, compact && s.choiceCompact, hovered && s.choiceHover, on && s.choiceOn]}
        >
          {!multi && <Brackets on={on} />}
          <View style={s.choiceTop}>
            {Icon && <Icon size={16} strokeWidth={1.6} color={on ? color.cyan2 : color.muted} />}
            <T style={[s.choiceTitle, on && s.choiceTitleOn]}>{title}</T>
            {multi && (
              <View style={[s.box, on && s.boxOn]}>
                {on && <Check size={11} strokeWidth={3} color={color.onAccent} />}
              </View>
            )}
          </View>
          {sub && <T style={[s.choiceSub, on && s.choiceSubOn]}>{sub}</T>}
        </Cut>
      )}
    </Pressable>
  );
}

/** A thin bar whose fill glides to `done / total`; the count beside it lerps with the fill. */
export function Progress({ done, total }: { done: number; total: number }) {
  const reduced = useReducedMotion();
  const frac = total ? done / total : 0;
  const v = useRef(new Animated.Value(frac)).current;
  useEffect(() => {
    if (reduced) {
      v.setValue(frac);
      return;
    }
    const a = Animated.timing(v, {
      toValue: frac,
      duration: FILL_MS,
      easing: curve,
      useNativeDriver: false,
    });
    a.start();
    return () => a.stop();
  }, [frac, reduced, v]);
  const fill = useMemo(
    () => [s.fill, { width: v.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] }) }],
    [v],
  );
  const format = useCallback((n: number) => `${Math.round(n)}/${total}`, [total]);
  return (
    <View style={s.progress} accessibilityLabel={`${done} of ${total} steps done`}>
      <View style={s.track}>
        <Animated.View style={fill} />
      </View>
      <Num value={done} format={format} duration={reduced ? 0 : FILL_MS} style={s.count} />
    </View>
  );
}

/** Step state in the list: done (mint check), current (cyan), or still to do (its number). */
export function StepGlyph({ n, done, on }: { n: number; done: boolean; on: boolean }) {
  if (done)
    return (
      <View style={[s.glyph, s.glyphDone]}>
        <Check size={11} strokeWidth={3} color={color.onAccent} />
      </View>
    );
  return (
    <View style={[s.glyph, on && s.glyphOn]}>
      <T v="mono" style={[s.glyphT, on && s.glyphTOn]}>
        {n}
      </T>
    </View>
  );
}

/** A status line: mint when done, amber while waiting, coral on failure. */
export function Status({ tone, children }: { tone: "ok" | "wait" | "bad"; children: ReactNode }) {
  return (
    <View style={s.status}>
      <View style={[s.dot, s[tone]]} />
      <T style={s.statusT}>{children}</T>
    </View>
  );
}

const s = StyleSheet.create({
  head: { marginBottom: 18, gap: 8 },
  title: { fontSize: 22, lineHeight: 28 },
  lede: { color: color.muted, lineHeight: 20, maxWidth: 560 },
  para: { color: color.muted, lineHeight: 20, marginBottom: 10 },
  faint: { color: color.faint, fontSize: 12.5 },
  cmd: {
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 10,
  },
  cmdT: { color: color.cyan2, fontSize: 12 },
  choiceWrap: { flexGrow: 1, flexBasis: 200, ...web({ outlineStyle: "none" }) },
  choiceWrapCompact: { flexBasis: 160 },
  choice: {
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
    padding: 14,
    minHeight: 96,
    gap: 6,
    ...web({ transition: "background-color 160ms ease-out" }),
  },
  choiceCompact: { minHeight: 70, padding: 12 },
  choiceHover: { backgroundColor: color.raise },
  choiceOn: {
    borderColor: "rgba(127,217,230,0.35)",
    backgroundColor: "rgba(37,181,200,0.12)",
    ...web({ backgroundImage: "linear-gradient(135deg, #7fd9e624, #25b5c812)" }),
  },
  choiceTop: { flexDirection: "row", alignItems: "center", gap: 9 },
  choiceTitle: { flex: 1, fontWeight: "600" },
  choiceTitleOn: { color: color.cyan2 },
  choiceSub: { color: color.faint, fontSize: 12.5, lineHeight: 18 },
  choiceSubOn: { color: color.muted },
  box: {
    width: 15,
    height: 15,
    borderWidth: 1,
    borderColor: color.line2,
    alignItems: "center",
    justifyContent: "center",
  },
  boxOn: { backgroundColor: color.cyan2, borderColor: color.cyan2 },
  progress: { flexDirection: "row", alignItems: "center", gap: 10 },
  track: { flex: 1, height: 2, backgroundColor: color.wash3, overflow: "hidden" },
  fill: {
    height: 2,
    backgroundColor: color.cyan2,
    ...web({ backgroundImage: "linear-gradient(90deg, #25b5c8, #7fd9e6)" }),
  },
  count: { fontSize: 11, color: color.muted, minWidth: 28, textAlign: "right" },
  glyph: {
    width: 18,
    height: 18,
    borderWidth: 1,
    borderColor: color.line2,
    alignItems: "center",
    justifyContent: "center",
  },
  glyphOn: { borderColor: color.cyan2 },
  glyphDone: { backgroundColor: color.mint, borderColor: color.mint },
  glyphT: { fontSize: 10, color: color.faint, fontFamily: font.mono },
  glyphTOn: { color: color.cyan2 },
  status: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 },
  dot: { width: 7, height: 7 },
  ok: { backgroundColor: color.mint },
  wait: { backgroundColor: color.amber },
  bad: { backgroundColor: color.coral },
  statusT: { color: color.text, flex: 1 },
});
