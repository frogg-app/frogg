import { ChevronDown } from "lucide-react-native";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { loadConfig, useConfig } from "../../daemon/config";
import { useDaemon } from "../../daemon/store";
import type { Agent } from "../../daemon/types";
import { color } from "../../theme/tokens";
import { providerLabel } from "../../util";
import { Button } from "../Button";
import { Select } from "../Select";
import { T } from "../Text";
import { Dialog } from "../tools/Dialog";
import { Menu, useAnchor, type MenuEntry } from "../tools/Menu";
import { cleanCutToProvider, hasFeature } from "./actions";
import { endsAtCleanCut, switchTargets, type SwitchTarget } from "./cleanCut";
import { runSessionOp, useSessionOp } from "./sessionOps";

const CUT_HINT =
  "A provider can't read another provider's history, so a cheap model summarises this conversation and a fresh one starts there. Workspace changes are kept; the old conversation stays visible to you.";
const REUSE_HINT =
  "Already a clean cut: nothing new has been said since the last summary, so it carries over as is. No re-summary, no extra cost.";

/**
 * The composer's provider chip. Picking another provider opens a confirm with that provider's
 * models; confirming makes a clean cut onto it. Straight after a cut the summary carries over.
 */
export function ProviderChip({ agent, compact }: { agent: Agent; compact?: boolean }) {
  const providers = useConfig((st) => st.providers);
  const reuses = useDaemon((st) => endsAtCleanCut(st.timelines[agent.id]));
  const op = useSessionOp(agent.id);
  const anchor = useAnchor();
  const [target, setTarget] = useState<SwitchTarget | null>(null);
  useEffect(() => {
    if (!providers) void loadConfig();
  }, [providers]);
  const targets = useMemo(
    () => switchTargets(providers?.entries, agent.provider),
    [providers, agent.provider],
  );
  const current =
    providers?.entries.find((e) => e.provider === agent.provider)?.label ??
    providerLabel(agent.provider);
  const items = useMemo<MenuEntry[]>(() => {
    const canCut = agent.status !== "running";
    let hint = reuses
      ? "Summary carries over: no new cost"
      : "Clean cut: summarise, then continue there";
    if (op) hint = `${op.label}…`;
    if (!canCut) hint = "Wait for the turn to finish";
    return [
      { head: "Provider" },
      { label: current, on: true, disabled: true },
      "-",
      ...targets.map((t) => ({
        label: `Switch to ${t.label}…`,
        hint,
        disabled: !canCut || !!op,
        onPress: () => setTarget(t),
      })),
    ];
  }, [targets, current, reuses, op, agent.status]);
  const close = useCallback(() => setTarget(null), []);
  // Compact (phone) composers never drew the plain provider chip; only add it when it does something.
  if (!targets.length || !hasFeature("agentCleanCut"))
    return compact ? null : <StaticChip label={current} />;
  return (
    <>
      <View ref={anchor.ref} collapsable={false}>
        <Pressable onPress={anchor.open} accessibilityLabel="Provider">
          {({ hovered }) => (
            <View style={[s.chip, hovered && s.hover]}>
              <View style={s.dot} />
              <T v="mono" style={s.t} numberOfLines={1}>
                {current}
              </T>
              <ChevronDown size={11} color={color.faint} />
            </View>
          )}
        </Pressable>
      </View>
      <Menu rect={anchor.rect} onClose={anchor.close} items={items} width={300} />
      <SwitchDialog
        agentId={agent.id}
        from={current}
        target={target}
        reuses={reuses}
        onClose={close}
      />
    </>
  );
}

/** The chip as the composer drew it before: shown when there is nowhere to switch to. */
function StaticChip({ label }: { label: string }) {
  return (
    <View style={s.chip}>
      <View style={s.dot} />
      <T v="mono" style={s.t} numberOfLines={1}>
        {label}
      </T>
    </View>
  );
}

function SwitchDialog({
  agentId,
  from,
  target,
  reuses,
  onClose,
}: {
  agentId: string;
  from: string;
  target: SwitchTarget | null;
  reuses: boolean;
  onClose: () => void;
}) {
  const [model, setModel] = useState<string | null>(null);
  // A fresh pick starts on the provider's default model.
  useEffect(() => setModel(target?.defaultModel ?? null), [target]);
  const confirm = useCallback(() => {
    if (!target) return;
    const to = target.label;
    const started = runSessionOp(
      agentId,
      reuses
        ? {
            label: `Moving the conversation to ${to}`,
            done: `Moved to ${to}`,
            doneDetail: "The last summary carried over: no new cost",
            failed: "Could not switch provider",
          }
        : {
            label: `Clean cut to ${to}: summarising`,
            done: `Clean cut to ${to} done`,
            doneDetail: "The next message starts from the summary",
            failed: "Clean cut failed",
          },
      () => cleanCutToProvider(agentId, target.provider, model),
    );
    if (started) onClose();
  }, [agentId, target, model, reuses, onClose]);
  const modelLabel = target?.models.find((m) => m.value === model)?.label ?? model;
  const footer = (
    <>
      <Button label="Cancel" onPress={onClose} />
      <Button
        label={reuses ? "Switch" : "Clean cut and switch"}
        kind="primary"
        onPress={confirm}
        disabled={!model}
      />
    </>
  );
  return (
    <Dialog
      open={!!target}
      onClose={onClose}
      eyebrow="Clean cut"
      title={`Switch to ${target?.label ?? ""}`}
      footer={footer}
    >
      <T>
        Move this conversation from {from} to {target?.label}
        {modelLabel ? ` (${modelLabel})` : ""} with a clean cut?
      </T>
      <T style={reuses ? s.reuse : s.hint}>{reuses ? REUSE_HINT : CUT_HINT}</T>
      <View style={s.field}>
        <T v="label">Model</T>
        <Select
          label="Model"
          mono
          width="100%"
          value={model}
          options={target?.models ?? []}
          onChange={setModel}
        />
      </View>
    </Dialog>
  );
}

const s = StyleSheet.create({
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: color.wash,
    paddingHorizontal: 8,
    paddingVertical: 4,
    maxWidth: 180,
  },
  hover: { backgroundColor: color.line },
  dot: { width: 6, height: 6, backgroundColor: color.cyan2, transform: [{ rotate: "45deg" }] },
  t: { color: color.text, flexShrink: 1 },
  hint: { color: color.muted, fontSize: 12.5, marginTop: 10 },
  reuse: { color: color.cyan2, fontSize: 12.5, marginTop: 10 },
  field: { gap: 6, marginTop: 14 },
});
