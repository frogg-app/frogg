import { getDesignVariant } from "@/styles/design-variants";
import type { DesignVariantId } from "@/styles/theme";

const loaded = new Set<string>();

/** Inject the Google Fonts stylesheet a design variant asks for, once per variant. Offline or
 * blocked loads fall through to the variant's system stack. */
export function loadDesignWebFonts(variant: DesignVariantId): void {
  if (typeof document === "undefined" || loaded.has(variant)) return;
  const definition = getDesignVariant(variant);
  if (!definition || definition.webFonts.length === 0) return;
  loaded.add(variant);
  const families = definition.webFonts.map((family) => `family=${family}`).join("&");
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  link.dataset.designVariant = variant;
  document.head.appendChild(link);
}
