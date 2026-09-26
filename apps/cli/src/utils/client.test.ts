import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { brand } from "@frogg/branding";

import { resolveDaemonCredential, resolveDaemonPassword, resolveDaemonTarget } from "./client.js";
import { isLocalDaemonHost, readCliLocalToken } from "./local-token.js";

const PASSWORD_KEY = `${brand.envPrefix.replace(/_+$/, "")}_PASSWORD`;

describe("resolveDaemonPassword", () => {
  test("reads the brand-prefixed password variable", () => {
    expect(resolveDaemonPassword("localhost:6767", { [PASSWORD_KEY]: "secret" })).toBe("secret");
  });

  test("ignores an empty password variable", () => {
    expect(resolveDaemonPassword("localhost:6767", { [PASSWORD_KEY]: "  " })).toBeUndefined();
  });

  test("a password in a tcp:// URI wins over the environment", () => {
    expect(
      resolveDaemonPassword("tcp://127.0.0.1:6767?password=fromuri", { [PASSWORD_KEY]: "env" }),
    ).toBe("fromuri");
  });
});

describe("local token credential", () => {
  let home: string;

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), "frogg-cli-token-"));
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  test("readCliLocalToken returns null when the file is absent", () => {
    expect(readCliLocalToken(home)).toBeNull();
  });

  test("a local daemon gets the local token when no password is set", () => {
    writeFileSync(path.join(home, "local-token"), "flt1.abc\n", { mode: 0o600 });
    expect(resolveDaemonCredential("127.0.0.1:6767", { home, env: {} })).toBe("flt1.abc");
    expect(resolveDaemonCredential("0.0.0.0:6767", { home, env: {} })).toBe("flt1.abc");
    expect(resolveDaemonCredential("unix:///tmp/frogg.sock", { home, env: {} })).toBe("flt1.abc");
  });

  test("a password wins over the local token", () => {
    writeFileSync(path.join(home, "local-token"), "flt1.abc\n");
    expect(resolveDaemonCredential("127.0.0.1:6767", { home, env: { [PASSWORD_KEY]: "pw" } })).toBe(
      "pw",
    );
  });

  test("the local token is never sent to a remote host", () => {
    writeFileSync(path.join(home, "local-token"), "flt1.abc\n");
    expect(resolveDaemonCredential("192.168.1.5:6767", { home, env: {} })).toBeUndefined();
    expect(resolveDaemonCredential("example.com:6767", { home, env: {} })).toBeUndefined();
  });

  test("isLocalDaemonHost recognises loopback and IPC targets", () => {
    expect(isLocalDaemonHost("localhost:6767")).toBe(true);
    expect(isLocalDaemonHost("[::1]:6767")).toBe(true);
    expect(isLocalDaemonHost(":::6767")).toBe(true);
    expect(isLocalDaemonHost("tcp://127.0.0.1:6767?ssl=true")).toBe(true);
    expect(isLocalDaemonHost("/run/frogg.sock")).toBe(true);
    expect(isLocalDaemonHost("10.0.0.2:6767")).toBe(false);
  });
});

describe("resolveDaemonTarget", () => {
  test("dials loopback for a wildcard bind read from the pid file", () => {
    expect(resolveDaemonTarget(":::9999").url).toBe("ws://[::1]:9999/ws");
    expect(resolveDaemonTarget("[::]:9999").url).toBe("ws://[::1]:9999/ws");
    expect(resolveDaemonTarget("0.0.0.0:9999").url).toBe("ws://127.0.0.1:9999/ws");
  });

  test("leaves an addressable host alone", () => {
    expect(resolveDaemonTarget("127.0.0.1:9999").url).toBe("ws://127.0.0.1:9999/ws");
    expect(resolveDaemonTarget("10.0.0.2:9999").url).toBe("ws://10.0.0.2:9999/ws");
  });
});
