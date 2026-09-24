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
    const items = visibleHostSectionItems(["pair-device", "agents"]);
    expect(items.map((item) => item.id)).toEqual(
      HOST_SECTION_ITEMS.filter((item) => item.id !== "pair-device" && item.id !== "agents").map(
        (item) => item.id,
      ),
    );
    expect(isHostSectionVisible("agents", ["pair-device", "agents"])).toBe(false);
    expect(isHostSectionVisible("projects", ["pair-device", "agents"])).toBe(true);
  });

  it("keeps the brand's hideable sections in step with the client's own list", () => {
    // Deploy is a desktop-only client section; the daemon has no setting for it.
    const clientOnly = new Set(["deploy"]);
    const hideable = HOST_SECTION_SLUGS.filter((slug) => !clientOnly.has(slug));
    expect([...HOST_SETTINGS_SECTIONS].sort()).toEqual([...hideable].sort());
  });

  it("sends a view of a hidden section to the first section the host still offers", () => {
    const hidden = ["pair-device", "agents"] as const;
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
