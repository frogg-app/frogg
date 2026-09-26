/**
 * @vitest-environment jsdom
 */
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PresenceResult } from "./use-presence";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(cleanup);

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      if (!options) return key;
      const name = "name" in options ? `:${String(options.name)}` : "";
      const second = "other" in options ? `+${String(options.other)}` : "";
      const count = "count" in options ? `#${String(options.count)}` : "";
      return `${key}${name}${second}${count}`;
    },
  }),
}));

let presence: PresenceResult = { view: { kind: "hidden" }, warning: null };
vi.mock("./use-presence", () => ({ usePresence: () => presence }));
vi.mock("@/constants/layout", () => ({ MAX_CONTENT_WIDTH: 820 }));
const nicknames: Record<string, string> = {};
vi.mock("@/presence/identity-store", () => ({
  usePresenceIdentityStore: (select: (state: { nicknames: Record<string, string> }) => unknown) =>
    select({ nicknames }),
  resolveParticipantName: (
    input: { clientKey?: string | null; deviceName: string },
    names: Record<string, string>,
  ) => (input.clientKey ? names[input.clientKey] : undefined) || input.deviceName,
}));

const { PresenceBar } = await import("./presence-bar");

function other(overrides: Record<string, unknown> = {}) {
  return {
    participantId: "other",
    deviceName: "Ada's laptop",
    clientKey: "key-ada",
    activity: "viewing" as const,
    activityAt: Date.now(),
    isExpired: false,
    ...overrides,
  };
}

describe("PresenceBar", () => {
  it("renders nothing when nobody else is here", () => {
    presence = { view: { kind: "hidden" }, warning: null };
    const view = render(<PresenceBar serverId="host" targetKind="agent" targetId="agent" />);
    expect(view.queryByTestId("presence-bar")).toBeNull();
  });

  it("names one other participant with what they are doing", () => {
    presence = {
      view: {
        kind: "list",
        others: [other({ activity: "typing" })],
        visible: [other({ activity: "typing" })],
        overflowCount: 0,
        isStale: false,
      },
      warning: null,
    };
    const view = render(<PresenceBar serverId="host" targetKind="agent" targetId="agent" />);
    expect(view.getByTestId("presence-participant").textContent).toBe(
      "presence.activity.typing:Ada's laptop",
    );
    expect(view.getByTestId("presence-bar-live")).toBeTruthy();
    expect(view.queryByTestId("presence-bar-overflow")).toBeNull();
    expect(view.queryByTestId("presence-bar-stale")).toBeNull();
  });

  it("says who is here when nobody is writing, preferring this user's nickname", () => {
    nicknames["key-ada"] = "Ada";
    const both = [other(), other({ participantId: "b", clientKey: "key-bo", deviceName: "Bo" })];
    presence = {
      view: { kind: "list", others: both, visible: both, overflowCount: 0, isStale: false },
      warning: null,
    };
    const view = render(<PresenceBar serverId="host" targetKind="agent" targetId="agent" />);
    expect(view.getByTestId("presence-participant").textContent).toBe(
      "presence.summary.two:Ada+Bo",
    );
    expect(view.queryByTestId("presence-bar-live")).toBeNull();
    expect(view.getAllByTestId("presence-avatar")).toHaveLength(2);
    delete nicknames["key-ada"];
  });

  it("falls back to a placeholder when nothing printable survived sanitizing", () => {
    const unnamed = other({ deviceName: "", activity: "sending" });
    presence = {
      view: {
        kind: "list",
        others: [unnamed],
        visible: [unnamed],
        overflowCount: 0,
        isStale: false,
      },
      warning: null,
    };
    const view = render(<PresenceBar serverId="host" targetKind="agent" targetId="agent" />);
    expect(view.getByTestId("presence-participant").textContent).toBe(
      "presence.activity.sending:presence.unknownDevice",
    );
  });

  it("folds a crowd into an overflow count and marks a stale snapshot", () => {
    const visible = [other({ participantId: "a" }), other({ participantId: "b" })];
    presence = {
      view: { kind: "list", others: visible, visible, overflowCount: 4, isStale: true },
      warning: null,
    };
    const view = render(<PresenceBar serverId="host" targetKind="terminal" targetId="term" />);
    expect(view.getByTestId("presence-bar-overflow")).toBeTruthy();
    expect(view.getByTestId("presence-bar-stale")).toBeTruthy();
  });

  it("keeps a hostile device name on one line", () => {
    // The row renders what `selectOtherParticipants` already sanitized, so the
    // name reaching it is capped; the row must not then let it wrap.
    const hostile = other({ deviceName: `${"x".repeat(47)}…` });
    presence = {
      view: {
        kind: "list",
        others: [hostile],
        visible: [hostile],
        overflowCount: 0,
        isStale: false,
      },
      warning: null,
    };
    const view = render(<PresenceBar serverId="host" targetKind="agent" targetId="agent" />);
    const node = view.getByTestId("presence-participant");
    expect(node.textContent?.includes("\n")).toBe(false);
    expect(node.textContent?.length).toBeLessThan(80);
  });
});
