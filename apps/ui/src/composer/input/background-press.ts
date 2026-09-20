/**
 * Clicking the chat box anywhere that is not itself a control should put the
 * caret in the message input, the way a click into the padding of a native
 * text field does. The predicate below decides whether a press that landed
 * inside the box landed on "background" chrome, so the wrapper can focus the
 * input without stealing clicks from the buttons and pills in the same box.
 */

const INTERACTIVE_SELECTOR = [
  "a",
  "button",
  "input",
  "select",
  "textarea",
  "[contenteditable='true']",
  "[role='button']",
  "[role='checkbox']",
  "[role='combobox']",
  "[role='link']",
  "[role='menuitem']",
  "[role='option']",
  "[role='radio']",
  "[role='slider']",
  "[role='switch']",
  "[role='tab']",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface PressTarget {
  closest?: (selector: string) => unknown;
}

/**
 * True when a press on `target` should move focus to the message input: it did
 * not land on a control, nor on the input itself (which the browser focuses on
 * its own, and where a synthetic focus would fight the caret placement).
 */
export function isComposerBackgroundPress(target: unknown): boolean {
  if (target == null) return false;
  const node = target as PressTarget;
  if (typeof node.closest !== "function") return false;
  return node.closest(INTERACTIVE_SELECTOR) == null;
}
