import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ screen: {} }));

const { readManualDragStart } = await import("./manual-drag");

describe("readManualDragStart", () => {
  it("accepts finite coordinates with a positive viewport", () => {
    expect(readManualDragStart({ clientX: 10, clientY: 5, viewportWidth: 800 })).toEqual({
      clientX: 10,
      clientY: 5,
      viewportWidth: 800,
    });
  });

  it("rejects malformed input", () => {
    expect(readManualDragStart(null)).toBeNull();
    expect(readManualDragStart({ clientX: "1", clientY: 5, viewportWidth: 800 })).toBeNull();
    expect(readManualDragStart({ clientX: 1, clientY: Number.NaN, viewportWidth: 800 })).toBeNull();
    expect(readManualDragStart({ clientX: 1, clientY: 5, viewportWidth: 0 })).toBeNull();
  });
});
