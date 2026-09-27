/**
 * `Array.prototype.findLastIndex` without relying on it: the engine also runs
 * in the mobile app, whose JS engine cannot be assumed to ship ES2023 arrays.
 */
export function findLastIndex<T>(items: readonly T[], match: (item: T) => boolean): number {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (match(items[index]!)) return index;
  }
  return -1;
}
