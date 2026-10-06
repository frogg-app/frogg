import { Lock } from "lucide-react-native";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { answerPermission } from "../daemon/store";
import type { Agent } from "../daemon/types";
import { color } from "../theme/tokens";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { T } from "./Text";

type Permission = Agent["pendingPermissions"][number];
type Action = NonNullable<Permission["actions"]>[number];

/** Command text for the headline: a shell command when the request carries one. */
function commandOf(p: Permission): string | null {
  const input = p.input as Record<string, unknown> | undefined;
  const cmd = input?.command ?? input?.cmd;
  if (typeof cmd === "string") return cmd;
  return Array.isArray(cmd) ? cmd.join(" ") : null;
}

export function PermissionCard({ agentId, p }: { agentId: string; p: Permission }) {
  const cmd = commandOf(p);
  const plan = p.kind === "plan";
  const deny = useCallback(() => void answerPermission(agentId, p.id, false), [agentId, p.id]);
  const allow = useCallback(() => void answerPermission(agentId, p.id, true), [agentId, p.id]);
  const extra = (p.actions ?? []).filter((a) => a.behavior === "allow" && a.id !== "implement");
  return (
    <Cut size={10} flip style={s.card}>
      <View style={s.head}>
        <Lock size={13} color={color.amber} />
        <T style={s.kind}>{plan ? "Plan ready for review" : "Permission needed"}</T>
        <T v="mono" style={s.name}>
          {p.name}
        </T>
      </View>
      {cmd ? (
        <T style={s.title}>
          Run{" "}
          <T v="mono" style={s.cmd}>
            {cmd}
          </T>
        </T>
      ) : (
        <T style={s.title}>{p.title ?? p.name}</T>
      )}
      {p.description && <T style={s.desc}>{p.description}</T>}
      <View style={s.actions}>
        <Button label="Deny" kbd="Esc" onPress={deny} />
        {extra.map((a) => (
          <ActionButton key={a.id} agentId={agentId} requestId={p.id} action={a} />
        ))}
        <Button kind="primary" label={plan ? "Approve plan" : "Approve"} kbd="A" onPress={allow} />
      </View>
    </Cut>
  );
}

function ActionButton({
  agentId,
  requestId,
  action,
}: {
  agentId: string;
  requestId: string;
  action: Action;
}) {
  const onPress = useCallback(
    () => void answerPermission(agentId, requestId, true, action.id),
    [agentId, requestId, action.id],
  );
  return <Button label={action.label} onPress={onPress} />;
}

const s = StyleSheet.create({
  card: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "rgba(245,184,74,0.45)",
    backgroundColor: "rgba(245,184,74,0.05)",
    padding: 14,
  },
  head: { flexDirection: "row", alignItems: "center", gap: 8 },
  kind: { color: color.amber, fontWeight: "600", fontSize: 12.5 },
  name: { marginLeft: "auto" },
  title: { fontSize: 15, marginTop: 10 },
  cmd: { fontSize: 14, color: color.cyan2 },
  desc: { color: color.muted, marginTop: 6, lineHeight: 20 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 },
});
