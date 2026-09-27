import { useCallback, useMemo, type ReactElement } from "react";
import { useTranslation } from "react-i18next";
import {
  SelectField,
  type SelectFieldDisplay,
  type SelectFieldOption,
} from "@/components/ui/select-field";
import { useHosts } from "@/runtime/host-runtime";
import { usePluginHostIds } from "./hosts";
import { isClientPluginRuntimeSupported } from "./client-runtime/storage";
import { usePluginsModalStore, type PluginsTarget } from "./modal-store";

const CLIENT_VALUE = "__client__";

/** This client, then every connected host that supports plugins. */
export function TargetSelect({ target }: { target: PluginsTarget }): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const hostIds = usePluginHostIds();
  const setTarget = usePluginsModalStore((state) => state.setTarget);

  const options = useMemo<SelectFieldOption<string>[]>(() => {
    const hostOptions = hostIds.map((serverId) => {
      const host = hosts.find((entry) => entry.serverId === serverId);
      return {
        id: serverId,
        value: serverId,
        label: host?.label?.trim() || serverId,
        description: t("plugins.target.host"),
        testID: `plugins-target-${serverId}`,
      };
    });
    if (!isClientPluginRuntimeSupported()) return hostOptions;
    return [
      {
        id: CLIENT_VALUE,
        value: CLIENT_VALUE,
        label: t("plugins.target.client"),
        testID: "plugins-target-client",
      },
      ...hostOptions,
    ];
  }, [hostIds, hosts, t]);

  const value = target.kind === "host" ? target.serverId : CLIENT_VALUE;
  const selectedDisplay = useMemo<SelectFieldDisplay | null>(() => {
    const option = options.find((entry) => entry.value === value);
    return option ? { label: option.label } : null;
  }, [options, value]);

  const handleChange = useCallback(
    (next: string) => {
      setTarget(next === CLIENT_VALUE ? { kind: "client" } : { kind: "host", serverId: next });
    },
    [setTarget],
  );

  return (
    <SelectField
      label={t("plugins.target.label")}
      value={value}
      selectedDisplay={selectedDisplay}
      options={options}
      onChange={handleChange}
      placeholder={t("plugins.target.label")}
      emptyText={t("plugins.target.none")}
      triggerTestID="plugins-target"
    />
  );
}
