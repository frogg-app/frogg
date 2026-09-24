import { describe, expect, it, vi } from "vitest";

vi.mock("@/attachments/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/attachments/service")>();
  return { ...actual, garbageCollectAttachments: () => Promise.resolve() };
});

const { useDraftStore } = await import("@/stores/draft-store");

const LOG = {
  type: "uploaded_file" as const,
  id: "ci-log_42_1",
  fileName: "unit-tests.log",
  mimeType: "text/plain",
  size: 5,
  path: "/home/u/.frogg/uploads/ci-log_42_1/unit-tests.log",
};

describe("attachUploadedFile", () => {
  it("adds a daemon file to the draft once, however often it is added", async () => {
    const draftKey = "server:agent-log";
    await useDraftStore.getState().attachUploadedFile({ draftKey, attachment: LOG });
    await useDraftStore.getState().attachUploadedFile({ draftKey, attachment: LOG });
    const draft = useDraftStore.getState().getDraftInput(draftKey);
    expect(draft?.attachments).toEqual([{ kind: "file", attachment: LOG }]);
  });
});
