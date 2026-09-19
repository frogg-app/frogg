import { describe, expect, it } from "vitest";
import type { TFunction } from "i18next";
import type { HostConnection } from "@/types/host-connection";
import { formatHostConnectionLabel, resolveHeaderConnections } from "./host-connection-display";

const t = ((key: string) => key.split(".").at(-1)) as unknown as TFunction;
const tcp: HostConnection = { id: "tcp", type: "directTcp", endpoint: "192.168.1.17:9999" };
const relay: HostConnection = {
  id: "relay",
  type: "relay",
  relayEndpoint: "relay.example:443",
  daemonPublicKeyB64: "key",
};

describe("host header connections", () => {
  it("names the address and port for a TCP connection", () => {
    expect(formatHostConnectionLabel(tcp, t)).toBe("TCP (192.168.1.17:9999)");
  });

  it("names every dialled connection before the runtime has picked one", () => {
    // Connecting while probes are still out, or after every probe timed out.
    expect(resolveHeaderConnections({ activeConnectionId: null, connections: [tcp] })).toEqual([
      tcp,
    ]);
    expect(
      resolveHeaderConnections({ activeConnectionId: null, connections: [tcp, relay] }),
    ).toEqual([tcp, relay]);
  });

  it("names only the picked connection once there is one, in any state", () => {
    expect(
      resolveHeaderConnections({ activeConnectionId: "relay", connections: [tcp, relay] }),
    ).toEqual([relay]);
  });

  it("falls back to every connection when the active one was removed", () => {
    expect(
      resolveHeaderConnections({ activeConnectionId: "gone", connections: [tcp, relay] }),
    ).toEqual([tcp, relay]);
  });
});
