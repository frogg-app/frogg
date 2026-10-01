import AsyncStorage from "@/storage/brand-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { DesignVariantId } from "@/styles/theme";

export type DesignSchemePreference = "auto" | "light" | "dark";

interface DesignPreviewState {
  variant: DesignVariantId;
  scheme: DesignSchemePreference;
  switcherVisible: boolean;
  setVariant: (variant: DesignVariantId) => void;
  setScheme: (scheme: DesignSchemePreference) => void;
  setSwitcherVisible: (visible: boolean) => void;
}

const PersistedDesignPreviewSchema = z.object({
  variant: z.enum(["current", "inset", "mono", "paper", "focus", "soft"]),
  scheme: z.enum(["auto", "light", "dark"]),
  switcherVisible: z.boolean(),
});

/** The design directions are a review tool for development builds; releases ship `current` only. */
export const DESIGN_PREVIEW_ENABLED = typeof __DEV__ !== "undefined" && __DEV__;

const noop = () => {};

/**
 * Which UI-refresh design direction is being reviewed. `current` defers entirely to the
 * user's theme setting; any other variant takes over the theme until switched back.
 */
const persistedStore = DESIGN_PREVIEW_ENABLED ? createPersistedDesignPreviewStore() : null;

/** Hydration hooks for the persisted store; null in release builds. */
export const designPreviewPersist = persistedStore?.persist ?? null;

export const useDesignPreviewStore =
  persistedStore ??
  create<DesignPreviewState>()(() => ({
    variant: "current",
    scheme: "auto",
    switcherVisible: false,
    setVariant: noop,
    setScheme: noop,
    setSwitcherVisible: noop,
  }));

function createPersistedDesignPreviewStore() {
  return create<DesignPreviewState>()(
    persist(
      (set) => ({
        variant: "current",
        scheme: "auto",
        switcherVisible: true,
        setVariant: (variant) => set({ variant }),
        setScheme: (scheme) => set({ scheme }),
        setSwitcherVisible: (switcherVisible) => set({ switcherVisible }),
      }),
      {
        name: "design-preview",
        version: 1,
        storage: createValidatedPersistStorage(AsyncStorage, PersistedDesignPreviewSchema),
        partialize: ({ variant, scheme, switcherVisible }) => ({
          variant,
          scheme,
          switcherVisible,
        }),
      },
    ),
  );
}
