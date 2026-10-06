// Text reveal experiments (lab only for now): how streamed assistant text and one-shot titles
// appear. `RevealMarkdown` renders the same subset as Markdown.tsx but tracks when each range of
// characters arrived, so only the young tail is wrapped in animated spans; settled text is plain.
// Web uses CSS keyframes on inline spans (opacity, filter, top/left on position:relative, mask),
// so nothing reflows. Native renders plain text (caret and typewriter still work).
import {
  createContext,
  Fragment,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Platform, StyleSheet, Text, View, type StyleProp, type TextStyle } from "react-native";
import { anim, color, ease, font, web } from "../../theme/tokens";
import { reducedMotion } from "../presence";
import { T } from "../Text";

export type RevealMode =
  | "none"
  | "fade"
  | "blur"
  | "caret"
  | "scramble"
  | "wipe"
  | "slide"
  | "type"
  | "glow";

/** Durations in ms (before lab slow-mo). `step` is the stagger between pieces of one chunk. */
export const revealMs = {
  fade: 180,
  fadeStep: 30,
  blur: 220,
  blurStep: 30,
  scramble: 260,
  wipe: 420,
  slide: 200,
  typeFade: 90,
  typeCps: 55,
  glow: 700,
  glowStep: 15,
  caretIdle: 500,
  blink: 1000,
} as const;

export const REVEALS: Array<{ mode: RevealMode; n: number; label: string; spec: string }> = [
  {
    mode: "fade",
    n: 1,
    label: "Word fade",
    spec: `each word opacity 0→1 + 3px rise, ${revealMs.fade}ms ease, ${revealMs.fadeStep}ms stagger within a chunk`,
  },
  {
    mode: "blur",
    n: 2,
    label: "Blur-in",
    spec: `each word blur(6px)+opacity 0 → sharp, ${revealMs.blur}ms ease, ${revealMs.blurStep}ms stagger`,
  },
  {
    mode: "caret",
    n: 3,
    label: "Block caret",
    spec: `cyan mono block leads the stream; blinks (${revealMs.blink}ms steps) after ${revealMs.caretIdle}ms idle; gone when done`,
  },
  {
    mode: "scramble",
    n: 4,
    label: "Scramble / decode",
    spec: `new words cycle glyphs and settle left→right over ${revealMs.scramble}ms (overlay, real text holds the layout)`,
  },
  {
    mode: "wipe",
    n: 5,
    label: "Gradient wipe",
    spec: `mask sweeps across each chunk with a cyan glow at the head, ${revealMs.wipe}ms ease`,
  },
  {
    mode: "slide",
    n: 6,
    label: "Chunk slide",
    spec: `each network chunk slides from −4px + fades, ${revealMs.slide}ms ease, no stagger`,
  },
  {
    mode: "type",
    n: 7,
    label: "Typewriter",
    spec: `steady ${revealMs.typeCps} chars/s + catch-up (backlog drains in ~⅓s), each char fades ${revealMs.typeFade}ms`,
  },
  {
    mode: "glow",
    n: 8,
    label: "Glow head",
    spec: `new chars arrive cyan with a glow and cool to text colour over ${revealMs.glow}ms, ${revealMs.glowStep}ms per-char trail`,
  },
];

const isWeb = Platform.OS === "web";
const now = () => (globalThis.performance ? globalThis.performance.now() : Date.now());

// ---- keyframes -------------------------------------------------------------------------------

const kf = {
  // Only the 0% frame: the span animates to its own computed style (text, inline code, bold).
  fade: { "0%": { opacity: 0, top: "3px" } },
  blur: { "0%": { opacity: 0, filter: "blur(6px)" } },
  slide: { "0%": { opacity: 0, left: "-4px" } },
  typeFade: { "0%": { opacity: 0 } },
  glow: { "0%": { color: color.cyan2, textShadow: "0 0 10px rgba(37,181,200,0.95)" } },
  wipe: {
    "0%": {
      maskPosition: "100% 0",
      WebkitMaskPosition: "100% 0",
      textShadow: "0 0 10px rgba(127,217,230,0.9)",
    },
    "100%": { maskPosition: "0% 0", WebkitMaskPosition: "0% 0", textShadow: "0 0 0 transparent" },
  },
  blink: {
    "0%": { opacity: 1 },
    "50%": { opacity: 1 },
    "51%": { opacity: 0 },
    "100%": { opacity: 0 },
  },
  titleRise: { "0%": { opacity: 0, top: "6px" } },
  titleBlur: { "0%": { opacity: 0, filter: "blur(8px)", letterSpacing: "0.04em" } },
  titleWipe: {
    "0%": {
      maskPosition: "100% 0",
      WebkitMaskPosition: "100% 0",
      textShadow: "0 0 14px rgba(127,217,230,0.9)",
    },
    "100%": { maskPosition: "0% 0", WebkitMaskPosition: "0% 0", textShadow: "0 0 0 transparent" },
  },
};

const mask = web({
  maskImage: "linear-gradient(90deg, #000 0%, #000 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,0) 100%)",
  WebkitMaskImage:
    "linear-gradient(90deg, #000 0%, #000 40%, rgba(0,0,0,0) 55%, rgba(0,0,0,0) 100%)",
  maskSize: "300% 100%",
  WebkitMaskSize: "300% 100%",
  maskRepeat: "no-repeat",
  WebkitMaskRepeat: "no-repeat",
});
const rel = web({ position: "relative" });

// RN-web compiles `animationKeyframes` only inside StyleSheet.create.
const m = StyleSheet.create({
  fade: { ...rel, ...anim(kf.fade, `${revealMs.fade}ms`, ease, 1, "backwards") },
  blur: anim(kf.blur, `${revealMs.blur}ms`, ease, 1, "backwards"),
  slide: { ...rel, ...anim(kf.slide, `${revealMs.slide}ms`, ease, 1, "backwards") },
  type: anim(kf.typeFade, `${revealMs.typeFade}ms`, "linear", 1, "backwards"),
  glow: anim(kf.glow, `${revealMs.glow}ms`, "ease-out", 1, "backwards"),
  wipe: { ...mask, ...anim(kf.wipe, `${revealMs.wipe}ms`, ease) },
  blink: anim(kf.blink, `${revealMs.blink}ms`, "linear", "infinite"),
  titleRise: { ...rel, ...anim(kf.titleRise, "260ms", ease, 1, "backwards") },
  titleBlur: anim(kf.titleBlur, "380ms", ease, 1, "backwards"),
  titleWipe: { ...mask, ...anim(kf.titleWipe, "620ms", ease) },
});

/** animationDelay steps of 15ms; index capped at the last. */
const DELAY = StyleSheet.create(
  Object.fromEntries(
    Array.from({ length: 40 }, (_, i) => [`d${i}`, web({ animationDelay: `${i * 15}ms` })]),
  ),
);
const delay = (i: number) => DELAY[`d${Math.min(39, Math.max(0, Math.round(i)))}`];

// ---- arrival tracking ------------------------------------------------------------------------

interface Piece {
  from: number;
  to: number;
  /** Stagger in 15ms steps. */
  d: number;
  born: number;
}

const WORD = /\S+\s*/g;

/** Splits a newly arrived range into the pieces the mode animates. */
function piecesFor(mode: RevealMode, text: string, from: number, to: number, born: number) {
  const out: Piece[] = [];
  if (mode === "slide" || mode === "wipe") {
    out.push({ from, to, d: 0, born });
    return out;
  }
  if (mode === "glow" || mode === "type") {
    for (let i = from; i < to; i++) {
      if (text[i] !== " " && text[i] !== "\n")
        out.push({ from: i, to: i + 1, d: mode === "glow" ? i - from : 0, born });
    }
    return out;
  }
  const chunk = text.slice(from, to);
  const step = mode === "fade" || mode === "blur" ? 2 : 0;
  let k = 0;
  for (const w of chunk.matchAll(WORD)) {
    const at = from + (w.index ?? 0);
    out.push({ from: at, to: at + w[0].trimEnd().length, d: k * step, born });
    k++;
  }
  // Leading whitespace before the first word is not animated.
  return out;
}

function life(mode: RevealMode, p: Piece) {
  const base: Record<RevealMode, number> = {
    none: 0,
    caret: 0,
    fade: revealMs.fade,
    blur: revealMs.blur,
    scramble: revealMs.scramble,
    wipe: revealMs.wipe,
    slide: revealMs.slide,
    type: revealMs.typeFade,
    glow: revealMs.glow,
  };
  return base[mode] + p.d * 15 + 40;
}

/**
 * Remembers when each character range arrived. Text present at mount counts as settled (history
 * does not animate). Pieces past their animation are pruned on a timer so spans fold back into
 * plain text; `rate` stretches that timer to match lab slow-mo.
 */
function useArrivals(text: string, mode: RevealMode, rate: number, on: boolean) {
  const ref = useRef({ text, list: [] as Piece[] });
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const r = ref.current;
  if (text !== r.text) {
    if (!on || !text.startsWith(r.text)) r.list = [];
    else r.list = r.list.concat(piecesFor(mode, text, r.text.length, text.length, now()));
    r.text = text;
  }
  const t = now();
  const live = r.list.filter((p) => t - p.born < life(mode, p) / rate);
  if (live.length !== r.list.length) r.list = live;
  const next = live.reduce((a, p) => Math.min(a, p.born + life(mode, p) / rate - t), Infinity);
  useEffect(() => {
    if (next === Infinity) return undefined;
    const id = setTimeout(bump, Math.max(16, next + 8));
    return () => clearTimeout(id);
  }, [next, text]);
  return live;
}

/** Steady per-char reveal decoupled from network chunking, speeding up to drain a backlog. */
function useTypewriter(full: string, on: boolean, rate: number) {
  const [shown, setShown] = useState(on ? 0 : full.length);
  const target = useRef(full.length);
  target.current = full.length;
  if (shown > full.length) setShown(full.length);
  useEffect(() => {
    if (!on) return undefined;
    let frame = 0;
    let last = now();
    let acc = 0;
    const tick = () => {
      const t = now();
      const dt = (t - last) / 1000;
      last = t;
      setShown((s) => {
        const backlog = target.current - s;
        if (backlog <= 0) return s;
        acc += dt * rate * (revealMs.typeCps + backlog * 3);
        const n = Math.floor(acc);
        acc -= n;
        return Math.min(target.current, s + n);
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [on, rate]);
  return on ? full.slice(0, shown) : full;
}

// Nested spans use RN Text, not T: T sets font/size/colour and would override the parent run.

// ---- markdown with offsets -------------------------------------------------------------------

interface Seg {
  text: string;
  at: number;
}
interface Block {
  kind: "code" | "h" | "li" | "p";
  parts: Seg[];
  level?: number;
  key: string;
}

function parse(text: string): Block[] {
  const blocks: Block[] = [];
  const lines = text.split("\n");
  let at = 0;
  const starts = lines.map((l) => {
    const s = at;
    at += l.length + 1;
    return s;
  });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const key = `${starts[i]}`;
    if (line.startsWith("```")) {
      const code: Seg[] = [];
      while (++i < lines.length && !lines[i].startsWith("```"))
        code.push({ text: lines[i], at: starts[i] });
      blocks.push({ kind: "code", parts: code, key });
    } else if (/^#{1,4}\s/.test(line)) {
      const cut = line.match(/^#+\s/)?.[0].length ?? 0;
      blocks.push({
        kind: "h",
        parts: [{ text: line.slice(cut), at: starts[i] + cut }],
        level: line.indexOf(" "),
        key,
      });
    } else if (/^\s*([-*]|\d+\.)\s/.test(line)) {
      const cut = line.match(/^\s*([-*]|\d+\.)\s/)?.[0].length ?? 0;
      blocks.push({ kind: "li", parts: [{ text: line.slice(cut), at: starts[i] + cut }], key });
    } else if (line.trim()) {
      const prev = blocks[blocks.length - 1];
      if (prev?.kind === "p" && lines[i - 1]?.trim())
        prev.parts.push({ text: line, at: starts[i] });
      else blocks.push({ kind: "p", parts: [{ text: line, at: starts[i] }], key });
    }
  }
  return blocks;
}

const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|(?<![\w*])[_*][^_*\s][^_*]*[_*](?![\w*]))/g;

interface Ctx {
  mode: RevealMode;
  pieces: Piece[];
  rate: number;
}
const RevealCtx = createContext<Ctx>({ mode: "none", pieces: [], rate: 1 });

/** Plain text for settled ranges, animated spans for pieces still in flight. */
function Run({ text, at }: Seg) {
  const { mode, pieces } = useContext(RevealCtx);
  const end = at + text.length;
  const hits = pieces.filter((p) => p.to > at && p.from < end);
  if (!hits.length) return text;
  const out: ReactNode[] = [];
  let pos = at;
  for (const p of hits) {
    const a = Math.max(p.from, at);
    const b = Math.min(p.to, end);
    if (a > pos) out.push(<Fragment key={`t${pos}`}>{text.slice(pos - at, a - at)}</Fragment>);
    out.push(<Span key={`p${p.from}`} mode={mode} piece={p} text={text.slice(a - at, b - at)} />);
    pos = b;
  }
  if (pos < end) out.push(<Fragment key={`t${pos}`}>{text.slice(pos - at)}</Fragment>);
  return out;
}

function Span({ mode, piece, text }: { mode: RevealMode; piece: Piece; text: string }) {
  if (mode === "scramble") return <Scramble text={text} born={piece.born} />;
  const style = MODE_STYLE[mode];
  if (!style) return text;
  return <Text style={[style, delay(piece.d)]}>{text}</Text>;
}

const MODE_STYLE: Partial<Record<RevealMode, object>> = {
  fade: m.fade,
  blur: m.blur,
  slide: m.slide,
  type: m.type,
  glow: m.glow,
  wipe: m.wipe,
};

const GLYPHS = "▓▒░<>/\\[]{}=+*#_01";
const noise = (len: number, keep: number, src: string) => {
  let s = src.slice(0, keep);
  for (let i = keep; i < len; i++) s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  return s;
};

/** Real text holds the layout (transparent); a glyph overlay settles left to right on top. */
function Scramble({
  text,
  born,
  ms = revealMs.scramble,
  style,
}: {
  text: string;
  born: number;
  ms?: number;
  style?: StyleProp<TextStyle>;
}) {
  const { rate } = useContext(RevealCtx);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const p = Math.min(1, (now() - born) / (ms / rate));
  useEffect(() => {
    if (p >= 1) return undefined;
    const id = requestAnimationFrame(bump);
    return () => cancelAnimationFrame(id);
  }, [p]);
  if (p >= 1) return <Text style={style}>{text}</Text>;
  return (
    <Text style={[sx.ghost, style]}>
      {text}
      <Text style={[sx.over, style, sx.overTint]}>
        {noise(text.length, Math.floor(p * text.length), text)}
      </Text>
    </Text>
  );
}

function Inline({ seg }: { seg: Seg }) {
  let pos = seg.at;
  return seg.text
    .split(INLINE)
    .filter(Boolean)
    .map((part) => {
      const at = pos;
      pos += part.length;
      const key = `${at}`;
      if (part.startsWith("`") && part.endsWith("`") && part.length > 1)
        return (
          <T key={key} style={st.inlineCode}>
            <Run text={part.slice(1, -1)} at={at + 1} />
          </T>
        );
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4)
        return (
          <T key={key} style={st.bold}>
            <Run text={part.slice(2, -2)} at={at + 2} />
          </T>
        );
      if (/^[_*].+[_*]$/.test(part))
        return (
          <T key={key} style={st.italic}>
            <Run text={part.slice(1, -1)} at={at + 1} />
          </T>
        );
      return <Run key={key} text={part} at={at} />;
    });
}

function Parts({ parts }: { parts: Seg[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={p.at}>
          {i > 0 ? " " : null}
          <Inline seg={p} />
        </Fragment>
      ))}
    </>
  );
}

function CodeLines({ parts }: { parts: Seg[] }) {
  return (
    <>
      {parts.map((p, i) => (
        <Fragment key={p.at}>
          {i > 0 ? "\n" : null}
          <Run text={p.text} at={p.at} />
        </Fragment>
      ))}
    </>
  );
}

function Caret({ idle }: { idle: boolean }) {
  return <T style={[sx.caret, idle && sx.blink]}>{" "}</T>;
}

function BlockView({ b, caret }: { b: Block; caret: ReactNode }) {
  if (b.kind === "code")
    return (
      <View style={st.code}>
        <T v="mono" style={st.codeText}>
          <CodeLines parts={b.parts} />
          {caret}
        </T>
      </View>
    );
  if (b.kind === "h")
    return (
      <T v="display" style={[st.h, b.level === 1 && st.h1]}>
        <Parts parts={b.parts} />
        {caret}
      </T>
    );
  if (b.kind === "li")
    return (
      <View style={st.li}>
        <View style={st.bullet} />
        <T style={st.liText}>
          <Parts parts={b.parts} />
          {caret}
        </T>
      </View>
    );
  return (
    <T style={st.body}>
      <Parts parts={b.parts} />
      {caret}
    </T>
  );
}

/** True for a short while after `text` last grew. */
function useIdle(text: string, rate: number) {
  const [idle, setIdle] = useState(false);
  const [prev, setPrev] = useState(text);
  if (prev !== text) {
    setPrev(text);
    setIdle(false);
  }
  useEffect(() => {
    const id = setTimeout(() => setIdle(true), revealMs.caretIdle / rate);
    return () => clearTimeout(id);
  }, [text, rate]);
  return idle;
}

/**
 * Markdown (same subset as Markdown.tsx) with a reveal on newly streamed text. `streaming`
 * shows the caret (caret mode) and keeps the typewriter running; `rate` matches lab slow-mo for
 * the JS-timed parts (pruning, scramble, typewriter).
 */
export function RevealMarkdown({
  text,
  mode,
  streaming,
  rate = 1,
}: {
  text: string;
  mode: RevealMode;
  streaming: boolean;
  rate?: number;
}) {
  const reduced = reducedMotion();
  // Native gets no CSS keyframes; scramble needs absolute nested text. Caret and typewriter stay.
  const eff: RevealMode =
    reduced || (!isWeb && mode !== "caret" && mode !== "type") ? "none" : mode;
  const shown = useTypewriter(text, eff === "type", rate);
  const pieces = useArrivals(shown, eff, rate, eff !== "none" && eff !== "caret");
  const idle = useIdle(text, rate);
  const blocks = useMemo(() => parse(shown), [shown]);
  const ctx = useMemo(() => ({ mode: eff, pieces, rate }), [eff, pieces, rate]);
  const caret = eff === "caret" && streaming ? <Caret idle={idle && isWeb} /> : null;
  const last = blocks[blocks.length - 1];
  return (
    <RevealCtx.Provider value={ctx}>
      <View style={st.wrap}>
        {blocks.map((b) => (
          <BlockView key={b.key} b={b} caret={b === last ? caret : null} />
        ))}
        {!last && caret ? <T style={st.body}>{caret}</T> : null}
      </View>
    </RevealCtx.Provider>
  );
}

// ---- one-shot titles -------------------------------------------------------------------------

export type TitleMode = "stagger" | "scramble" | "wipe" | "blur";
export const TITLE_REVEALS: Array<{ mode: TitleMode; label: string; spec: string }> = [
  {
    mode: "stagger",
    label: "Letter stagger",
    spec: "per letter opacity + 6px rise, 260ms ease, 15ms stagger",
  },
  {
    mode: "scramble",
    label: "Scramble",
    spec: "glyphs settle left→right over 560ms, per word overlay (no reflow)",
  },
  { mode: "wipe", label: "Wipe", spec: "mask sweep with cyan glow head, 620ms ease" },
  {
    mode: "blur",
    label: "Blur",
    spec: "blur(8px) + 0.04em tracking + opacity → sharp, 380ms ease",
  },
];

/** A title that reveals once on mount. Remount (key) to replay. Static on native / reduced motion. */
export function RevealTitle({
  text,
  mode,
  style,
  rate = 1,
}: {
  text: string;
  mode: TitleMode;
  style?: StyleProp<TextStyle>;
  rate?: number;
}) {
  const [born] = useState(now);
  const ctx = useMemo(() => ({ mode: "none" as RevealMode, pieces: [], rate }), [rate]);
  if (!isWeb || reducedMotion())
    return (
      <T v="display" style={style}>
        {text}
      </T>
    );
  if (mode === "wipe")
    return (
      <T v="display" style={[style, m.titleWipe]}>
        {text}
      </T>
    );
  if (mode === "blur")
    return (
      <T v="display" style={[style, m.titleBlur]}>
        {text}
      </T>
    );
  const words = [...text.matchAll(WORD)].map((w) => ({ w: w[0], at: w.index ?? 0 }));
  return (
    <RevealCtx.Provider value={ctx}>
      <T v="display" style={style}>
        {mode === "scramble"
          ? words.map((w) => <Scramble key={w.at} text={w.w} born={born} ms={560} />)
          : letters(text)}
      </T>
    </RevealCtx.Provider>
  );
}

function letters(text: string) {
  const out: ReactNode[] = [];
  for (let at = 0; at < text.length; at++) out.push(<Letter key={`c${at}`} ch={text[at]} i={at} />);
  return out;
}

function Letter({ ch, i }: { ch: string; i: number }) {
  return <Text style={[m.titleRise, delay(i)]}>{ch}</Text>;
}

const sx = StyleSheet.create({
  ghost: { ...rel, color: "transparent" },
  over: {
    ...web({
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      overflow: "hidden",
      whiteSpace: "pre",
      fontSize: "inherit",
      fontFamily: "inherit",
      fontWeight: "inherit",
      lineHeight: "inherit",
    }),
  },
  overTint: { color: color.cyan2 },
  caret: {
    fontFamily: font.mono,
    backgroundColor: color.cyan,
    marginLeft: 1,
  },
  blink: m.blink,
});

const st = StyleSheet.create({
  wrap: { gap: 8 },
  code: {
    backgroundColor: color.bg,
    borderLeftWidth: 2,
    borderLeftColor: color.deep,
    padding: 10,
  },
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
