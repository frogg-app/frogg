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
    t: (key: string, options?: Record<string, unknown>) =>
      options && "name" in options ? `${key}:${String(options.name)}` : key,
  }),
}));

let presence: PresenceResult = { view: { kind: "hidden" }, warning: null };
vi.mock("./use-presence", () => ({ usePresence: () => presence }));

const { PresenceBar } = await import("./presence-bar");
const { PresenceComposerNotice } = await import("./composer-presence-notice");

function other(overrides: Record<string, unknown> = {}) {
  return {
    participantId: "other",
    deviceName: "Ada's laptop",
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
    expect(view.queryByTestId("presence-bar-overflow")).toBeNull();
    expect(view.queryByTestId("presence-bar-stale")).toBeNull();
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

const TYPING_WARNING = {
  deviceName: "Ada's laptop",
  activity: "typing",
  additionalCount: 0,
} as const;
const UNNAMED_WARNING = { deviceName: "", activity: "typing", additionalCount: 0 } as const;

describe("PresenceComposerNotice", () => {
  it("renders nothing without a warning", () => {
    const view = render(<PresenceComposerNotice warning={null} />);
    expect(view.queryByTestId("composer-presence-warning")).toBeNull();
  });

  it("names the other person", () => {
    const view = render(<PresenceComposerNotice warning={TYPING_WARNING} />);
    expect(view.getByTestId("composer-presence-warning").textContent).toBe(
      "presence.composer.warningOne:Ada's laptop",
    );
  });

  it("falls back to a placeholder when nothing printable survived sanitizing", () => {
    const view = render(<PresenceComposerNotice warning={UNNAMED_WARNING} />);
    expect(view.getByTestId("composer-presence-warning").textContent).toBe(
      "presence.composer.warningOne:presence.unknownDevice",
    );
  });
});
