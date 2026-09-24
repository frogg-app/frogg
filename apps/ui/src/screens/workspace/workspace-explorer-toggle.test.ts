import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceExplorerToggleOwner,
  shouldShowHeaderExplorerToggle,
} from "./workspace-explorer-toggle";

describe("explorer toggle placement", () => {
  it("pins the toggle to the header on every desktop platform", () => {
    expect(shouldShowHeaderExplorerToggle({ owner: "header" })).toBe(true);
    expect(shouldShowHeaderExplorerToggle({ owner: "window" })).toBe(true);
  });

  it("renders no header toggle on mobile, which has its own navigation", () => {
    expect(shouldShowHeaderExplorerToggle({ owner: "mobile" })).toBe(false);
  });

  it("routes owners by platform and window chrome", () => {
    expect(
      resolveWorkspaceExplorerToggleOwner({
        isMobile: true,
        hasMacTrafficLights: false,
      }),
    ).toBe("mobile");
    expect(
      resolveWorkspaceExplorerToggleOwner({
        isMobile: false,
        hasMacTrafficLights: true,
      }),
    ).toBe("window");
    expect(
      resolveWorkspaceExplorerToggleOwner({
        isMobile: false,
        hasMacTrafficLights: false,
      }),
    ).toBe("header");
  });
});
