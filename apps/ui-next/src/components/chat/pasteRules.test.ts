import { describe, expect, it } from "vitest";
import { picturesToAttach } from "./pasteRules";

const png = { name: "image.png", type: "image/png" };

describe("picturesToAttach", () => {
  it("attaches a screenshot pasted on its own", () => {
    expect(picturesToAttach([png], "")).toEqual([png]);
  });

  it("attaches a copied image whose text is only its address or name", () => {
    expect(picturesToAttach([png], "https://example.com/a.png")).toEqual([png]);
    expect(picturesToAttach([png], "shot 2026-11-01.png".replace(" ", "_"))).toEqual([png]);
  });

  it("attaches a file copied from the desktop even with its name as text", () => {
    const file = { name: "Screenshot 2026-11-01 at 10.02.png", type: "image/png" };
    expect(picturesToAttach([file], "Screenshot 2026-11-01 at 10.02.png")).toEqual([file]);
  });

  it("pastes the text when a document copy carries a rendered picture of it", () => {
    expect(picturesToAttach([png], "Quarterly numbers are up 4%")).toEqual([]);
  });

  it("ignores pastes with no pictures", () => {
    expect(picturesToAttach([{ name: "a.txt", type: "text/plain" }], "")).toEqual([]);
  });
});
