import { describe, expect, it, vi } from "vitest";

vi.mock("../TerminalsPanel", () => ({ TerminalRow: () => null }));
vi.mock("../../daemon/terminals", () => ({}));
vi.mock("../../daemon/hosts", () => ({ useHosts: () => null }));
vi.mock("../../ui-store", () => ({ useUi: () => null }));

const { groupByHost } = await import("./merged");

const sess = (id: string, hostId?: string) => ({ agent: { id }, hostId }) as never;
const hosts = [
  { id: "a", name: "workstation" },
  { id: "b", name: "build box" },
  { id: "c", name: "laptop" },
];

describe("groupByHost", () => {
  it("puts the active host first, then the others in saved order", () => {
    const groups = groupByHost([sess("1", "c"), sess("2"), sess("3", "a")], hosts, "b", new Set());
    expect(groups.map((g) => [g.label, g.list.length])).toEqual([
      ["build box", 1],
      ["workstation", 1],
      ["laptop", 1],
    ]);
    expect(groups[0].hostId).toBe("b");
  });

  it("keeps a host that only has terminals and drops empty ones", () => {
    const groups = groupByHost([sess("1")], hosts, "a", new Set(["c"]));
    expect(groups.map((g) => g.hostId)).toEqual(["a", "c"]);
    expect(groups[1].list).toEqual([]);
  });
});
