/**
 * Geometry shared by every ring in the composer's meter cluster.
 *
 * A leaf module on purpose: the ring component and the cluster that lays it out both need these
 * numbers, and holding them in either one puts the two files in an import cycle. That cycle is
 * not theoretical — it deadlocked the packaged app's first render, because the ring's
 * module-scope styles ran while the cluster module was still initialising.
 */

/**
 * Diameter of a meter ring. The capsule is 28pt tall with 2pt of padding, so 20 is as large as
 * a ring goes before it touches the capsule's edge — and the larger the ring, the more room its
 * centre character has.
 */
export const COMPOSER_METER_RING_SIZE = 20;

/** Width of one ring's slot, which sets the pitch the rings sit on. */
export const COMPOSER_METER_SLOT_WIDTH = 26;

/** The centre character's size, sized to the ring's inner well rather than the toolbar's text. */
export const COMPOSER_METER_GLYPH_SIZE = 10;
