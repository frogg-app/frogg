import { describe, expect, it } from "vitest";
import {
  COMPOSER_METER_GLYPH_SIZE,
  COMPOSER_METER_RING_SIZE,
  COMPOSER_METER_SLOT_WIDTH,
} from "./meter-geometry";

/**
 * The ring component and the cluster that lays it out once held these constants between them,
 * which put the two modules in an import cycle: loading the ring first deadlocked, and the
 * packaged app rendered an empty window. Importing the ring on its own is the regression.
 */
describe("composer meter geometry", () => {
  it("loads the ring without pulling in the cluster that lays it out", async () => {
    const ring = await import("@/components/quota-ring");
    expect(ring.QuotaRing).toBeTypeOf("function");
  });

  it("keeps the glyph small enough to sit inside the ring", () => {
    expect(COMPOSER_METER_GLYPH_SIZE).toBeLessThan(COMPOSER_METER_RING_SIZE);
    expect(COMPOSER_METER_SLOT_WIDTH).toBeGreaterThanOrEqual(COMPOSER_METER_RING_SIZE);
  });
});
