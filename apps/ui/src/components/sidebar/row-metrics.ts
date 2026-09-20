/**
 * The fixed trailing columns a sidebar row holds open whether or not it has anything to draw
 * in them.
 *
 * Workspace rows and the agent rows nested under them both reserve these, so a row's account
 * glyph and its kebab land on the same rail whatever the row is: with subagents or without,
 * hovered or not, a session or one of its agents. Anything that only appears sometimes and is
 * not reserved here reflows its neighbours the moment it appears, which is how the right edge
 * of the list ended up ragged.
 */

/**
 * The actions column: the kebab trigger's painted footprint (a 14px icon, 2px padding each
 * side, 2px lead-in) less the 7px it is pulled right onto the row's trailing edge.
 */
export const SIDEBAR_ROW_ACTIONS_COLUMN_WIDTH = 13;

/** The disclosure chevron's column, held open on rows that have no children to disclose. */
export const SIDEBAR_ROW_DISCLOSURE_WIDTH = 16;
