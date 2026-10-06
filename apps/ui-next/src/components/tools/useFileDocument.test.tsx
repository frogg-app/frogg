import { act, renderHook, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { create } from "zustand";
import { readDoc, saveText, useFiles } from "../../daemon/files";
import { useFileDocument } from "./useFileDocument";

vi.mock("../../daemon/files", () => ({
  readDoc: vi.fn(),
  saveText: vi.fn(),
  useFiles: create(() => ({ root: "/repo" })),
}));
vi.mock("../../daemon/store", () => ({ onHostSwitch: vi.fn() }));
const document = {
  text: "original",
  kind: "text",
  size: 8,
  modifiedAt: "original-stamp",
  revision: "original-revision",
};
beforeEach(() => {
  vi.mocked(readDoc).mockReset().mockResolvedValue(document);
  vi.mocked(saveText).mockReset();
});
afterEach(cleanup);

describe("file editor draft lifecycle", () => {
  it("retains unsaved edits and their original revision when a tab is reopened", async () => {
    const first = renderHook(() => useFileDocument("keep.ts"));
    await waitFor(() => expect(first.result.current.doc).toEqual(document));
    act(() => first.result.current.edit("my draft"));
    first.unmount();
    const reopened = renderHook(() => useFileDocument("keep.ts"));
    await waitFor(() => expect(reopened.result.current.draft).toBe("my draft"));
    expect(reopened.result.current.doc).toEqual(document);
    expect(readDoc).toHaveBeenCalledTimes(1);
  });
  it("preserves a draft after a rejected save and enables retry", async () => {
    vi.mocked(saveText).mockRejectedValue(new Error("connection lost"));
    const { result } = renderHook(() => useFileDocument("failure.ts"));
    await waitFor(() => expect(result.current.doc).toEqual(document));
    act(() => result.current.edit("unsaved"));
    await act(() => result.current.save());
    expect(result.current.saving).toBe(false);
    expect(result.current.saveError).toContain("connection lost");
    expect(result.current.draft).toBe("unsaved");
  });
  it("keeps newer typing when an earlier save finishes", async () => {
    let finish!: (value: Awaited<ReturnType<typeof saveText>>) => void;
    vi.mocked(saveText).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { result } = renderHook(() => useFileDocument("concurrent.ts"));
    await waitFor(() => expect(result.current.doc).toEqual(document));
    act(() => result.current.edit("first edit"));
    let pending!: Promise<void>;
    act(() => {
      pending = result.current.save();
    });
    act(() => result.current.edit("newer edit"));
    await act(async () => {
      finish({ ok: true, doc: { ...document, text: "first edit", revision: "new-revision" } });
      await pending;
    });
    expect(result.current.draft).toBe("newer edit");
    expect(result.current.doc).toMatchObject({ revision: "new-revision" });
  });
  it("isolates drafts for the same relative path in different checkouts", async () => {
    const { result, rerender } = renderHook(() => useFileDocument("scoped.ts"));
    await waitFor(() => expect(result.current.doc).toEqual(document));
    act(() => result.current.edit("checkout one"));
    act(() => useFiles.setState({ root: "/another-repo" }));
    rerender();
    await waitFor(() => expect(result.current.draft).toBeNull());
    act(() => useFiles.setState({ root: "/repo" }));
    rerender();
    await waitFor(() => expect(result.current.draft).toBe("checkout one"));
  });
});
