import { describe, expect, it } from "vitest";
import type { TimelineEntry } from "../../daemon/types";
import { headerTitle } from "./title";

const user = (text: string) => ({ item: { type: "user_message", text } }) as TimelineEntry;
const PROMPT =
  "The sidebar needs to expand out smoothly when hovering or selecting a tool, and more";

describe("headerTitle", () => {
  it("replaces the daemon's 60-character provisional title with the whole first line", () => {
    expect(headerTitle(PROMPT.slice(0, 60), [user(`${PROMPT}\nsecond line`)])).toBe(PROMPT);
  });

  it("keeps a generated title", () => {
    expect(headerTitle("Smooth sidebar expansion", [user(PROMPT)])).toBe(
      "Smooth sidebar expansion",
    );
  });

  it("keeps the title until the timeline loads", () => {
    expect(headerTitle(PROMPT.slice(0, 60), undefined)).toBe(PROMPT.slice(0, 60));
  });
});
