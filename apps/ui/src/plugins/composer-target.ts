/**
 * The composer a plugin's `ctx.composer.insertText` writes into: the one in the focused pane.
 * Composers register while active; the most recent registration wins.
 */
export interface ComposerInsertTarget {
  insert: (text: string) => void;
}

const targets: ComposerInsertTarget[] = [];

export function registerComposerTarget(target: ComposerInsertTarget): () => void {
  targets.push(target);
  return () => {
    const index = targets.lastIndexOf(target);
    if (index >= 0) targets.splice(index, 1);
  };
}

/** False when no composer is active. */
export function insertIntoActiveComposer(text: string): boolean {
  const target = targets.at(-1);
  if (!target) return false;
  target.insert(text);
  return true;
}
