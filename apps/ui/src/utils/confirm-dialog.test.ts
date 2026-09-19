import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __private__,
  confirmDialog,
  getActiveConfirmDialogRequest,
  settleConfirmDialogRequest,
  subscribeConfirmDialogRequests,
} from "./confirm-dialog";

describe("confirmDialog", () => {
  beforeEach(() => {
    __private__.reset();
  });

  afterEach(() => {
    __private__.reset();
    delete (globalThis as { document?: unknown }).document;
    vi.restoreAllMocks();
  });

  it("exposes the request to the host and resolves true when confirmed", async () => {
    const pending = confirmDialog({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      destructive: true,
    });

    const request = getActiveConfirmDialogRequest();
    expect(request?.input).toEqual({
      title: "Restart host",
      message: "This will restart the daemon.",
      confirmLabel: "Restart",
      destructive: true,
    });

    settleConfirmDialogRequest(request!.id, true);
    await expect(pending).resolves.toBe(true);
    expect(getActiveConfirmDialogRequest()).toBeNull();
  });

  it("resolves false when the confirmation is declined", async () => {
    const pending = confirmDialog({ title: "Restart host", message: "Are you sure?" });
    settleConfirmDialogRequest(getActiveConfirmDialogRequest()!.id, false);

    await expect(pending).resolves.toBe(false);
  });

  it("resolves false when the modal is dismissed without an answer", async () => {
    // Backdrop press, Escape and the Android back button all land here: the host settles the
    // request as declined rather than leaving the caller hanging.
    const pending = confirmDialog({ title: "Delete file", message: "This cannot be undone." });
    const dismissed = getActiveConfirmDialogRequest();

    settleConfirmDialogRequest(dismissed!.id, false);

    await expect(pending).resolves.toBe(false);
    expect(__private__.pendingCount()).toBe(0);
  });

  it("serialises a second request instead of dropping it", async () => {
    const first = confirmDialog({ title: "First", message: "one" });
    const second = confirmDialog({ title: "Second", message: "two" });

    expect(__private__.pendingCount()).toBe(2);
    const firstRequest = getActiveConfirmDialogRequest();
    expect(firstRequest?.input.title).toBe("First");

    settleConfirmDialogRequest(firstRequest!.id, true);
    await expect(first).resolves.toBe(true);

    const secondRequest = getActiveConfirmDialogRequest();
    expect(secondRequest?.input.title).toBe("Second");
    settleConfirmDialogRequest(secondRequest!.id, false);
    await expect(second).resolves.toBe(false);
  });

  it("queues a request raised before the host subscribes", async () => {
    const pending = confirmDialog({ title: "Early", message: "before mount" });

    const listener = vi.fn();
    const unsubscribe = subscribeConfirmDialogRequests(listener);
    expect(getActiveConfirmDialogRequest()?.input.title).toBe("Early");

    settleConfirmDialogRequest(getActiveConfirmDialogRequest()!.id, true);
    await expect(pending).resolves.toBe(true);
    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  it("notifies subscribers when a request arrives and when it settles", async () => {
    const listener = vi.fn();
    subscribeConfirmDialogRequests(listener);

    const pending = confirmDialog({ title: "Notify", message: "message" });
    expect(listener).toHaveBeenCalledTimes(1);

    settleConfirmDialogRequest(getActiveConfirmDialogRequest()!.id, false);
    expect(listener).toHaveBeenCalledTimes(2);
    await pending;
  });

  it("returns web focus to the element that invoked the confirmation", async () => {
    const blur = vi.fn();
    const focus = vi.fn();
    const invoker = { blur, focus } as unknown as HTMLElement;
    (globalThis as { document?: unknown }).document = {
      activeElement: invoker,
      contains: () => true,
    } as unknown as Document;

    const pending = confirmDialog({ title: "Focus", message: "message" });
    expect(blur).toHaveBeenCalledTimes(1);

    settleConfirmDialogRequest(getActiveConfirmDialogRequest()!.id, true);
    await pending;
    expect(focus).toHaveBeenCalledTimes(1);
  });

  it("does not restore focus to an element that left the document", async () => {
    const focus = vi.fn();
    const invoker = { blur: vi.fn(), focus } as unknown as HTMLElement;
    (globalThis as { document?: unknown }).document = {
      activeElement: invoker,
      contains: () => false,
    } as unknown as Document;

    const pending = confirmDialog({ title: "Focus", message: "message" });
    settleConfirmDialogRequest(getActiveConfirmDialogRequest()!.id, true);
    await pending;

    expect(focus).not.toHaveBeenCalled();
  });

  it("ignores a settle for a request that is no longer pending", async () => {
    const pending = confirmDialog({ title: "Once", message: "message" });
    const id = getActiveConfirmDialogRequest()!.id;

    settleConfirmDialogRequest(id, true);
    settleConfirmDialogRequest(id, false);

    await expect(pending).resolves.toBe(true);
  });
});
