/**
 * Device names, pairing-request names and match codes are written by whoever
 * is asking to be let in, not by the host. They are rendered next to Approve
 * and Revoke buttons, so they are treated as hostile input: never as markup,
 * never long enough to push a button off screen, and never able to reorder the
 * line around them with bidi controls.
 *
 * React Native `<Text>` has no markup to inject into, and react-native-web
 * escapes its children, so the remaining risks are spoofing ones — hence the
 * stripping and the length cap rather than HTML escaping.
 */

/** Longer than most real device names, short enough to keep a row one line. */
export const UNTRUSTED_NAME_DISPLAY_MAX = 48;

const ELLIPSIS = "…";

// C0/C1 controls, bidi overrides and embeddings, zero-width and invisible
// formatting characters, and the interlinear annotation range.
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const DANGEROUS = /[\u0000-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g;

export interface UntrustedTextOptions {
  max?: number;
  /** Shown when the value is empty once cleaned. */
  fallback?: string;
}

/**
 * Cleans and truncates attacker-authored text for display. Returns the
 * fallback (default an empty string) when nothing printable is left.
 */
export function sanitizeUntrustedText(
  value: string | null | undefined,
  options: UntrustedTextOptions = {},
): string {
  const max = options.max ?? UNTRUSTED_NAME_DISPLAY_MAX;
  const cleaned = (value ?? "")
    // Any run of whitespace, including newlines, becomes one space so a name
    // cannot grow its row or hide text below the fold. This runs first because
    // newlines are also C0 controls, and dropping them would join two lines
    // into one word.
    .replace(/\s+/g, " ")
    .replace(DANGEROUS, "")
    .replace(/\s+/g, " ")
    .trim();
  if (cleaned.length === 0) return options.fallback ?? "";
  if (cleaned.length <= max) return cleaned;
  // Split on code points so a truncation never cuts a surrogate pair in half.
  return [...cleaned].slice(0, Math.max(1, max - 1)).join("") + ELLIPSIS;
}

/** True when {@link sanitizeUntrustedText} would shorten the value. */
export function isUntrustedTextTruncated(
  value: string | null | undefined,
  options: UntrustedTextOptions = {},
): boolean {
  const sanitized = sanitizeUntrustedText(value, options);
  return sanitized.endsWith(ELLIPSIS) && sanitized !== value;
}
