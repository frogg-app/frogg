import { useMemo } from "react";
import { brand } from "@frogg/branding";
import type { HostSettingsSection } from "@frogg/protocol/messages";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { HOST_SECTION_ITEMS, type HostSectionItem } from "@/screens/settings/section-items";
import type { HostSectionSlug } from "@/utils/host-routes";

/**
 * Which sections of a host's settings this app offers for that host.
 *
 * The daemon owns the answer — it seeds its config from the brand's defaults
 * and an admin can re-enable a section there without a new build — so the brand
 * list is only the fallback for a daemon too old to have the key, or one the
 * app has not read the config from yet.
 */
export function resolveHiddenHostSections(
  daemonHiddenSections: readonly HostSettingsSection[] | undefined,
): readonly HostSectionSlug[] {
  return daemonHiddenSections ?? brand.hostSettings.hiddenSections;
}

export function isHostSectionVisible(
  section: HostSectionSlug,
  hidden: readonly HostSectionSlug[],
): boolean {
  return !hidden.includes(section);
}

export function visibleHostSectionItems(hidden: readonly HostSectionSlug[]): HostSectionItem[] {
  return HOST_SECTION_ITEMS.filter((item) => isHostSectionVisible(item.id, hidden));
}

export function useHiddenHostSections(serverId: string | null): readonly HostSectionSlug[] {
  const { config } = useDaemonConfig(serverId);
  const daemonHiddenSections = config?.hostSettings?.hiddenSections;
  return useMemo(() => resolveHiddenHostSections(daemonHiddenSections), [daemonHiddenSections]);
}

export function useVisibleHostSectionItems(serverId: string | null): HostSectionItem[] {
  const hidden = useHiddenHostSections(serverId);
  return useMemo(() => visibleHostSectionItems(hidden), [hidden]);
}

/**
 * Where a view of a hidden section should go instead. Returns the first section
 * this host still offers — its settings root is the compact layout's list, and
 * on desktop navigating there closes settings altogether.
 */
export function resolveHiddenSectionRedirect(input: {
  section: HostSectionSlug | null;
  hidden: readonly HostSectionSlug[];
  visible: readonly HostSectionItem[];
}): HostSectionSlug | null {
  if (!input.section || isHostSectionVisible(input.section, input.hidden)) return null;
  return input.visible[0]?.id ?? null;
}
