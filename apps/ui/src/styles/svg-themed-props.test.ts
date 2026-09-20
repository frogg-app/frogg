import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `withUnistyles` resolves its theme mapping into props of the component it wraps, which works
 * for anything reading those values through `style`. `react-native-svg`'s drawing primitives do
 * not: `stroke` and `fill` are plain props they read directly, so a mapped `Circle` renders with
 * no stroke — an invisible ring, which shipped once in the composer's quota meters.
 *
 * Theme an SVG by wrapping a component of your own that takes the resolved colours as a prop,
 * the way `checks-progress-ring` does.
 */

/** The primitives that read `stroke` and `fill` directly. `SvgXml` and friends wrap fine. */
const SVG_PRIMITIVES = new Set([
  "Circle",
  "Ellipse",
  "G",
  "Line",
  "Path",
  "Polygon",
  "Polyline",
  "Rect",
  "Text",
]);

/**
 * The primitives one file imports from `react-native-svg`, under whatever local name it gives
 * them. Matching the import rather than the bare name matters: `Circle` is also a lucide icon,
 * and lucide icons take their colour through props `withUnistyles` does reach.
 */
function importedPrimitives(source: string): string[] {
  const names: string[] = [];
  const importPattern = /import\s+([^;]*?)\s+from\s+["']react-native-svg["']/g;
  for (const match of source.matchAll(importPattern)) {
    const braces = /\{([^}]*)\}/.exec(match[1] ?? "");
    for (const part of (braces?.[1] ?? "").split(",")) {
      const segments = part.trim().split(/\s+as\s+/);
      const imported = segments[0]?.trim();
      const local = segments.at(-1)?.trim();
      if (imported && local && SVG_PRIMITIVES.has(imported)) names.push(local);
    }
  }
  return names;
}

const SRC = path.resolve(__dirname, "..");

async function sourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    }),
  );
  return nested.flat();
}

describe("themed SVG props", () => {
  it("never wraps an SVG drawing primitive with withUnistyles", async () => {
    const offenders: string[] = [];
    for (const file of await sourceFiles(SRC)) {
      const source = await readFile(file, "utf8");
      const names = importedPrimitives(source);
      if (names.length === 0) continue;
      const pattern = new RegExp(`withUnistyles\\(\\s*(${names.join("|")})\\s*[,)]`);
      if (pattern.test(source)) offenders.push(path.relative(SRC, file));
    }
    expect(offenders).toEqual([]);
  });
});
