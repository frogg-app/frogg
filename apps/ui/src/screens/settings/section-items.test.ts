import { describe, expect, it } from "vitest";
import { SETTINGS_SECTION_SLUGS } from "@/utils/host-routes";
import { SIDEBAR_SECTION_ITEMS, visibleSettingsSections } from "./section-items";

// Guards against merges and upstream syncs quietly restoring removed sections
// (Layout, Editor, Integrations) or re-promoting General's Companion and
// Diagnostics groups to top-level sections. Change this list only on purpose.
const EXPECTED_SECTIONS = [
  "general",
  "appearance",
  "shortcuts",
  "notifications",
  "permissions",
  "about",
];
// Developer is registered but hidden unless About's "Developer options" switch is on.
const ALL_SECTIONS = [
  "general",
  "appearance",
  "shortcuts",
  "notifications",
  "permissions",
  "developer",
  "about",
];

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("app settings sections", () => {
  it("lists exactly the expected sections, in order", () => {
    expect(ids(SIDEBAR_SECTION_ITEMS)).toEqual(ALL_SECTIONS);
    expect([...SETTINGS_SECTION_SLUGS].sort()).toEqual([...ALL_SECTIONS].sort());
  });

  it("shows every section on desktop with shortcuts, About last", () => {
    const visible = ids(
      visibleSettingsSections({
        isDesktopApp: true,
        shortcutsAvailable: true,
        developerOptions: false,
      }),
    );
    expect(visible).toEqual(EXPECTED_SECTIONS);
  });

  it("hides desktop-only and shortcut sections where they do not apply", () => {
    const visible = ids(
      visibleSettingsSections({
        isDesktopApp: false,
        shortcutsAvailable: false,
        developerOptions: false,
      }),
    );
    expect(visible).toEqual(["general", "appearance", "about"]);
  });

  it("shows Developer before About only when developer options are on", () => {
    const visible = ids(
      visibleSettingsSections({
        isDesktopApp: true,
        shortcutsAvailable: true,
        developerOptions: true,
      }),
    );
    expect(visible).toEqual(ALL_SECTIONS);
    const mobile = ids(
      visibleSettingsSections({
        isDesktopApp: false,
        shortcutsAvailable: false,
        developerOptions: true,
      }),
    );
    expect(mobile).toEqual(["general", "appearance", "developer", "about"]);
  });
});
