// Settings → Design options: every pending lab pick, switchable at runtime and persisted in prefs.
// Each section pairs the chooser with a live preview of the real production component.
import { Lock, Plus, RefreshCw } from "lucide-react-native";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import {
  usePrefs,
  prefSetter,
  PREF_DEFAULTS,
  type ButtonStyle,
  type HeadingRevealPref,
  type LogoMotionPref,
  type ShapeLang,
  type StateStylePref,
  type SubworkStylePref,
  type TextRevealPref,
  type ToastStylePref,
} from "../../../prefs";
import { color } from "../../../theme/tokens";
import { Brackets, BracketScope } from "../../Brackets";
import { Button } from "../../Button";
import { RevealMarkdown, RevealTitle } from "../../chat/TextReveal";
import { StatePreview } from "../../chat/SessionState";
import { SubWorkPreview } from "../../subwork/Preview";
import { Cut } from "../../Cut";
import { Logo } from "../../Logo";
import { ShapeCard, ShapeInput } from "../../Shape";
import { T } from "../../Text";
import { toast } from "../../toast/store";
import { Note, Pill, Row, Section } from "../controls";

interface Opt<V extends string> {
  value: V;
  label: string;
  /** What it looks like, shown under the chooser while selected. */
  note: string;
  /** Platforms where the motion is not available ("web only"). */
  webOnly?: string;
}

const BUTTONS: Opt<ButtonStyle>[] = [
  {
    value: "gradient",
    label: "Gradient",
    note: "Current: cyan to deep-blue gradient, brightens on hover.",
    webOnly: "gradient fill (flat cyan on Android)",
  },
  { value: "solid", label: "A Flat cyan", note: "Solid cyan; hover lifts to cyan2, press dims." },
  { value: "mint", label: "B Flat mint", note: "Solid mint, the go accent." },
  { value: "outline", label: "C Outline", note: "1px cyan border, cyan2 label; wash on hover." },
  { value: "bar", label: "D Accent bar", note: "Dark raise fill with a 2px cyan left bar." },
  { value: "bracket", label: "E Brackets", note: "Raise fill framed by corner brackets." },
  { value: "tint", label: "F Wash", note: "Cyan tinted wash, the danger recipe in cyan." },
];

const LOGOS: Opt<LogoMotionPref>[] = [
  { value: "none", label: "None", note: "Static gem." },
  {
    value: "ripple",
    label: "Ripple",
    note: "A light wave runs face to face; a press sends a pulse.",
  },
  { value: "split", label: "Split", note: "Faces breathe apart; a press opens dark seams." },
  { value: "sweep", label: "Sweep", note: "A light band crosses the gem; a press flashes edges." },
  { value: "turn", label: "Turn", note: "The light rotates round the faces; a press spins it." },
];

const SHAPES: Opt<ShapeLang>[] = [
  { value: "chamfer", label: "A Chamfer", note: "Current: continuous 1px chamfered outline." },
  {
    value: "bar",
    label: "B Edge bar",
    note: "Tint with a kind-coloured left bar, square corners.",
  },
  { value: "brackets", label: "C Brackets", note: "No edges, only L-marks at the corners." },
  { value: "tab", label: "D Notch tab", note: "Hairline box with the label on a chamfered tab." },
  { value: "soft", label: "E Soft", note: "4–6px radius, inner hairline, accent line on top." },
  {
    value: "hud",
    label: "F HUD",
    note: "Dashed edge, corner ticks, mono header; [ LABEL ] buttons.",
  },
];

const TOASTS: Opt<ToastStylePref>[] = [
  {
    value: "bracket",
    label: "A Bracket",
    note: "Chamfered card, kind corner marks, edge bar, mono tag.",
  },
  { value: "hud", label: "B HUD", note: "Terminal frame, corner ticks, mono header and clock." },
  { value: "facet", label: "C Facet", note: "Triangle-mesh leading edge and a gem glyph." },
];

const STATES: Opt<StateStylePref>[] = [
  { value: "edge", label: "A Edge", note: "Kind wash, 3px leading edge bar and a mono tag." },
  { value: "bracket", label: "B Bracket", note: "Raised card with kind bracket corners." },
  { value: "banner", label: "C Banner", note: "Full-width wash with a 2px top trim." },
];

const SUBWORK: Opt<SubworkStylePref>[] = [
  {
    value: "chip",
    label: "A Count chip",
    note: "A chip with the count; beam and pulse while running. Tap to open the nested rows.",
  },
  {
    value: "dots",
    label: "B Mini-glyph dots",
    note: "One small square per sub-process, coloured by status. Tap to open the nested rows.",
  },
  {
    value: "tree",
    label: "C Tree",
    note: "Nested rows with tree lines, always visible under the session (up to five).",
  },
];

const TEXTS: Opt<TextRevealPref>[] = [
  { value: "none", label: "Off", note: "Streamed text appears as it arrives." },
  { value: "fade", label: "1 Word fade", note: "Each new word fades in (web adds a 3px rise)." },
  {
    value: "blur",
    label: "2 Blur-in",
    note: "Web: blur and fade. Android: no text blur, so a slower cool-tinted fade.",
  },
  {
    value: "caret",
    label: "3 Block caret",
    note: "A cyan block leads the stream, blinks when idle.",
  },
  {
    value: "scramble",
    label: "4 Scramble",
    note: "New words cycle glyphs and settle left to right.",
  },
  {
    value: "wipe",
    label: "5 Wipe",
    note: "A soft-edged sweep with a glowing head across each chunk.",
  },
  {
    value: "slide",
    label: "6 Chunk slide",
    note: "Each network chunk fades in (web also slides 4px; inline text cannot slide on Android).",
  },
  { value: "type", label: "7 Typewriter", note: "Steady characters per second with catch-up." },
  {
    value: "glow",
    label: "8 Glow head",
    note: "New characters arrive cyan and cool to text colour.",
  },
];

const HEADINGS: Opt<HeadingRevealPref>[] = [
  { value: "none", label: "Off", note: "Headings appear at once." },
  {
    value: "stagger",
    label: "Letter stagger",
    note: "Each letter fades in, 15ms apart (web adds a 6px rise).",
  },
  { value: "scramble", label: "Scramble", note: "Words decode left to right." },
  { value: "wipe", label: "Wipe", note: "A mask sweep with a cyan glow head." },
  {
    value: "blur",
    label: "Blur",
    note: "Web: blur and tracking resolve. Android: cool-tinted fade.",
  },
];

/** Wrapped option chips; the selection uses the app's bracket language. */
function Choice<V extends string>({
  options,
  value,
  onChange,
}: {
  options: Opt<V>[];
  value: V;
  onChange: (v: V) => void;
}) {
  return (
    <BracketScope>
      <View style={s.chips}>
        {options.map((o) => (
          <Chip key={o.value} o={o} on={o.value === value} onPick={onChange} />
        ))}
      </View>
    </BracketScope>
  );
}

function Chip<V extends string>({
  o,
  on,
  onPick,
}: {
  o: Opt<V>;
  on: boolean;
  onPick: (v: V) => void;
}) {
  const press = useCallback(() => onPick(o.value), [onPick, o.value]);
  return (
    <Pressable onPress={press} accessibilityRole="button" accessibilityLabel={o.label}>
      {({ hovered }) => (
        <Cut size={6} style={[s.chip, hovered && s.chipHover, on && s.chipOn]}>
          <Brackets on={on} len={5} />
          <T style={[s.chipT, on && s.chipTOn]}>{o.label}</T>
        </Cut>
      )}
    </Pressable>
  );
}

/** One picker: chooser, what the pick does, and its live preview. */
function Picker<V extends string>({
  title,
  options,
  value,
  fallback,
  onChange,
  children,
}: {
  title: string;
  options: Opt<V>[];
  value: V;
  fallback: V;
  onChange: (v: V) => void;
  children?: ReactNode;
}) {
  const cur = options.find((o) => o.value === value) ?? options[0];
  return (
    <Section title={title}>
      <View style={s.block}>
        <Choice options={options} value={value} onChange={onChange} />
        <T style={s.note}>
          {cur.note}
          {cur.value === fallback ? "  · default" : ""}
        </T>
        {cur.webOnly && <WebOnly what={cur.webOnly} />}
        {children ? <View style={s.preview}>{children}</View> : null}
      </View>
    </Section>
  );
}

function WebOnly({ what }: { what: string }) {
  return (
    <View style={s.tagRow}>
      <View style={s.tag}>
        <T v="mono" style={s.tagT}>
          web only
        </T>
      </View>
      <T style={s.tagWhat}>{what}</T>
    </View>
  );
}

const noop = () => {};

function ButtonPreview() {
  return (
    <View style={s.wrap}>
      <Button kind="primary" label="Create session" icon={Plus} onPress={noop} />
      <Button kind="primary" label="Approve" kbd="⌘↵" onPress={noop} />
      <Button label="Cancel" onPress={noop} />
      <Button kind="danger" label="Deny" onPress={noop} />
      <Button label="Refresh" icon={RefreshCw} onPress={noop} />
    </View>
  );
}

function LogoPreview() {
  const motion = usePrefs((st) => st.logoMotion);
  return (
    <View style={s.logos}>
      <Logo size={48} motion={motion} />
      <Logo size={26} motion={motion} />
      <T style={s.hint}>
        {Platform.OS === "web"
          ? "Hover or click the gems."
          : "Tap the gems (hover needs a pointer)."}
      </T>
    </View>
  );
}

function ShapePreview() {
  const [text, setText] = useState("");
  return (
    <View style={s.shape}>
      <ShapeCard
        tint={color.amber}
        icon={Lock}
        tag="PERMISSION"
        meta="Bash · Default"
        title="Permission needed"
      >
        <T style={s.cardTitle}>Run git push --force-with-lease</T>
        <View style={s.wrap}>
          <Button kind="danger" label="Deny" onPress={noop} />
          <Button kind="primary" label="Approve" onPress={noop} />
        </View>
      </ShapeCard>
      <ShapeInput
        value={text}
        onChangeText={setText}
        placeholder="Tell the agent what to do instead"
      />
    </View>
  );
}

function ToastPreview() {
  const done = useCallback(
    () =>
      void toast({
        title: "Fix flaky session list finished",
        detail: "Ready to review",
        kind: "done",
        action: { label: "Open", onPress: noop },
      }),
    [],
  );
  const needs = useCallback(
    () => void toast({ title: "Release notes needs you", kind: "needs", source: "preview" }),
    [],
  );
  const fail = useCallback(
    () =>
      void toast({
        title: "Agent crashed",
        detail: "exit code 137 while running npm test",
        kind: "error",
      }),
    [],
  );
  return (
    <View style={s.wrap}>
      <Button label="Show done" onPress={done} />
      <Button label="Needs you" onPress={needs} />
      <Button label="Error" onPress={fail} />
    </View>
  );
}

function StateCards() {
  const [run, setRun] = useState(0);
  const replay = useCallback(() => setRun((n) => n + 1), []);
  return (
    <View>
      <StatePreview key={`r${run}`} kind="review" />
      <StatePreview key={`f${run}`} kind="failed" />
      <View style={s.replay}>
        <Button label="Replay entry" onPress={replay} />
      </View>
    </View>
  );
}

const SAMPLE = `The flicker came from the **session list** re-sorting on every status tick.

- \`SessionList\` now memoises rows by \`id\`
- the sort key ignores \`updatedAt\` while an agent is *working*

Run \`npm test\` to confirm.`;

/** A short bursty stream of SAMPLE through the production reveal; remounts when the mode changes. */
function StreamPreview({ mode }: { mode: TextRevealPref }) {
  const [run, setRun] = useState(0);
  const replay = useCallback(() => setRun((n) => n + 1), []);
  return (
    <View>
      <Stream key={`${mode}${run}`} mode={mode} />
      <View style={s.replay}>
        <Button label="Replay stream" icon={RefreshCw} onPress={replay} />
      </View>
    </View>
  );
}

function Stream({ mode }: { mode: TextRevealPref }) {
  const [len, setLen] = useState(0);
  const at = useRef(0);
  useEffect(() => {
    let id: ReturnType<typeof setTimeout>;
    const step = () => {
      at.current = Math.min(SAMPLE.length, at.current + 2 + Math.floor(Math.random() * 12));
      setLen(at.current);
      if (at.current < SAMPLE.length) id = setTimeout(step, 40 + Math.random() * 130);
    };
    id = setTimeout(step, 300);
    return () => clearTimeout(id);
  }, []);
  return <RevealMarkdown text={SAMPLE.slice(0, len)} mode={mode} streaming={len < SAMPLE.length} />;
}

const TITLES = ["What do you want to know?", "Agent crashed", "Source control"];

function HeadingLine({
  text,
  mode,
  style,
}: {
  text: string;
  mode: HeadingRevealPref;
  style: object;
}) {
  if (mode === "none")
    return (
      <T v="display" style={style}>
        {text}
      </T>
    );
  return <RevealTitle text={text} mode={mode} style={style} />;
}

function HeadingPreview({ mode }: { mode: HeadingRevealPref }) {
  const [run, setRun] = useState(0);
  const replay = useCallback(() => setRun((n) => n + 1), []);
  return (
    <View style={s.titles}>
      <HeadingLine key={`a${mode}${run}`} text={TITLES[0]} mode={mode} style={s.hero} />
      <HeadingLine key={`b${mode}${run}`} text={TITLES[1]} mode={mode} style={s.crash} />
      <HeadingLine key={`c${mode}${run}`} text={TITLES[2]} mode={mode} style={s.panel} />
      <View style={s.replay}>
        <Button label="Replay" icon={RefreshCw} onPress={replay} />
      </View>
    </View>
  );
}

/** Everything at once: the strip you can keep an eye on while switching pickers further down. */
function Strip() {
  const motion = usePrefs((st) => st.logoMotion);
  return (
    <Section title="Live preview">
      <View style={s.strip}>
        <Logo size={32} motion={motion} />
        <View style={s.wrap}>
          <Button kind="primary" label="Primary" onPress={noop} />
          <Button label="Ghost" onPress={noop} />
          <Button kind="danger" label="Danger" onPress={noop} />
        </View>
      </View>
    </Section>
  );
}

const DIFFS: Array<{ label: string; hint: string; tag: string }> = [
  { label: "Gradient button fill", hint: "Flat cyan on Android.", tag: "web only" },
  {
    label: "Hover states",
    hint: "Buttons, logo hover and the toast pause need a pointer.",
    tag: "web only",
  },
  {
    label: "Word rise and letter rise",
    hint: "Inline text cannot move on Android; it fades.",
    tag: "web only",
  },
  {
    label: "Blur-in and blur heading",
    hint: "Cool-tinted fade instead of a blur.",
    tag: "approximated",
  },
  { label: "Chunk slide", hint: "Whole-chunk fade instead of a 4px slide.", tag: "approximated" },
  { label: "Glow head shadow", hint: "Colour cooling only, no text shadow.", tag: "approximated" },
  {
    label: "Review glow and tool glyph pop",
    hint: "Overlay opacity pulse; no overshoot.",
    tag: "approximated",
  },
  {
    label: "Scramble",
    hint: "Glyphs swap in place; the line may reflow slightly.",
    tag: "approximated",
  },
];

const resetAll = () => {
  for (const key of Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>) {
    prefSetter(key)(DEFAULTS[key] as never);
  }
};
const DEFAULTS = {
  buttonStyle: PREF_DEFAULTS.buttonStyle,
  logoMotion: PREF_DEFAULTS.logoMotion,
  shapeLang: PREF_DEFAULTS.shapeLang,
  toastStyle: PREF_DEFAULTS.toastStyle,
  stateStyle: PREF_DEFAULTS.stateStyle,
  subworkStyle: PREF_DEFAULTS.subworkStyle,
  textReveal: PREF_DEFAULTS.textReveal,
  headingReveal: PREF_DEFAULTS.headingReveal,
};

export function DesignOptions() {
  const p = usePrefs();
  return (
    <>
      <Note>
        Prototype picks, applied app-wide as you change them and kept on this device. The lab
        entries that carry these decisions are in the component lab.
      </Note>
      <Strip />
      <Picker
        title="Primary button style"
        options={BUTTONS}
        value={p.buttonStyle}
        fallback={DEFAULTS.buttonStyle}
        onChange={prefSetter("buttonStyle")}
      >
        <ButtonPreview />
      </Picker>
      <Picker
        title="Logo motion"
        options={LOGOS}
        value={p.logoMotion}
        fallback={DEFAULTS.logoMotion}
        onChange={prefSetter("logoMotion")}
      >
        <LogoPreview />
      </Picker>
      <Picker
        title="Shape language"
        options={SHAPES}
        value={p.shapeLang}
        fallback={DEFAULTS.shapeLang}
        onChange={prefSetter("shapeLang")}
      >
        <ShapePreview />
      </Picker>
      <Picker
        title="Toast style"
        options={TOASTS}
        value={p.toastStyle}
        fallback={DEFAULTS.toastStyle}
        onChange={prefSetter("toastStyle")}
      >
        <ToastPreview />
      </Picker>
      <Picker
        title="Session state card"
        options={STATES}
        value={p.stateStyle}
        fallback={DEFAULTS.stateStyle}
        onChange={prefSetter("stateStyle")}
      >
        <StateCards />
      </Picker>
      <Picker
        title="Sub-work indicator"
        options={SUBWORK}
        value={p.subworkStyle}
        fallback={DEFAULTS.subworkStyle}
        onChange={prefSetter("subworkStyle")}
      >
        <SubWorkPreview />
      </Picker>
      <Picker
        title="Streaming text reveal"
        options={TEXTS}
        value={p.textReveal}
        fallback={DEFAULTS.textReveal}
        onChange={prefSetter("textReveal")}
      >
        <StreamPreview mode={p.textReveal} />
      </Picker>
      <Picker
        title="Heading reveal"
        options={HEADINGS}
        value={p.headingReveal}
        fallback={DEFAULTS.headingReveal}
        onChange={prefSetter("headingReveal")}
      >
        <HeadingPreview mode={p.headingReveal} />
      </Picker>
      <Section title="On Android">
        {DIFFS.map((d, n) => (
          <Row key={d.label} label={d.label} hint={d.hint} last={n === DIFFS.length - 1}>
            <Pill text={d.tag} tint={d.tag === "web only" ? color.amber : color.muted} />
          </Row>
        ))}
      </Section>
      <Section title="Reset">
        <View style={s.block}>
          <Button label="Restore shipping defaults" onPress={resetAll} />
        </View>
      </Section>
    </>
  );
}

const s = StyleSheet.create({
  block: { padding: 16, gap: 12 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: color.wash,
    borderWidth: 1,
    borderColor: color.line,
  },
  chipHover: { backgroundColor: color.wash2 },
  chipOn: { backgroundColor: color.cyanWash, borderColor: color.cyan },
  chipT: { fontSize: 12.5, color: color.muted },
  chipTOn: { color: color.cyan2 },
  note: { color: color.muted, fontSize: 12.5, lineHeight: 18 },
  tagRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  tag: { borderWidth: 1, borderColor: color.amber, paddingHorizontal: 6, paddingVertical: 1 },
  tagT: { color: color.amber, fontSize: 10, letterSpacing: 1 },
  tagWhat: { color: color.faint, fontSize: 12, flexShrink: 1 },
  preview: {
    padding: 14,
    backgroundColor: color.bg,
    borderWidth: 1,
    borderColor: color.line,
    gap: 12,
  },
  wrap: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 },
  strip: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 16,
    padding: 16,
  },
  logos: { flexDirection: "row", alignItems: "center", gap: 18 },
  hint: { color: color.faint, fontSize: 12, flexShrink: 1 },
  shape: { gap: 0 },
  cardTitle: { fontSize: 14, marginVertical: 10 },
  replay: { alignItems: "flex-start", marginTop: 12 },
  titles: { gap: 14 },
  hero: { fontSize: 24 },
  crash: { fontSize: 18, color: color.coral },
  panel: { fontSize: 13, color: color.text },
});
