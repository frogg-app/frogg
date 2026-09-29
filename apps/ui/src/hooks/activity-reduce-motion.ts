/**
 * Activity indicators (loaders, shimmers, pulses) freeze when the OS asks for reduced motion.
 * On Windows that follows "Animation effects", so a working agent can read as stuck. The
 * `animateActivityUnderReducedMotion` preference lets those indicators keep moving; every
 * other animation still honours the OS setting.
 */
export function resolveActivityReduceMotion(
  osReducedMotion: boolean,
  animateAnyway: boolean,
): boolean {
  return osReducedMotion && !animateAnyway;
}
