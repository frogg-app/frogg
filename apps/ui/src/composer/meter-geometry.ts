/**
 * Geometry shared by every ring in the composer's meter cluster.
 *
 * A leaf module on purpose: the ring component and the cluster that lays it out both need these
 * numbers, and holding them in either one puts the two files in an import cycle. That cycle is
 * not theoretical — it deadlocked the packaged app's first render, because the ring's
 * module-scope styles ran while the cluster module was still initialising.
 */

/** Diameter of a meter ring. Large enough for `COMPOSER_METER_GLYPH_SIZE` text inside it. */
export const COMPOSER_METER_RING_SIZE = 16;

/** Width of one ring's slot, which sets the pitch the rings sit on. */
export const COMPOSER_METER_SLOT_WIDTH = 24;

/** The centre character's size. One point smaller and it stops resolving at 1x. */
export const COMPOSER_METER_GLYPH_SIZE = 8;
