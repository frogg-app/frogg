import { beforeEach, describe, expect, it } from "vitest";
import { openDetail, useSubWorkStore } from "../../daemon/subwork";
import { useUi } from "../../ui-store";
import { backAction, popBack } from "./back";

describe("back", () => {
  beforeEach(() => {
    useUi.setState({
      tool: "sessions",
      selected: null,
      paletteOpen: false,
      newSessionOpen: false,
      listOpen: false,
    });
    useSubWorkStore.setState({ detail: {} });
  });

  it("is a no-op at the sessions root", () => {
    expect(backAction(true, null)).toBeNull();
    expect(popBack(true, null)).toBe(false);
  });

  it("closes a sub-work item's details before leaving its parent's chat", () => {
    useUi.getState().select("p");
    openDetail("p", "sub:a1");
    expect(popBack(true, null)).toBe(true);
    expect(useSubWorkStore.getState().detail).toEqual({});
    expect(useUi.getState().selected).toBe("p");
    expect(popBack(true, null)).toBe(true);
    expect(useUi.getState().selected).toBeNull();
  });

  it("returns from another tab to Sessions", () => {
    useUi.setState({ tool: "inbox", inboxId: null });
    expect(popBack(true, null)).toBe(true);
    expect(useUi.getState().tool).toBe("sessions");
  });
});
