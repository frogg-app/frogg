import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, test } from "vitest";
import {
  describePortHolder,
  findPortHolder,
  isAddressInUse,
  parseLsofOwner,
  parseSsOwner,
} from "./port-holder.js";

describe("port holder", () => {
  test("parses the owning process from ss and lsof", () => {
    expect(
      parseSsOwner(
        'LISTEN 0 511 0.0.0.0:9999 0.0.0.0:* users:(("Frogg Daemon",pid=1805533,fd=31))',
      ),
    ).toEqual({ pid: 1805533, name: "Frogg Daemon" });
    expect(parseSsOwner("LISTEN 0 511 0.0.0.0:9999 0.0.0.0:*")).toBeUndefined();
    expect(parseLsofOwner("p4242\ncnode\nf31\n")).toEqual({ pid: 4242, name: "node" });
    expect(parseLsofOwner("")).toBeUndefined();
  });

  test("names a daemon answering /api/identity on the port", async () => {
    const server = createServer((req, res) => {
      if (req.url === "/api/identity") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ product: "fde", version: "0.6.13", serverId: "srv_old" }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const holder = await findPortHolder("0.0.0.0", port);
      expect(holder.identity).toEqual({ product: "fde", version: "0.6.13", serverId: "srv_old" });
      expect(describePortHolder(holder)).toContain(
        `port ${port} is already in use by a fde daemon 0.6.13 (server srv_old)`,
      );
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  test("still names the port when the owner is unknown", () => {
    expect(describePortHolder({ port: 9999 })).toBe(
      "port 9999 is already in use by another process (owner not discoverable)",
    );
    expect(isAddressInUse(Object.assign(new Error("x"), { code: "EADDRINUSE" }))).toBe(true);
    expect(isAddressInUse(new Error("x"))).toBe(false);
  });
});
