import { describe, expect, it } from "vitest";
import {
  registerMobileBackOverlayHandler,
  resolveMobileBackAction,
  runMobileBackOverlayHandlers,
  type MobileBackInput,
} from "./mobile-back";

function input(overrides: Partial<MobileBackInput> = {}): MobileBackInput {
  return {
    activePanel: "agent",
    canPopRoute: false,
    consumedByOverlay: false,
    isWorkspaceRoute: true,
    ...overrides,
  };
}

describe("resolveMobileBackAction", () => {
  it("lets an overlay absorb the press first", () => {
    expect(resolveMobileBackAction(input({ consumedByOverlay: true, canPopRoute: true }))).toEqual({
      kind: "consumed",
    });
  });

  it("returns from the right sidebar to the conversation", () => {
    expect(resolveMobileBackAction(input({ activePanel: "file-explorer" }))).toEqual({
      kind: "show-agent",
    });
  });

  it("returns from the conversation to the session list instead of exiting", () => {
    expect(resolveMobileBackAction(input())).toEqual({ kind: "show-agent-list" });
  });

  it("exits from the session list", () => {
    expect(resolveMobileBackAction(input({ activePanel: "agent-list" }))).toEqual({
      kind: "exit",
    });
  });

  it("pops a route pushed under the session list before exiting", () => {
    expect(
      resolveMobileBackAction(input({ activePanel: "agent-list", canPopRoute: true })),
    ).toEqual({ kind: "pop-route" });
  });

  it("pops back to whatever opened a non-workspace screen", () => {
    expect(
      resolveMobileBackAction(
        input({ isWorkspaceRoute: false, canPopRoute: true, activePanel: "agent" }),
      ),
    ).toEqual({ kind: "pop-route" });
  });

  it("exits from a non-workspace screen with no history", () => {
    expect(resolveMobileBackAction(input({ isWorkspaceRoute: false }))).toEqual({ kind: "exit" });
  });
});

describe("mobile back overlay handlers", () => {
  it("runs the most recently registered overlay first and stops once consumed", () => {
    const calls: string[] = [];
    const unregisterFirst = registerMobileBackOverlayHandler(() => {
      calls.push("first");
      return true;
    });
    const unregisterSecond = registerMobileBackOverlayHandler(() => {
      calls.push("second");
      return true;
    });

    expect(runMobileBackOverlayHandlers()).toBe(true);
    expect(calls).toEqual(["second"]);

    unregisterSecond();
    expect(runMobileBackOverlayHandlers()).toBe(true);
    expect(calls).toEqual(["second", "first"]);

    unregisterFirst();
    expect(runMobileBackOverlayHandlers()).toBe(false);
  });

  it("falls through overlays that decline the press", () => {
    const unregisterDeclining = registerMobileBackOverlayHandler(() => false);
    expect(runMobileBackOverlayHandlers()).toBe(false);
    unregisterDeclining();
  });
});
