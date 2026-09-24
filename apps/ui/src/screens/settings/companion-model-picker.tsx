import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useSettings } from "@/hooks/use-settings";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { Choice } from "./companion-behavior-settings";

type Backend = "cli" | "codex" | "api" | null;

/** The Claude backends (subscription CLI and API) share Claude's models. */
function providerForBackend(backend: Backend): string | null {
  if (backend === "cli" || backend === "api") return "claude";
  if (backend === "codex") return "codex";
  return null;
}

// Sentinel for "no override": the daemon's own default for the backend.
const DEFAULT_VALUE = "";

/**
 * The model this host's Companion talks with, stored as the host's
 * `features.companion.model`. Hidden for daemons that do not report
 * `companionModel` in their config (older than the picker).
 */
export function CompanionModelPicker({
  serverId,
  details,
}: {
  serverId: string | null;
  /** The host's reported Companion backend and the model it resolves to now. */
  details: { backend: Backend; model: string | null } | null | undefined;
}) {
  const backend = details?.backend ?? null;
  const hostModel = details?.model ?? null;
  const { t } = useTranslation();
  const visible = useSettings((s) => s.companionEnabled && !s.companionNativeVoice);
  const { config, patchConfig } = useDaemonConfig(visible ? serverId : null);
  const provider = providerForBackend(backend);
  const { entries } = useProvidersSnapshot(serverId, { enabled: visible && provider !== null });
  const [error, setError] = useState<string | null>(null);

  const models = useMemo(() => {
    const entry = entries?.find((candidate) => candidate.provider === provider);
    return filterSelectableModels(entry?.models ?? null) ?? [];
  }, [entries, provider]);

  const current = config?.companionModel ?? null;
  const options = useMemo(() => {
    const list = models.map((model) => ({ value: model.id, label: model.label }));
    // Keep a hand-configured model selectable even when the catalog lacks it.
    if (current && !list.some((option) => option.value === current)) {
      list.unshift({ value: current, label: current });
    }
    return [
      {
        value: DEFAULT_VALUE,
        // With no override the host's reported model is the default it uses.
        label:
          current === null && hostModel
            ? t("companion.settings.model.defaultOption", { model: hostModel })
            : t("companion.settings.model.defaultOption", { model: "…" }),
      },
      ...list,
    ];
  }, [current, hostModel, models, t]);

  const change = useCallback(
    (value: string) => {
      setError(null);
      void patchConfig({ companionModel: value === DEFAULT_VALUE ? null : value }).catch(() => {
        setError(t("companion.settings.model.saveFailed"));
      });
    },
    [patchConfig, t],
  );

  // COMPAT(companionModel): older daemons do not report the field.
  if (!visible || !config || config.companionModel === undefined || provider === null) return null;
  return (
    <Choice<string>
      label={t("companion.settings.model.label")}
      hint={error ?? t("companion.settings.model.hint")}
      hintIsError={error !== null}
      value={current ?? DEFAULT_VALUE}
      options={options}
      onChange={change}
    />
  );
}
