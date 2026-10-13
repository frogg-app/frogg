import { useCallback } from "react";
import { Pressable, StyleSheet } from "react-native";
import { useNow, useSubWorkStore } from "../../daemon/subwork";
import { color } from "../../theme/tokens";
import { useUi } from "../../ui-store";
import { T } from "../Text";
import { elapsed } from "./model";

/** The live subagent row a Task/Agent tool call spawned, matched on its tool call id. */
function useSpawned(callId: string) {
  return useSubWorkStore((s) => {
    const sel = useUi.getState().selected;
    return sel ? s.subagents[sel]?.find((x) => x.toolCallId === callId) : undefined;
  });
}

/** Ticking run time in a subagent tool call's header while its subagent runs. */
export function SpawnedElapsed({ callId }: { callId: string }) {
  const sub = useSpawned(callId);
  const running = sub?.status === "running";
  const now = useNow(running);
  if (!sub || !running) return null;
  return (
    <T v="mono" style={s.live}>
      {elapsed(Date.parse(sub.createdAt), now)}
    </T>
  );
}

/** Body link from a subagent tool call to its row in the Tasks panel. */
export function SpawnedLink({ callId }: { callId: string }) {
  const sub = useSpawned(callId);
  const open = useCallback(() => useUi.getState().setTool("tasks"), []);
  if (!sub) return null;
  return (
    <Pressable onPress={open} style={s.link} accessibilityRole="link">
      <T style={s.linkT}>{`Open in Tasks · ${sub.status}`}</T>
    </Pressable>
  );
}

const s = StyleSheet.create({
  live: { fontSize: 10.5, color: color.cyan2, fontVariant: ["tabular-nums"] },
  link: { paddingHorizontal: 12, paddingVertical: 6 },
  linkT: { fontSize: 12, color: color.cyan2 },
});
