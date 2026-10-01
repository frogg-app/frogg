import { LeftSidebar } from "@/components/left-sidebar";
import { useIsCompactFormFactor } from "@/constants/layout";

/**
 * Mono follows Vercel's top-navigation dashboard: on desktop the header's host, project and
 * branch selectors plus its tabs replace the sidebar, so there is none. Compact layouts keep the
 * shipping drawer, opened from the header's menu button, as the full project tree.
 */
export function MonoSidebar({ active }: { active: boolean }) {
  const compact = useIsCompactFormFactor();
  return compact ? <LeftSidebar active={active} /> : null;
}
