import { describe, expect, it } from "vitest";
import type { Session } from "../../daemon/types";
import { buildFamily, familyRows } from "./family";

const PARENT = "frogg.parent-agent-id";

function sess(
  id: string,
  opts: { parent?: string; host?: string; status?: string; perm?: boolean; title?: string } = {},
): Session {
  return {
    hostId: opts.host,
    project: null,
    agent: {
      id,
      title: opts.title ?? id,
      status: opts.status ?? "idle",
      pendingPermissions: opts.perm ? [{ id: "p" }] : [],
      labels: opts.parent ? { [PARENT]: opts.parent } : {},
    },
  } as unknown as Session;
}

const all = { inScope: () => true, passes: () => true, matches: () => true };

describe("session families", () => {
  it("lists a child under its parent, not as a row of its own", () => {
    const pool = [sess("p"), sess("c", { parent: "p" }), sess("g", { parent: "c" })];
    const fam = buildFamily(pool);
    expect(fam.rootOf(pool[2]).agent.id).toBe("p");
    expect(familyRows(pool, fam, all).roots.map((x) => x.agent.id)).toEqual(["p"]);
  });

  it("keeps a child whose parent is not loaded, and a detached one, as roots", () => {
    const pool = [sess("orphan", { parent: "gone" }), sess("free")];
    const rows = familyRows(pool, buildFamily(pool), all);
    expect(rows.roots.map((x) => x.agent.id)).toEqual(["orphan", "free"]);
  });

  it("never links across hosts", () => {
    const pool = [sess("p"), sess("c", { parent: "p", host: "h2" })];
    const fam = buildFamily(pool);
    expect(fam.rootOf(pool[1]).agent.id).toBe("c");
  });

  it("files the family under its most urgent state", () => {
    const pool = [sess("p"), sess("c", { parent: "p", perm: true })];
    const fam = buildFamily(pool);
    expect(fam.bucketOf(pool[0])).toBe("needs");
  });

  it("scopes children by their root and lets a matching child bring its family in", () => {
    const pool = [sess("p", { title: "parent" }), sess("c", { parent: "p", title: "needle" })];
    const fam = buildFamily(pool);
    const rows = familyRows(pool, fam, {
      inScope: (root) => root.agent.id === "p",
      passes: () => true,
      matches: (x) => x.agent.title === "needle",
    });
    expect(rows.inScope).toHaveLength(2);
    expect(rows.roots.map((x) => x.agent.id)).toEqual(["p"]);
  });

  it("puts another host's children right after their root as nested rows", () => {
    const pool = [
      sess("p", { host: "h2" }),
      sess("q", { host: "h2" }),
      sess("c", { parent: "p", host: "h2" }),
    ];
    const rows = familyRows(pool, buildFamily(pool), all);
    expect(rows.withKids(rows.roots).map((x) => x.agent.id)).toEqual(["p", "c", "q"]);
    expect(rows.nested.has("h2:c")).toBe(true);
  });

  it("survives a parent cycle", () => {
    const pool = [sess("a", { parent: "b" }), sess("b", { parent: "a" })];
    const rows = familyRows(pool, buildFamily(pool), all);
    expect(rows.roots.map((x) => x.agent.id)).toEqual(["a", "b"]);
  });
});
