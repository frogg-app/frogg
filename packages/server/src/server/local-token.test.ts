import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";

import { createLocalTokenFile, readLocalToken, LOCAL_TOKEN_FILENAME } from "./local-token.js";
import { PRIVATE_FILE_MODE } from "./private-files.js";

describe("local token file", () => {
  const homes: string[] = [];
  afterEach(() => {
    for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
  });

  function makeHome(): string {
    const created = mkdtempSync(path.join(tmpdir(), "frogg-local-token-"));
    homes.push(created);
    return created;
  }

  test("creates one token, keeps it, and stores it unreadable by others", () => {
    const froggHome = makeHome();
    const file = createLocalTokenFile(froggHome);
    expect(file.read()).toBeNull();

    const token = file.ensure();
    expect(token).toMatch(/^flt1\./);
    expect(file.ensure()).toBe(token);
    expect(readLocalToken(froggHome)).toBe(token);
    expect(readFileSync(path.join(froggHome, LOCAL_TOKEN_FILENAME), "utf8").trim()).toBe(token);
    if (process.platform !== "win32") {
      expect(statSync(file.filePath).mode & 0o777).toBe(PRIVATE_FILE_MODE);
    }
  });

  test("matches only the exact token", () => {
    const file = createLocalTokenFile(makeHome());
    const token = file.ensure();
    expect(file.matches(token)).toBe(true);
    expect(file.matches(`${token}x`)).toBe(false);
    expect(file.matches("")).toBe(false);
    expect(file.matches(null)).toBe(false);
  });

  test("matches nothing before a token exists", () => {
    const file = createLocalTokenFile(makeHome());
    expect(file.matches("anything")).toBe(false);
  });
});
