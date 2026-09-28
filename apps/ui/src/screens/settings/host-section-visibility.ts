import { useMemo } from "react";
import { brand } from "@frogg/branding";
import type { HostSettingsSection } from "@frogg/protocol/messages";
import { getIsElectron, isWeb } from "@/constants/platform";
import { useDaemonConfig } from "@/hooks/use-daemon-config";
import { useSettings } from "@/hooks/use-settings";
import { isBetaBuild } from "@/utils/app-version";
import { HOST_SECTION_ITEMS, type HostSectionItem } from "@/screens/settings/section-items";
import { isHostSectionSlug, type HostSectionSlug } from "@/utils/host-routes";

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
  const hidden: readonly string[] = daemonHiddenSections ?? brand.hostSettings.hiddenSections;
  // A retired section (`usage`, folded into Providers) may still be listed; it
  // hides nothing, and in particular not the section it moved into.
  return hidden.filter(isHostSectionSlug);
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

/**
 * Pairing a device was its own section before it folded into Devices; a daemon
 * that still hides `pair-device` hides the pairing card there instead.
 */
export function useHostPairingHidden(serverId: string | null): boolean {
  const { config } = useDaemonConfig(serverId);
  const hidden: readonly string[] =
    config?.hostSettings?.hiddenSections ?? brand.hostSettings.hiddenSections;
  return hidden.includes("pair-device");
}

export function useVisibleHostSectionItems(serverId: string | null): HostSectionItem[] {
  const hidden = useHiddenHostSections(serverId);
  const developerOptions = useSettings((settings) => settings.developerOptions) || isBetaBuild();
  return useMemo(() => {
    const items = visibleHostSectionItems(hidden).filter(
      (item) => developerOptions || item.id !== "developer",
    );
    // The browser app is served by the web client itself; a page must not be able to switch
    // off the server that serves it, so only other clients get the section.
    return isWeb && !getIsElectron() ? items.filter((item) => item.id !== "web-client") : items;
  }, [developerOptions, hidden]);
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
