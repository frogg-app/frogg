import { describe, expect, it } from "vitest";
import { pickedFromDataUrl, readClipboardPicture } from "./clipboardImage";
import { INLINE_IMAGE_MAX_BYTES } from "./upload";

const PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const dataUrl = `data:image/png;base64,${PNG}`;

describe("pickedFromDataUrl", () => {
  it("wraps a base64 picture as an inline image the uploader can also read", async () => {
    const p = pickedFromDataUrl(dataUrl, "shot.png");
    expect(p).not.toBeNull();
    expect(p?.name).toBe("shot.png");
    expect(p?.mimeType).toBe("image/png");
    expect(p?.base64).toBe(PNG);
    expect(p?.size).toBe(Buffer.from(PNG, "base64").length);
    const head = await p?.read(0, 4);
    expect(Array.from(head ?? [])).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it("names a picture with none", () => {
    expect(pickedFromDataUrl(dataUrl)?.name).toMatch(/^Pasted image \d+\.png$/);
  });

  it("refuses anything but a base64 image", () => {
    expect(pickedFromDataUrl("data:text/plain;base64,aGk=")).toBeNull();
    expect(pickedFromDataUrl("https://example.com/a.png")).toBeNull();
  });

  it("keeps a picture too big for the model as a file to upload", () => {
    const big = Buffer.alloc(INLINE_IMAGE_MAX_BYTES + 1).toString("base64");
    const p = pickedFromDataUrl(`data:image/png;base64,${big}`);
    expect(p?.base64).toBeUndefined();
    expect(p?.size).toBe(INLINE_IMAGE_MAX_BYTES + 1);
  });
});

describe("readClipboardPicture", () => {
  const reader = (has: boolean, data: string | null) => {
    const calls: string[] = [];
    return {
      calls,
      hasImageAsync: async () => {
        calls.push("has");
        return has;
      },
      getImageAsync: async () => {
        calls.push("get");
        return data === null ? null : { data };
      },
    };
  };

  it("reads the clipboard's picture", async () => {
    const r = reader(true, dataUrl);
    expect((await readClipboardPicture(r))?.mimeType).toBe("image/png");
  });

  it("does not read the clipboard when it holds no picture", async () => {
    const r = reader(false, dataUrl);
    expect(await readClipboardPicture(r)).toBeNull();
    expect(r.calls).toEqual(["has"]);
  });

  it("returns null when the picture went away before it was read", async () => {
    expect(await readClipboardPicture(reader(true, null))).toBeNull();
  });
});
