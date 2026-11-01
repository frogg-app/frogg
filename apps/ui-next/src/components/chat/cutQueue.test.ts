import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Attachment } from "./actions";
import { queueMessage, sendQueued, setQueueSender, settleQueue, useCutQueue } from "./cutQueue";

const img: Attachment = {
  kind: "image",
  id: "a1",
  name: "shot.png",
  mimeType: "image/png",
  data: "x",
};

describe("cut queue", () => {
  const sent = vi.fn(async (_id: string, _text: string, _atts: Attachment[]) => {});
  beforeEach(() => {
    sent.mockClear();
    useCutQueue.setState({ s1: undefined }, false);
    setQueueSender(sent);
  });

  it("sends the held message once the operation succeeds", async () => {
    queueMessage("s1", "next step", [img]);
    expect(sent).not.toHaveBeenCalled();
    await settleQueue("s1", true);
    expect(sent).toHaveBeenCalledWith("s1", "next step", [img]);
    expect(useCutQueue.getState().s1).toBeUndefined();
  });

  it("joins a second message instead of dropping the first", async () => {
    queueMessage("s1", "one", []);
    queueMessage("s1", "two", [img]);
    expect(useCutQueue.getState().s1).toMatchObject({ text: "one\n\ntwo", attachments: [img] });
  });

  it("keeps the message, unsent, when the operation fails", async () => {
    queueMessage("s1", "next step", []);
    await settleQueue("s1", false);
    expect(sent).not.toHaveBeenCalled();
    expect(useCutQueue.getState().s1?.state).toBe("failed");
    // A later operation does not send a failed message behind the user's back.
    await settleQueue("s1", true);
    expect(sent).not.toHaveBeenCalled();
    await sendQueued("s1");
    expect(sent).toHaveBeenCalledWith("s1", "next step", []);
  });

  it("puts the message back when the send itself fails", async () => {
    sent.mockRejectedValueOnce(new Error("offline"));
    queueMessage("s1", "next step", []);
    await expect(settleQueue("s1", true)).rejects.toThrow("offline");
    expect(useCutQueue.getState().s1).toMatchObject({ text: "next step", state: "failed" });
  });
});
