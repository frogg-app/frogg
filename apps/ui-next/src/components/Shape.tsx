// Shape language (Settings → Design options): the silhouette and border treatment shared by
// buttons, cards and inputs. `chamfer` is the production default; the rest are the lab's
// alternatives (lab/entries/shapeAlts.tsx) promoted to prop-driven variants.
import type { LucideIcon } from "lucide-react-native";
import { useCallback, useState, type ReactNode } from "react";
import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from "react-native";
import { usePrefs, type ShapeLang } from "../prefs";
import { color, font, web } from "../theme/tokens";
import { Brackets } from "./Brackets";
import { Cut } from "./Cut";
import { T } from "./Text";

export type { ShapeLang };

export function useShape(): ShapeLang {
  return usePrefs((st) => st.shapeLang);
}

/** Per-colour edge styles, built once. */
const edgeCache = new Map<string, { bar: object; barWide: object; line: object; tab: object }>();
function edges(c: string) {
  let e = edgeCache.get(c);
  if (!e) {
    const st = StyleSheet.create({
      bar: { borderLeftWidth: 2, borderLeftColor: c },
      barWide: { borderLeftWidth: 3, borderLeftColor: c },
      line: { borderColor: c.startsWith("#") ? `${c}73` : c },
      tab: { backgroundColor: c },
    });
    e = st;
    edgeCache.set(c, e);
  }
  return e;
}

/**
 * A control or card silhouette. `style` carries the fill (and, for chamfer, any border);
 * `edge` is the kind colour the bar / bracket / tab treatments borrow; `on` is hover or focus.
 */
export function ShapeFace({
  lang,
  style,
  edge = color.line2,
  on,
  cut = 6,
  children,
}: {
  lang?: ShapeLang;
  style?: StyleProp<ViewStyle>;
  edge?: string;
  on?: boolean;
  cut?: number;
  children?: ReactNode;
}) {
  const chosen = useShape();
  const l = lang ?? chosen;
  if (l === "chamfer")
    return (
      <Cut size={cut} style={style}>
        {children}
      </Cut>
    );
  if (l === "tab")
    return (
      <Cut size={cut} flip style={style}>
        {children}
      </Cut>
    );
  if (l === "bar") return <View style={[style, edges(edge).bar]}>{children}</View>;
  if (l === "brackets")
    return (
      <View style={style}>
        <Brackets c={on ? color.cyan2 : edge} len={5} />
        {children}
      </View>
    );
  if (l === "soft") return <View style={[style, f.soft, on && f.softOn]}>{children}</View>;
  return (
    <View style={[style, f.hud, on && f.hudOn]}>
      {on && <Brackets c={color.cyan2} len={4} />}
      {children}
    </View>
  );
}

/** Permission-style card: a kind-tinted frame around a header row and body. */
export function ShapeCard({
  tint,
  title,
  tag,
  meta,
  icon: Icon,
  children,
}: {
  tint: string;
  /** Header text, used by every language except tab and hud, which draw their own. */
  title: string;
  tag: string;
  meta?: string;
  icon: LucideIcon;
  children: ReactNode;
}) {
  const lang = useShape();
  const head = (
    <View style={c.head}>
      <Icon size={13} color={tint} />
      <T style={[c.kind, cardWash(tint).fg]}>{title}</T>
      {meta ? (
        <T v="mono" style={c.name} numberOfLines={1}>
          {meta}
        </T>
      ) : null}
    </View>
  );
  const e = edges(tint);
  const wash = cardWash(tint);
  if (lang === "bar")
    return (
      <View style={[c.card, wash.fill, e.barWide, c.cardBar]}>
        {head}
        {children}
      </View>
    );
  if (lang === "brackets")
    return (
      <View style={[c.card, c.cardBrackets]}>
        <Brackets c={tint} len={10} />
        {head}
        {children}
      </View>
    );
  if (lang === "tab")
    return (
      <View style={c.tabWrap}>
        <Cut size={6} flip style={[c.tab, e.tab]}>
          <Icon size={11} color={color.onAccent} />
          <T v="mono" style={c.tabT}>
            {tag}
          </T>
        </Cut>
        <View style={[c.cardTab, wash.fill, e.line]}>{children}</View>
      </View>
    );
  if (lang === "soft")
    return (
      <View style={[c.card, c.cardSoft]}>
        <View pointerEvents="none" style={c.softInner} />
        <View pointerEvents="none" style={[c.softTop, e.tab]} />
        {head}
        {children}
      </View>
    );
  if (lang === "hud")
    return (
      <View style={[c.hud, wash.dashed]}>
        <Brackets c={tint} len={6} />
        <View style={[c.hudStrip, wash.strip]}>
          <T v="mono" style={[c.hudT, wash.fg]}>
            {`// ${tag}`}
          </T>
          {meta ? (
            <T v="mono" style={c.hudMeta} numberOfLines={1}>
              {meta.toUpperCase()}
            </T>
          ) : null}
        </View>
        <View style={c.hudBody}>{children}</View>
      </View>
    );
  return (
    <Cut size={10} flip style={[c.card, wash.faint, e.line, c.cardChamfer]}>
      {head}
      {children}
    </Cut>
  );
}

const washCache = new Map<
  string,
  { fill: object; faint: object; dashed: object; strip: object; fg: object }
>();
function cardWash(tint: string) {
  let w = washCache.get(tint);
  if (!w) {
    w = StyleSheet.create({
      fill: { backgroundColor: `${tint}0f` },
      faint: { backgroundColor: `${tint}0a` },
      dashed: { borderColor: `${tint}40` },
      strip: { backgroundColor: `${tint}14` },
      fg: { color: tint },
    });
    washCache.set(tint, w);
  }
  return w;
}

/** A bordered text input in the active language; focus lights it like hover lights a button. */
export function ShapeInput(props: TextInputProps) {
  const lang = useShape();
  const [focus, setFocus] = useState(false);
  const { onFocus, onBlur } = props;
  const on = useCallback<NonNullable<TextInputProps["onFocus"]>>(
    (e) => {
      setFocus(true);
      onFocus?.(e);
    },
    [onFocus],
  );
  const off = useCallback<NonNullable<TextInputProps["onBlur"]>>(
    (e) => {
      setFocus(false);
      onBlur?.(e);
    },
    [onBlur],
  );
  const field = (
    <TextInput
      placeholderTextColor={color.faint}
      {...props}
      onFocus={on}
      onBlur={off}
      style={[i.field, lang === "hud" && i.mono, props.style]}
    />
  );
  if (lang === "chamfer" || lang === "tab")
    return (
      <Cut size={6} flip={lang === "tab"} style={[i.chamfer, focus && i.chamferOn]}>
        {field}
      </Cut>
    );
  if (lang === "bar") return <View style={[i.bar, focus && i.barOn]}>{field}</View>;
  if (lang === "brackets")
    return (
      <View style={i.brackets}>
        <Brackets c={focus ? color.cyan2 : color.line2} len={6} />
        {field}
      </View>
    );
  if (lang === "soft") return <View style={[i.soft, focus && i.softOn]}>{field}</View>;
  return (
    <View style={[i.hud, focus && i.hudOn]}>
      <T v="mono" style={[i.prompt, focus && i.promptOn]}>
        {">"}
      </T>
      {field}
    </View>
  );
}

const f = StyleSheet.create({
  soft: { borderRadius: 4, borderWidth: 1, borderColor: color.line2 },
  softOn: { borderColor: color.cyan },
  hud: { borderWidth: 1, borderStyle: "dashed", borderColor: color.line2 },
  hudOn: { borderColor: color.cyan },
});

const c = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  kind: { fontWeight: "600", fontSize: 12.5 },
  name: { marginLeft: "auto", flexShrink: 1 },
  card: { marginTop: 16, padding: 14 },
  cardChamfer: { borderWidth: 1 },
  cardBar: { paddingLeft: 13 },
  cardBrackets: { backgroundColor: color.wash, padding: 16 },
  tabWrap: { marginTop: 16, alignItems: "flex-start" },
  tab: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  tabT: { fontSize: 10.5, color: color.onAccent, fontWeight: "700", letterSpacing: 1 },
  cardTab: { alignSelf: "stretch", borderWidth: 1, padding: 14, paddingTop: 4 },
  cardSoft: {
    borderRadius: 6,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.raise,
    paddingTop: 16,
    overflow: "hidden",
  },
  softInner: {
    ...StyleSheet.absoluteFillObject,
    margin: 1,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: color.wash2,
  },
  softTop: { position: "absolute", left: 0, right: 0, top: 0, height: 2 },
  hud: { marginTop: 16, borderWidth: 1, borderStyle: "dashed", padding: 3 },
  hudStrip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  hudT: { fontSize: 11, letterSpacing: 1.5 },
  hudMeta: { fontSize: 10.5, color: color.muted, marginLeft: "auto", letterSpacing: 1 },
  hudBody: { paddingHorizontal: 11, paddingBottom: 11 },
});

const i = StyleSheet.create({
  field: {
    flex: 1,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13.5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    ...web({ outlineStyle: "none" }),
  },
  mono: { fontFamily: font.mono, fontSize: 12, paddingLeft: 4 },
  chamfer: { marginTop: 12, borderWidth: 1, borderColor: color.line2, backgroundColor: color.bg },
  chamferOn: { borderColor: color.cyan },
  bar: {
    marginTop: 12,
    backgroundColor: color.bg,
    borderLeftWidth: 2,
    borderLeftColor: color.faint,
  },
  barOn: { borderLeftColor: color.cyan, backgroundColor: color.wash },
  brackets: { marginTop: 12, backgroundColor: color.bg },
  soft: {
    marginTop: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: color.line2,
    backgroundColor: color.bg,
  },
  softOn: { borderColor: color.cyan, ...web({ boxShadow: `0 0 0 3px ${color.cyanWash}` }) },
  hud: {
    marginTop: 12,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: color.line2,
    paddingLeft: 8,
  },
  hudOn: { borderBottomColor: color.cyan },
  prompt: { fontSize: 12, color: color.faint },
  promptOn: { color: color.cyan2 },
});
