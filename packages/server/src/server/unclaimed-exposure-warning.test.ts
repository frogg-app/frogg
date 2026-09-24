import { describe, expect, test } from "vitest";

import { shouldWarnUnclaimedExposure } from "./bootstrap.js";

const tcp = (host: string) => ({ type: "tcp" as const, host, port: 6767 });

describe("unclaimed exposure warning", () => {
  test("warns only for claim mode, unclaimed, and a non-loopback bind", () => {
    expect(
      shouldWarnUnclaimedExposure({
        claimMode: true,
        claimed: false,
        listenTarget: tcp("0.0.0.0"),
      }),
    ).toBe(true);
    expect(
      shouldWarnUnclaimedExposure({
        claimMode: true,
        claimed: false,
        listenTarget: tcp("::"),
      }),
    ).toBe(true);
    expect(
      shouldWarnUnclaimedExposure({
        claimMode: true,
        claimed: false,
        listenTarget: tcp("192.168.1.10"),
      }),
    ).toBe(true);
  });

  test("stays quiet on loopback, sockets, when claimed, or with claim mode off", () => {
    for (const host of ["127.0.0.1", "::1", "[::1]", "localhost"]) {
      expect(
        shouldWarnUnclaimedExposure({
          claimMode: true,
          claimed: false,
          listenTarget: tcp(host),
        }),
      ).toBe(false);
    }
    expect(
      shouldWarnUnclaimedExposure({
        claimMode: true,
        claimed: false,
        listenTarget: { type: "socket", path: "/tmp/frogg.sock" },
      }),
    ).toBe(false);
    expect(
      shouldWarnUnclaimedExposure({
        claimMode: true,
        claimed: true,
        listenTarget: tcp("0.0.0.0"),
      }),
    ).toBe(false);
    expect(
      shouldWarnUnclaimedExposure({
        claimMode: false,
        claimed: false,
        listenTarget: tcp("0.0.0.0"),
      }),
    ).toBe(false);
  });
});
