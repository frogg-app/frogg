import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DaemonVersionResolutionError, resolveDaemonVersion } from "./daemon-version.js";

const createdDirs: string[] = [];

function createTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "frogg-daemon-version-"));
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of createdDirs.splice(0, createdDirs.length)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDaemonVersion", () => {
  it("resolves server version by walking up to @frogg/server package.json", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@frogg/server", version: "9.8.7" }),
      "utf8",
    );
    const nestedDir = path.join(root, "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(resolveDaemonVersion(moduleUrl)).toBe("9.8.7");
  });

  it("prefers the matching bundle manifest version for a downstream release", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({
        version: "1.3.2-xx.1",
        brand: { id: "frogg", applicationId: "app.frogg.frogg" },
      }),
      "utf8",
    );
    mkdirSync(path.join(root, "daemon", "packages", "server"), { recursive: true });
    writeFileSync(
      path.join(root, "daemon", "packages", "server", "package.json"),
      JSON.stringify({ name: "@frogg/server", version: "1.3.2" }),
      "utf8",
    );
    const nestedDir = path.join(root, "daemon", "packages", "server", "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(resolveDaemonVersion(moduleUrl)).toBe("1.3.2-xx.1");
  });

  it("ignores a bundle manifest for another product", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "manifest.json"),
      JSON.stringify({
        version: "1.3.2-xx.1",
        brand: { id: "other", applicationId: "com.example.other" },
      }),
      "utf8",
    );
    mkdirSync(path.join(root, "daemon", "packages", "server"), { recursive: true });
    writeFileSync(
      path.join(root, "daemon", "packages", "server", "package.json"),
      JSON.stringify({ name: "@frogg/server", version: "1.3.2" }),
      "utf8",
    );
    const nestedDir = path.join(root, "daemon", "packages", "server", "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(resolveDaemonVersion(moduleUrl)).toBe("1.3.2");
  });

  it("throws when @frogg/server package metadata cannot be resolved", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "not-frogg-app-server", version: "1.2.3" }),
      "utf8",
    );
    const nestedDir = path.join(root, "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(() => resolveDaemonVersion(moduleUrl)).toThrow(DaemonVersionResolutionError);
  });

  it("throws when @frogg/server version is missing", () => {
    const root = createTempDir();
    writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ name: "@frogg/server" }),
      "utf8",
    );
    const nestedDir = path.join(root, "dist", "server");
    mkdirSync(nestedDir, { recursive: true });

    const moduleUrl = pathToFileURL(path.join(nestedDir, "index.js")).href;
    expect(() => resolveDaemonVersion(moduleUrl)).toThrow(DaemonVersionResolutionError);
  });
});
