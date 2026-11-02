import { describe, expect, it, vi } from "vitest";
import type { DaemonClient } from "@frogg/client/internal/daemon-client";
import {
  cancelUpload,
  formatBytes,
  tooLarge,
  UPLOAD_MAX_BYTES,
  uploadPicked,
  useUploads,
} from "./upload";

const picked = (size: number) => ({
  name: "big.zip",
  mimeType: "application/zip",
  size,
  read: async (start: number, end: number) => new Uint8Array(end - start),
});

describe("upload limits", () => {
  it("formats sizes the way the chips show them", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1_997_000_000)).toBe("1.9 GB");
    expect(formatBytes(UPLOAD_MAX_BYTES)).toBe("4 GB");
  });

  it("refuses files over the limit with a readable reason", () => {
    expect(tooLarge("a.zip", UPLOAD_MAX_BYTES)).toBeNull();
    expect(tooLarge("a.zip", UPLOAD_MAX_BYTES + 1)).toMatch(/a\.zip is 4 GB\. Files up to 4 GB/);
  });
});

describe("uploadPicked", () => {
  it("refuses an oversized file without contacting the host", async () => {
    const uploadFileStream = vi.fn();
    const client = { uploadFileStream } as unknown as DaemonClient;
    await expect(uploadPicked(client, picked(UPLOAD_MAX_BYTES + 1), "x")).rejects.toThrow(
      /Files up to/,
    );
    expect(uploadFileStream).not.toHaveBeenCalled();
  });

  it("tracks progress while streaming and clears it after", async () => {
    let seen: unknown = null;
    const client = {
      uploadFileStream: async (input: {
        size: number;
        onProgress: (s: number, t: number) => void;
      }) => {
        input.onProgress(input.size / 2, input.size);
        seen = useUploads.getState().u1;
        return { requestId: "r", error: null, file: { id: "f" } };
      },
    } as unknown as DaemonClient;
    await expect(uploadPicked(client, picked(1000), "u1")).resolves.toEqual({ id: "f" });
    expect(seen).toEqual({ sent: 500, total: 1000 });
    expect(useUploads.getState().u1).toBeUndefined();
  });

  it("cancels through the abort signal the client watches", async () => {
    const client = {
      uploadFileStream: (input: { signal: AbortSignal }) =>
        new Promise((_, reject) => {
          input.signal.addEventListener("abort", () => reject(input.signal.reason));
        }),
    } as unknown as DaemonClient;
    const pending = uploadPicked(client, picked(1000), "u2");
    cancelUpload("u2");
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });
});
