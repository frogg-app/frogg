import { Easing } from "react-native";

/**
 * Motion for small in-place swaps: a control fading in over another, a hover affordance, a
 * modifier-hold reveal. Long enough to read as a transition rather than a flicker, short
 * enough that a held key or a hover still feels answered at once.
 */
export const MOTION_SWAP_DURATION_MS = 150;

/** Decelerating: the change lands fast and settles, which is what makes a short swap feel snappy. */
export const MOTION_SWAP_EASING = Easing.out(Easing.cubic);
