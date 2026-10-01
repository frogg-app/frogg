import type { DesignVariantId } from "@/styles/theme";

/**
 * How the home (open project) screen arranges its first-run actions for each design direction.
 * tiles: a grid of cards (current, Paper, Soft). hero: one big composer-like primary action with
 * quiet secondary chips (Focus). list: a single dense list (Mono, Inset).
 */
export type HomeLayout = "tiles" | "hero" | "list";

export interface HomePresentation {
  layout: HomeLayout;
  /** Show the greeting heading above the actions. `current` keeps today's logo-only header. */
  greeting: boolean;
  logoSize: number;
  /** Left-align the header and actions instead of centring them. */
  alignStart: boolean;
}

const PRESENTATION: Record<DesignVariantId, HomePresentation> = {
  current: { layout: "tiles", greeting: false, logoSize: 130, alignStart: false },
  paper: { layout: "tiles", greeting: true, logoSize: 52, alignStart: false },
  soft: { layout: "tiles", greeting: true, logoSize: 64, alignStart: false },
  focus: { layout: "hero", greeting: true, logoSize: 40, alignStart: false },
  mono: { layout: "list", greeting: true, logoSize: 28, alignStart: true },
  inset: { layout: "list", greeting: true, logoSize: 24, alignStart: true },
};

export function resolveHomePresentation(variant: DesignVariantId): HomePresentation {
  return PRESENTATION[variant] ?? PRESENTATION.current;
}
