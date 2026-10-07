// Text reveal experiments (lab only for now): how streamed assistant text and one-shot titles
// appear. `RevealMarkdown` renders the same subset as Markdown.tsx but tracks when each range of
// characters arrived, so only the young tail is wrapped in animated spans; settled text is plain.
// Web uses CSS keyframes on inline spans (opacity, filter, top/left on position:relative, mask),
// so nothing reflows. Native cannot animate nested <Text> spans, so a shared frame clock (rAF,
// running only while a live span is mounted) drives them: each live span re-renders only when its
// quantised per-char level changes, expressed as text-colour alpha/tint from precomputed tables.
import {
  createContext,
  Fragment,
  memo,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  Platform,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
} from "react-native";
import { usePrefs } from "../../prefs";
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
    spec: `each word opacity 0→1 + 3px rise (native: alpha ramp, no rise), ${revealMs.fade}ms ease, ${revealMs.fadeStep}ms stagger within a chunk`,
  },
  {
    mode: "blur",
    n: 2,
    label: "Blur-in",
    spec: `each word blur(6px)+opacity 0 → sharp (native: slower alpha fade from a cool cyan tint, no blur), ${revealMs.blur}ms ease, ${revealMs.blurStep}ms stagger`,
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
    spec: `new words cycle glyphs and settle left→right over ${revealMs.scramble}ms (web: overlay, real text holds the layout; native: glyphs swapped in place at ~30fps, minor reflow)`,
  },
  {
    mode: "wipe",
    n: 5,
    label: "Gradient wipe",
    spec: `mask sweeps across each chunk with a cyan glow at the head (native: per-char alpha/tint with a soft leading edge), ${revealMs.wipe}ms ease`,
  },
  {
    mode: "slide",
    n: 6,
    label: "Chunk slide",
    spec: `each network chunk slides from −4px + fades (native: whole-chunk alpha fade, no slide), ${revealMs.slide}ms ease, no stagger`,
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

/** animationDelay in 15ms steps from -900ms to +585ms; negative continues a remounted animation. */
const DELAY = StyleSheet.create(
  Object.fromEntries(
    Array.from({ length: 100 }, (_, i) => [`d${i}`, web({ animationDelay: `${(i - 60) * 15}ms` })]),
  ),
);
const delay = (i: number) => DELAY[`d${Math.min(99, Math.max(0, Math.round(i) + 60))}`];

// ---- reduced motion --------------------------------------------------------------------------

let nativeReduced = false;
const reducedListeners = new Set<() => void>();
const setNativeReduced = (v: boolean) => {
  nativeReduced = v;
  reducedListeners.forEach((l) => l());
};
if (!isWeb) {
  AccessibilityInfo.isReduceMotionEnabled()
    .then(setNativeReduced)
    .catch(() => {});
  AccessibilityInfo.addEventListener("reduceMotionChanged", setNativeReduced);
}
/** Web: prefers-reduced-motion. Native: the OS reduce-motion setting. */
export const reduceMotion = () => (isWeb ? reducedMotion() : nativeReduced);
const subscribeReduced = (l: () => void) => {
  reducedListeners.add(l);
  return () => void reducedListeners.delete(l);
};
function useReduced() {
  return useSyncExternalStore(subscribeReduced, reduceMotion, reduceMotion);
}

// ---- native frame clock ----------------------------------------------------------------------

/** One shared rAF loop that only runs while something is subscribed. */
export const clock = { t: now(), raf: 0 };
const clockListeners = new Set<() => void>();
function frame() {
  clock.t = now();
  clockListeners.forEach((l) => l());
  clock.raf = clockListeners.size ? requestAnimationFrame(frame) : 0;
}
export function subscribeClock(l: () => void) {
  clockListeners.add(l);
  if (!clock.raf) {
    clock.t = now();
    clock.raf = requestAnimationFrame(frame);
  }
  return () => void clockListeners.delete(l);
}

// ---- native levels (pure) --------------------------------------------------------------------

export const LEVELS = 12;
export type Kind =
  | "fade"
  | "blur"
  | "slide"
  | "type"
  | "glow"
  | "wipe"
  | "scramble"
  | "tStagger"
  | "tBlur"
  | "tWipe"
  | "tScramble";

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
/** 0 (start) .. LEVELS (settled) for progress x in 0..1. */
export const lvl = (x: number) => Math.round(easeOut(x) * LEVELS);

const EDGE = 6;
const SCRAMBLE_MS = { scramble: revealMs.scramble, tScramble: 560 };
const ms = {
  fade: revealMs.fade,
  blur: Math.round(revealMs.blur * 1.4),
  slide: Math.round(revealMs.slide * 1.3),
  type: 120,
  glow: revealMs.glow,
  wipe: revealMs.wipe,
  tStagger: 260,
  tBlur: 380,
  tWipe: 620,
};

/**
 * Level of char `i` of `n` after `e` ms (already scaled by lab rate). `w` is the char's word
 * index (word-staggered modes).
 */
export function levelAt(kind: Kind, e: number, i: number, n: number, w: number): number {
  switch (kind) {
    case "fade":
      return lvl((e - w * revealMs.fadeStep) / ms.fade);
    case "blur":
      return lvl((e - w * revealMs.blurStep) / ms.blur);
    case "slide":
      return lvl(e / ms.slide);
    case "type":
      return lvl(e / ms.type);
    case "glow":
      return lvl((e - i * revealMs.glowStep) / ms.glow);
    case "tStagger":
      return lvl((e - i * 15) / ms.tStagger);
    case "tBlur":
      return lvl(e / ms.tBlur);
    case "wipe":
    case "tWipe": {
      const head = (e / ms[kind]) * (n + EDGE);
      return Math.round(clamp01((head - i) / EDGE) * LEVELS);
    }
    default:
      return LEVELS;
  }
}

/** Un-rated lifetime in ms of a piece of `n` chars / `words` words (plus slack for pruning). */
export function lifeOf(kind: Kind, n: number, words: number): number {
  const slack = 60;
  switch (kind) {
    case "fade":
      return ms.fade + words * revealMs.fadeStep + slack;
    case "blur":
      return ms.blur + words * revealMs.blurStep + slack;
    case "glow":
      return ms.glow + n * revealMs.glowStep + slack;
    case "tStagger":
      return ms.tStagger + n * 15 + slack;
    case "scramble":
    case "tScramble":
      return SCRAMBLE_MS[kind] + slack;
    default:
      return ms[kind] + slack;
  }
}

/** Number of leading chars (of `n`) already settled after `e` ms. */
export const settledChars = (kind: "scramble" | "tScramble", e: number, n: number) =>
  Math.floor(clamp01(e / SCRAMBLE_MS[kind]) * n);

const GLYPHS = "▓▒░<>/\\[]{}=+*#_01";
const hash = (i: number, tick: number) =>
  Math.abs(Math.imul(i + 1, 2654435761) ^ Math.imul(tick + 7, 40503)) >>> 0;
const SKIP = /\s/;
export function noiseOf(text: string, from: number, tick: number): string {
  let s = "";
  for (let i = 0; i < text.length; i++)
    s += SKIP.test(text[i]) ? text[i] : GLYPHS[hash(from + i, tick) % GLYPHS.length];
  return s;
}

// ---- native colour tables --------------------------------------------------------------------

type Base = "text" | "cyan" | "muted" | "coral";
export type Tone = Base;
const BASES: Base[] = ["text", "cyan", "muted", "coral"];
const RGB: Record<Base, [number, number, number]> = {
  text: [242, 246, 247],
  cyan: [127, 217, 230],
  muted: [154, 166, 169],
  coral: [255, 107, 107],
};
const COOL: [number, number, number] = [127, 217, 230];
const mix = (a: number[], b: number[], p: number) =>
  a.map((v, i) => Math.round(v + (b[i] - v) * p));
const rgba = (c: number[], a: number) =>
  `rgba(${c[0]},${c[1]},${c[2]},${Math.round(a * 100) / 100})`;
const makeTable = (fn: (b: number[], p: number) => string) =>
  StyleSheet.create(
    Object.fromEntries(
      BASES.flatMap((b) =>
        Array.from({ length: LEVELS + 1 }, (_, l) => [
          `${b}${l}`,
          { color: fn(RGB[b], l / LEVELS) },
        ]),
      ),
    ),
  );
/** Alpha ramp of the base colour. */
const ALPHA = makeTable((b, p) => rgba(b, p));
/** Alpha ramp starting from a cool cyan tint (blur and wipe edge). */
const TINT = makeTable((b, p) => rgba(mix(COOL, b, p), p));
/** Cyan cooling to the base colour, opaque (glow). */
const HEAT = makeTable((b, p) => rgba(mix(COOL, b, p), 1));
const TABLE: Record<Exclude<Kind, "scramble" | "tScramble">, Record<string, TextStyle>> = {
  fade: ALPHA,
  slide: ALPHA,
  type: ALPHA,
  tStagger: ALPHA,
  blur: TINT,
  tBlur: TINT,
  wipe: TINT,
  tWipe: TINT,
  glow: HEAT,
};

// ---- arrival tracking ------------------------------------------------------------------------

interface Piece {
  from: number;
  to: number;
  /** Stagger in 15ms steps (web). */
  d: number;
  born: number;
  /** Native: word index per char (word-staggered modes). */
  w?: number[];
  /** Native: un-rated lifetime in ms. */
  life?: number;
}

const WORD = /\S+\s*/g;

/** Native: one piece per arrived chunk; the level functions handle per-char/word timing. */
function nativePieces(mode: RevealMode, text: string, from: number, to: number, born: number) {
  const chunk = text.slice(from, to);
  if (!chunk) return [];
  const w: number[] = [];
  let k = -1;
  let inWord = false;
  for (const ch of chunk) {
    if (SKIP.test(ch)) inWord = false;
    else if (!inWord) {
      inWord = true;
      k++;
    }
    w.push(Math.max(k, 0));
  }
  const kind = mode as Kind;
  return [{ from, to, d: 0, born, w, life: lifeOf(kind, chunk.length, k + 1) }];
}

/** Splits a newly arrived range into the pieces the mode animates. */
function piecesFor(mode: RevealMode, text: string, from: number, to: number, born: number) {
  if (!isWeb) return nativePieces(mode, text, from, to, born);
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
  if (p.life !== undefined) return p.life;
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
    else {
      clock.t = now();
      r.list = r.list.concat(piecesFor(mode, text, r.text.length, text.length, clock.t));
    }
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

/**
 * Steady per-char reveal decoupled from network chunking, speeding up to drain a backlog. Text
 * present at mount is fully shown; the loop only runs while there is a backlog.
 */
function useTypewriter(full: string, on: boolean, rate: number) {
  const shown = useRef(full.length);
  const acc = useRef(0);
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const len = full.length;
  if (!on || shown.current > len) shown.current = len;
  useEffect(() => {
    if (!on || shown.current >= len) return undefined;
    let id = 0;
    let last = now();
    const tick = () => {
      const t = now();
      const dt = (t - last) / 1000;
      last = t;
      acc.current += dt * rate * (revealMs.typeCps + (len - shown.current) * 3);
      const n = Math.floor(acc.current);
      acc.current -= n;
      if (n > 0) {
        shown.current = Math.min(len, shown.current + n);
        bump();
      }
      if (shown.current < len) id = requestAnimationFrame(tick);
      else acc.current = 0;
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [on, rate, len]);
  return on ? full.slice(0, shown.current) : full;
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
/** Colour of the enclosing text run, so spans fade to their own colour (code, italic). */
const BaseCtx = createContext<Base>("text");

/** Plain text for settled ranges, animated spans for pieces still in flight. */
function Run({ text, at }: Seg) {
  const { mode, pieces, rate } = useContext(RevealCtx);
  const base = useContext(BaseCtx);
  const end = at + text.length;
  const hits = pieces.filter((p) => p.to > at && p.from < end);
  if (!hits.length) return text;
  const out: ReactNode[] = [];
  let pos = at;
  for (const p of hits) {
    const a = Math.max(p.from, at, pos);
    const b = Math.min(p.to, end);
    if (b <= a) continue;
    if (a > pos) out.push(<Fragment key={`t${pos}`}>{text.slice(pos - at, a - at)}</Fragment>);
    const slice = text.slice(a - at, b - at);
    out.push(
      isWeb ? (
        <WebSpan key={`p${p.from}`} mode={mode} piece={p} text={slice} rate={rate} />
      ) : (
        <NativeSpan
          key={`p${p.from}`}
          kind={mode as Kind}
          piece={p}
          off={a - p.from}
          text={slice}
          rate={rate}
          base={base}
        />
      ),
    );
    pos = b;
  }
  if (pos < end) out.push(<Fragment key={`t${pos}`}>{text.slice(pos - at)}</Fragment>);
  return out;
}

function WebSpan({
  mode,
  piece,
  text,
  rate,
}: {
  mode: RevealMode;
  piece: Piece;
  text: string;
  rate: number;
}) {
  // A remounted span (e.g. `**bo` becoming bold) continues from its elapsed time, not from zero.
  const [lag] = useState(() => Math.round((now() - piece.born) / 15));
  if (mode === "scramble") return <Scramble text={text} born={piece.born} rate={rate} />;
  const style = MODE_STYLE[mode];
  if (!style) return text;
  return <Text style={[style, delay(piece.d - lag)]}>{text}</Text>;
}

const MODE_STYLE: Partial<Record<RevealMode, object>> = {
  fade: m.fade,
  blur: m.blur,
  slide: m.slide,
  type: m.type,
  glow: m.glow,
  wipe: m.wipe,
};

/** Frame-clock state of a span: a string of per-char levels, or `settled|tick` for scramble. */
function keyOf(kind: Kind, piece: Piece, off: number, len: number, e: number) {
  const n = piece.to - piece.from;
  if (kind === "scramble" || kind === "tScramble") {
    const s = Math.min(len, Math.max(0, settledChars(kind, e, n) - off));
    return s >= len ? `${len}|0` : `${s}|${Math.floor(e / 33)}`;
  }
  let k = "";
  for (let i = 0; i < len; i++)
    k += levelAt(kind, e, off + i, n, piece.w?.[off + i] ?? 0).toString(36);
  return k;
}

/** Native span: subscribes to the shared clock, re-renders only when its level key changes. */
function NativeSpan({
  kind,
  piece,
  off,
  text,
  rate,
  base,
}: {
  kind: Kind;
  piece: Piece;
  off: number;
  text: string;
  rate: number;
  base: Base;
}) {
  const get = useCallback(
    () => keyOf(kind, piece, off, text.length, (clock.t - piece.born) * rate),
    [kind, piece, off, text.length, rate],
  );
  const key = useSyncExternalStore(subscribeClock, get, get);
  if (kind === "scramble" || kind === "tScramble") {
    const [s, tick] = key.split("|").map(Number);
    if (s >= text.length) return text;
    return (
      <>
        {text.slice(0, s)}
        <Text style={sx.overTint}>{noiseOf(text.slice(s), off + s, tick)}</Text>
      </>
    );
  }
  const table = TABLE[kind];
  const out: ReactNode[] = [];
  let i = 0;
  while (i < key.length) {
    let j = i + 1;
    while (j < key.length && key[j] === key[i]) j++;
    const l = parseInt(key[i], 36);
    const part = text.slice(i, j);
    out.push(
      l >= LEVELS ? (
        <Fragment key={i}>{part}</Fragment>
      ) : (
        <Text key={i} style={table[`${base}${l}`]}>
          {part}
        </Text>
      ),
    );
    i = j;
  }
  return out;
}

/** Real text holds the layout (transparent); a glyph overlay settles left to right on top. */
function Scramble({
  text,
  born,
  ms: dur = revealMs.scramble,
  rate,
  style,
}: {
  text: string;
  born: number;
  ms?: number;
  rate: number;
  style?: StyleProp<TextStyle>;
}) {
  const [, bump] = useReducer((x: number) => x + 1, 0);
  const p = Math.min(1, (now() - born) / (dur / rate));
  useEffect(() => {
    if (p >= 1) return undefined;
    const id = requestAnimationFrame(bump);
    return () => cancelAnimationFrame(id);
  }, [p]);
  if (p >= 1) return <Text style={style}>{text}</Text>;
  const keep = Math.floor(p * text.length);
  return (
    <Text style={[sx.ghost, style]}>
      {text}
      <Text style={[sx.over, style, sx.overTint]}>
        {text.slice(0, keep) + noiseOf(text.slice(keep), keep, Math.floor(p * 40))}
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
            <BaseCtx.Provider value="cyan">
              <Run text={part.slice(1, -1)} at={at + 1} />
            </BaseCtx.Provider>
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
            <BaseCtx.Provider value="muted">
              <Run text={part.slice(1, -1)} at={at + 1} />
            </BaseCtx.Provider>
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

const getBlink = () => Math.floor(clock.t / (revealMs.blink / 2)) % 2 === 0;
function BlinkCaret() {
  const on = useSyncExternalStore(subscribeClock, getBlink, getBlink);
  return <T style={[sx.caret, !on && sx.caretOff]}> </T>;
}

/** state 1: solid, 2: idle (blinking). */
function Caret({ state }: { state: 1 | 2 }) {
  if (state === 2 && !isWeb) return <BlinkCaret />;
  return <T style={[sx.caret, state === 2 && sx.blink]}> </T>;
}

interface BlockProps {
  b: Block;
  pieces: Piece[];
  mode: RevealMode;
  rate: number;
  caret: 0 | 1 | 2;
}

function BlockViewImpl({ b, pieces, mode, rate, caret }: BlockProps) {
  const ctx = useMemo(() => ({ mode, pieces, rate }), [mode, pieces, rate]);
  const c = caret ? <Caret state={caret} /> : null;
  let body: ReactNode;
  if (b.kind === "code")
    body = (
      <View style={st.code}>
        <T v="mono" style={st.codeText}>
          <CodeLines parts={b.parts} />
          {c}
        </T>
      </View>
    );
  else if (b.kind === "h")
    body = (
      <T v="display" style={[st.h, b.level === 1 && st.h1]}>
        <Parts parts={b.parts} />
        {c}
      </T>
    );
  else if (b.kind === "li")
    body = (
      <View style={st.li}>
        <View style={st.bullet} />
        <T style={st.liText}>
          <Parts parts={b.parts} />
          {c}
        </T>
      </View>
    );
  else
    body = (
      <T style={st.body}>
        <Parts parts={b.parts} />
        {c}
      </T>
    );
  return <RevealCtx.Provider value={ctx}>{body}</RevealCtx.Provider>;
}

function sameBlock(a: BlockProps, b: BlockProps) {
  if (a.mode !== b.mode || a.rate !== b.rate || a.caret !== b.caret) return false;
  if (a.b.key !== b.b.key || a.b.kind !== b.b.kind || a.b.level !== b.b.level) return false;
  if (a.b.parts.length !== b.b.parts.length || a.pieces.length !== b.pieces.length) return false;
  if (a.b.parts.some((p, i) => p.text !== b.b.parts[i].text || p.at !== b.b.parts[i].at))
    return false;
  return a.pieces.every((p, i) => p === b.pieces[i]);
}
/** Settled blocks (same text, no live pieces) skip re-rendering while the tail streams. */
const BlockView = memo(BlockViewImpl, sameBlock);

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

const NO_PIECES: Piece[] = [];
function piecesIn(b: Block, pieces: Piece[]) {
  if (!pieces.length || !b.parts.length) return NO_PIECES;
  const lo = b.parts[0].at;
  const last = b.parts[b.parts.length - 1];
  const hi = last.at + last.text.length;
  const hit = pieces.filter((p) => p.to > lo && p.from < hi);
  return hit.length ? hit : NO_PIECES;
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
  const reduced = useReduced();
  const eff: RevealMode = reduced ? "none" : mode;
  const shown = useTypewriter(text, eff === "type" && streaming, rate);
  const pieces = useArrivals(shown, eff, rate, eff !== "none" && eff !== "caret");
  const idle = useIdle(text, rate);
  const blocks = useMemo(() => parse(shown), [shown]);
  let caret: 0 | 1 | 2 = 0;
  if (eff === "caret" && streaming) caret = idle ? 2 : 1;
  const lastIdx = blocks.length - 1;
  return (
    <View style={st.wrap}>
      {blocks.map((b, i) => (
        <BlockView
          key={b.key}
          b={b}
          pieces={piecesIn(b, pieces)}
          mode={eff}
          rate={rate}
          caret={i === lastIdx ? caret : 0}
        />
      ))}
      {lastIdx < 0 && caret ? (
        <T style={st.body}>
          <Caret state={caret} />
        </T>
      ) : null}
    </View>
  );
}

// ---- one-shot titles -------------------------------------------------------------------------

export type TitleMode = "stagger" | "scramble" | "wipe" | "blur";
export const TITLE_REVEALS: Array<{ mode: TitleMode; label: string; spec: string }> = [
  {
    mode: "stagger",
    label: "Letter stagger",
    spec: "per letter opacity + 6px rise, 260ms ease, 15ms stagger (native: alpha only, no rise)",
  },
  {
    mode: "scramble",
    label: "Scramble",
    spec: "glyphs settle left→right over 560ms (web: per word overlay, no reflow; native: whole title swapped in place)",
  },
  {
    mode: "wipe",
    label: "Wipe",
    spec: "mask sweep with cyan glow head, 620ms ease (native: per-char alpha/tint, soft leading edge)",
  },
  {
    mode: "blur",
    label: "Blur",
    spec: "blur(8px) + 0.04em tracking + opacity → sharp, 380ms ease (native: alpha fade from a cool cyan tint)",
  },
];

const TITLE_KIND: Record<TitleMode, Kind> = {
  stagger: "tStagger",
  scramble: "tScramble",
  wipe: "tWipe",
  blur: "tBlur",
};

/** A title that reveals once on mount. Remount (key) to replay. Instant under reduced motion. */
export function RevealTitle({
  text,
  mode,
  style,
  rate = 1,
  numberOfLines,
  tone = "text",
}: {
  text: string;
  mode: TitleMode;
  style?: StyleProp<TextStyle>;
  rate?: number;
  numberOfLines?: number;
  /** Colour the title settles to, so native alpha fades end on it. */
  tone?: Tone;
}) {
  const [born] = useState(now);
  const reduced = useReduced();
  const ctx = useMemo(() => ({ mode: "none" as RevealMode, pieces: [], rate }), [rate]);
  const kind = TITLE_KIND[mode];
  const piece = useMemo<Piece>(
    () => ({ from: 0, to: text.length, d: 0, born, life: lifeOf(kind, text.length, 0) }),
    [born, kind, text.length],
  );
  if (reduced)
    return (
      <T v="display" numberOfLines={numberOfLines} style={style}>
        {text}
      </T>
    );
  if (!isWeb)
    return (
      <T v="display" numberOfLines={numberOfLines} style={style}>
        <NativeSpan kind={kind} piece={piece} off={0} text={text} rate={rate} base={tone} />
      </T>
    );
  if (mode === "wipe")
    return (
      <T v="display" numberOfLines={numberOfLines} style={[style, m.titleWipe]}>
        {text}
      </T>
    );
  if (mode === "blur")
    return (
      <T v="display" numberOfLines={numberOfLines} style={[style, m.titleBlur]}>
        {text}
      </T>
    );
  const words = [...text.matchAll(WORD)].map((w) => ({ w: w[0], at: w.index ?? 0 }));
  return (
    <RevealCtx.Provider value={ctx}>
      <T v="display" numberOfLines={numberOfLines} style={style}>
        {mode === "scramble"
          ? words.map((w) => <Scramble key={w.at} text={w.w} born={born} ms={560} rate={rate} />)
          : letters(text)}
      </T>
    </RevealCtx.Provider>
  );
}

/** RevealTitle driven by the `headingReveal` preference; plain display text when "none". */
export function RevealHeading({
  text,
  style,
  numberOfLines,
  tone,
}: {
  text: string;
  style?: StyleProp<TextStyle>;
  numberOfLines?: number;
  tone?: Tone;
}) {
  const mode = usePrefs((s) => s.headingReveal);
  if (mode === "none")
    return (
      <T v="display" numberOfLines={numberOfLines} style={style}>
        {text}
      </T>
    );
  return (
    <RevealTitle text={text} mode={mode} style={style} numberOfLines={numberOfLines} tone={tone} />
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
  caretOff: { backgroundColor: "transparent" },
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
