/**
 * How wide the Explorer sidebar's tab strip wants to be, and therefore when it has to drop
 * its labels.
 *
 * The strip used to be clipped by the header once the panel got narrow: the tabs kept their
 * labels, ran past the close button and the window controls, and the last tab simply was not
 * reachable. Losing a label is recoverable — the icon still says which tab it is and the
 * tooltip spells it out — whereas losing the button is not, so the strip collapses to
 * icon-only rather than overflowing.
 */

/** The tab icon, at the size the tab buttons render it. */
const TAB_ICON_SIZE = 13;
/** `styles.tab`'s horizontal padding, both sides. */
const TAB_HORIZONTAL_PADDING = 24;
/** `styles.tabsContainer`'s gap between two tabs. */
const TAB_GAP = 4;
/** The gap between a tab's icon and its label. */
const TAB_ICON_LABEL_GAP = 8;
/**
 * Average advance of the tab label's typeface at its rendered size. Deliberately generous:
 * over-estimating collapses the strip a few pixels early, under-estimating clips it, and only
 * one of those two loses a button.
 */
const TAB_LABEL_CHARACTER_WIDTH = 7.5;

/** One tab with its icon and no label. */
export const EXPLORER_TAB_ICON_ONLY_WIDTH = TAB_ICON_SIZE + TAB_HORIZONTAL_PADDING;

export function explorerTabStripWidth(input: {
  labels: readonly string[];
  withLabels: boolean;
}): number {
  const { labels, withLabels } = input;
  if (labels.length === 0) return 0;
  const tabs = labels.reduce((total, label) => {
    const labelWidth = withLabels
      ? TAB_ICON_LABEL_GAP + label.length * TAB_LABEL_CHARACTER_WIDTH
      : 0;
    return total + EXPLORER_TAB_ICON_ONLY_WIDTH + labelWidth;
  }, 0);
  return tabs + TAB_GAP * (labels.length - 1);
}

/**
 * Labels stay while every tab still fits with one. `availableWidth` of 0 means the strip has
 * not been measured yet, and the labelled form is the right thing to draw first: it is what
 * the panel shows at any ordinary width.
 */
export function shouldCollapseExplorerTabLabels(input: {
  labels: readonly string[];
  availableWidth: number;
}): boolean {
  if (input.availableWidth <= 0) return false;
  return explorerTabStripWidth({ labels: input.labels, withLabels: true }) > input.availableWidth;
}
