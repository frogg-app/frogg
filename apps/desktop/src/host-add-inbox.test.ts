import { describe, expect, it, vi } from "vitest";
import { HostAddInbox, isHostAddLink } from "./host-add-inbox.js";

const LINK = "frogg://host/add?type=directTcp&host=localhost&port=9999&label=Agent-Sandbox";

describe("HostAddInbox", () => {
  it("recognises only host/add links", () => {
    expect(isHostAddLink(LINK)).toBe(true);
    expect(isHostAddLink("frogg://pair#offer=abc")).toBe(false);
    expect(isHostAddLink("frogg://h/server/agent/agent-1")).toBe(false);
    expect(isHostAddLink("/Users/me/project")).toBe(false);
  });

  it("holds a link that arrives before a renderer is ready", () => {
    const inbox = new HostAddInbox();
    const listener = vi.fn();

    expect(inbox.receive(LINK)).toBe(true);
    inbox.ready(1, listener);

    expect(listener).toHaveBeenCalledWith(LINK);
    // Taken once: a second renderer gets nothing.
    const other = vi.fn();
    inbox.ready(2, other);
    expect(other).not.toHaveBeenCalled();
  });

  it("delivers to the newest listener and stops after removal", () => {
    const inbox = new HostAddInbox();
    const first = vi.fn();
    const second = vi.fn();
    inbox.ready(1, first);
    inbox.ready(2, second);

    inbox.receive(LINK);
    expect(second).toHaveBeenCalledWith(LINK);
    expect(first).not.toHaveBeenCalled();

    inbox.remove(2);
    inbox.receive(LINK);
    expect(first).toHaveBeenCalledWith(LINK);
  });

  it("ignores links it does not own", () => {
    const inbox = new HostAddInbox();
    expect(inbox.receive("frogg://pair#offer=abc")).toBe(false);
  });
});
