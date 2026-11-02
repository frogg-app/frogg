// Settings → Appearance: a VS Code style theme picker plus per-token colour overrides.
// Stylesheets read the tokens when they load, so a change is staged here and applied by a reload.
import { Check, RotateCcw } from "lucide-react-native";
import { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { readStoredTheme, reloadForTheme, writeStoredTheme } from "../../../theme/stored";
import {
  HEX_COLOR,
  OVERRIDABLE,
  resolveTheme,
  THEMES,
  type ColorKey,
  type ThemeChoice,
  type ThemeDef,
} from "../../../theme/themes";
import { activeTheme, alpha, color, font, web } from "../../../theme/tokens";
import { Button } from "../../Button";
import { T } from "../../Text";
import { Note, Row, Section, TextField } from "../controls";

const TOKEN_HINT: Record<string, string> = {
  bg: "App background",
  bg2: "Sidebars and the rail",
  panel: "Panels and cards",
  raise: "Raised surfaces, inputs",
  text: "Primary text",
  muted: "Secondary text",
  faint: "Hints, placeholders",
  cyan: "Accent",
  cyan2: "Accent, light (links, focus)",
  deep: "Accent, deep (gradients)",
  mint: "Success, running",
  violet: "Secondary accent",
  amber: "Warning, needs you",
  coral: "Danger, failed",
  onAccent: "Text on accent fills",
};

function initialChoice(): ThemeChoice {
  const saved = readStoredTheme();
  return { id: activeTheme.def.id, overrides: { ...saved?.overrides } };
}

function sameChoice(a: ThemeChoice, b: ThemeChoice): boolean {
  if (a.id !== b.id) return false;
  const ka = Object.keys(a.overrides);
  const kb = Object.keys(b.overrides);
  return (
    ka.length === kb.length &&
    ka.every((k) => a.overrides[k as ColorKey] === b.overrides[k as ColorKey])
  );
}

export function ThemeSettings() {
  const [applied] = useState(initialChoice);
  const [draft, setDraft] = useState(applied);
  const dirty = !sameChoice(draft, applied);
  const preview = useMemo(() => resolveTheme(draft).color, [draft]);

  const pick = useCallback((id: string) => setDraft((d) => ({ ...d, id })), []);
  const setToken = useCallback((key: ColorKey, value: string | null) => {
    setDraft((d) => {
      const overrides = { ...d.overrides };
      if (value === null) delete overrides[key];
      else overrides[key] = value;
      return { ...d, overrides };
    });
  }, []);
  const apply = useCallback(() => {
    writeStoredTheme(draft);
    reloadForTheme();
  }, [draft]);
  const discard = useCallback(() => setDraft(applied), [applied]);
  const resetAll = useCallback(() => setDraft((d) => ({ ...d, overrides: {} })), []);
  const overrideCount = Object.keys(draft.overrides).length;

  return (
    <>
      <Section title="Theme">
        <View style={s.cards}>
          {THEMES.map((t) => (
            <ThemeCard
              key={t.id}
              theme={t}
              on={draft.id === t.id}
              current={applied.id === t.id}
              onPick={pick}
            />
          ))}
        </View>
      </Section>
      <Section title="Colour overrides">
        {OVERRIDABLE.map((key, i) => (
          <TokenRow
            key={key}
            tokenKey={key}
            value={preview[key]}
            overridden={key in draft.overrides}
            onSet={setToken}
            last={i === OVERRIDABLE.length - 1}
          />
        ))}
      </Section>
      <Note>
        Overrides take a #rrggbb colour and sit on top of whichever theme is active; washes and
        hover tints follow the token they come from.
        {overrideCount > 0 ? ` ${overrideCount} set.` : ""}
      </Note>
      <View style={s.acts}>
        {overrideCount > 0 && <Button label="Reset overrides" onPress={resetAll} />}
        {dirty && <Button label="Discard" onPress={discard} />}
        <Button
          kind="primary"
          label={dirty ? "Apply and reload" : "Applied"}
          disabled={!dirty}
          onPress={apply}
        />
      </View>
    </>
  );
}

const ThemeCard = memo(function ThemeCard({
  theme,
  on,
  current,
  onPick,
}: {
  theme: ThemeDef;
  on: boolean;
  current: boolean;
  onPick: (id: string) => void;
}) {
  const press = useCallback(() => onPick(theme.id), [onPick, theme.id]);
  const { color: p, syntax } = useMemo(() => resolveTheme({ id: theme.id }), [theme.id]);
  const state = useMemo(() => ({ selected: on }), [on]);
  const cardStyle = useCallback(
    ({ hovered }: { hovered?: boolean }) => [s.card, hovered && s.cardHover, on && s.cardOn],
    [on],
  );
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={state}
      accessibilityLabel={`${theme.label} theme`}
      onPress={press}
      style={cardStyle}
      testID={`theme-card-${theme.id}`}
    >
      <View style={[s.mini, { backgroundColor: p.bg, borderColor: p.line }]}>
        <View style={[s.miniRail, { backgroundColor: p.bg2, borderRightColor: p.line }]}>
          <View style={[s.miniDot, { backgroundColor: p.cyan }]} />
          <View style={[s.miniDot, { backgroundColor: p.faint }]} />
          <View style={[s.miniDot, { backgroundColor: p.faint }]} />
        </View>
        <View style={s.miniBody}>
          <View style={[s.miniLine, { backgroundColor: p.text, width: "70%" }]} />
          <View style={[s.miniLine, { backgroundColor: p.muted, width: "90%" }]} />
          <View style={[s.miniPanel, { backgroundColor: p.panel, borderColor: p.line }]}>
            <View style={[s.miniLine, { backgroundColor: syntax.keyword ?? p.violet }]} />
            <View style={[s.miniLine, { backgroundColor: p.mint, width: "50%" }]} />
          </View>
          <View style={s.miniFoot}>
            <View style={[s.miniBtn, { backgroundColor: p.cyan }]} />
            <View style={[s.miniChip, { backgroundColor: alpha(p.amber, 0.25) }]} />
            <View style={[s.miniChip, { backgroundColor: alpha(p.coral, 0.25) }]} />
          </View>
        </View>
      </View>
      <View style={s.cardText}>
        <T style={s.cardT}>{theme.label}</T>
        {on && <Check size={13} color={color.cyan2} />}
        {current && !on && <T style={s.cardTag}>current</T>}
      </View>
      <T style={s.cardD}>{theme.description}</T>
    </Pressable>
  );
});

function TokenRow({
  tokenKey,
  value,
  overridden,
  onSet,
  last,
}: {
  tokenKey: ColorKey;
  value: string;
  overridden: boolean;
  onSet: (key: ColorKey, value: string | null) => void;
  last: boolean;
}) {
  const [bad, setBad] = useState(false);
  const change = useCallback(
    (v: string) => {
      const hex = v.startsWith("#") ? v : `#${v}`;
      if (v === "") {
        setBad(false);
        onSet(tokenKey, null);
      } else if (HEX_COLOR.test(hex)) {
        setBad(false);
        onSet(tokenKey, hex.toLowerCase());
      } else setBad(true);
    },
    [onSet, tokenKey],
  );
  const reset = useCallback(() => {
    setBad(false);
    onSet(tokenKey, null);
  }, [onSet, tokenKey]);
  const swatch = useMemo(() => [s.swatch, { backgroundColor: value }], [value]);
  return (
    <Row label={tokenKey} hint={bad ? "Use a #rrggbb colour." : TOKEN_HINT[tokenKey]} last={last}>
      <View style={s.tok}>
        <View style={swatch} />
        <TextField
          value={overridden ? value : ""}
          placeholder={value}
          onChange={change}
          width={92}
        />
        <Pressable
          onPress={reset}
          disabled={!overridden}
          accessibilityLabel={`Reset ${tokenKey}`}
          style={[s.reset, !overridden && s.resetOff]}
        >
          <RotateCcw size={12} color={color.muted} />
        </Pressable>
      </View>
    </Row>
  );
}

const s = StyleSheet.create({
  cards: { flexDirection: "row", flexWrap: "wrap", gap: 12, padding: 14 },
  card: {
    width: 220,
    padding: 10,
    gap: 6,
    borderWidth: 1,
    borderColor: color.line,
    backgroundColor: color.wash,
    ...web({ transitionProperty: "border-color, background-color", transitionDuration: "160ms" }),
  },
  cardHover: { borderColor: color.line2, backgroundColor: color.wash2 },
  cardOn: { borderColor: color.cyan, backgroundColor: color.cyanWash },
  mini: { height: 96, flexDirection: "row", borderWidth: 1, overflow: "hidden" },
  miniRail: { width: 22, alignItems: "center", gap: 6, paddingTop: 8, borderRightWidth: 1 },
  miniDot: { width: 8, height: 8 },
  miniBody: { flex: 1, padding: 8, gap: 5 },
  miniLine: { height: 4, width: "80%" },
  miniPanel: { borderWidth: 1, padding: 5, gap: 4 },
  miniFoot: { flexDirection: "row", gap: 4, marginTop: "auto" },
  miniBtn: { width: 30, height: 8 },
  miniChip: { width: 16, height: 8 },
  cardText: { flexDirection: "row", alignItems: "center", gap: 6 },
  cardT: { fontFamily: font.display, fontWeight: "600", fontSize: 13.5, color: color.text },
  cardTag: { fontFamily: font.mono, fontSize: 10, color: color.faint },
  cardD: { fontSize: 12, color: color.muted },
  tok: { flexDirection: "row", alignItems: "center", gap: 8 },
  swatch: { width: 16, height: 16, borderWidth: 1, borderColor: color.line2 },
  reset: { padding: 4 },
  resetOff: { opacity: 0.3 },
  acts: { flexDirection: "row", justifyContent: "flex-end", gap: 8, marginTop: 4 },
});
