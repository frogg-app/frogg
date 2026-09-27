import type { ReactElement } from "react";
import { useTranslation } from "react-i18next";
import { i18n } from "@/i18n/i18next";
import { StatusBadge, type StatusBadgeVariant } from "@/components/ui/status-badge";

const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  active: "success",
  disabled: "muted",
  error: "error",
  incompatible: "warning",
  blocked: "warning",
  inactive: "muted",
};

/** Plugin status; unknown statuses from a newer host show verbatim. */
export function PluginStatusBadge({ status }: { status: string }): ReactElement {
  const { t } = useTranslation();
  const key = `plugins.status.${status}`;
  return (
    <StatusBadge
      label={t(key, { defaultValue: status })}
      variant={STATUS_VARIANT[status] ?? "muted"}
    />
  );
}

/** Where a plugin/repo comes from: official, brand, user or dev. */
export function PluginTierBadge({ tier }: { tier: string }): ReactElement {
  const { t } = useTranslation();
  return (
    <StatusBadge
      label={t(`plugins.tier.${tier}`, { defaultValue: tier })}
      variant={tier === "dev" || tier === "user" ? "warning" : "muted"}
    />
  );
}

/** Plain-language line for a capability; unknown ones from a newer host show verbatim. */
export function describeCapability(cap: string): string {
  return i18n.t(`plugins.capabilities.${cap.replace(/\./g, "_")}`, { defaultValue: cap });
}
