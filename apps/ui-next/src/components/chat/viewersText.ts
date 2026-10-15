// Pure text and colour for the "who else is here" widget (Viewers.tsx), kept free of React Native.
import { isActive, type Viewer } from "../../daemon/viewers";
import { labelTint } from "../../theme/tokens";

const TINTS = Object.values(labelTint);

function hash(v: string): number {
  let h = 0;
  for (let i = 0; i < v.length; i += 1) h = (h * 31 + v.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The same device gets the same tint in every chat. */
export const tintOf = (key: string) => TINTS[hash(key) % TINTS.length];

/** One or two letters from the first two words; "?" when nothing printable is left. */
export function initials(name: string): string {
  const words = name
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "?";
  const letters =
    words.length === 1 ? [...words[0]].slice(0, 2) : [[...words[0]][0], [...words[1]][0]];
  return letters.join("").toUpperCase();
}

const VERB: Record<Viewer["activity"], string> = {
  typing: "is typing",
  sending: "is sending",
  input: "is answering",
  viewing: "is here",
  idle: "is here",
};

/** "Pixel 8 is here", "Pixel 8 and Laptop are here", "Pixel 8 is typing · 2 more here". */
export function describeViewers(list: Viewer[]): { lead: string; rest: string | null } {
  const active = list.find(isActive);
  if (active) {
    const more = list.length - 1;
    return {
      lead: `${active.name} ${VERB[active.activity]}`,
      rest: more ? `${more} more here` : null,
    };
  }
  const [a, b] = list;
  if (!a) return { lead: "", rest: null };
  if (!b) return { lead: `${a.name} is here`, rest: null };
  if (list.length === 2) return { lead: `${a.name} and ${b.name} are here`, rest: null };
  return { lead: `${a.name} and ${list.length - 1} others are here`, rest: null };
}
