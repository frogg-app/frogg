import { describe, expect, it } from "vitest";
import {
  resolveWorkspaceExplorerToggleOwner,
  shouldShowHeaderExplorerToggle,
} from "./workspace-explorer-toggle";

describe("explorer toggle placement", () => {
  it("shows the header toggle on desktop while the sidebar is closed", () => {
    expect(shouldShowHeaderExplorerToggle({ owner: "header", docked: false })).toBe(true);
    expect(shouldShowHeaderExplorerToggle({ owner: "window", docked: false })).toBe(true);
  });

  it("hands the toggle to the open sidebar's tab rail", () => {
    expect(shouldShowHeaderExplorerToggle({ owner: "header", docked: true })).toBe(false);
    expect(shouldShowHeaderExplorerToggle({ owner: "window", docked: true })).toBe(false);
  });

  it("renders no header toggle on mobile, which has its own navigation", () => {
    expect(shouldShowHeaderExplorerToggle({ owner: "mobile", docked: false })).toBe(false);
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
