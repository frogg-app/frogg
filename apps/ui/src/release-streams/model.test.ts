import { describe, expect, it } from "vitest";
import type { ReleaseStream, ReleaseStreamChange } from "@frogg/protocol/messages";
import { filterChanges, layoutStreamGraph, orderStreams, summarizeFlow } from "./model";

function stream(id: string, releases: Array<[string, string]>, extra: Partial<ReleaseStream> = {}) {
  return {
    id,
    kind: id,
    label: id,
    ref: `refs/remotes/origin/${id}`,
    channel: id.includes("stable") ? "stable" : "beta",
    exists: true,
    head: "abc",
    headDate: "2026-09-26T00:00:00Z",
    version: releases[0]?.[0] ?? null,
    unreleased: 2,
    releases: releases.map(([version, date]) => ({
      tag: `v${version}`,
      version,
      sha: version,
      date,
    })),
    ...extra,
  } satisfies ReleaseStream;
}

function change(
  subject: string,
  type: string,
  presence: Record<string, string>,
  origin = "development",
): ReleaseStreamChange {
  return {
    sha: subject.replace(/\W/g, "").slice(0, 8).padEnd(8, "0"),
    subject,
    type,
    scope: null,
    breaking: false,
    author: "t",
    date: null,
    origin,
    presence: Object.entries(presence).map(([s, state]) => ({
      stream: s,
      state,
      via: null,
      release: null,
    })),
  };
}

describe("release streams model", () => {
  it("orders the most stable stream first and upstream above the fork", () => {
    const ids = orderStreams([
      stream("development", []),
      stream("stable", []),
      stream("upstream-development", []),
      stream("upstream-stable", []),
    ]).map((s) => s.id);
    expect(ids).toEqual(["upstream-stable", "upstream-development", "stable", "development"]);
  });

  it("lays releases out in time order with heads in the last column and promotions joined", () => {
    const layout = layoutStreamGraph({
      streams: [
        stream("development", [
          ["1.6.0-beta.2", "2026-09-20T00:00:00Z"],
          ["1.6.0-beta.1", "2026-09-10T00:00:00Z"],
        ]),
        stream("stable", [
          ["1.6.0", "2026-09-22T00:00:00Z"],
          ["1.5.1", "2026-09-12T00:00:00Z"],
        ]),
      ],
      events: [
        {
          kind: "promote",
          from: "development",
          to: "stable",
          fromRelease: "1.6.0-beta.2",
          toRelease: "1.6.0",
          sha: "p",
          date: "2026-09-22T00:00:00Z",
          count: 0,
        },
        {
          kind: "backport",
          from: "development",
          to: "stable",
          fromRelease: null,
          toRelease: "1.5.1",
          sha: "b",
          date: "2026-09-12T00:00:00Z",
          count: 2,
        },
      ],
      flows: [
        { from: "development", to: "stable", kind: "promote", pending: 3, command: null },
        { from: "stable", to: "development", kind: "forward-port", pending: 0, command: null },
      ],
    });
    expect(layout.lanes.map((lane) => lane.stream.id)).toEqual(["stable", "development"]);
    const column = (key: string) => layout.nodes.find((node) => node.key === key)?.column;
    expect(column("development:v1.6.0-beta.1")).toBe(0);
    expect(column("stable:v1.5.1")).toBe(1);
    expect(column("development:v1.6.0-beta.2")).toBe(2);
    expect(column("stable:v1.6.0")).toBe(3);
    expect(column("stable:head")).toBe(4);
    expect(column("development:head")).toBe(4);
    const promote = layout.edges.find((edge) => edge.kind === "promote")!;
    expect([promote.from.key, promote.to.key]).toEqual([
      "development:v1.6.0-beta.2",
      "stable:v1.6.0",
    ]);
    const backport = layout.edges.find((edge) => edge.kind === "backport")!;
    expect(backport.from).toMatchObject({ stream: "development", column: 0 });
    expect(backport.count).toBe(2);
    expect(layout.pending).toHaveLength(1);
    expect(layout.columns).toBe(5);
  });

  it("filters and summarises changes", () => {
    const changes = [
      change("feat: a", "feat", { stable: "pending", development: "shipped" }),
      change("fix: b", "fix", { stable: "shipped", development: "shipped" }),
      change("fix: c", "fix", { stable: "pending", development: "landed" }),
    ];
    expect(filterChanges(changes, "features", "").map((c) => c.subject)).toEqual(["feat: a"]);
    expect(filterChanges(changes, "waiting", "").map((c) => c.subject)).toEqual([
      "feat: a",
      "fix: c",
    ]);
    expect(filterChanges(changes, "all", "c").map((c) => c.subject)).toEqual(["fix: c"]);
    expect(
      summarizeFlow(
        { from: "development", to: "stable", kind: "promote", pending: 2, command: null },
        changes,
      ),
    ).toEqual({ features: 1, fixes: 1, other: 0 });
  });
});
