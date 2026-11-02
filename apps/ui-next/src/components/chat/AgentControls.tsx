import { useCallback, useEffect, useMemo } from "react";
import { loadConfig, useConfig } from "../../daemon/config";
import { setAgentMode, setAgentModel, setAgentThinking } from "../../daemon/store";
import type { Agent } from "../../daemon/types";
import { Select } from "../Select";
import { toast, toastError } from "../toast/store";

/** Model, thinking and mode pickers for a live session, fed by the host's provider snapshot. */
export function AgentControls({ agent }: { agent: Agent }) {
  const providers = useConfig((st) => st.providers);
  useEffect(() => {
    if (!providers) void loadConfig();
  }, [providers]);
  const model = agent.runtimeInfo?.model ?? agent.model;
  const defs = useMemo(
    () => providers?.entries.find((p) => p.provider === agent.provider)?.models ?? [],
    [providers, agent.provider],
  );
  const models = useMemo(
    () => defs.map((m) => ({ value: m.id, label: m.label, hint: m.description })),
    [defs],
  );
  // Thinking levels belong to the model; the provider's default model when none is set.
  const def =
    defs.find((m) => m.id === model || m.aliases?.includes(model ?? "")) ??
    (model ? undefined : defs.find((m) => m.isDefault));
  const thinkingOptions = def?.thinkingOptions;
  const thinking = useMemo(
    () =>
      (thinkingOptions ?? []).map((o) => ({ value: o.id, label: o.label, hint: o.description })),
    [thinkingOptions],
  );
  const thinkingId =
    agent.thinkingOptionId ??
    agent.effectiveThinkingOptionId ??
    def?.defaultThinkingOptionId ??
    thinkingOptions?.find((o) => o.isDefault)?.id ??
    null;
  const modes = useMemo(
    () =>
      agent.availableModes.map((m) => ({
        value: m.id,
        label: m.label,
        hint: m.description,
      })),
    [agent.availableModes],
  );
  const pickModel = useCallback(
    (v: string) =>
      void setAgentModel(agent.id, v).catch((e) => toastError("Could not change model", e)),
    [agent.id],
  );
  const pickThinking = useCallback(
    (v: string) =>
      void setAgentThinking(agent.id, v).then(
        (notice) => notice && toast({ title: "Thinking level", detail: notice }),
        (e) => toastError("Could not change thinking level", e),
      ),
    [agent.id],
  );
  const pickMode = useCallback(
    (v: string) =>
      void setAgentMode(agent.id, v).catch((e) => toastError("Could not change mode", e)),
    [agent.id],
  );
  return (
    <>
      <Select
        label="Model"
        chip
        mono
        up
        width="auto"
        menuWidth={240}
        value={model ?? null}
        placeholder={model ?? "default model"}
        options={models}
        onChange={pickModel}
      />
      {thinking.length > 0 && (
        <Select
          label="Thinking"
          chip
          up
          width="auto"
          menuWidth={240}
          value={thinkingId}
          options={thinking}
          onChange={pickThinking}
        />
      )}
      {modes.length > 0 && (
        <Select
          label="Mode"
          chip
          up
          width="auto"
          menuWidth={240}
          value={agent.currentModeId}
          options={modes}
          onChange={pickMode}
        />
      )}
    </>
  );
}
