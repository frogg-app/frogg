import { beforeEach, describe, expect, it } from "vitest";
import { addHost, rebindHost, upsertHost, useHosts } from "./hosts";

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

describe("rebindHost", () => {
  beforeEach(() => useHosts.setState({ hosts: [], activeId: null }));

  it("binds the entry to the new daemon and drops the old one's credential", () => {
    const old = addHost({
      name: "devbox",
      endpoint: "127.0.0.1:6767",
      serverId: "srv_old",
      password: "cred",
      fingerprint: "sha256:old",
      role: "owner",
    });
    const next = rebindHost(old.id, "srv_new");
    expect(next).toMatchObject({ id: old.id, name: "devbox", serverId: "srv_new" });
    expect(next).not.toHaveProperty("password");
    expect(next).not.toHaveProperty("fingerprint");
    expect(next).not.toHaveProperty("role");
    // Pairing with the new daemon then refreshes this same entry.
    const paired = upsertHost({ name: "devbox", endpoint: "127.0.0.1:6767", serverId: "srv_new" });
    expect(paired.id).toBe(old.id);
    expect(useHosts.getState().hosts).toHaveLength(1);
  });
});
