import { ListChecks, Lock } from "lucide-react-native";
import { useCallback, useState } from "react";
import { StyleSheet, View } from "react-native";
import { answerPermission, useDaemon } from "../daemon/store";
import type { Agent } from "../daemon/types";
import { color } from "../theme/tokens";
import { providerLabel } from "../util";
import { Button } from "./Button";
import { denyWithMessage } from "./chat/actions";
import { parseQuestions, QuestionCard } from "./chat/QuestionCard";
import { Markdown } from "./Markdown";
import { ShapeCard, ShapeInput } from "./Shape";
import { T } from "./Text";
import { toast, toastError } from "./toast/store";

type Permission = Agent["pendingPermissions"][number];
type Action = NonNullable<Permission["actions"]>[number];

/** Command text for the headline: a shell command when the request carries one. */
function commandOf(p: Permission): string | null {
  const input = p.input as Record<string, unknown> | undefined;
  const cmd = input?.command ?? input?.cmd;
  if (typeof cmd === "string") return cmd;
  return Array.isArray(cmd) ? cmd.join(" ") : null;
}

function planOf(p: Permission): string | null {
  const plan = (p.input as Record<string, unknown> | undefined)?.plan;
  return typeof plan === "string" ? plan : null;
}

/** Inline approval in the timeline: a question, a plan to review, or a tool/command to allow. */
export function PermissionCard({
  agent: given,
  agentId,
  p,
}: {
  agent?: Agent;
  /** Older call sites pass only the id; the agent is looked up. */
  agentId?: string;
  p: Permission;
}) {
  const looked = useDaemon((st) => (agentId ? st.sessions[agentId]?.agent : undefined));
  const agent = given ?? looked;
  if (!agent) return null;
  if (p.kind === "question" && parseQuestions(p.input)) return <QuestionCard agent={agent} p={p} />;
  return <ApprovalCard agent={agent} p={p} />;
}

function ApprovalCard({ agent, p }: { agent: Agent; p: Permission }) {
  const agentId = agent.id;
  const cmd = commandOf(p);
  const plan = p.kind === "plan";
  const planText = plan ? planOf(p) : null;
  const [replying, setReplying] = useState(false);
  const [reply, setReply] = useState("");
  const [busy, setBusy] = useState(false);
  const mode = agent.availableModes.find((m) => m.id === agent.currentModeId)?.label;
  const run = useCallback(
    (fn: () => Promise<void>, done: string) => {
      setBusy(true);
      fn().then(
        () => toast({ title: done, detail: cmd ?? p.title ?? p.name }),
        (e) => {
          setBusy(false);
          toastError("Could not answer", e);
        },
      );
    },
    [cmd, p.title, p.name],
  );
  const deny = useCallback(
    () => run(() => answerPermission(agentId, p.id, false), plan ? "Plan rejected" : "Denied"),
    [run, agentId, p.id, plan],
  );
  const allow = useCallback(
    () =>
      run(
        () => answerPermission(agentId, p.id, true, plan ? "implement" : undefined),
        plan ? "Implementing plan" : "Approved",
      ),
    [run, agentId, p.id, plan],
  );
  const openReply = useCallback(() => setReplying(true), []);
  const sendReply = useCallback(() => {
    const t = reply.trim();
    if (t) run(() => denyWithMessage(agentId, p.id, t), "Reply sent");
  }, [reply, run, agentId, p.id]);
  const extra = (p.actions ?? []).filter(
    (a) => a.behavior === "allow" && a.id !== "implement" && a.id !== "accept",
  );
  const Icon = plan ? ListChecks : Lock;
  const meta = [plan ? "Plan mode" : p.name, plan ? providerLabel(agent.provider) : mode]
    .filter(Boolean)
    .join(" · ");
  return (
    <ShapeCard
      tint={color.amber}
      icon={Icon}
      tag={plan ? "PLAN" : "PERMISSION"}
      meta={meta}
      title={plan ? "Plan ready for review" : "Permission needed"}
    >
      {planText && (
        <View style={s.plan}>
          <Markdown text={planText} />
        </View>
      )}
      {!planText && cmd && (
        <T style={s.title}>
          Run{" "}
          <T v="mono" style={s.cmd}>
            {cmd}
          </T>
        </T>
      )}
      {!planText && !cmd && <T style={s.title}>{p.title ?? p.name}</T>}
      {p.description && <T style={s.desc}>{p.description}</T>}
      {replying && (
        <ShapeInput
          value={reply}
          onChangeText={setReply}
          placeholder="Tell the agent what to do instead"
          autoFocus
          onSubmitEditing={sendReply}
        />
      )}
      <View style={s.actions}>
        <Button kind="danger" label={plan ? "Reject" : "Deny"} onPress={deny} disabled={busy} />
        {extra.map((a) => (
          <ActionButton key={a.id} agentId={agentId} requestId={p.id} action={a} busy={busy} />
        ))}
        {replying ? (
          <Button label="Send reply" onPress={sendReply} disabled={busy || !reply.trim()} />
        ) : (
          <Button
            label={plan ? "Edit plan…" : "Reply instead…"}
            onPress={openReply}
            disabled={busy}
          />
        )}
        <Button
          kind="primary"
          label={plan ? "Implement" : "Approve"}
          onPress={allow}
          disabled={busy}
        />
      </View>
    </ShapeCard>
  );
}

function ActionButton({
  agentId,
  requestId,
  action,
  busy,
}: {
  agentId: string;
  requestId: string;
  action: Action;
  busy: boolean;
}) {
  const onPress = useCallback(
    () =>
      void answerPermission(agentId, requestId, true, action.id).catch((e) =>
        toastError("Could not answer", e),
      ),
    [agentId, requestId, action.id],
  );
  return <Button label={action.label} onPress={onPress} disabled={busy} />;
}

const s = StyleSheet.create({
  title: { fontSize: 15, marginTop: 10 },
  cmd: { fontSize: 14, color: color.cyan2 },
  plan: { marginTop: 6 },
  desc: { color: color.muted, marginTop: 8, lineHeight: 20, fontSize: 12.5 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
});
