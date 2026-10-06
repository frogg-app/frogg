import {
  Archive,
  Copy,
  Eye,
  EyeOff,
  FolderPlus,
  History,
  MessageSquare,
  Pencil,
  Pin,
  Tag,
  Upload,
} from "lucide-react-native";
import { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useDaemon } from "../../daemon/store";
import { color } from "../../theme/tokens";
import { Select } from "../Select";
import { Seg, Toggle } from "../settings/controls";
import { copyText } from "../shell/copy";
import { T } from "../Text";
import { Menu, Popover, type MenuEntry, type Rect } from "../tools/Menu";
import {
  isChat,
  openSheet,
  projectIdOf,
  setPinned,
  setPrefs,
  setScope,
  toggleHidden,
  useDirectory,
  type Group,
  type ShowKey,
  type Sort,
} from "./directory";

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/** The "All projects ▾" switcher: every project with its session count, then chats and history. */
export function ScopeMenu({ rect, onClose }: { rect: Rect | null; onClose: () => void }) {
  const sessions = useDaemon((s) => s.sessions);
  const host = useDaemon((s) => s.serverName) ?? "this host";
  const dir = useDirectory();
  const items = useMemo<MenuEntry[]>(() => {
    const counts = new Map<string, number>();
    let all = 0;
    for (const sess of Object.values(sessions)) {
      if (isChat(sess, dir)) continue;
      all += 1;
      const id = projectIdOf(sess, dir);
      if (id) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const out: MenuEntry[] = [
      { head: "Scope" },
      {
        label: "All projects",
        hint: `${plural(all, "session")} · ${host}`,
        on: dir.scope === "all",
        onPress: () => setScope("all"),
      },
    ];
    for (const p of dir.projects)
      out.push({
        label: p.projectDisplayName,
        hint: `${plural(counts.get(p.projectId) ?? 0, "session")} · ${host}`,
        on: dir.scope === p.projectId,
        onPress: () => setScope(p.projectId),
      });
    out.push(
      "-",
      {
        label: "Chats",
        hint: "Project-less, read-only sandbox",
        icon: MessageSquare,
        on: dir.scope === "chats",
        onPress: () => setScope("chats"),
      },
      {
        label: "History",
        hint: "Archived and past sessions",
        icon: History,
        on: dir.scope === "archived",
        onPress: () => setScope("archived"),
      },
      "-",
      {
        label: "Add project…",
        icon: FolderPlus,
        onPress: () => openSheet({ kind: "add-project" }),
      },
      {
        label: "Import conversations…",
        icon: Upload,
        onPress: () => openSheet({ kind: "import" }),
      },
    );
    return out;
  }, [sessions, dir, host]);
  return <Menu rect={rect} onClose={onClose} items={items} width={316} />;
}

/** Right-click / long-press menu for one session row. */
export function SessionMenu({
  rect,
  agentId,
  onClose,
}: {
  rect: Rect | null;
  agentId: string | null;
  onClose: () => void;
}) {
  const sess = useDaemon((s) => (agentId ? s.sessions[agentId] : undefined));
  const ws = useDirectory((d) =>
    sess?.agent.workspaceId ? d.workspaces[sess.agent.workspaceId] : undefined,
  );
  const hidden = useDirectory((d) => (agentId ? d.hidden.includes(agentId) : false));
  const items = useMemo<MenuEntry[]>(() => {
    if (!sess) return [];
    const a = sess.agent;
    const branch = sess.project?.checkout.isGit ? sess.project.checkout.currentBranch : null;
    const out: MenuEntry[] = [
      {
        label: "Rename…",
        icon: Pencil,
        onPress: () => openSheet({ kind: "rename", agentId: a.id }),
      },
    ];
    if (ws) {
      out.push(
        {
          label: "Labels",
          icon: Tag,
          sub: true,
          onPress: () => openSheet({ kind: "labels", agentId: a.id }),
        },
        {
          label: ws.pinnedAt ? "Unpin" : "Pin to top",
          icon: Pin,
          on: !!ws.pinnedAt,
          onPress: () => void setPinned(ws.id, !ws.pinnedAt).catch(() => {}),
        },
      );
    }
    out.push(
      "-",
      { label: "Copy path", icon: Copy, onPress: () => void copyText(a.cwd) },
      ...(branch
        ? [{ label: "Copy branch", icon: Copy, onPress: () => void copyText(branch) }]
        : []),
      { label: "Copy ID", icon: Copy, onPress: () => void copyText(a.id) },
      "-",
      {
        label: hidden ? "Show in list" : "Hide from list",
        hint: "On this device only",
        icon: hidden ? Eye : EyeOff,
        onPress: () => toggleHidden(a.id),
      },
      {
        label: "Archive session…",
        icon: Archive,
        danger: true,
        onPress: () => openSheet({ kind: "archive", agentId: a.id }),
      },
    );
    return out;
  }, [sess, ws, hidden]);
  return <Menu rect={sess ? rect : null} onClose={onClose} items={items} width={260} />;
}

const GROUPS: Array<[Group, string]> = [
  ["attention", "Attention"],
  ["project", "Project"],
  ["labels", "Labels"],
];
const SORTS: Array<{ value: Sort; label: string }> = [
  { value: "recent", label: "Recent activity" },
  { value: "created", label: "Created" },
  { value: "title", label: "Title" },
];
const TITLES: Array<["title" | "branch", string]> = [
  ["title", "Title"],
  ["branch", "Branch"],
];
const SHOW: Array<[ShowKey, string]> = [
  ["project", "Project"],
  ["branch", "Branch"],
  ["host", "Host"],
  ["labels", "Labels"],
  ["provider", "Provider"],
];
const ANY = "__any";
const SELECTED = { selected: true };
const UNSELECTED = { selected: false };

const pickGroup = (group: Group) => setPrefs({ group });
const pickSort = (sort: Sort) => setPrefs({ sort });
const pickTitle = (title: "title" | "branch") => setPrefs({ title });
const pickLabel = (v: string) => setPrefs({ label: v === ANY ? null : v });
const pickHidden = (showHidden: boolean) => setPrefs({ showHidden });

/** The filter-icon popover: grouping, sort, row title, visible fields, label filter. */
export function DisplayMenu({ rect, onClose }: { rect: Rect | null; onClose: () => void }) {
  const prefs = useDirectory((d) => d.prefs);
  const labels = useDirectory((d) => d.labels);
  const hiddenN = useDirectory((d) => d.hidden.length);
  const labelOpts = useMemo(
    () => [{ value: ANY, label: "Any" }, ...labels.map((l) => ({ value: l.name, label: l.name }))],
    [labels],
  );
  return (
    <Popover rect={rect} onClose={onClose} width={330}>
      <View style={s.pop}>
        <T v="label" style={s.head}>
          Display
        </T>
        <View style={s.line}>
          <T style={s.k}>Group</T>
          <Seg options={GROUPS} value={prefs.group} onChange={pickGroup} />
        </View>
        <View style={s.line}>
          <T style={s.k}>Sort</T>
          <Select value={prefs.sort} options={SORTS} onChange={pickSort} width={160} label="Sort" />
        </View>
        <View style={s.line}>
          <T style={s.k}>Title</T>
          <Seg options={TITLES} value={prefs.title} onChange={pickTitle} />
        </View>
        <T v="label" style={s.head}>
          Show
        </T>
        <View style={s.chips}>
          {SHOW.map(([k, label]) => (
            <ShowChip key={k} k={k} label={label} on={prefs.show[k]} />
          ))}
        </View>
        <T v="label" style={s.head}>
          Filter
        </T>
        <View style={s.line}>
          <T style={s.k}>Label</T>
          <Select
            value={prefs.label ?? ANY}
            options={labelOpts}
            onChange={pickLabel}
            width={160}
            label="Label"
          />
        </View>
        <View style={s.line}>
          <T style={s.k}>Show hidden ({hiddenN})</T>
          <Toggle value={prefs.showHidden} onChange={pickHidden} />
        </View>
      </View>
    </Popover>
  );
}

function ShowChip({ k, label, on }: { k: ShowKey; label: string; on: boolean }) {
  const flip = useCallback(
    () => setPrefs({ show: { ...useDirectory.getState().prefs.show, [k]: !on } }),
    [k, on],
  );
  return (
    <Pressable
      onPress={flip}
      style={[s.chip, on && s.chipOn]}
      accessibilityState={on ? SELECTED : UNSELECTED}
    >
      <T style={on ? s.chipTOn : s.chipT}>{label}</T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  pop: { padding: 10, gap: 8 },
  head: { fontSize: 9.5, marginTop: 4 },
  line: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    zIndex: 1,
  },
  k: { fontSize: 13 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  chip: { borderWidth: 1, borderColor: color.line2, paddingHorizontal: 9, paddingVertical: 4 },
  chipOn: { borderColor: "rgba(37,181,200,0.45)", backgroundColor: "rgba(37,181,200,0.1)" },
  chipT: { fontSize: 12, color: color.faint },
  chipTOn: { fontSize: 12, color: color.cyan2 },
});
