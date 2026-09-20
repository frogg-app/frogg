import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMPOSER_METER_GLYPH_SIZE,
  COMPOSER_METER_RING_SIZE,
  COMPOSER_METER_SLOT_WIDTH,
} from "./meter-geometry";

/**
 * The ring component and the cluster that lays it out once held these constants between them,
 * which put the two modules in an import cycle: loading the ring first deadlocked, and because
 * the ring builds its styles at module scope the packaged app rendered an empty window. The
 * constants live in this leaf module so neither side has to import the other.
 */
describe("composer meter geometry", () => {
  it("keeps the ring and the cluster out of an import cycle", async () => {
    const ring = await readFile(path.resolve(__dirname, "../components/quota-ring.tsx"), "utf8");
    expect(ring).not.toContain("composer/usage-cluster");
  });

  it("keeps the glyph small enough to sit inside the ring", () => {
    expect(COMPOSER_METER_GLYPH_SIZE).toBeLessThan(COMPOSER_METER_RING_SIZE);
    expect(COMPOSER_METER_SLOT_WIDTH).toBeGreaterThanOrEqual(COMPOSER_METER_RING_SIZE);
  });
});
