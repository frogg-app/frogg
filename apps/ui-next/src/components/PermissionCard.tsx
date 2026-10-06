import { Lock } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { answerPermission } from "../daemon/store";
import type { Agent } from "../daemon/types";
import { color } from "../theme/tokens";
import { Button } from "./Button";
import { Cut } from "./Cut";
import { T } from "./Text";

type Permission = Agent["pendingPermissions"][number];

/** Command text for the headline: a shell command when the request carries one. */
function commandOf(p: Permission): string | null {
  const input = p.input as Record<string, unknown> | undefined;
  const cmd = input?.command ?? input?.cmd;
  return typeof cmd === "string" ? cmd : Array.isArray(cmd) ? cmd.join(" ") : null;
}

export function PermissionCard({ agentId, p }: { agentId: string; p: Permission }) {
  const cmd = commandOf(p);
  const plan = p.kind === "plan";
  return (
    <Cut size={10} flip style={s.card}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Lock size={13} color={color.amber} />
        <T style={{ color: color.amber, fontWeight: "600", fontSize: 12.5 }}>{plan ? "Plan ready for review" : "Permission needed"}</T>
        <T v="mono" style={{ marginLeft: "auto" }}>{p.name}</T>
      </View>
      {cmd ? (
        <T style={{ fontSize: 15, marginTop: 10 }}>
          Run <T v="mono" style={{ fontSize: 14, color: color.cyan2 }}>{cmd}</T>
        </T>
      ) : (
        <T style={{ fontSize: 15, marginTop: 10 }}>{p.title ?? p.name}</T>
      )}
      {p.description && <T style={{ color: color.muted, marginTop: 6, lineHeight: 20 }}>{p.description}</T>}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
        <Button label="Deny" kbd="Esc" onPress={() => void answerPermission(agentId, p.id, false)} />
        {(p.actions ?? []).filter((a) => a.behavior === "allow" && a.id !== "implement").map((a) => (
          <Button key={a.id} label={a.label} onPress={() => void answerPermission(agentId, p.id, true, a.id)} />
        ))}
        <Button kind="primary" label={plan ? "Approve plan" : "Approve"} kbd="A" onPress={() => void answerPermission(agentId, p.id, true)} />
      </View>
    </Cut>
  );
}

const s = StyleSheet.create({
  card: { marginTop: 16, borderWidth: 1, borderColor: "rgba(245,184,74,0.45)", backgroundColor: "rgba(245,184,74,0.05)", padding: 14 },
});
