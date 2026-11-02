import { describe, expect, it } from "vitest";
import { parsePopout } from "./popout";

describe("parsePopout", () => {
  it("routes a window to one session on one host", () => {
    expect(parsePopout("?daemon=x&chrome=windows&popout=agt_1&host=h1")).toEqual({
      session: "agt_1",
      host: "h1",
    });
  });
  it("the host is optional", () => {
    expect(parsePopout("?popout=agt_1")).toEqual({ session: "agt_1", host: null });
  });
  it("the main window has no popout", () => {
    expect(parsePopout("?daemon=x&pair=frogg-next://pair")).toBeNull();
    expect(parsePopout("?popout=")).toBeNull();
  });
});
