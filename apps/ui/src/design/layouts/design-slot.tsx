import type { ReactNode } from "react";
import { useDesignPreviewStore } from "@/design/design-preview-store";
import type { DesignVariantId } from "@/styles/theme";
import { focusLayout } from "./focus";
import { insetLayout } from "./inset";
import { monoLayout } from "./mono";
import { paperLayout } from "./paper";
import type { DesignChrome, DesignLayout, DesignSlotName, DesignSlotProps } from "./slots";
import { softLayout } from "./soft";

const LAYOUTS: Record<DesignVariantId, DesignLayout> = {
  current: {},
  inset: insetLayout,
  mono: monoLayout,
  paper: paperLayout,
  focus: focusLayout,
  soft: softLayout,
};

const NO_CHROME: DesignChrome = {};

/** Which shipping chrome the active direction takes over. */
export function useDesignChrome(): DesignChrome {
  const variant = useDesignPreviewStore((state) => state.variant);
  return LAYOUTS[variant].chrome ?? NO_CHROME;
}

/** Whether the active direction replaces a region, for callers that must also drop a sibling. */
export function useDesignSlotOverride(name: DesignSlotName): boolean {
  const variant = useDesignPreviewStore((state) => state.variant);
  return LAYOUTS[variant][name] !== undefined;
}

/**
 * Renders the active direction's component for a region, or `children` (the shipping UI).
 * Reads the direction from the preview store, never from the theme, so it is a real value on
 * web too.
 */
export function DesignSlot<Name extends DesignSlotName>({
  name,
  props,
  children = null,
}: {
  name: Name;
  props: DesignSlotProps[Name];
  children?: ReactNode;
}) {
  const variant = useDesignPreviewStore((state) => state.variant);
  const Override = LAYOUTS[variant][name] as React.ComponentType<DesignSlotProps[Name]> | undefined;
  if (!Override) return children;
  return <Override {...props} />;
}
