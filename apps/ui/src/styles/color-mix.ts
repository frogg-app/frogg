/**
 * Blending two theme colours by hand rather than through Reanimated: these are
 * SVG stroke props, which `useAnimatedProps` cannot drive identically across
 * web and native, and the meters are small enough that a plain re-render per
 * frame costs nothing. Anything this cannot parse snaps to the target, which
 * is the same behaviour as not animating at all.
 */

function parseHex(color: string): [number, number, number] | null {
  const value = color.trim();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(value);
  if (short) {
    return [
      Number.parseInt(`${short[1]}${short[1]}`, 16),
      Number.parseInt(`${short[2]}${short[2]}`, 16),
      Number.parseInt(`${short[3]}${short[3]}`, 16),
    ];
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})[0-9a-f]{0,2}$/i.exec(value);
  if (long) {
    return [
      Number.parseInt(long[1] ?? "", 16),
      Number.parseInt(long[2] ?? "", 16),
      Number.parseInt(long[3] ?? "", 16),
    ];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(value);
  if (rgb) {
    return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  }
  return null;
}

function toHex(channel: number): string {
  return Math.round(Math.min(255, Math.max(0, channel)))
    .toString(16)
    .padStart(2, "0");
}

/** `from` at t=0, `to` at t=1, mixed in sRGB. */
export function mixColor(from: string, to: string, t: number): string {
  if (t <= 0) return from;
  if (t >= 1) return to;
  const start = parseHex(from);
  const end = parseHex(to);
  if (!start || !end) return to;
  const [r, g, b] = [0, 1, 2].map(
    (index) => (start[index] ?? 0) + ((end[index] ?? 0) - (start[index] ?? 0)) * t,
  );
  return `#${toHex(r ?? 0)}${toHex(g ?? 0)}${toHex(b ?? 0)}`;
}
