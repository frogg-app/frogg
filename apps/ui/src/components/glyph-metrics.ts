import { Platform } from "react-native";

/**
 * How far a character's ink sits from the middle of its own text box, in points, positive when
 * the ink sits below the middle and therefore has to be lifted by that much to look centred.
 *
 * Centring a text box does not centre the character in it. The box is the font's em — ascender
 * to descender — and where the baseline falls inside it, and how tall a capital is above that
 * baseline, are the font's business. A capital S in one font lands a little below the box's
 * middle and in another a little above, so a fixed nudge tuned to one font is wrong in the next;
 * the app's UI font is a `system-ui` stack the user can override, so it really is a different
 * font from one machine to the next.
 *
 * The browser can answer the question exactly, so on web we ask it: `TextMetrics` gives both the
 * font's own ascent and descent, which fix the baseline inside the box, and the ink's actual
 * ascent and descent for this particular character, which fix the ink around the baseline.
 *
 * React Native has no equivalent, so native returns 0 and keeps plain box centring.
 */
export function measureGlyphRise(glyph: string, fontSize: number, fontFamily: string): number {
  if (Platform.OS !== "web" || typeof document === "undefined") return 0;
  const key = `${glyph}|${fontSize}|${fontFamily}`;
  const cached = riseCache.get(key);
  if (cached !== undefined) return cached;
  const rise = computeGlyphRise(glyph, fontSize, fontFamily);
  riseCache.set(key, rise);
  return rise;
}

/** Measuring costs a canvas draw, and a ring re-renders on every usage refresh. */
const riseCache = new Map<string, number>();

let sharedContext: CanvasRenderingContext2D | null | undefined;

function getMeasuringContext(): CanvasRenderingContext2D | null {
  if (sharedContext === undefined) {
    sharedContext = document.createElement("canvas").getContext("2d");
  }
  return sharedContext;
}

function computeGlyphRise(glyph: string, fontSize: number, fontFamily: string): number {
  const context = getMeasuringContext();
  if (!context) return 0;
  context.font = `${fontSize}px ${fontFamily}`;
  const metrics = context.measureText(glyph);
  const { fontBoundingBoxAscent, fontBoundingBoxDescent } = metrics;
  const { actualBoundingBoxAscent, actualBoundingBoxDescent } = metrics;
  if (
    !Number.isFinite(fontBoundingBoxAscent) ||
    !Number.isFinite(fontBoundingBoxDescent) ||
    !Number.isFinite(actualBoundingBoxAscent) ||
    !Number.isFinite(actualBoundingBoxDescent)
  ) {
    return 0;
  }
  // The text box is one line tall — `lineHeight` is set to the font size — and the box's leading
  // is split evenly above and below the font's own ascent and descent, which puts the baseline
  // here, measured down from the top of the box.
  const baseline =
    (fontSize - (fontBoundingBoxAscent + fontBoundingBoxDescent)) / 2 + fontBoundingBoxAscent;
  // The ink runs from `actualBoundingBoxAscent` above the baseline to `actualBoundingBoxDescent`
  // below it, so its middle sits here — below the baseline for a capital, which has no descender.
  const inkCenter = baseline + (actualBoundingBoxDescent - actualBoundingBoxAscent) / 2;
  return inkCenter - fontSize / 2;
}
