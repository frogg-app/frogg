/**
 * Identity colour and initials for a presence avatar. Pure so the same person
 * gets the same colour in every panel, list and composer outline.
 */

/** Mid-tone hues that read on both the light and dark surfaces. */
const AVATAR_COLORS = [
  "#3b82f6",
  "#10b981",
  "#8b5cf6",
  "#f59e0b",
  "#ec4899",
  "#14b8a6",
  "#f97316",
  "#6366f1",
] as const;

function hash(value: string): number {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) {
    result = (result * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(result);
}

export function presenceAvatarColor(identity: string): string {
  return AVATAR_COLORS[hash(identity) % AVATAR_COLORS.length]!;
}

/** One or two letters: the first letters of the first two words. "?" for none. */
export function presenceInitials(name: string): string {
  const words = name
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  const letters =
    words.length === 1
      ? [...words[0]!].slice(0, 2)
      : [words[0]!, words[1]!].map((word) => [...word][0]);
  return letters.join("").toUpperCase();
}
