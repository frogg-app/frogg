import { useDesignPreviewStore } from "@/design/design-preview-store";
import { getDesignVariant } from "@/styles/design-variants";
import { CODE_SURFACE_DATASET } from "@/styles/code-surface";

/**
 * Web dataSet for metadata text styled with `panelMetaText`. When the active direction renders
 * metadata in mono, the text opts out of the app-wide UI-font rule so its mono family applies;
 * otherwise it stays undefined and the text keeps the UI font exactly as before.
 */
export function usePanelMetaDataSet(): typeof CODE_SURFACE_DATASET | undefined {
  const monoMeta = useDesignPreviewStore(
    (state) => getDesignVariant(state.variant)?.design.monoMeta ?? false,
  );
  return monoMeta ? CODE_SURFACE_DATASET : undefined;
}
