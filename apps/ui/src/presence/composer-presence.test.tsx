/**
 * @vitest-environment jsdom
 */
import React from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/presence/use-presence", () => ({ usePresence: () => ({ warning: null }) }));
const { useIsEditing } = await import("./composer-presence");

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

describe("useIsEditing", () => {
  it("is not typing for text that is already there", () => {
    const { result } = renderHook(({ text }) => useIsEditing(text, 5000), {
      initialProps: { text: "draft" },
    });
    expect(result.current).toBe(false);
  });

  it("types on edit and stops 5s after the last edit", () => {
    const { result, rerender } = renderHook(({ text }) => useIsEditing(text, 5000), {
      initialProps: { text: "" },
    });
    rerender({ text: "h" });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(4000));
    rerender({ text: "hi" });
    act(() => vi.advanceTimersByTime(4000));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it("stops at once when the text is cleared", () => {
    const { result, rerender } = renderHook(({ text }) => useIsEditing(text, 5000), {
      initialProps: { text: "hi" },
    });
    rerender({ text: "hi!" });
    rerender({ text: "" });
    expect(result.current).toBe(false);
  });
});
