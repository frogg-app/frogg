import { describe, expect, it } from "vitest";
import { brand } from "@frogg/branding";
import { HOST_SETTINGS_SECTIONS } from "@frogg/branding/schema";
import {
  isHostSectionVisible,
  resolveHiddenHostSections,
  resolveHiddenSectionRedirect,
  visibleHostSectionItems,
} from "./host-section-visibility";
import { HOST_SECTION_ITEMS } from "./section-items";
import { HOST_SECTION_SLUGS } from "@/utils/host-routes";

describe("host settings section visibility", () => {
  it("takes the daemon's list, and the brand's only when the daemon says nothing", () => {
    expect(resolveHiddenHostSections(["agents"])).toEqual(["agents"]);
    // An admin who re-enables everything sends an empty list, which is not "unset".
    expect(resolveHiddenHostSections([])).toEqual([]);
    expect(resolveHiddenHostSections(undefined)).toEqual(brand.hostSettings.hiddenSections);
  });

  it("drops hidden sections from the nav and keeps the rest in order", () => {
    const items = visibleHostSectionItems(["terminals", "agents"]);
    expect(items.map((item) => item.id)).toEqual(
      HOST_SECTION_ITEMS.filter((item) => item.id !== "terminals" && item.id !== "agents").map(
        (item) => item.id,
      ),
    );
    expect(isHostSectionVisible("agents", ["terminals", "agents"])).toBe(false);
    expect(isHostSectionVisible("projects", ["terminals", "agents"])).toBe(true);
  });

  it("keeps the brand's hideable sections in step with the client's own list", () => {
    // Security is never hideable: a brand must not be able to hide its warnings.
    // Developer follows the app's own Developer options switch, not the daemon config.
    // Web client manages a daemon server the browser app itself runs on; not a brand setting.
    // Automation and Updates are client groupings of cards Overview used to hold.
    const clientOnly = new Set(["security", "web-client", "developer", "automation", "updates"]);
    // Retired sections stay valid in brand and daemon config so existing files parse;
    // `pair-device` now hides the pairing card inside Devices.
    const retired = ["usage", "pair-device"];
    const hideable = HOST_SECTION_SLUGS.filter((slug) => !clientOnly.has(slug));
    expect([...HOST_SETTINGS_SECTIONS].sort()).toEqual([...hideable, ...retired].sort());
  });

  it("ignores a retired section rather than hiding what replaced it", () => {
    expect(resolveHiddenHostSections(["usage", "agents"])).toEqual(["agents"]);
  });

  it("sends a view of a hidden section to the first section the host still offers", () => {
    const hidden = ["terminals", "agents"] as const;
    const visible = visibleHostSectionItems(hidden);
    expect(resolveHiddenSectionRedirect({ section: "agents", hidden, visible })).toBe(
      visible[0]?.id,
    );
    // A section that is still offered stays put.
    expect(resolveHiddenSectionRedirect({ section: "projects", hidden, visible })).toBeNull();
    expect(resolveHiddenSectionRedirect({ section: null, hidden, visible })).toBeNull();
    // Nothing left to show: the caller has no better destination to offer.
    expect(resolveHiddenSectionRedirect({ section: "agents", hidden, visible: [] })).toBeNull();
  });
});
