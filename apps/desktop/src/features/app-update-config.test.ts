import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  isUpdateRateLimitError,
  writeElectronUpdateConfig,
  resolveElectronUpdateUrl,
  resolveElectronUpdateFeed as resolveFeed,
} from "./app-update-config.js";

const resolveElectronUpdateFeed = (input: Parameters<typeof resolveFeed>[0]) =>
  resolveFeed({ currentVersion: "0.6.9", fetchDescriptor: async () => null, ...input });

it("provides updater download cache metadata for an explicitly configured feed", () => {
  const root = mkdtempSync(path.join(tmpdir(), "electron-update-config-"));
  try {
    const file = writeElectronUpdateConfig(
      root,
      "https://updates.example/electron",
      "example-electron-updater",
    );
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
      provider: "generic",
      url: "https://updates.example/electron",
      updaterCacheDirName: "example-electron-updater",
    });
    expect(readdirSync(path.dirname(file))).toEqual(["app-update.yml"]);
    expect(() =>
      writeElectronUpdateConfig(root, "http://updates.example", "example-electron-updater"),
    ).toThrow("HTTPS");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it("uses the production release feed unless an explicit override is configured", () => {
  expect(resolveElectronUpdateUrl(undefined, "https://github.com/frogg-app/frogg/releases")).toBe(
    "https://github.com/frogg-app/frogg/releases/latest/download",
  );
  expect(resolveElectronUpdateUrl(" https://updates.example.com/frogg ", null)).toBe(
    "https://updates.example.com/frogg",
  );
  expect(resolveElectronUpdateUrl(undefined, null)).toBeNull();
});

const releaseBase = "https://github.com/frogg-app/frogg/releases";

it("follows GitHub's stable latest alias, explicit generic feeds, and disabled distributions", async () => {
  await expect(resolveElectronUpdateFeed({ releaseBase })).resolves.toEqual({
    url: `${releaseBase}/latest/download`,
    channel: "electron-latest",
  });
  await expect(
    resolveElectronUpdateFeed({ releaseBase, override: "https://updates.example.com" }),
  ).resolves.toEqual({ url: "https://updates.example.com", channel: "electron-latest" });
  await expect(resolveElectronUpdateFeed({ releaseBase: null })).resolves.toBeNull();
});

it("rejects insecure overrides", async () => {
  await expect(
    resolveElectronUpdateFeed({ releaseBase, override: "http://updates.example.com" }),
  ).rejects.toThrow("HTTPS");
});

function descriptor(version = "0.6.9", minimumClientVersion = "0.6.0") {
  return {
    schemaVersion: 1,
    version,
    channel: version.includes("-") ? "beta" : "stable",
    updatePaths: {
      "electron-updater": {
        mode: "automatic",
        minimumClientVersion,
        channel: version.includes("-") ? "electron-beta" : "electron-latest",
      },
    },
  };
}

it("pins discovery through the product-level release.json", async () => {
  const fetchDescriptor = vi.fn(async () => descriptor());
  await expect(resolveElectronUpdateFeed({ releaseBase, fetchDescriptor })).resolves.toEqual({
    url: `${releaseBase}/download/v0.6.9`,
    channel: "electron-latest",
  });
  expect(fetchDescriptor).toHaveBeenCalledWith(`${releaseBase}/latest/download/release.json`);
});

it("rejects incompatible descriptors and propagates discovery failures", async () => {
  for (const raw of [{}, { ...descriptor(), schemaVersion: 2 }, descriptor("0.7.0-beta.1")]) {
    await expect(
      resolveElectronUpdateFeed({
        releaseBase,
        fetchDescriptor: async () => raw,
      }),
    ).rejects.toThrow();
  }
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      fetchDescriptor: async () => {
        throw new Error("offline");
      },
    }),
  ).rejects.toThrow("offline");
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      fetchDescriptor: async () => descriptor("0.7.0-beta.1"),
    }),
  ).rejects.toThrow("points to a prerelease");
});

it("requires a manual migration when the supported path raises its minimum client version", async () => {
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      currentVersion: "0.6.9",
      fetchDescriptor: async () => descriptor("0.8.0", "0.7.0"),
    }),
  ).rejects.toThrow("manual upgrade");
});

it("ignores unrelated future protocols while retaining this client's valid update path", async () => {
  const release = descriptor();
  const raw = {
    ...release,
    updatePaths: {
      ...release.updatePaths,
      "future-updater": { mode: "automatic", metadata: "future.json" },
    },
  };
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      fetchDescriptor: async () => raw,
    }),
  ).resolves.toEqual({ url: `${releaseBase}/download/v0.6.9`, channel: "electron-latest" });
});

it("honors explicit migration instructions after the application architecture changes", async () => {
  const raw = {
    schemaVersion: 1,
    version: "0.8.0",
    channel: "stable",
    updatePaths: {
      "electron-updater": {
        mode: "manual",
        message: "Download the new installer from the release page.",
      },
      "future-updater": { mode: "automatic", metadata: "future.json" },
    },
  };
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      fetchDescriptor: async () => raw,
    }),
  ).rejects.toThrow("Download the new installer");
  await expect(
    resolveElectronUpdateFeed({
      releaseBase,
      fetchDescriptor: async () => ({
        ...raw,
        updatePaths: { "future-updater": raw.updatePaths["future-updater"] },
      }),
    }),
  ).rejects.toThrow("no compatible automatic update path");
});

describe("isUpdateRateLimitError", () => {
  it("recognises electron-updater and release-discovery 429s only", () => {
    expect(
      isUpdateRateLimitError(Object.assign(new Error("HTTP error"), { statusCode: 429 })),
    ).toBe(true);
    expect(isUpdateRateLimitError(new Error('429 "method: GET url: https://github.com/x"'))).toBe(
      true,
    );
    expect(isUpdateRateLimitError(new Error("Release discovery failed (429)."))).toBe(true);
    expect(isUpdateRateLimitError(new Error("Release discovery failed (404)."))).toBe(false);
    expect(isUpdateRateLimitError(new Error("version 1.4290.0"))).toBe(false);
    expect(isUpdateRateLimitError(null)).toBe(false);
  });
});
