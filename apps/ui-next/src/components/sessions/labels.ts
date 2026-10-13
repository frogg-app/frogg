import { color } from "../../theme/tokens";
import type { LabelColor } from "./directory";

/** Daemon label colours mapped onto the palette; chips tint their fill with the same hue. */
const HUE: Record<LabelColor, string> = {
  violet: color.violet,
  sky: color.cyan2,
  emerald: color.mint,
  orange: color.amber,
  pink: color.coral,
  indigo: color.violet,
  teal: color.cyan,
  red: color.coral,
  amber: color.amber,
  blue: color.cyan2,
};

export const labelHue = (c: LabelColor | undefined): string => (c ? HUE[c] : color.muted);
/** Hex palette colour with a low alpha suffix, for chip fills. */
export const labelFill = (c: LabelColor | undefined): string => `${labelHue(c)}26`;
