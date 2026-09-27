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

const ids = (items: { id: string }[]) => items.map((item) => item.id);

describe("app settings sections", () => {
  it("lists exactly the expected sections, in order", () => {
    expect(ids(SIDEBAR_SECTION_ITEMS)).toEqual(EXPECTED_SECTIONS);
    expect([...SETTINGS_SECTION_SLUGS].sort()).toEqual([...EXPECTED_SECTIONS].sort());
  });

  it("shows every section on desktop with shortcuts, About last", () => {
    const visible = ids(visibleSettingsSections({ isDesktopApp: true, shortcutsAvailable: true }));
    expect(visible).toEqual(EXPECTED_SECTIONS);
  });

  it("hides desktop-only and shortcut sections where they do not apply", () => {
    const visible = ids(
      visibleSettingsSections({ isDesktopApp: false, shortcutsAvailable: false }),
    );
    expect(visible).toEqual(["general", "appearance", "about"]);
  });
});
