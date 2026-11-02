/**
 * Apple keyboards: macOS (desktop or browser) and iPadOS/iOS. Everything else, including Android
 * (whose navigator reports "ReactNative"), uses Ctrl. Kept free of react-native imports so pure
 * modules such as the onboarding model can use it.
 */
function detectApple(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const name = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(name);
}

export const IS_APPLE = detectApple();

const PC: Array<[RegExp, string]> = [
  [/⌘/g, "Ctrl+"],
  [/⌃/g, "Ctrl+"],
  [/⌥/g, "Alt+"],
  [/⇧/g, "Shift+"],
];

/**
 * A shortcut hint written with Apple symbols ("⌘K", "⌘↵", "⌃`"), shown as the user's keyboard
 * spells it: unchanged on Apple devices, "Ctrl+K", "Ctrl+↵", "Ctrl+`" on Windows, Linux and web.
 * Also rewrites hints inside prose ("⌘K opens the palette").
 */
export function kbd(hint: string, apple: boolean = IS_APPLE): string {
  if (apple) return hint;
  return PC.reduce((out, [symbol, word]) => out.replace(symbol, word), hint);
}
