import { describe, expect, it } from "vitest";
import {
  EXPLORER_TAB_ICON_ONLY_WIDTH,
  explorerTabStripWidth,
  shouldCollapseExplorerTabLabels,
} from "./explorer-tab-strip-layout";

const FULL_STRIP = ["Changes", "Files", "#109", "CI"];

describe("explorer tab strip layout", () => {
  it("keeps labels while the strip has room for them", () => {
    expect(shouldCollapseExplorerTabLabels({ labels: FULL_STRIP, availableWidth: 400 })).toBe(
      false,
    );
  });

  it("drops labels once the labelled strip no longer fits", () => {
    expect(shouldCollapseExplorerTabLabels({ labels: FULL_STRIP, availableWidth: 120 })).toBe(true);
  });

  it("draws the labelled form before the strip has been measured", () => {
    expect(shouldCollapseExplorerTabLabels({ labels: FULL_STRIP, availableWidth: 0 })).toBe(false);
  });

  it("collapses to the icons plus their gaps and nothing more", () => {
    expect(explorerTabStripWidth({ labels: FULL_STRIP, withLabels: false })).toBe(
      EXPLORER_TAB_ICON_ONLY_WIDTH * 4 + 4 * 3,
    );
  });

  it("has no width with no tabs", () => {
    expect(explorerTabStripWidth({ labels: [], withLabels: true })).toBe(0);
  });
});
