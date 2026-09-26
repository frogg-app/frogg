import { describe, expect, test } from "vitest";
import { groupSidebarChats, type SidebarChatItem } from "./chat-list-model";

const now = new Date(2026, 8, 26, 15, 0, 0);
const at = (daysAgo: number, hour = 12) => new Date(2026, 8, 26 - daysAgo, hour, 0, 0).getTime();
const titles = (group: { items: SidebarChatItem[] }) => group.items.map((entry) => entry.title);
const item = (title: string, sortTime: number): SidebarChatItem => ({
  serverId: "srv",
  workspaceId: title,
  title,
  status: "done",
  sortTime,
});

describe("groupSidebarChats", () => {
  test("buckets by calendar day, newest first, and drops empty buckets", () => {
    const groups = groupSidebarChats({
      items: [
        item("old", at(30)),
        item("morning", at(0, 8)),
        item("afternoon", at(0, 14)),
        item("yesterday late", at(1, 23)),
        item("last week", at(5)),
      ],
      query: "",
      now,
    });
    expect(groups.map((group) => [group.key, titles(group)])).toEqual([
      ["today", ["afternoon", "morning"]],
      ["yesterday", ["yesterday late"]],
      ["previous7Days", ["last week"]],
      ["older", ["old"]],
    ]);
  });

  test("filters by title, case-insensitively", () => {
    const groups = groupSidebarChats({
      items: [item("Rust lifetimes", at(0)), item("S3 pricing", at(0))],
      query: " rust ",
      now,
    });
    expect(groups).toEqual([{ key: "today", items: [item("Rust lifetimes", at(0))] }]);
  });
});
