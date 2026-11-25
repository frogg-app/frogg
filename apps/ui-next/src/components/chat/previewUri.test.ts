import { describe, expect, it } from "vitest";
import { previewUri } from "./previewUri";

const read = async () => new Uint8Array();

describe("previewUri", () => {
  it("previews inline images", () => {
    expect(
      previewUri({
        kind: "image",
        id: "a",
        name: "x.png",
        mimeType: "image/png",
        data: "AAA",
      }),
    ).toBe("data:image/png;base64,AAA");
  });
  it("previews held pictures that carry their bytes", () => {
    const picked = {
      name: "x.jpg",
      mimeType: "image/jpeg",
      size: 3,
      base64: "BBB",
      read,
    };
    expect(previewUri({ kind: "local", id: "a", name: "x.jpg", picked })).toBe(
      "data:image/jpeg;base64,BBB",
    );
  });
  it("has no preview for files or uploads", () => {
    const picked = {
      name: "x.pdf",
      mimeType: "application/pdf",
      size: 3,
      base64: "C",
      read,
    };
    expect(previewUri({ kind: "local", id: "a", name: "x.pdf", picked })).toBeNull();
    expect(previewUri({ kind: "upload", id: "a", name: "x", size: 1 })).toBeNull();
  });
});
