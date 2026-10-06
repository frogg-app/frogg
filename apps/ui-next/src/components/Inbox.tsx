import { CheckCheck, ExternalLink } from "lucide-react-native";
import { useCallback, useEffect } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import { getClient, openTimeline, useDaemon } from "../daemon/store";
import { bucketOf, type Bucket, type Session } from "../daemon/types";
import { color } from "../theme/tokens";
import { useUi } from "../ui-store";
import { ago, providerLabel } from "../util";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { Markdown } from "./Markdown";
import { GroupHead, PanelHead } from "./PanelHead";
import { PermissionCard } from "./PermissionCard";
import { Brackets, useBuckets } from "./SessionList";
import { StatusGlyph } from "./StatusGlyph";
import { T } from "./Text";

const GROUPS: Array<{ b: Bucket; label: string }> = [
  { b: "needs", label: "Needs you" },
  { b: "failed", label: "Failures" },
  { b: "review", label: "Finished" },
];

function summary(s: Session): string {
  const a = s.agent;
  const p = a.pendingPermissions[0];
  if (p)
    return p.kind === "plan"
      ? "Plan ready for review"
      : `${providerLabel(a.provider)} wants to run ${p.title ?? p.name}`;
  if (a.lastError) return a.lastError;
  return "Finished · ready to review";
}

export function InboxPanel() {
  const b = useBuckets();
  const { inboxId, openInbox } = useUi();
  const total = GROUPS.reduce((n, g) => n + b[g.b].length, 0);
  const clearAll = useCallback(() => {
    const ids = GROUPS.flatMap((g) => b[g.b]).map((s) => s.agent.id);
    if (ids.length) void getClient()?.clearAgentAttention(ids);
  }, [b]);
  return (
    <View style={st.fill}>
      <PanelHead title="Inbox">
        <Pressable onPress={clearAll} accessibilityLabel="Mark all read">
          <CheckCheck size={15} color={color.faint} />
        </Pressable>
      </PanelHead>
      <ScrollView style={st.flex}>
        {total === 0 && (
          <T v="label" style={st.empty}>
            nothing needs you
          </T>
        )}
        {GROUPS.map((g) =>
          b[g.b].length ? (
            <View key={g.b}>
              <GroupHead label={g.label} count={b[g.b].length} />
              {b[g.b].map((s) => (
                <InboxRow
                  key={s.agent.id}
                  s={s}
                  bucket={g.b}
                  on={s.agent.id === inboxId}
                  onOpen={openInbox}
                />
              ))}
            </View>
          ) : null,
        )}
      </ScrollView>
      <T v="mono" style={st.foot}>
        OS notifications and toasts mirror this list
      </T>
    </View>
  );
}

function InboxRow({
  s,
  bucket,
  on,
  onOpen,
}: {
  s: Session;
  bucket: Bucket;
  on: boolean;
  onOpen: (id: string) => void;
}) {
  const press = useCallback(() => onOpen(s.agent.id), [onOpen, s.agent.id]);
  return (
    <Pressable onPress={press}>
      {({ hovered }) => (
        <View style={[st.row, hovered && st.rowHover, on && st.rowOn]}>
          {on && <Brackets />}
          <View style={st.line}>
            <StatusGlyph bucket={bucket} />
            <T numberOfLines={1} style={st.title}>
              {s.agent.title || "Untitled session"}
            </T>
            <T v="mono" style={st.when}>
              {ago(s.agent.attentionTimestamp ?? s.agent.updatedAt)}
            </T>
            {s.agent.requiresAttention && <View style={st.unread} />}
          </View>
          <T v="mono" numberOfLines={1} style={st.summary}>
            {summary(s)}
          </T>
        </View>
      )}
    </Pressable>
  );
}

export function InboxDetail({ id, onBack }: { id: string; onBack?: () => void }) {
  const s = useDaemon((st) => st.sessions[id]);
  const entries = useDaemon((st) => st.timelines[id]);
  const { setTool, select } = useUi();
  useEffect(() => {
    void openTimeline(id);
  }, [id]);
  const open = useCallback(() => {
    setTool("sessions");
    select(id);
  }, [id, setTool, select]);
  if (!s) return <View style={st.fill} />;
  const a = s.agent;
  const bucket = bucketOf(a);
  const lastReply = entries
    ? entries.toReversed().find((e) => e.item.type === "assistant_message")
    : undefined;
  const branch = s.project?.checkout.isGit ? s.project.checkout.currentBranch : null;
  return (
    <View style={st.fill}>
      <View style={st.head}>
        <View style={st.headMain}>
          <T v="label">
            notification · {ago(a.attentionTimestamp ?? a.updatedAt)} ago · from{" "}
            {providerLabel(a.provider)}
          </T>
          <View style={st.titleRow}>
            {onBack && (
              <Pressable onPress={onBack}>
                <T style={st.back}>←</T>
              </Pressable>
            )}
            <T v="display" style={st.display} numberOfLines={1}>
              {a.title || "Untitled session"}
            </T>
          </View>
          <View style={st.meta}>
            <StatusGlyph bucket={bucket} size={7} />
            <T style={st.metaText}>
              {[s.project?.projectName, branch].filter(Boolean).join(" / ")}
            </T>
          </View>
        </View>
        <Button label="Open session" icon={ExternalLink} onPress={open} />
      </View>
      <ScrollView contentContainerStyle={st.body}>
        {a.pendingPermissions.map((p) => (
          <PermissionCard key={p.id} agentId={a.id} p={p} />
        ))}
        {a.lastError && (
          <Cut size={10} flip style={st.boxFail}>
            <T style={st.failHead}>Failed</T>
            <T v="mono" style={st.failText}>
              {a.lastError}
            </T>
            <View style={st.actions}>
              <Button kind="primary" label="Open and retry" onPress={open} />
            </View>
          </Cut>
        )}
        <Cut size={10} style={st.box}>
          <T style={st.ctxHead}>Context</T>
          {lastReply && lastReply.item.type === "assistant_message" ? (
            <View style={st.ctx}>
              <Markdown text={lastReply.item.text.slice(-900)} />
            </View>
          ) : (
            <T style={st.faint}>{entries ? "No reply yet." : "Loading…"}</T>
          )}
        </Cut>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  fill: { flex: 1, backgroundColor: color.bg2 },
  flex: { flex: 1 },
  empty: { padding: 16 },
  rowHover: { backgroundColor: color.wash },
  rowOn: { backgroundColor: "rgba(127,217,230,0.05)" },
  line: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, fontWeight: "600" },
  when: { fontSize: 10.5, color: color.faint },
  summary: { marginTop: 4, marginLeft: 17, fontSize: 11 },
  headMain: { flex: 1, minWidth: 220 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginTop: 4,
  },
  back: { color: color.cyan2 },
  display: { fontSize: 20 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  metaText: { fontSize: 12, color: color.muted },
  body: { padding: 24, gap: 14, maxWidth: 860 },
  failHead: { color: color.coral, fontWeight: "600", fontSize: 12.5 },
  failText: { color: color.text, marginTop: 8, fontSize: 12.5 },
  actions: { flexDirection: "row", gap: 8, marginTop: 12 },
  ctxHead: { fontWeight: "600", marginBottom: 10 },
  ctx: { maxHeight: 260, overflow: "hidden" },
  faint: { color: color.faint },
  row: {
    marginHorizontal: 8,
    paddingHorizontal: 8,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  unread: { width: 6, height: 6, backgroundColor: color.cyan2 },
  foot: {
    padding: 12,
    fontSize: 10.5,
    color: color.faint,
    borderTopWidth: 1,
    borderTopColor: color.line,
  },
  head: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "flex-end",
    gap: 12,
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: color.line,
  },
  box: {
    backgroundColor: color.panel,
    padding: 16,
    borderWidth: 1,
    borderColor: color.line,
  },
  boxFail: {
    backgroundColor: color.panel,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(255,107,107,0.4)",
  },
});
