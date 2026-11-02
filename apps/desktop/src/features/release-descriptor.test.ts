import { afterEach, expect, it, vi } from "vitest";
import { fetchReleaseDescriptor, parseReleaseDescriptor } from "./release-descriptor.js";

afterEach(() => vi.unstubAllGlobals());

it("falls back only for a missing descriptor, not network or malformed metadata", async () => {
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  fetcher.mockResolvedValueOnce(new Response("missing", { status: 404 }));
  await expect(fetchReleaseDescriptor("https://example.test/release.json")).resolves.toBeNull();
  fetcher.mockResolvedValueOnce(new Response("unavailable", { status: 503 }));
  await expect(fetchReleaseDescriptor("https://example.test/release.json")).rejects.toThrow("503");
  fetcher.mockResolvedValueOnce(new Response("invalid JSON", { status: 200 }));
  await expect(fetchReleaseDescriptor("https://example.test/release.json")).rejects.toThrow();
  fetcher.mockRejectedValueOnce(new Error("offline"));
  await expect(fetchReleaseDescriptor("https://example.test/release.json")).rejects.toThrow(
    "offline",
  );
});

it("accepts the classic clients and rejects a release that ships another one", () => {
  const raw = { schemaVersion: 1, version: "1.6.14-beta.4", channel: "beta", updatePaths: {} };
  expect(parseReleaseDescriptor(raw).version).toBe("1.6.14-beta.4");
  expect(parseReleaseDescriptor({ ...raw, client: "classic-beta" }).channel).toBe("beta");
  expect(
    parseReleaseDescriptor({ ...raw, version: "1.6.15", channel: "stable", client: "classic" })
      .channel,
  ).toBe("stable");
  expect(() =>
    parseReleaseDescriptor({ ...raw, version: "1.6.14-next.1", client: "frogg-next" }),
  ).toThrow("does not carry this app");
});
