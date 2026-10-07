import {
  ChevronDown,
  Filter,
  FolderGit2,
  History,
  Layers,
  MessageSquare,
  Pin,
  Plus,
} from "lucide-react-native";
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Brackets, BracketScope } from "./Brackets";
import { answerPermission, useDaemon } from "../daemon/store";
import { bucketOf, type Bucket, type Session } from "../daemon/types";
import { color, font, web } from "../theme/tokens";
import { useUi } from "../ui-store";
import { ago } from "../util";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { useRunningSubWork } from "../daemon/subwork";
import { useRowSubWork } from "./subwork/hooks";
import { SubWorkBody, SubWorkChip } from "./subwork/views";
import { useContextMenu } from "./sessions/contextMenu";
import { isChat, openSheet, projectIdOf, useDirectory, type Prefs } from "./sessions/directory";
import { ageGroup, HistoryList } from "./sessions/history";
import { DisplayMenu, ScopeMenu, SessionMenu } from "./sessions/menus";
import { LabelChip, SessionSheets } from "./sessions/sheets";
import { StatusSummary } from "./sessions/StatusSummary";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";
import { useAnchor, type Rect } from "./tools/Menu";

const ORDER: Array<{ b: Bucket; label: string }> = [
  { b: "needs", label: "Needs you" },
  { b: "failed", label: "Failed" },
  { b: "review", label: "Ready to review" },
  { b: "working", label: "Working" },
  { b: "idle", label: "Idle" },
];

export function useBuckets() {
  const sessions = useDaemon((s) => s.sessions);
  return useMemo(() => {
    const out: Record<Bucket, Session[]> = {
      needs: [],
      failed: [],
      review: [],
      working: [],
      idle: [],
    };
    for (const s of Object.values(sessions)) out[bucketOf(s.agent)].push(s);
    for (const list of Object.values(out))
      list.sort((a, b) => Date.parse(b.agent.updatedAt) - Date.parse(a.agent.updatedAt));
    return out;
  }, [sessions]);
}

const openNewSession = () => useUi.getState().setNewSession(true);
const openImport = () => openSheet({ kind: "import" });

interface Group {
  key: string;
  label: string;
  list: Session[];
}

const branchOf = (x: Session) =>
  x.project?.checkout.isGit ? x.project.checkout.currentBranch : null;
const projectName = (x: Session) => x.project?.projectName ?? x.agent.cwd.split("/").pop() ?? "";

function sorter(sort: Prefs["sort"], pinned: (x: Session) => boolean) {
  return (a: Session, b: Session) => {
    const p = Number(pinned(b)) - Number(pinned(a));
    if (p) return p;
    if (sort === "title") return (a.agent.title ?? "").localeCompare(b.agent.title ?? "");
    const key = sort === "created" ? "createdAt" : "updatedAt";
    return Date.parse(b.agent[key]) - Date.parse(a.agent[key]);
  };
}

/** The scoped, filtered, grouped rows the list shows, plus per-bucket counts for the meter. */
function useListModel(needle: string) {
  const sessions = useDaemon((s) => s.sessions);
  const dir = useDirectory();
  return useMemo(() => {
    const { scope, prefs, hidden, workspaces } = dir;
    const labelsOf = (x: Session) =>
      (x.agent.workspaceId && workspaces[x.agent.workspaceId]?.labels) || [];
    const pinned = (x: Session) =>
      !!(x.agent.workspaceId && workspaces[x.agent.workspaceId]?.pinnedAt);
    const chats = scope === "chats";
    const inScope = Object.values(sessions).filter((x) => {
      if (isChat(x, dir) !== chats) return false;
      if (!chats && scope !== "all" && projectIdOf(x, dir) !== scope) return false;
      return true;
    });
    const counts: Record<Bucket, number> = { needs: 0, failed: 0, review: 0, working: 0, idle: 0 };
    for (const x of inScope) counts[bucketOf(x.agent)] += 1;
    const visible = inScope.filter((x) => {
      if (!prefs.showHidden && hidden.includes(x.agent.id)) return false;
      if (prefs.label && !labelsOf(x).includes(prefs.label)) return false;
      if (!needle) return true;
      const hay = `${x.agent.title ?? ""} ${projectName(x)} ${branchOf(x) ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
    visible.sort(sorter(prefs.sort, pinned));
    const groups: Group[] = [];
    const push = (key: string, label: string, x: Session) => {
      let g = groups.find((y) => y.key === key);
      if (!g) {
        g = { key, label, list: [] };
        groups.push(g);
      }
      g.list.push(x);
    };
    if (chats) {
      // Already newest-first, so calendar groups come out in order.
      for (const x of visible) {
        const g = ageGroup(x.agent.updatedAt);
        push(g, g, x);
      }
    } else if (prefs.group === "project") {
      for (const x of visible) push(projectIdOf(x, dir) ?? projectName(x), projectName(x), x);
      groups.sort((a, b) => a.label.localeCompare(b.label));
    } else if (prefs.group === "labels") {
      for (const x of visible) {
        const ls = labelsOf(x);
        if (!ls.length) push("~none", "No label", x);
        for (const l of ls) push(`l:${l}`, l, x);
      }
      groups.sort((a, b) => a.label.localeCompare(b.label));
    } else {
      for (const o of ORDER) {
        const list = visible.filter((x) => bucketOf(x.agent) === o.b);
        if (list.length) groups.push({ key: o.b, label: o.label, list });
      }
    }
    return { groups, counts, total: inScope.length, scopeName: scopeName(dir) };
  }, [sessions, dir, needle]);
}

function scopeName(d: ReturnType<typeof useDirectory.getState>): string {
  if (d.scope === "all") return "All projects";
  if (d.scope === "chats") return "Chats";
  if (d.scope === "archived") return "History";
  return d.projects.find((p) => p.projectId === d.scope)?.projectDisplayName ?? "Project";
}

function ScopeIcon({ scope }: { scope: string }) {
  if (scope === "chats") return <MessageSquare size={14} color={color.cyan2} />;
  if (scope === "archived") return <History size={14} color={color.cyan2} />;
  if (scope === "all") return <Layers size={14} color={color.cyan2} />;
  return <FolderGit2 size={14} color={color.cyan2} />;
}

export function SessionList() {
  const [q, setQ] = useState("");
  const scope = useDirectory((d) => d.scope);
  const needle = q.trim().toLowerCase();
  const { groups, counts, total, scopeName: name } = useListModel(needle);
  const ids = useMemo(() => groups.flatMap((g) => g.list.map((x) => x.agent.id)), [groups]);
  const subRunning = useRunningSubWork(ids);
  const scopeA = useAnchor();
  const displayA = useAnchor();
  const [menu, setMenu] = useState<{ id: string; rect: Rect } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const openMenu = useCallback((id: string, rect: Rect) => setMenu({ id, rect }), []);
  const chats = scope === "chats";
  const history = scope === "archived";
  let body: ReactNode;
  if (history) body = <HistoryList />;
  else if (!total) body = <Empty name={name} chats={chats} all={scope === "all"} />;
  else
    body = (
      <>
        {!chats && <StatusSummary key={name} counts={counts} sub={subRunning} />}
        <Cut size={5} style={s.filter}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder={chats ? "Filter chats" : "Filter sessions"}
            placeholderTextColor={color.faint}
            style={s.filterIn}
          />
          <T v="mono" style={s.kbd}>
            /
          </T>
        </Cut>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollBody}>
          <BracketScope>
            {groups.map((g) => (
              <View key={g.key}>
                <View style={s.groupHead}>
                  <T v="label">{g.label}</T>
                  <T v="mono" style={s.groupN}>
                    {g.list.length}
                  </T>
                </View>
                {g.list.map((sess) => (
                  <Row key={sess.agent.id} sess={sess} chat={chats} onMenu={openMenu} />
                ))}
              </View>
            ))}
          </BracketScope>
          {!groups.length && <T style={s.none}>Nothing matches.</T>}
        </ScrollView>
      </>
    );
  return (
    <View style={s.root}>
      <View style={s.head}>
        <View ref={scopeA.ref} collapsable={false}>
          <Pressable
            style={s.scope}
            onPress={scopeA.open}
            accessibilityLabel="Switch scope"
            accessibilityRole="button"
          >
            <ScopeIcon scope={scope} />
            <T v="display" style={s.scopeT} numberOfLines={1}>
              {name}
            </T>
            <ChevronDown size={14} color={color.faint} />
          </Pressable>
        </View>
        <View style={s.spacer} />
        <View ref={displayA.ref} collapsable={false}>
          <Pressable onPress={displayA.open} accessibilityLabel="Display options" style={s.icon}>
            <Filter size={15} color={color.faint} />
          </Pressable>
        </View>
        <Pressable onPress={openNewSession} accessibilityLabel="New session" style={s.icon}>
          <Plus size={17} color={color.faint} />
        </Pressable>
      </View>
      {body}
      <ScopeMenu rect={scopeA.rect} onClose={scopeA.close} />
      <DisplayMenu rect={displayA.rect} onClose={displayA.close} />
      <SessionMenu rect={menu?.rect ?? null} agentId={menu?.id ?? null} onClose={closeMenu} />
      <SessionSheets />
    </View>
  );
}

function Empty({ name, chats, all }: { name: string; chats: boolean; all: boolean }) {
  let title = `No sessions in ${name} yet`;
  if (chats) title = "No chats yet";
  else if (all) title = "No sessions yet";
  return (
    <View style={s.empty}>
      <View style={s.emptyMark} />
      <T v="display" style={s.emptyT}>
        {title}
      </T>
      <T style={s.emptyB}>
        {chats
          ? "Ask a quick question without a project."
          : "Start one on a new worktree, or import an existing conversation."}
      </T>
      <Button kind="primary" label="New session" onPress={openNewSession} />
      {!chats && (
        <Pressable onPress={openImport}>
          <T style={s.emptyLink}>Import…</T>
        </Pressable>
      )}
    </View>
  );
}

function Row({
  sess,
  chat,
  onMenu,
}: {
  sess: Session;
  chat: boolean;
  onMenu: (id: string, r: Rect) => void;
}) {
  const a = sess.agent;
  const bucket = bucketOf(a);
  const selected = useUi((st) => st.selected === a.id);
  const prefs = useDirectory((d) => d.prefs);
  const ws = useDirectory((d) => (a.workspaceId ? d.workspaces[a.workspaceId] : undefined));
  const catalog = useDirectory((d) => d.labels);
  const hidden = useDirectory((d) => d.hidden.includes(a.id));
  const ref = useRef<View>(null);
  const sub = useRowSubWork(a.id, a.status === "running" || selected);
  const perm = a.pendingPermissions[0];
  const plan = perm?.kind === "plan";
  const branch = branchOf(sess);
  const open = useCallback(() => useUi.getState().select(a.id), [a.id]);
  const menuAt = useCallback((r: Rect) => onMenu(a.id, r), [a.id, onMenu]);
  useContextMenu(ref, menuAt);
  const longPress = useCallback(() => {
    ref.current?.measureInWindow((x, y, w, h) => menuAt({ x, y, w, h }));
  }, [menuAt]);
  // A plan needs reading, so its button opens the session; anything else approves in place.
  const act = useCallback(() => {
    if (!perm || perm.kind === "plan") useUi.getState().select(a.id);
    else void answerPermission(a.id, perm.id, true);
  }, [a.id, perm]);
  const title = prefs.title === "branch" && branch ? branch : a.title || "Untitled session";
  const labels = prefs.show.labels ? (ws?.labels ?? []) : [];
  return (
    <View ref={ref} collapsable={false}>
      <Pressable onPress={open} onLongPress={longPress} delayLongPress={350}>
        {({ hovered }) => (
          <View style={[s.row, hovered && s.rowHover, selected && s.rowOn, hidden && s.rowHidden]}>
            <Brackets on={selected} />
            <View style={s.rowTop}>
              <View style={s.glyph}>
                {chat ? (
                  <MessageSquare size={12} color={color.muted} />
                ) : (
                  <StatusGlyph bucket={bucket} />
                )}
              </View>
              <T numberOfLines={1} style={s.title}>
                {title}
              </T>
              {ws?.pinnedAt && <Pin size={11} color={color.faint} />}
              <SubWorkChip
                items={sub.items}
                variant={sub.variant}
                open={sub.open}
                onToggle={sub.toggle}
              />
              <T v="mono" style={s.time}>
                {ago(a.updatedAt)}
              </T>
            </View>
            <View style={s.meta}>
              {chat && (
                <T style={s.proj} numberOfLines={1}>
                  {a.model ?? a.provider} · read-only sandbox
                </T>
              )}
              {!chat && prefs.show.project && (
                <T style={s.proj} numberOfLines={1}>
                  {projectName(sess)}
                </T>
              )}
              {!chat && prefs.show.branch && branch && prefs.title !== "branch" && (
                <T v="mono" numberOfLines={1} style={s.branch}>
                  {branch}
                </T>
              )}
              {!chat && prefs.show.provider && (
                <T v="mono" numberOfLines={1} style={s.branch}>
                  {a.provider}
                </T>
              )}
              {labels.map((l) => (
                <LabelChip key={l} name={l} c={catalog.find((c) => c.name === l)?.color} />
              ))}
            </View>
            {bucket === "failed" && a.lastError && (
              <T v="mono" numberOfLines={2} style={s.error}>
                {a.lastError}
              </T>
            )}
            {perm && (
              <View style={s.permRow}>
                <View style={s.permCmd}>
                  <T v="mono" numberOfLines={1} style={plan ? s.permPlan : s.permText}>
                    {plan ? "Plan ready" : (perm.title ?? perm.name)}
                  </T>
                </View>
                <Pressable onPress={act}>
                  <Cut size={6} style={s.approve}>
                    <T style={s.approveT}>{plan ? "Review" : "Approve"}</T>
                    <T v="mono" style={s.approveK}>
                      A
                    </T>
                  </Cut>
                </Pressable>
              </View>
            )}
            <SubWorkBody
              items={sub.items}
              variant={sub.variant}
              open={sub.open}
              onOpen={sub.onOpen}
            />
          </View>
        )}
      </Pressable>
    </View>
  );
}

export { Brackets, BracketScope } from "./Brackets";

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg2 },
  head: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
  },
  scope: { flexDirection: "row", alignItems: "center", gap: 7, flexShrink: 1 },
  scopeT: { fontSize: 15, flexShrink: 1 },
  spacer: { flex: 1 },
  icon: { marginLeft: 14, padding: 2 },
  none: { color: color.faint, fontSize: 12.5, textAlign: "center", marginTop: 24 },
  empty: { alignItems: "center", paddingHorizontal: 28, paddingTop: 48, gap: 10 },
  emptyMark: {
    width: 34,
    height: 34,
    backgroundColor: color.line2,
    transform: [{ rotate: "45deg" }],
    marginBottom: 8,
  },
  emptyT: { fontSize: 14.5, textAlign: "center" },
  emptyB: { fontSize: 12.5, color: color.muted, textAlign: "center", lineHeight: 19 },
  emptyLink: { fontSize: 12.5, color: color.text, marginTop: 4 },
  rowHidden: { opacity: 0.5 },
  filter: {
    flexDirection: "row",
    alignItems: "center",
    marginHorizontal: 12,
    marginBottom: 6,
    backgroundColor: color.panel,
    borderWidth: 1,
    borderColor: color.line,
  },
  filterIn: {
    flex: 1,
    paddingHorizontal: 10,
    paddingVertical: 7,
    color: color.text,
    fontFamily: font.body,
    fontSize: 13,
    ...web({ outlineStyle: "none" }),
  },
  kbd: {
    borderWidth: 1,
    borderColor: color.line2,
    paddingHorizontal: 5,
    marginRight: 8,
    fontSize: 10,
  },
  scroll: { flex: 1 },
  scrollBody: { paddingBottom: 16 },
  groupHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  groupN: { color: color.faint, fontSize: 10.5 },
  row: {
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 9,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  rowHover: { backgroundColor: color.wash },
  rowOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: 4 },
  glyph: { width: 14, paddingTop: 5 },
  title: { flex: 1, fontSize: 13.5, fontWeight: "500" },
  time: { fontSize: 10.5, color: color.faint },
  meta: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
    marginLeft: 18,
  },
  proj: { fontSize: 12, color: color.muted },
  branch: { fontSize: 11, color: color.faint, flexShrink: 1 },
  error: { color: color.coral, marginTop: 6, marginLeft: 14 },
  permRow: { flexDirection: "row", gap: 8, marginTop: 8, marginLeft: 18 },
  permCmd: {
    flex: 1,
    backgroundColor: "rgba(245,184,74,0.07)",
    paddingHorizontal: 8,
    justifyContent: "center",
  },
  permText: { color: color.text },
  permPlan: { color: color.amber },
  approve: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 5,
    backgroundColor: color.cyan2,
    ...web({ backgroundImage: "linear-gradient(135deg, #7fd9e6, #25b5c8)" }),
  },
  approveT: { fontWeight: "600", color: color.onAccent, fontSize: 12.5 },
  approveK: {
    fontSize: 9.5,
    color: color.onAccent,
    borderWidth: 1,
    borderColor: "rgba(4,22,26,0.35)",
    paddingHorizontal: 3,
  },
});
