import type { PresenceSnapshot } from "@frogg/protocol/device-access";
import { describe, expect, it } from "vitest";
import { cleanName, othersIn, VIEWER_TTL_MS, type Viewer } from "../../daemon/viewers";
import { describeViewers, initials } from "./viewersText";

const NOW = Date.parse("2026-10-15T10:00:00Z");
const p = (id: string, name: string, over: Record<string, unknown> = {}) => ({
  participantId: id,
  deviceId: null,
  deviceName: name,
  clientType: "browser",
  clientKey: `k-${id}`,
  activity: "viewing",
  activityAt: new Date(NOW - 1000).toISOString(),
  isSelf: false,
  ...over,
});
const snap = (...participants: unknown[]) =>
  ({ target: { kind: "agent", agentId: "a" }, participants }) as PresenceSnapshot;
const v = (name: string, activity: Viewer["activity"] = "viewing"): Viewer => ({
  id: name,
  name,
  key: name,
  clientType: null,
  activity,
});

describe("othersIn", () => {
  it("drops this connection and entries past the TTL", () => {
    const old = new Date(NOW - VIEWER_TTL_MS - 1).toISOString();
    const out = othersIn(
      snap(
        p("me", "This", { isSelf: true }),
        p("x", "Pixel 8"),
        p("y", "Gone", { activityAt: old }),
      ),
      NOW,
    );
    expect(out.map((x) => x.name)).toEqual(["Pixel 8"]);
  });

  it("names a device with no printable name", () => {
    expect(othersIn(snap(p("x", "\u0007\u0000 ")), NOW)[0].name).toBe("Another device");
    expect(cleanName("  Laptop\n  two ")).toBe("Laptop two");
  });
});

describe("describeViewers", () => {
  it("reads one, two and many", () => {
    expect(describeViewers([v("Pixel")]).lead).toBe("Pixel is here");
    expect(describeViewers([v("Pixel"), v("Mac")]).lead).toBe("Pixel and Mac are here");
    expect(describeViewers([v("Pixel"), v("Mac"), v("Web")]).lead).toBe(
      "Pixel and 2 others are here",
    );
  });

  it("leads with whoever is typing", () => {
    expect(describeViewers([v("Pixel"), v("Mac", "typing")])).toEqual({
      lead: "Mac is typing",
      rest: "1 more here",
    });
  });

  it("makes initials", () => {
    expect(initials("Frogg Next on web")).toBe("FN");
    expect(initials("pixel")).toBe("PI");
    expect(initials("!!")).toBe("?");
  });
});
