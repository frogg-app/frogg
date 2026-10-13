import { beforeEach, describe, expect, it } from "vitest";
import { addHost, upsertHost, useHosts } from "./hosts";

describe("upsertHost", () => {
  beforeEach(() => useHosts.setState({ hosts: [], activeId: null }));

  it("adopts an address-only host at the same endpoint when it pairs", () => {
    const bare = addHost({ name: "127.0.0.1", endpoint: "127.0.0.1:6767" });
    const paired = upsertHost({
      name: "devbox",
      endpoint: "127.0.0.1:6767",
      password: "cred",
      serverId: "srv_1",
    });
    expect(paired.id).toBe(bare.id);
    expect(useHosts.getState().hosts).toHaveLength(1);
    expect(useHosts.getState().hosts[0]).toMatchObject({ serverId: "srv_1", password: "cred" });
  });

  it("keeps a host of another daemon at that endpoint separate", () => {
    upsertHost({ name: "a", endpoint: "127.0.0.1:6767", serverId: "srv_a" });
    upsertHost({ name: "b", endpoint: "127.0.0.1:6767", serverId: "srv_b" });
    expect(useHosts.getState().hosts).toHaveLength(2);
  });
});
