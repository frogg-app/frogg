import { brand } from "@frogg/branding";
import { afterEach, describe, expect, test, vi } from "vitest";
import { probeDaemon, waitForDaemonVersion } from "./verify.js";

afterEach(() => vi.unstubAllGlobals());

describe("update gateway verification", () => {
  test.each([null, "0.4.3"])(
    "verifies installed gateway header %s while retaining backend version",
    async (gateway) => {
      const headers = new Headers();
      if (gateway) headers.set("x-frogg-gateway-version", gateway);
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ version: "0.4.2", brand }), {
              headers,
            }),
          )
          .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }))),
      );
      await expect(probeDaemon("http://127.0.0.1:1")).resolves.toEqual({
        version: gateway ?? "0.4.2",
        healthy: true,
      });
    },
  );
});

describe("foreign daemon on the listen address", () => {
  test("the pre-rename FDE daemon is reported as foreign, not as a version mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({
              product: "fde",
              brand: { id: "fde", name: "FDE", applicationId: "app.frogg.fde" },
              version: "0.6.13",
            }),
          ),
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ status: "ok" }))),
    );
    await expect(probeDaemon("http://127.0.0.1:1")).resolves.toEqual({
      version: "0.6.13",
      healthy: false,
      foreign: { product: "fde", brand: "fde" },
    });
  });

  test("fails fast with foreign_listener instead of waiting out the timeout", async () => {
    let clock = 0;
    const result = await waitForDaemonVersion(
      {
        httpBase: "http://127.0.0.1:9999",
        expectedVersion: "1.5.7",
        timeoutMs: 90_000,
        sleep: async () => {
          clock += 1000;
        },
        now: () => clock,
      },
      async () => ({
        version: "0.6.13",
        healthy: false,
        foreign: { product: "fde", brand: "fde" },
      }),
    );
    expect(result).toMatchObject({ ok: false, kind: "foreign_listener" });
    expect((result as { reason: string }).reason).toMatch(/another daemon \(fde 0\.6\.13\)/);
    expect(clock).toBeLessThan(30_000);
  });

  test("a transient foreign answer during the restart race does not fail the update", async () => {
    let calls = 0;
    let clock = 0;
    const result = await waitForDaemonVersion(
      {
        httpBase: "http://x",
        expectedVersion: "1.5.7",
        sleep: async () => {
          clock += 1000;
        },
        now: () => clock,
      },
      async () =>
        ++calls <= 3
          ? { version: "0.6.13", healthy: false, foreign: { product: "fde", brand: "fde" } }
          : { version: "1.5.7", healthy: true },
    );
    expect(result).toMatchObject({ ok: true });
  });
});
